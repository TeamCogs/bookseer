import type { CatalogBook, LibraryItem, SourceState } from '../shared/types.js';
import { loadConfig } from '../server/config.js';
export const config = () =>
  loadConfig({
    BOOKSEER_ADMIN_PASSWORD: 'a-strong-test-password',
    BOOKSEER_SESSION_SECRET: 'a-private-test-key-at-least-32-characters',
    BOOKSEER_DATA_DIR: '/tmp/bookseer-test-unused',
  });
export const book: CatalogBook = {
  id: 'ol:OL20158882W',
  title: 'Oathbringer',
  author: 'Brandon Sanderson',
  identifiers: { isbn: ['9780765326379'], work: ['ol:OL20158882W'] },
  origin: 'openlibrary',
};
export const item: LibraryItem = {
  id: 'bookorbit:test:1:ebook',
  source: 'bookorbit',
  remoteId: '1',
  title: 'Sanderson, Brandon - Stormlight 03 - Oathbringer.epub',
  author: 'Sanderson, Brandon',
  mediaKind: 'ebook',
  formats: ['EPUB'],
  available: true,
  identifiers: { isbn: [], work: [] },
};
export const fresh = (): SourceState[] => [
  {
    source: 'bookorbit',
    configured: true,
    status: 'healthy',
    lastSuccess: new Date().toISOString(),
    count: 1,
  },
  { source: 'chaptarr', configured: false, status: 'unconfigured', count: 0 },
];
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
