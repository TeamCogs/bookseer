import type {
  CatalogBook,
  ChaptarrMatchCandidate,
  LibraryItem,
  MediaKind,
} from '../../shared/types.js';
import type { ConnectionConfig } from '../config.js';
import { digest } from '../security.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';
import { rankChaptarrMatches, uniqueChaptarrMatch, type MatchInput } from './chaptarr-matching.js';
export class LookupPendingError extends IntegrationError {}
export class MatchReviewError extends IntegrationError {
  constructor(readonly candidates: ChaptarrMatchCandidate[]) {
    super(
      'Chaptarr did not resolve a unique matching work. Review and save the correct book match before retrying.',
    );
  }
}
export function queueReviewMessage(item: Record<string, any>): string {
  const details = (Array.isArray(item.statusMessages) ? item.statusMessages : [])
    .flatMap((entry: any) => (Array.isArray(entry.messages) ? entry.messages : []))
    .filter((message: unknown): message is string => typeof message === 'string')
    .join(' ')
    .slice(0, 1000);
  const prefix =
    item.trackedDownloadState === 'importBlocked'
      ? 'Download complete; Chaptarr blocked the library import.'
      : 'Chaptarr reported a download or import issue.';
  return `${prefix}${details ? ' ' + details : ' Review its queue.'} The existing download will not be requested again.`;
}
export class PendingAddError extends IntegrationError {
  constructor(readonly pendingId: number) {
    super('Chaptarr accepted the addition for background processing.');
  }
}

