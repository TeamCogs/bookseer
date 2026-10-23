import type {
  ChaptarrMatchCandidate,
  LibraryItem,
  MediaKind,
  Source,
  User,
} from '../shared/types.js';
import type { Config, ConnectionConfig } from './config.js';
import type { Store } from './store.js';
import { librarySource } from '../shared/libraries.js';
import { normalizeConnections } from './library-config.js';
import { libraryAdapter } from './integrations/libraries.js';
import type { LibraryAdapter } from './integrations/library.js';
import { IntegrationError } from './integrations/http.js';
import {
  Chaptarr,
  LookupPendingError,
  MatchReviewError,
  PendingAddError,
  queueReviewMessage,
} from './integrations/chaptarr.js';
import { OpenLibrary } from './integrations/openlibrary.js';
import { bookResult } from './matching.js';
import { decrypt, encrypt } from './security.js';

export class Services {
  chaptarr!: Chaptarr;
  discovery: OpenLibrary;
  connections!: ReturnType<typeof normalizeConnections>;
  private adapters = new Map<
    Source,
    Pick<LibraryAdapter, 'configured' | 'cancel' | 'inventory' | 'cover'>
  >();
  private generation = 0;
  private syncing = new Map<Source, Promise<void>>();
  private dispatching = new Set<string>();
  private submissions = new Set<Promise<void>>();
  enqueue(id: string) {
    if (this.stopping) return;
    const task = this.dispatch(id);
    this.submissions.add(task);
    void task
      .catch(() => {
        /* The persisted request is recovered on restart if the store itself fails. */
      })
      .finally(() => this.submissions.delete(task));
  }
  async drain() {
    await Promise.allSettled([...this.submissions]);
  }
  private stopping = false;
  private lastRequestInventoryCheck = 0;
  cancel() {
    this.stopping = true;
    for (const adapter of this.adapters.values()) adapter.cancel();
  }
  constructor(
    readonly config: Config,
    readonly store: Store,
  ) {
    const saved = store.setting('connections');
    this.connect(saved ? JSON.parse(decrypt(saved, config.secret)) : config.connections);
    this.discovery = new OpenLibrary(config.contact);
    store.db
      .prepare(
        "UPDATE requests SET status='needs_review', message='The server restarted during submission. Verify Chaptarr before retrying.', updated_at=? WHERE status='submitting'",
      )
      .run(new Date().toISOString());
    store.db
      .prepare(
        "UPDATE requests SET status='pending_setup',message='Library verification was interrupted. Waiting to recheck.',updated_at=? WHERE status='checking'",
      )
      .run(new Date().toISOString());
  }
  private connect(input: ConnectionConfig) {
    this.connections = normalizeConnections(input);
    this.chaptarr = new Chaptarr(this.connections);
    this.adapters = new Map([['chaptarr', this.chaptarr]]);
    for (const server of this.connections.libraryServers)
      this.adapters.set(librarySource(server), libraryAdapter(server, this.connections));
    for (const state of this.store.states()) {
      if (!this.adapters.has(state.source))
        this.store.setState({
          ...state,
          configured: false,
          status: 'unconfigured',
          error: undefined,
        });
    }
    for (const [source, adapter] of this.adapters) {
      const state = this.store.state(source);
      const server = this.connections.libraryServers.find(
        (server) => librarySource(server) === source,
      );
      const configured = Boolean(server) || adapter.configured;
      this.store.setState({
        ...state,
        source,
        name: server?.name || 'Chaptarr',
        provider: server?.provider,
        configured,
        snapshotVerified: false,
        status: configured && state.lastSuccess ? 'error' : 'unconfigured',
        error:
          configured && state.lastSuccess ? 'Waiting for a fresh connection check.' : undefined,
      });
    }
  }
  async cover(item: LibraryItem): Promise<Response> {
    const adapter = this.adapters.get(item.source);
    if (!adapter?.configured) throw new IntegrationError('This library server is not connected.');
    return adapter.cover(item);
  }
  saveConnections(input: ConnectionConfig, actor: User) {
    if (this.stopping) throw new Error('The server is shutting down.');
    const previous = this.connections;
    const next = normalizeConnections(input);
    const retained = new Set(next.libraryServers.map(librarySource));
    this.store.transaction(() => {
      this.store.setSetting('connections', encrypt(JSON.stringify(next), this.config.secret));
      for (const state of this.store.states())
        if (state.source !== 'chaptarr' && !retained.has(state.source))
          this.store.removeSource(state.source);
    });
    for (const adapter of this.adapters.values()) adapter.cancel();
    this.generation++;
    this.syncing.clear();
    this.connect(next);
    this.store.db
      .prepare(
        "UPDATE requests SET status='pending_setup',message='Connections changed. Waiting to recheck libraries.',updated_at=? WHERE status='checking'",
      )
      .run(new Date().toISOString());
    this.store.audit(
      actor.id,
      'connections.updated',
      'Connection settings updated. Credentials omitted.',
    );
    return previous;
  }
  async sync(source: Source): Promise<void> {
    if (this.stopping) return;
    if (this.syncing.has(source)) return this.syncing.get(source)!;
    const adapter = this.adapters.get(source);
    if (!adapter || this.config.demo || !this.store.state(source).configured) return;
    const task = (async () => {
      const previous = this.store.state(source);
      this.store.setState({
        ...previous,
        configured: true,
        status: 'syncing',
        snapshotVerified: previous.status === 'healthy' && previous.snapshotVerified !== false,
        lastAttempt: new Date().toISOString(),
        error: undefined,
      });
      try {
        if (!adapter.configured)
          throw new IntegrationError(
            'Enter the server URL and required credentials, then save and sync.',
          );
        const items = await adapter.inventory();
        // Do not commit an old connection's in-flight snapshot after settings change.
        if (adapter !== this.adapters.get(source)) return;
        this.store.replaceInventory(source, items);
      } catch (error) {
        if (adapter !== this.adapters.get(source)) return;
        this.store.setState({
          ...this.store.state(source),
          configured: true,
          status: 'error',
          error: error instanceof Error ? error.message : 'Inventory sync failed.',
        });
      }
    })();
    this.syncing.set(source, task);
    try {
      await task;
    } finally {
      if (this.syncing.get(source) === task) this.syncing.delete(source);
    }
  }
  private async syncInventories() {
    await Promise.allSettled([...this.adapters.keys()].map((source) => this.sync(source)));
  }
  async syncAll() {
    await this.syncInventories();
    await this.refreshRequests();
  }
  private matchKey(catalogId: string, kind: MediaKind) {
    return `chaptarr_match:${this.chaptarr.fingerprint}:${catalogId}:${kind}`;
  }
  savedMatch(
    catalogId: string,
    kind: MediaKind,
  ): (ChaptarrMatchCandidate & { confirmedBy?: string }) | undefined {
    const value = this.store.setting(this.matchKey(catalogId, kind));
    return value ? JSON.parse(value) : undefined;
  }
  async requestMatches(id: string) {
    const request = this.store.request(id);
    const book = request && this.store.book(String(request.catalog_id));
    if (!request || !book) throw new Error('Request not found.');
    const kind = request.media_kind as MediaKind;
    const candidates = await this.chaptarr.candidates(book, kind, undefined, true);
    return {
      items: candidates.map((candidate) => candidate.summary),
      saved: this.savedMatch(book.id, kind),
    };
  }
  async confirmRequestMatch(id: string, workId: string, actor: User) {
    const request = this.store.request(id);
    const book = request && this.store.book(String(request.catalog_id));
    if (!request || !book) throw new Error('Request not found.');
    const eligible = ['needs_review', 'failed', 'cancelled', 'rejected'];
    if (!eligible.includes(String(request.status)))
      throw new Error('Only a stopped request can change its book match.');
    const kind = request.media_kind as MediaKind;
    const adapter = this.chaptarr;
    const candidates = await adapter.candidates(book, kind, undefined, true);
    if (!candidates.some((candidate) => candidate.summary.workId === workId))
      throw new Error('Select one of the verified matching works.');
    const selected = await adapter.lookup(book, kind, workId);
    this.store.transaction(() => {
      if (this.chaptarr !== adapter)
        throw new Error('Connections changed during review. Load the matching books again.');
      if (
        this.store.request(id)?.updated_at !== request.updated_at ||
        !eligible.includes(String(this.store.request(id)?.status))
      )
        throw new Error('The request changed during review.');
      this.store.setSetting(
        this.matchKey(book.id, kind),
        JSON.stringify({
          ...selected.bookseerrMatch,
          confirmedBy: actor.id,
          confirmedAt: new Date().toISOString(),
        }),
      );
      this.store.setSetting(`lookup_retry:${id}`, '');
      this.store.audit(
        actor.id,
        'request.match_confirmed',
        JSON.stringify({ id, workId, reason: selected.bookseerrMatch.reason }),
      );
      this.store.updateRequest(
        id,
        'pending_setup',
        'Book identity confirmed. Rechecking the libraries and existing download before acquisition.',
      );
    });
    this.enqueue(id);
  }
  async dispatch(id: string): Promise<void> {
    if (this.stopping || this.dispatching.has(id) || this.config.demo) return;
    const request = this.store.request(id);
    if (
      !request ||
      !['pending_setup', 'pending_metadata', 'pending_upstream'].includes(String(request.status))
    )
      return;
    const pendingKey = `pending_add:${id}`;
    const savedPending = this.store.setting(pendingKey);
    const pending = savedPending
      ? (JSON.parse(savedPending) as { pendingId: number; createdAt: number })
      : undefined;
    if (pending && Date.now() - pending.createdAt > 6 * 3600000) {
      this.store.updateRequest(
        id,
        'needs_review',
        'Chaptarr accepted the addition but it has not resolved after six hours. Check its pending operations before reopening.',
      );
      return;
    }
    const retryKey = `lookup_retry:${id}`;
    const savedRetry = this.store.setting(retryKey);
    const retry = savedRetry
      ? (JSON.parse(savedRetry) as { attempts: number; after: number })
      : { attempts: 0, after: 0 };
    if (retry.after > Date.now()) return;
    const book = this.store.book(String(request.catalog_id));
    const kind = request.media_kind as MediaKind;
    if (!book) return;
    const availability = bookResult(book, this.store, this.config.inventoryMaxAgeHours)
      .availability[kind];
    if (availability.status === 'available') {
      this.store.updateRequest(
        id,
        'available',
        'An available copy is already in your connected library.',
      );
      return;
    }
    if (availability.status !== 'not_found') {
      const waiting =
        availability.status === 'unknown' &&
        (!availability.confirmed || availability.items.length > 0);
      this.store.updateRequest(
        id,
        waiting ? 'pending_setup' : 'needs_review',
        waiting
          ? 'Waiting for complete, fresh library verification before acquisition.'
          : availability.reason,
      );
      return;
    }
    if (!this.chaptarr.ready(kind)) {
      this.store.updateRequest(
        id,
        'pending_setup',
        'Approved. Configure Chaptarr acquisition and the format’s destination to continue.',
      );
      return;
    }
    const reserved = this.store.db
      .prepare(
        "UPDATE requests SET status='checking',message='Resolving metadata and checking connected inventories.',updated_at=? WHERE id=? AND status IN ('pending_setup','pending_metadata','pending_upstream')",
      )
      .run(new Date().toISOString(), id);
    if (!reserved.changes) return;
    const generation = this.generation;
    this.dispatching.add(id);
    try {
      if (request.upstream_id) {
        const existingDownload = (await this.chaptarr.queue()).find(
          (item) => item.bookId === request.upstream_id || item.book?.id === request.upstream_id,
        );
        if (
          this.stopping ||
          generation !== this.generation ||
          this.store.request(id)?.status !== 'checking'
        )
          return;
        if (existingDownload) {
          const blocked =
            existingDownload.trackedDownloadState === 'importBlocked' ||
            ['error', 'warning'].includes(existingDownload.trackedDownloadStatus);
          this.store.updateRequest(
            id,
            blocked ? 'needs_review' : 'downloading',
            blocked
              ? queueReviewMessage(existingDownload)
              : 'The existing Chaptarr download is still being processed; no new search was sent.',
          );
          return;
        }
      }
      const savedMatch = this.savedMatch(book.id, kind);
      const resolved = await this.chaptarr.lookup(book, kind, savedMatch?.workId);
      if (
        this.stopping ||
        generation !== this.generation ||
        this.store.request(id)?.status !== 'checking'
      )
        return;
      if (resolved.bookseerrMatch?.workId) {
        this.store.setSetting(
          this.matchKey(book.id, kind),
          JSON.stringify({
            ...resolved.bookseerrMatch,
            confirmedBy: savedMatch?.confirmedBy,
            resolvedAt: new Date().toISOString(),
          }),
        );
      }
      if (
        typeof resolved.foreignBookId === 'string' &&
        /^(ol:|hc:|gr:|gb:)/.test(resolved.foreignBookId)
      ) {
        book.identifiers = {
          ...book.identifiers,
          work: [...new Set([resolved.foreignBookId, ...book.identifiers.work])],
        };
        this.store.saveBook(book);
      }
      if (
        pending &&
        !(kind === 'ebook' ? resolved.localEbookBooks : resolved.localAudiobookBooks)?.some(
          (copy: { id: number }) => Number.isSafeInteger(copy.id) && copy.id > 0,
        )
      )
        throw new LookupPendingError(
          'Waiting for the accepted Chaptarr addition to create its local instance.',
        );
      await this.syncInventories();
      if (
        this.stopping ||
        generation !== this.generation ||
        this.store.request(id)?.status !== 'checking'
      )
        return;
      const checked = bookResult(book, this.store, this.config.inventoryMaxAgeHours).availability[
        kind
      ];
      if (checked.status === 'available') {
        this.store.updateRequest(
          id,
          'available',
          'An available copy was found while rechecking your connected libraries.',
        );
        return;
      }
      if (checked.status !== 'not_found') {
        const waiting =
          checked.status === 'unknown' && (!checked.confirmed || checked.items.length > 0);
        this.store.updateRequest(
          id,
          waiting ? 'pending_setup' : 'needs_review',
          waiting
            ? 'Waiting for complete, fresh library verification before acquisition.'
            : checked.reason,
        );
        return;
      }
      const ready = this.store.db
        .prepare(
          "UPDATE requests SET status='submitting',message='Sending the verified missing format to Chaptarr.',updated_at=? WHERE id=? AND status='checking'",
        )
        .run(new Date().toISOString(), id);
      if (!ready.changes) return;
      const result = await this.chaptarr.submit(
        book,
        kind,
        () => {
          if (this.stopping) throw new Error('Submission interrupted by server shutdown.');
          if (generation !== this.generation)
            throw new Error(
              'Connections changed during submission. Review Chaptarr before retrying.',
            );
          const current = bookResult(book, this.store, this.config.inventoryMaxAgeHours)
            .availability[kind];
          if (current.status !== 'not_found')
            throw new Error(
              'Library availability changed during submission. Review before continuing.',
            );
        },
        resolved,
        !pending,
      );
      this.store.setSetting(retryKey, '');
      this.store.setSetting(pendingKey, '');
      this.store.updateRequest(
        id,
        result.available ? 'available' : 'requested',
        result.available
          ? 'Chaptarr already has an available copy.'
          : 'Sent to official Chaptarr. Waiting for an eligible release.',
        result.id,
      );
    } catch (error) {
      if (
        this.store.request(id)?.status === 'cancelled' ||
        this.store.request(id)?.status === 'rejected'
      )
        return;
      if (this.stopping && this.store.request(id)?.status === 'checking') {
        this.store.updateRequest(
          id,
          'pending_setup',
          'Verification interrupted by shutdown; it will resume safely.',
        );
        return;
      }
      if (error instanceof PendingAddError) {
        this.store.transaction(() => {
          this.store.setSetting(
            pendingKey,
            JSON.stringify({ pendingId: error.pendingId, createdAt: Date.now() }),
          );
          this.store.updateRequest(
            id,
            'pending_upstream',
            'Chaptarr accepted the addition. Waiting for its local book record; the add will not be repeated.',
          );
        });
        return;
      }
      if (error instanceof LookupPendingError && (pending || retry.attempts < 6)) {
        const attempts = retry.attempts + 1;
        this.store.setSetting(
          retryKey,
          JSON.stringify({
            attempts,
            after: Date.now() + Math.min(15, 2 ** (attempts - 1)) * 60000,
          }),
        );
        this.store.updateRequest(
          id,
          pending ? 'pending_upstream' : 'pending_metadata',
          pending
            ? 'Waiting for the accepted Chaptarr addition. Only its status is being checked; no new add is sent.'
            : 'Waiting for Chaptarr metadata. Lookup will retry automatically before any book is added.',
        );
        return;
      }
      this.store.updateRequest(
        id,
        'needs_review',
        `${error instanceof Error ? error.message : 'Submission could not be verified.'} Verify Chaptarr before retrying; automatic retries are disabled.`,
      );
      if (error instanceof MatchReviewError)
        this.store.setSetting(`match_review:${id}`, JSON.stringify(error.candidates));
    } finally {
      this.dispatching.delete(id);
    }
  }
  async refreshRequests() {
    if (this.stopping || this.config.demo) return;
    const active = this.store.db
      .prepare(
        "SELECT * FROM requests WHERE status IN ('pending_setup','pending_metadata','pending_upstream','requested','downloading','importing','needs_review')",
      )
      .all() as Record<string, unknown>[];
    if (!active.length) return;
    let queue: Record<string, any>[] | undefined;
    if (this.chaptarr.configured && active.some((r) => r.upstream_id)) {
      try {
        queue = await this.chaptarr.queue();
      } catch {
        /* Retain the last verified request state when polling fails. */
      }
      if (Date.now() - this.lastRequestInventoryCheck > 60000) {
        this.lastRequestInventoryCheck = Date.now();
        await this.sync('chaptarr');
      }
    }
    for (const request of active) {
      const id = String(request.id);
      const book = this.store.book(String(request.catalog_id));
      const latest = this.store.request(id);
      if (
        !latest ||
        ![
          'pending_setup',
          'pending_metadata',
          'pending_upstream',
          'requested',
          'downloading',
          'importing',
          'needs_review',
        ].includes(String(latest.status))
      )
        continue;
      if (!book) continue;
      if (
        bookResult(book, this.store, this.config.inventoryMaxAgeHours).availability[
          request.media_kind as MediaKind
        ].status === 'available'
      ) {
        this.store.updateRequest(id, 'available', 'Available in your connected library.');
        continue;
      }
      if (
        ['pending_setup', 'pending_metadata', 'pending_upstream'].includes(String(request.status))
      ) {
        this.enqueue(id);
        continue;
      }
      const item = queue?.find(
        (q) => q.bookId === request.upstream_id || q.book?.id === request.upstream_id,
      );
      if (!item) continue;
      if (
        item.trackedDownloadState === 'importBlocked' ||
        item.trackedDownloadStatus === 'error' ||
        item.trackedDownloadStatus === 'warning'
      )
        this.store.updateRequest(id, 'needs_review', queueReviewMessage(item));
      else if (latest.status === 'needs_review') continue;
      else if (/import/i.test(item.trackedDownloadState || ''))
        this.store.updateRequest(id, 'importing', 'Chaptarr is processing the completed download.');
      else this.store.updateRequest(id, 'downloading', 'Downloading through Chaptarr.');
    }
  }
}
