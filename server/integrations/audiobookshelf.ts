import type { LibraryItem, MediaKind } from '../../shared/types.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';
import { audioFormats, RemoteLibrary, selectedLibraries, type LibraryChoice } from './library.js';

export class Audiobookshelf extends RemoteLibrary {
  get configured() {
    return Boolean(this.config.url && this.config.apiKey);
  }
  private response(path: string) {
    return upstream(this.config.url, '/api' + path, {
      signal: this.controller.signal,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });
  }
  async libraries(): Promise<LibraryChoice[]> {
    const data = object(await readJson(await this.response('/libraries')));
    return array(data.libraries)
      .filter((library) => library.mediaType === 'book')
      .map((library) => {
        if (typeof library.id !== 'string' || !library.id)
          throw new IntegrationError('Audiobookshelf returned an invalid library ID.');
        return {
          id: library.id,
          name: typeof library.name === 'string' ? library.name : library.id,
        };
      });
  }
  async inventory(): Promise<LibraryItem[]> {
    const libraries = selectedLibraries(
      await this.libraries(),
      this.config.libraryIds,
      'Audiobookshelf',
    );
    const result: LibraryItem[] = [];
    const allIds = new Set<string>();
    for (const library of libraries) {
      let expected: number | undefined;
      let count = 0;
      for (let page = 0; page < 10000; page++) {
        const data = object(
          await readJson(
            await this.response(
              `/libraries/${encodeURIComponent(library.id)}/items?limit=100&page=${page}&minified=0&collapseseries=0&sort=media.metadata.title`,
            ),
          ),
        );
        if (
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          (expected !== undefined && expected !== data.total) ||
          (data.page !== undefined && Number(data.page) !== page)
        )
          throw new IntegrationError(
            'Audiobookshelf inventory changed during pagination. Retry the sync.',
          );
        expected = Number(data.total);
        const records = array(data.results);
        for (const record of records) {
          if (
            typeof record.id !== 'string' ||
            !record.id ||
            allIds.has(record.id) ||
            record.libraryId !== library.id ||
            record.mediaType !== 'book'
          )
            throw new IntegrationError('Audiobookshelf returned repeated or invalid book IDs.');
          allIds.add(record.id);
          count++;
          result.push(...this.map(record));
        }
        if (count === expected) break;
        if (!records.length || count > expected || page === 9999)
          throw new IntegrationError(
            'Audiobookshelf returned an incomplete inventory. Previous inventory has been retained.',
          );
      }
    }
    return result;
  }
  map(record: Record<string, any>): LibraryItem[] {
    const media = object(record.media);
    const metadata = object(media.metadata);
    if (
      typeof metadata.title !== 'string' ||
      typeof record.isMissing !== 'boolean' ||
      typeof record.isInvalid !== 'boolean' ||
      !Array.isArray(media.audioFiles) ||
      !Object.hasOwn(media, 'ebookFile')
    )
      throw new IntegrationError(
        'Audiobookshelf did not return full file details. Previous inventory has been retained.',
      );
    const audio = array(media.audioFiles);
    const ebook = media.ebookFile ? object(media.ebookFile) : undefined;
    const formats: Record<MediaKind, string[]> = {
      audiobook: [
        ...new Set(
          audio.map((file) => {
            const extension = String(
              file.metadata?.ext || file.metadata?.filename?.split('.').pop() || '',
            )
              .replace(/^\./, '')
              .toLowerCase();
            return audioFormats.has(extension) ? extension.toUpperCase() : 'AUDIO';
          }),
        ),
      ],
      ebook: ebook
        ? [
            String(ebook.ebookFormat || ebook.metadata?.ext || 'EBOOK')
              .replace(/^\./, '')
              .toUpperCase(),
          ]
        : [],
    };
    const authors = Array.isArray(metadata.authors)
      ? metadata.authors
          .map((author: any) => (typeof author === 'string' ? author : author?.name))
          .filter((author: unknown) => typeof author === 'string')
      : [];
    const author =
      authors.join('; ') || (typeof metadata.authorName === 'string' ? metadata.authorName : '');
    const year = Number(metadata.publishedYear);
    return (['ebook', 'audiobook'] as MediaKind[]).flatMap((kind) => {
      if (!formats[kind].length) return [];
      return [
        this.item(
          String(record.id),
          kind,
          {
            title: metadata.title,
            author,
            formats: formats[kind],
            available:
              !record.isMissing &&
              !record.isInvalid &&
              (kind !== 'audiobook' || audio.every((file) => !file.isInvalid && !file.invalid)),
            identifiers: identifiers([metadata.isbn], []),
            year: Number.isInteger(year) && year > 0 ? year : undefined,
            url: `${this.config.publicUrl || this.config.url}/item/${encodeURIComponent(String(record.id))}`,
          },
          Boolean(media.coverPath),
        ),
      ];
    });
  }
  async cover(item: LibraryItem): Promise<Response> {
    this.checkCover(item);
    return this.response(`/items/${encodeURIComponent(item.remoteId)}/cover`);
  }
}
