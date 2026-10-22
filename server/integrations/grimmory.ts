import type { LibraryItem, MediaKind } from '../../shared/types.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';
import {
  audioFormats,
  ebookFormats,
  RemoteLibrary,
  selectedLibraries,
  type LibraryChoice,
} from './library.js';

export class Grimmory extends RemoteLibrary {
  private accessToken = '';
  private tokenExpires = 0;
  private authenticating?: Promise<void>;
  get configured() {
    return Boolean(this.config.url && this.config.username && this.config.password);
  }
  private async authenticate() {
    if (this.accessToken && this.tokenExpires > Date.now()) return;
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const data = object(
        await readJson(
          await upstream(this.config.url, '/api/v1/auth/login', {
            signal: this.controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: this.config.username,
              password: this.config.password,
            }),
          }),
        ),
      );
      if (typeof data.accessToken !== 'string' || !data.accessToken)
        throw new IntegrationError('Grimmory did not return an access token.');
      this.accessToken = data.accessToken;
      this.tokenExpires = Date.now() + 60000;
    })().finally(() => {
      this.authenticating = undefined;
    });
    return this.authenticating;
  }
  private async response(path: string) {
    await this.authenticate();
    return upstream(this.config.url, '/api/v1' + path, {
      signal: this.controller.signal,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }
  async libraries(): Promise<LibraryChoice[]> {
    return array(await readJson(await this.response('/libraries'))).map((library) => {
      if (!Number.isSafeInteger(library.id) || library.id <= 0)
        throw new IntegrationError('Grimmory returned an invalid library ID.');
      return {
        id: String(library.id),
        name: typeof library.name === 'string' ? library.name : String(library.id),
      };
    });
  }
  async inventory(): Promise<LibraryItem[]> {
    const libraries = selectedLibraries(await this.libraries(), this.config.libraryIds, 'Grimmory');
    const checkHealth = async () => {
      const health = object(await readJson(await this.response('/libraries/health')));
      if (libraries.some((library) => health[library.id] !== true))
        throw new IntegrationError(
          'A selected Grimmory library path is unavailable. Previous inventory has been retained.',
        );
    };
    await checkHealth();
    const result: LibraryItem[] = [];
    const seen = new Set<number>();
    for (const library of libraries) {
      // This endpoint returns the complete library, including metadata and alternate formats.
      const records = array(
        await readJson(await this.response(`/libraries/${encodeURIComponent(library.id)}/book`)),
      );
      for (const record of records) {
        if (
          !Number.isSafeInteger(record.id) ||
          record.id <= 0 ||
          seen.has(record.id) ||
          String(record.libraryId) !== library.id
        )
          throw new IntegrationError('Grimmory returned repeated or invalid book IDs.');
        seen.add(record.id);
        result.push(...this.map(record));
      }
    }
    await checkHealth();
    return result;
  }
  map(record: Record<string, any>): LibraryItem[] {
    if (typeof record.title !== 'string')
      throw new IntegrationError('Grimmory returned unsupported book fields.');
    if (record.isPhysical === true) return [];
    if (!record.primaryFile || typeof record.metadata !== 'object' || !record.metadata)
      throw new IntegrationError(
        'Grimmory did not return digital file and metadata details. Previous inventory has been retained.',
      );
    const metadata = object(record.metadata);
    const files = [object(record.primaryFile), ...array(record.alternativeFormats ?? [])];
    const byKind: Record<MediaKind, Set<string>> = { ebook: new Set(), audiobook: new Set() };
    for (const file of files) {
      if (file.isBook === false) continue;
      const extension = String(
        file.extension ||
          String(file.fileName || '')
            .split('.')
            .pop() ||
          file.bookType ||
          '',
      )
        .replace(/^\./, '')
        .toLowerCase();
      if (file.bookType === 'AUDIOBOOK' || audioFormats.has(extension))
        byKind.audiobook.add(audioFormats.has(extension) ? extension.toUpperCase() : 'AUDIO');
      else if (ebookFormats.has(extension)) byKind.ebook.add(extension.toUpperCase());
      else
        throw new IntegrationError(
          'Grimmory returned an unsupported digital book format. Previous inventory has been retained.',
        );
    }
    const author = Array.isArray(metadata.authors)
      ? metadata.authors.filter((a: unknown) => typeof a === 'string').join('; ')
      : '';
    const work: string[] = [];
    if (metadata.hardcoverId) work.push(`hc:${metadata.hardcoverId}`);
    // Open Library edition IDs must never be treated as work IDs.
    const ol = String(metadata.openlibraryId || '').match(/(?:^|\/works\/)(OL\d+W)$/i);
    if (ol) work.push(`ol:${ol[1].toUpperCase()}`);
    const year = Number(String(metadata.publishedDate || '').slice(0, 4));
    return (['ebook', 'audiobook'] as MediaKind[]).flatMap((kind) => {
      if (!byKind[kind].size) return [];
      return [
        this.item(
          String(record.id),
          kind,
          {
            title: record.title,
            author,
            formats: [...byKind[kind]],
            available: true,
            identifiers: identifiers([metadata.isbn13, metadata.isbn10], work),
            year: year > 0 ? year : undefined,
            url: `${this.config.publicUrl || this.config.url}/book/${record.id}`,
          },
          Boolean(
            kind === 'audiobook'
              ? metadata.audiobookCoverUpdatedOn || metadata.coverUpdatedOn
              : metadata.coverUpdatedOn,
          ),
        ),
      ];
    });
  }
  async cover(item: LibraryItem): Promise<Response> {
    this.checkCover(item);
    return this.response(
      `/media/book/${encodeURIComponent(item.remoteId)}/${item.mediaKind === 'audiobook' ? 'audiobook-thumbnail' : 'thumbnail'}`,
    );
  }
}
