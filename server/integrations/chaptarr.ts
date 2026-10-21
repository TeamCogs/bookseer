import type { CatalogBook, LibraryItem, MediaKind } from '../../shared/types.js';
import type { ConnectionConfig } from '../config.js';
import { digest } from '../security.js';
import { identifiers, normalizeAuthor, normalizeText } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';

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
  async json(path: string, body?: unknown): Promise<unknown> {
    return readJson(
      await upstream(this.config.chaptarrUrl, '/api/v1' + path, {
        signal: this.controller.signal,
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Api-Key': this.config.chaptarrApiKey, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
  async inventory(): Promise<LibraryItem[]> {
    return array(await this.json('/book?include=author')).map((book) => this.map(book));
  }
  map(book: Record<string, any>): LibraryItem {
    if (
      !Number.isSafeInteger(book.id) ||
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
      coverUrl: Array.isArray(book.images)
        ? book.images.find((i: any) => i.coverType === 'cover')?.url
        : undefined,
      year: book.releaseDate ? Number(String(book.releaseDate).slice(0, 4)) : undefined,
    };
  }
  async submit(
    book: CatalogBook,
    kind: MediaKind,
    beforeWrite: () => void,
  ): Promise<{ id: number; available: boolean }> {
    if (!this.ready(kind))
      throw new IntegrationError(
        'Set Chaptarr root folders and profile IDs before enabling acquisition.',
      );
    const lookupTerm =
      book.identifiers.work.find((id) => /^(ol:|hc:|gr:|gb:)/.test(id)) ||
      `${book.title} ${book.author}`;
    const found = array(
      await this.json(`/book/lookup?term=${encodeURIComponent(lookupTerm)}&mediaType=${kind}`),
    );
    const matches = found.filter(
      (candidate) =>
        normalizeText(candidate.title || '') === normalizeText(book.title) &&
        normalizeAuthor(candidate.author?.authorName || candidate.author?.name || '') ===
          normalizeAuthor(book.author),
    );
    if (matches.length !== 1)
      throw new IntegrationError(
        'Chaptarr did not resolve a unique matching work. Review the book in Chaptarr before requesting it.',
      );
    const candidate = matches[0];
    const local =
      (kind === 'ebook' ? candidate.localEbookBooks : candidate.localAudiobookBooks) || [];
    const existing =
      local.find((b: any) => Number.isSafeInteger(b.id) && b.hasFiles) ||
      local.find((b: any) => Number.isSafeInteger(b.id));
    beforeWrite();
    if (existing?.hasFiles) return { id: existing.id, available: true };
    let id = existing?.id;
    if (!id) {
      const { root, quality, metadata } = this.profiles(kind);
      const payload = {
        ...candidate,
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
        },
        addOptions: { searchForNewBook: false, addType: 'manual' },
      };
      const response = object(await this.json(`/book?mediaType=${kind}`, payload));
      if (!Number.isSafeInteger(response.id) || response.id <= 0)
        throw new IntegrationError(
          'Chaptarr accepted a pending or unexpected add response. Verify it in Chaptarr; Bookseer will not retry automatically.',
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
