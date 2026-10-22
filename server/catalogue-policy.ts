import { readFileSync, statSync } from 'node:fs';
import type { CatalogBook, MediaKind } from '../shared/types.js';

export const cataloguePolicyMessage =
  'This server offers a curated catalogue. Requests are limited to its listed titles and formats.';
type Entry = { book: CatalogBook; formats: MediaKind[] };

/** Optional, operator-managed catalogue. Invalid configuration never falls back to open search. */
export class CataloguePolicy {
  private entries = new Map<string, Entry>();
  constructor(path: string) {
    if (statSync(path).size > 2 * 1024 * 1024) throw new Error('Catalogue file is too large.');
    const entries: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(entries) || !entries.length || entries.length > 1000)
      throw new Error('The catalogue must contain between 1 and 1000 approved titles.');
    for (const entry of entries) {
      const book = entry?.book;
      if (
        !book ||
        typeof book.id !== 'string' ||
        !/^ol:OL\d+W$/.test(book.id) ||
        typeof book.title !== 'string' ||
        !book.title.trim() ||
        book.title.length > 500 ||
        typeof book.author !== 'string' ||
        !book.author.trim() ||
        book.author.length > 500 ||
        book.origin !== 'openlibrary' ||
        !Array.isArray(book.identifiers?.isbn) ||
        !book.identifiers.isbn.every((id: unknown) => typeof id === 'string') ||
        !Array.isArray(book.identifiers?.work) ||
        !book.identifiers.work.includes(book.id) ||
        !book.identifiers.work.every((id: unknown) => typeof id === 'string') ||
        !Array.isArray(entry.formats) ||
        !entry.formats.length ||
        !entry.formats.every((kind: unknown) => kind === 'ebook' || kind === 'audiobook') ||
        this.entries.has(book.id)
      )
        throw new Error('The catalogue contains an invalid or duplicate title.');
      this.entries.set(book.id, structuredClone({ book, formats: entry.formats }));
    }
  }
  search(query: string): CatalogBook[] {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return [...this.entries.values()]
      .map(({ book }) => book)
      .filter((book) =>
        words.every((word) => `${book.title} ${book.author}`.toLocaleLowerCase().includes(word)),
      )
      .map((book) => structuredClone(book));
  }
  permits(book: CatalogBook, kind: MediaKind): boolean {
    const entry = this.entries.get(book.id);
    return Boolean(
      entry &&
      entry.book.title === book.title &&
      entry.book.author === book.author &&
      entry.formats.includes(kind),
    );
  }
}
