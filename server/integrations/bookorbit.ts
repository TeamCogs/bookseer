import type { LibraryItem, MediaKind, Source } from '../../shared/types.js';
import type { ConnectionConfig } from '../config.js';
import { digest } from '../security.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';
import { selectedLibraries, type LibraryAdapter, type LibraryChoice } from './library.js';

const audio = new Set(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']);
const ebook = new Set([
  'epub',
  'kepub',
  'pdf',
  'mobi',
  'azw',
  'azw3',
  'fb2',
  'djvu',
  'cbz',
  'cbr',
  'cb7',
]);
export class BookOrbit implements LibraryAdapter {
  private controller = new AbortController();
  cancel() {
    this.controller.abort();
  }
  private accessToken?: string;
  private tokenExpires = 0;
  readonly fingerprint: string;
  constructor(
    readonly config: ConnectionConfig,
    readonly source: Source = 'bookorbit',
    readonly name = 'BookOrbit',
  ) {
    this.fingerprint = digest(
      `${config.bookorbitUrl}|${config.bookorbitUsername}|${config.bookorbitLibraryIds}`,
    ).slice(0, 12);
  }
  async libraries(): Promise<LibraryChoice[]> {
    return array(await readJson(await this.response('/libraries')))
      .filter((library) => library.type === 'books')
      .map((library) => {
        if (!Number.isSafeInteger(library.id) || library.id <= 0)
          throw new IntegrationError('BookOrbit returned an invalid library ID.');
        return {
          id: String(library.id),
          name: typeof library.name === 'string' ? library.name : String(library.id),
        };
      });
  }
  get configured() {
    return Boolean(
      this.config.bookorbitUrl && this.config.bookorbitUsername && this.config.bookorbitPassword,
    );
  }
  async authenticate() {
    if (this.accessToken && this.tokenExpires > Date.now()) return;
    const result = object(
      await readJson(
        await upstream(this.config.bookorbitUrl, '/api/v1/auth/login', {
          signal: this.controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.config.bookorbitUsername,
            password: this.config.bookorbitPassword,
          }),
        }),
      ),
    );
    if (typeof result.accessToken !== 'string')
      throw new IntegrationError('BookOrbit did not return an access token.');
    this.accessToken = result.accessToken;
    this.tokenExpires = Date.now() + 10 * 60000;
  }
  async response(path: string, body?: unknown) {
    await this.authenticate();
    return upstream(this.config.bookorbitUrl, '/api/v1' + path, {
      signal: this.controller.signal,
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async inventory(): Promise<LibraryItem[]> {
    const libraries = selectedLibraries(
      await this.libraries(),
      this.config.bookorbitLibraryIds,
      'BookOrbit',
    );
    const result: LibraryItem[] = [];
    for (const library of libraries) {
      const seen = new Set<string>();
      let expected: number | undefined;
      for (let page = 0; page < 1000; page++) {
        const data = object(
          await readJson(
            await this.response(`/libraries/${encodeURIComponent(String(library.id))}/books`, {
              sort: [{ field: 'title', dir: 'asc' }],
              pagination: { page, size: 100 },
              collapseSeries: false,
            }),
          ),
        );
        const records = array(data.items);
        if (
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          (expected !== undefined && data.total !== expected)
        )
          throw new IntegrationError(
            'BookOrbit inventory changed during pagination. Retry the sync.',
          );
        expected = Number(data.total);
        for (const record of records) {
          const id = String(record.id);
          if (!Number.isSafeInteger(record.id) || seen.has(id))
            throw new IntegrationError('BookOrbit returned a repeated or invalid book ID.');
          seen.add(id);
          result.push(...this.map(record));
        }
        if (seen.size === expected) break;
        if (!records.length || seen.size > expected || page === 999)
          throw new IntegrationError(
            'BookOrbit returned an incomplete inventory. Previous inventory has been retained.',
          );
      }
    }
    return result;
  }
  map(record: Record<string, any>): LibraryItem[] {
    if (typeof record.title !== 'string' || !Array.isArray(record.files))
      throw new IntegrationError('BookOrbit book fields do not match the supported API.');
    const files = array(record.files).filter(
      (f) => ['primary', 'content'].includes(f.role) && typeof f.format === 'string',
    );
    const authors = Array.isArray(record.authors)
      ? record.authors
          .map((a) => (typeof a === 'string' ? a : a?.name))
          .filter((a) => typeof a === 'string')
      : [];
    const ids = identifiers(
      [record.isbn13, record.isbn10],
      [record.hardcoverId ? `hc:${record.hardcoverId}` : null],
    );
    return (['ebook', 'audiobook'] as MediaKind[]).flatMap((kind) => {
      const formats = [
        ...new Set(
          files
            .filter((f) =>
              kind === 'audiobook'
                ? audio.has(f.format.toLowerCase())
                : ebook.has(f.format.toLowerCase()),
            )
            .map((f) => String(f.format).toUpperCase()),
        ),
      ];
      if (!formats.length) return [];
      const id = `${this.source}:${this.fingerprint}:${record.id}:${kind}`;
      return [
        {
          id,
          source: this.source,
          sourceName: this.name,
          remoteId: String(record.id),
          title: record.title,
          author: authors.join('; '),
          mediaKind: kind,
          formats,
          available: record.status === 'present',
          identifiers: ids,
          year: typeof record.publishedYear === 'number' ? record.publishedYear : undefined,
          url: `${this.config.bookorbitPublicUrl || this.config.bookorbitUrl}/book/${record.id}`,
          coverUrl: record.hasCover ? `/api/covers/${encodeURIComponent(id)}` : undefined,
        },
      ];
    });
  }
  async cover(item: LibraryItem): Promise<Response> {
    if (item.source !== this.source || !item.id.startsWith(`${this.source}:${this.fingerprint}:`))
      throw new IntegrationError(
        'The cover belongs to a previous connection. Sync the new connection first.',
      );
    return this.response(
      `/books/${encodeURIComponent(item.remoteId)}/thumbnail?medium=${item.mediaKind === 'audiobook' ? 'audio' : 'ebook'}`,
    );
  }
}
