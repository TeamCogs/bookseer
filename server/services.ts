import type { MediaKind, Source, User } from '../shared/types.js';
import type { Config, ConnectionConfig } from './config.js';
import type { Store } from './store.js';
import { BookOrbit } from './integrations/bookorbit.js';
import { Chaptarr, LookupPendingError, PendingAddError } from './integrations/chaptarr.js';
import { OpenLibrary } from './integrations/openlibrary.js';
import { bookResult } from './matching.js';
import { decrypt, encrypt } from './security.js';

export class Services {
  bookorbit: BookOrbit;
  chaptarr: Chaptarr;
  discovery: OpenLibrary;
  connections: ConnectionConfig;
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
    this.bookorbit.cancel();
    this.chaptarr.cancel();
  }
  constructor(
    readonly config: Config,
    readonly store: Store,
  ) {
    const saved = store.setting('connections');
    this.connections = saved ? JSON.parse(decrypt(saved, config.secret)) : config.connections;
    this.bookorbit = new BookOrbit(this.connections);
    this.chaptarr = new Chaptarr(this.connections);
    this.discovery = new OpenLibrary(config.contact);
    for (const source of ['bookorbit', 'chaptarr'] as Source[]) {
      const state = store.state(source);
      const configured = this[source].configured;
      store.setState({
        ...state,
        source,
        configured,
        status: configured ? (state.lastSuccess ? 'error' : 'unconfigured') : 'unconfigured',
        error:
          configured && state.lastSuccess
            ? 'Waiting for a fresh connection check after startup.'
            : undefined,
      });
    }
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
  saveConnections(input: ConnectionConfig, actor: User) {
    if (this.stopping) throw new Error('The server is shutting down.');
    const previous = this.connections;
    this.store.setSetting('connections', encrypt(JSON.stringify(input), this.config.secret));
    this.bookorbit.cancel();
    this.chaptarr.cancel();
    this.syncing.clear();
    this.connections = input;
    this.bookorbit = new BookOrbit(input);
    this.chaptarr = new Chaptarr(input);
    for (const source of ['bookorbit', 'chaptarr'] as Source[]) {
      this.store.setState({
        ...this.store.state(source),
        configured: this[source].configured,
        status: 'unconfigured',
        error: undefined,
        lastSuccess: undefined,
      });
    }
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
    const adapter = this[source];
    if (!adapter.configured || this.config.demo) return;
    const task = (async () => {
      this.store.setState({
        ...this.store.state(source),
        configured: true,
        status: 'syncing',
        lastAttempt: new Date().toISOString(),
        error: undefined,
      });
      try {
        const items = await adapter.inventory();
        // Do not commit an old connection's in-flight snapshot after settings change.
        if (adapter !== this[source]) return;
        this.store.replaceInventory(source, items);
      } catch (error) {
        if (adapter !== this[source]) return;
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
  async syncAll() {
    await Promise.allSettled([this.sync('bookorbit'), this.sync('chaptarr')]);
    await this.refreshRequests();
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
    this.dispatching.add(id);
    try {
      const resolved = await this.chaptarr.lookup(book, kind);
      if (this.stopping || this.store.request(id)?.status !== 'checking') return;
      if (
        pending &&
        !(kind === 'ebook' ? resolved.localEbookBooks : resolved.localAudiobookBooks)?.some(
          (copy: { id: number }) => Number.isSafeInteger(copy.id) && copy.id > 0,
        )
      )
        throw new LookupPendingError(
          'Waiting for the accepted Chaptarr addition to create its local instance.',
        );
      await Promise.all([this.sync('bookorbit'), this.sync('chaptarr')]);
      if (this.stopping || this.store.request(id)?.status !== 'checking') return;
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
      if (latest.status === 'needs_review') continue;
      const item = queue?.find(
        (q) => q.bookId === request.upstream_id || q.book?.id === request.upstream_id,
      );
      if (!item) continue;
      if (item.trackedDownloadStatus === 'error' || item.trackedDownloadStatus === 'warning')
        this.store.updateRequest(
          id,
          'needs_review',
          'Chaptarr reported a download or import issue. Review its queue.',
        );
      else if (/import/i.test(item.trackedDownloadState || ''))
        this.store.updateRequest(id, 'importing', 'Chaptarr is processing the completed download.');
      else this.store.updateRequest(id, 'downloading', 'Downloading through Chaptarr.');
    }
  }
}
