import type { LibraryProvider, LibraryServerConfig, Source } from './types.js';

export const libraryProviders: Record<LibraryProvider, string> = {
  bookorbit: 'BookOrbit',
  grimmory: 'Grimmory',
  audiobookshelf: 'Audiobookshelf',
};

export function librarySource(server: Pick<LibraryServerConfig, 'id'>): Source {
  // Retain existing inventory IDs, saved groups, and identity reviews on upgrade.
  return server.id === 'bookorbit' ? 'bookorbit' : `library:${server.id}`;
}

export function sourceName(value: { source: Source; sourceName?: string; name?: string }): string {
  return (
    value.sourceName ||
    value.name ||
    (value.source === 'bookorbit'
      ? 'BookOrbit'
      : value.source === 'chaptarr'
        ? 'Chaptarr'
        : 'Library server')
  );
}
