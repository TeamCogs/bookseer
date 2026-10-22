import type { LibraryItem, LibraryServerConfig, MediaKind, Source } from '../../shared/types.js';
import { librarySource } from '../../shared/libraries.js';
import { digest } from '../security.js';
import { IntegrationError } from './http.js';

export interface LibraryChoice {
  id: string;
  name: string;
}
export interface LibraryAdapter {
  readonly configured: boolean;
  cancel(): void;
  libraries(): Promise<LibraryChoice[]>;
  inventory(): Promise<LibraryItem[]>;
  cover(item: LibraryItem): Promise<Response>;
}

export const audioFormats = new Set([
  'm4b',
  'mp3',
  'm4a',
  'aac',
  'opus',
  'ogg',
  'flac',
  'wav',
  'wma',
]);
export const ebookFormats = new Set([
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

export function selectedLibraries(
  libraries: LibraryChoice[],
  ids: string,
  label: string,
): LibraryChoice[] {
  const requested = ids
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    new Set(libraries.map((library) => library.id)).size !== libraries.length ||
    libraries.some((library) => !library.id)
  )
    throw new IntegrationError(`${label} returned repeated or invalid library IDs.`);
  if (requested.some((id) => !libraries.some((library) => library.id === id)))
    throw new IntegrationError(`A configured ${label} library is missing or inaccessible.`);
  const selected = libraries.filter(
    (library) => !requested.length || requested.includes(library.id),
  );
  if (!selected.length)
    throw new IntegrationError(`No accessible book libraries were returned by ${label}.`);
  return selected;
}

export abstract class RemoteLibrary implements LibraryAdapter {
  protected controller = new AbortController();
  readonly source: Source;
  readonly fingerprint: string;
  constructor(readonly config: LibraryServerConfig) {
    this.source = librarySource(config);
    this.fingerprint = digest(
      `${config.provider}|${config.url}|${config.username}|${config.libraryIds}`,
    ).slice(0, 12);
  }
  cancel() {
    this.controller.abort();
  }
  abstract get configured(): boolean;
  abstract libraries(): Promise<LibraryChoice[]>;
  abstract inventory(): Promise<LibraryItem[]>;
  abstract cover(item: LibraryItem): Promise<Response>;
  protected item(
    remoteId: string,
    kind: MediaKind,
    value: Omit<
      LibraryItem,
      'id' | 'source' | 'sourceName' | 'remoteId' | 'mediaKind' | 'coverUrl'
    >,
    hasCover: boolean,
  ): LibraryItem {
    const id = `${this.source}:${this.fingerprint}:${remoteId}:${kind}`;
    return {
      ...value,
      id,
      source: this.source,
      sourceName: this.config.name,
      remoteId,
      mediaKind: kind,
      coverUrl: hasCover ? `/api/covers/${encodeURIComponent(id)}` : undefined,
    };
  }
  protected checkCover(item: LibraryItem) {
    if (item.source !== this.source || !item.id.startsWith(`${this.source}:${this.fingerprint}:`))
      throw new IntegrationError(
        'The cover belongs to a previous connection. Sync the new connection first.',
      );
  }
}