export class Chaptarr {
  private controller = new AbortController();
  cancel() {
    this.controller.abort();
  }
  readonly fingerprint: string;
  constructor(readonly config: ConnectionConfig) {
    this.fingerprint = digest(config.chaptarrUrl).slice(0, 12);
  }
  get configured() {
    return Boolean(this.config.chaptarrUrl && this.config.chaptarrApiKey);
  }
  profiles(kind: MediaKind) {
    return kind === 'ebook'
      ? {
          quality: this.config.ebookQualityProfileId,
          metadata: this.config.ebookMetadataProfileId,
          root: this.config.ebookRootFolder,
        }
      : {
          quality: this.config.audiobookQualityProfileId,
          metadata: this.config.audiobookMetadataProfileId,
          root: this.config.audiobookRootFolder,
        };
  }
  ready(kind: MediaKind) {
    const p = this.profiles(kind);
    return this.configured && p.quality > 0 && p.metadata > 0 && Boolean(p.root);
  }
  async json(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<unknown> {
    return readJson(
      await upstream(this.config.chaptarrUrl, '/api/v1' + path, {
        signal: this.controller.signal,
        method,
        headers: { 'X-Api-Key': this.config.chaptarrApiKey, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
  async inventory(): Promise<LibraryItem[]> {
    return array(await this.json('/book?include=author'))
      .map((book) => ({ book, item: this.map(book) }))
      .filter(
        ({ book, item }) =>
          item.available || book.monitored === true || book[item.mediaKind + 'Monitored'] === true,
      )
      .map(({ item }) => item);
  }
  map(book: Record<string, any>): LibraryItem {
    if (
      !Number.isSafeInteger(book.id) ||
      book.id <= 0 ||
      typeof book.title !== 'string' ||
      !['ebook', 'audiobook'].includes(book.mediaType)
    )
      throw new IntegrationError('Chaptarr book fields do not match the supported official API.');
    const files = Array.isArray(book.bookFiles) ? book.bookFiles : [];
    const formats = Array.isArray(book.formats)
      ? book.formats.filter((f: unknown) => typeof f === 'string')
      : files
          .map((f: any) =>
            String(f.path || '')
              .split('.')
              .pop(),
          )
          .filter(Boolean);
    const fileCount = Number(book.statistics?.bookFileCount || 0);
    const hasFiles =
      typeof book.hasFiles === 'boolean' ? book.hasFiles : fileCount > 0 || files.length > 0;
    const editions = Array.isArray(book.editions) ? book.editions : [];
    const prefixed = (prefix: string, value: unknown) =>
      typeof value === 'string' && value
        ? value.startsWith(prefix + ':')
          ? value
          : `${prefix}:${value}`
        : undefined;
    const workIds = [
      book.foreignBookId,
      prefixed('ol', book.openLibraryWorkId),
      prefixed('hc', book.hardcoverBookId),
      prefixed('gr', book.goodreadsWorkId),
    ];
    const image = Array.isArray(book.images)
      ? book.images.find((i: any) => i.coverType === 'cover')?.url
      : undefined;
    return {
      id: `chaptarr:${this.fingerprint}:${book.id}`,
      source: 'chaptarr',
      remoteId: String(book.id),
      title: book.title,
      author: book.author?.authorName || book.author?.name || book.authorTitle || '',
      mediaKind: book.mediaType,
      formats: [
        ...new Set<string>(formats.map((f: string | undefined) => String(f).toUpperCase())),
      ],
      available: hasFiles,
      identifiers: identifiers(
        editions.map((e: any) => e.isbn13 || e.isbn),
        workIds,
      ),
      url: `${this.config.chaptarrPublicUrl || this.config.chaptarrUrl}/book/${encodeURIComponent(book.titleSlug || book.foreignBookId || String(book.id))}`,
      coverUrl: image
        ? `/api/covers/${encodeURIComponent(`chaptarr:${this.fingerprint}:${book.id}`)}`
        : undefined,
      year: book.releaseDate ? Number(String(book.releaseDate).slice(0, 4)) : undefined,
    };
  }
  async cover(item: LibraryItem): Promise<Response> {
    if (!item.id.startsWith(`chaptarr:${this.fingerprint}:`))
      throw new IntegrationError('The cover belongs to a previous Chaptarr connection.');
    const book = object(await this.json(`/book/${encodeURIComponent(item.remoteId)}`));
    const raw = Array.isArray(book.images)
      ? book.images.find((image: any) => image.coverType === 'cover')?.url
      : undefined;
    if (typeof raw !== 'string') throw new IntegrationError('No Chaptarr cover is available.');
    const base = new URL(this.config.chaptarrUrl);
    const url = new URL(raw, this.config.chaptarrUrl + '/');
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      !/\/(mediacover|mediacoverproxy)(\/|$)/i.test(url.pathname)
    )
      throw new IntegrationError('The Chaptarr cover is not a local cover resource.');
    return upstream(url.origin, url.pathname + url.search, {
      signal: this.controller.signal,
      headers: { 'X-Api-Key': this.config.chaptarrApiKey },
    });
  }
  async candidates(
    book: CatalogBook,
    kind: MediaKind,
    confirmedWorkId?: string,
    includeAlternatives = false,
  ) {
    if (!this.ready(kind))
      throw new IntegrationError(
        'Set Chaptarr root folders and profile IDs before enabling acquisition.',
      );
    const lookupTerm =
      confirmedWorkId ||
      (/^(ol:|hc:|gr:|gb:)/.test(book.id) ? book.id : undefined) ||
      book.identifiers.work.find((id) => /^(ol:|hc:|gr:|gb:)/.test(id)) ||
      `${book.title} ${book.author}`;
    const found = array(
      await this.json(`/book/lookup?term=${encodeURIComponent(lookupTerm)}&mediaType=${kind}`),
    );
    const inputs: MatchInput[] = found
      .filter((candidate) => !candidate.mediaType || candidate.mediaType === kind)
      .map((candidate) => ({ book: candidate, canonical: /^(ol:|hc:|gr:|gb:)/.test(lookupTerm) }));
    let ranked = rankChaptarrMatches(book, kind, inputs, confirmedWorkId);
    const direct = uniqueChaptarrMatch(ranked, confirmedWorkId);
    if (direct && direct.summary.score >= 800 && !includeAlternatives) return ranked;
    let searched = false;
    for (const provider of ['goodreads', 'hardcover']) {
      try {
        const results = array(
          await this.json(`/search?term=${encodeURIComponent(book.title)}&provider=${provider}`),
        );
        searched = true;
        for (const result of results) {
          const candidate = result.book;
          if (
            candidate &&
            /^(hc|ol|gr):/.test(candidate.foreignBookId || '') &&
            /^(hc|ol|gr):/.test(candidate.author?.foreignAuthorId || '')
          )
            inputs.push({ book: candidate });
        }
      } catch {
        /* One optional provider may be unavailable; retain evidence from the others. */
      }
    }
    ranked = rankChaptarrMatches(book, kind, inputs, confirmedWorkId);
    if (found.length && !ranked.length) throw new MatchReviewError([]);
    if (!searched && !inputs.length)
      throw new IntegrationError(
        'Chaptarr native search providers could not be reached. Check its provider settings and network, then retry.',
      );
    return ranked;
  }
  async lookup(
    book: CatalogBook,
    kind: MediaKind,
    confirmedWorkId?: string,
  ): Promise<Record<string, any>> {
    const ranked = await this.candidates(book, kind, confirmedWorkId);
    const selected = uniqueChaptarrMatch(ranked, confirmedWorkId);
    if (!selected) {
      if (!ranked.length && !confirmedWorkId)
        throw new LookupPendingError('Chaptarr metadata is not ready for this work yet.');
      throw new MatchReviewError(ranked.map((m) => m.summary));
    }
    let candidate = selected.book;
    // Search previews may use an audiobook placeholder. Hydrate the chosen identity for this format.
    if (
      candidate.foreignBookId &&
      !ranked.some((m) => m === selected && m.summary.reason.includes('validated work lookup'))
    ) {
      const resolved = array(
        await this.json(
          `/book/lookup?term=${encodeURIComponent(candidate.foreignBookId)}&mediaType=${kind}`,
        ),
      );
      const hydrated = uniqueChaptarrMatch(
        rankChaptarrMatches(
          book,
          kind,
          resolved
            .filter((b) => !b.mediaType || b.mediaType === kind)
            .map((b) => ({ book: b, canonical: true })),
          candidate.foreignBookId,
        ),
        candidate.foreignBookId,
      );
      if (resolved.length && !hydrated) throw new MatchReviewError(ranked.map((m) => m.summary));
      if (hydrated) candidate = hydrated.book;
    }
    return { ...candidate, bookseerrMatch: selected.summary };
  }
  async submit(
    book: CatalogBook,
    kind: MediaKind,
    beforeWrite: () => void,
    resolved?: Record<string, any>,
    allowCreate = true,
  ): Promise<{ id: number; available: boolean }> {
    const candidate = resolved || (await this.lookup(book, kind));
    const local =
      (kind === 'ebook' ? candidate.localEbookBooks : candidate.localAudiobookBooks) || [];
    const existing =
      local.find((b: any) => Number.isSafeInteger(b.id) && b.hasFiles) ||
      local.find((b: any) => Number.isSafeInteger(b.id));
    beforeWrite();
    if (existing?.hasFiles) return { id: existing.id, available: true };
    let id = existing?.id;
    if (id) {
      const queued = (await this.queue()).find(
        (item) => item.bookId === id || item.book?.id === id,
      );
      if (queued) {
        if (
          queued.trackedDownloadState === 'importBlocked' ||
          ['error', 'warning'].includes(queued.trackedDownloadStatus)
        )
          throw new IntegrationError(queueReviewMessage(queued));
        return { id, available: false };
      }
    }
    if (existing && !existing.monitored) {
      const stored = object(await this.json(`/book/${id}`));
      if (stored.mediaType !== kind || stored.id !== id)
        throw new IntegrationError(
          'The existing Chaptarr instance does not match the requested format.',
        );
      if (stored.hasFiles) return { id, available: true };
      beforeWrite();
      await this.json(
        `/book/${id}?mediaType=${kind}`,
        { ...stored, monitored: true, [kind + 'Monitored']: true },
        'PUT',
      );
    }
    if (!id) {
      if (!allowCreate)
        throw new LookupPendingError(
          'The accepted Chaptarr addition has not created a local book yet.',
        );
      const { root, quality, metadata } = this.profiles(kind);
      const { bookseerrMatch: _explanation, ...upstreamCandidate } = candidate;
      const payload = {
        ...upstreamCandidate,
        id: 0,
        mediaType: kind,
        monitored: true,
        ebookMonitored: kind === 'ebook',
        audiobookMonitored: kind === 'audiobook',
        author: {
          ...candidate.author,
          rootFolderPath: root,
          qualityProfileId: quality,
          metadataProfileId: metadata,
          [kind + 'RootFolderPath']: root,
          [kind + 'QualityProfileId']: quality,
          [kind + 'MetadataProfileId']: metadata,
          monitored: false,
          ebookMonitored: false,
          audiobookMonitored: false,
          ebookMonitorExistingMode: 'none',
          audiobookMonitorExistingMode: 'none',
          ebookMonitorNewItems: 'none',
          audiobookMonitorNewItems: 'none',
          syncMonitoredAcrossFormats: false,
          addOptions: { monitor: 'specificBook' },
        },
        addOptions: { searchForNewBook: false, addType: 'manual' },
      };
      const response = object(await this.json(`/book?mediaType=${kind}`, payload));
      if (Number.isSafeInteger(response.pendingId) && response.pendingId > 0)
        throw new PendingAddError(response.pendingId);
      if (!Number.isSafeInteger(response.id) || response.id <= 0)
        throw new IntegrationError(
          'Chaptarr accepted a pending or unexpected add response. Verify it in Chaptarr; Bookseerr will not retry automatically.',
        );
      id = response.id;
    }
    beforeWrite();
    await this.json('/command', { name: 'BookSearch', bookIds: [id] });
    return { id, available: false };
  }
  async queue(): Promise<Record<string, any>[]> {
    const result: Record<string, any>[] = [];
    let total: number | undefined;
    for (let page = 1; page <= 100; page++) {
      const response = object(await this.json(`/queue?page=${page}&pageSize=100`));
      const records = array(response.records);
      if (!Number.isSafeInteger(response.totalRecords))
        throw new IntegrationError('Chaptarr queue pagination was not recognized.');
      if (total !== undefined && total !== response.totalRecords)
        throw new IntegrationError('The queue changed during pagination.');
      total = Number(response.totalRecords);
      result.push(...records);
      if (result.length === total) return result;
      if (!records.length || result.length > total) break;
    }
    throw new IntegrationError('Chaptarr returned an incomplete queue.');
  }
}
