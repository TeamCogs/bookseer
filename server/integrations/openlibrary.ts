import type { CatalogBook } from '../../shared/types.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';

export class OpenLibrary {
  private cache = new Map<string, { at: number; books: CatalogBook[] }>();
  private lastCall = 0;
  private pending = new Map<string, Promise<CatalogBook[]>>();
  private gate: Promise<unknown> = Promise.resolve();
  constructor(private contact = '') {}
  async search(query: string): Promise<CatalogBook[]> {
    const key = query.trim().toLowerCase();
    const saved = this.cache.get(key);
    if (saved && Date.now() - saved.at < 15 * 60000) return saved.books;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const task = this.gate
      .catch(() => undefined)
      .then(async () => {
        const delay = Math.max(0, 1100 - (Date.now() - this.lastCall));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastCall = Date.now();
        const fields = 'key,title,author_name,first_publish_year,cover_i,isbn';
        const response = object(
          await readJson(
            await upstream(
              'https://openlibrary.org',
              `/search.json?q=${encodeURIComponent(query)}&limit=30&fields=${fields}`,
              {
                headers: {
                  'User-Agent': `Bookseerr/0.1.0${this.contact ? ` (${this.contact})` : ''}`,
                  Accept: 'application/json',
                },
              },
              18000,
            ),
          ),
        );
        const books = array(response.docs).flatMap((doc) => {
          if (
            typeof doc.key !== 'string' ||
            !/^\/works\/OL\d+W$/.test(doc.key) ||
            typeof doc.title !== 'string'
          )
            return [];
          return [
            {
              id: `ol:${doc.key.split('/').pop()}`,
              title: doc.title,
              author: Array.isArray(doc.author_name)
                ? doc.author_name.filter((a: unknown) => typeof a === 'string').join('; ')
                : '',
              year: Number.isFinite(doc.first_publish_year) ? doc.first_publish_year : undefined,
              coverUrl: Number.isSafeInteger(doc.cover_i)
                ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
                : undefined,
              identifiers: identifiers(Array.isArray(doc.isbn) ? doc.isbn : [], [
                `ol:${doc.key.split('/').pop()}`,
              ]),
              origin: 'openlibrary' as const,
            },
          ];
        });
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: Date.now(), books });
        return books;
      });
    this.gate = task;
    this.pending.set(key, task);
    try {
      return await task;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        'Discovery is temporarily unavailable. Your library search still works.',
      );
    } finally {
      this.pending.delete(key);
    }
  }
}
