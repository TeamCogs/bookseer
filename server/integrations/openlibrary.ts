import type { CatalogBook } from '../../shared/types.js';
import {
  discoveryPageSize,
  publicationRange,
  topicSubjects,
  type CatalogPage,
  type DiscoveryQuery,
} from '../../shared/discovery.js';
import { identifiers } from '../matching.js';
import { array, IntegrationError, object, readJson, upstream } from './http.js';

const fields =
  'key,title,author_name,first_publish_year,cover_i,isbn,subject,language,ratings_average,ratings_count';
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
const literal = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;
function parseBooks(docs: unknown): CatalogBook[] {
  const seen = new Set<string>();
  return array(docs).flatMap((doc) => {
    if (
      typeof doc.key !== 'string' ||
      !/^(?:\/works\/)?OL\d+W$/.test(doc.key) ||
      typeof doc.title !== 'string' ||
      !doc.title.trim()
    )
      return [];
    const id = `ol:${doc.key.split('/').pop()}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        title: doc.title,
        author: strings(doc.author_name).join('; '),
        year: Number.isSafeInteger(doc.first_publish_year) ? doc.first_publish_year : undefined,
        coverUrl:
          Number.isSafeInteger(doc.cover_i) && doc.cover_i > 0
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
            : undefined,
        identifiers: identifiers(strings(doc.isbn), [id]),
        origin: 'openlibrary' as const,
        subjects: strings(doc.subject),
        languages: strings(doc.language),
        rating:
          Number.isFinite(doc.ratings_average) &&
          doc.ratings_average > 0 &&
          doc.ratings_average <= 5
            ? doc.ratings_average
            : undefined,
        ratingCount:
          Number.isSafeInteger(doc.ratings_count) && doc.ratings_count > 0
            ? doc.ratings_count
            : undefined,
      },
    ];
  });
}

export class OpenLibrary {
  private cache = new Map<string, { at: number; page: CatalogPage }>();
  private lastCall = 0;
  private pending = new Map<string, Promise<CatalogPage>>();
  private gate: Promise<unknown> = Promise.resolve();
  constructor(private contact = '') {}

  async search(query: string): Promise<CatalogBook[]> {
    const params = new URLSearchParams({ q: query, limit: '30', fields });
    return (await this.page(`/search.json?${params}`, false)).books;
  }

  async browse(query: DiscoveryQuery = {}): Promise<CatalogPage> {
    const page = String(query.page || 1);
    const sort = query.sort || 'trending';
    const q = query.q?.trim() || '';
    // The weekly chart is based on community activity, independent of this server's inventory.
    if (sort === 'trending' && !q && !query.topic && !query.language && !query.era) {
      const params = new URLSearchParams({ limit: String(discoveryPageSize), page, fields });
      return this.page(`/trending/weekly.json?${params}`, true);
    }
    const range = publicationRange(query.era);
    const clauses = [`first_publish_year:[${range.from ?? '*'} TO ${range.to}]`];
    if (q) clauses.push(...q.split(/\s+/).map(literal));
    if (query.topic) {
      const subjects = topicSubjects(query.topic).map((term) => `subject:${literal(term)}`);
      clauses.push(subjects.length === 1 ? subjects[0] : `(${subjects.join(' OR ')})`);
    }
    if (query.language) clauses.push(`language:${literal(query.language)}`);
    // Avoid elevating a single five-star vote above widely rated books.
    if (sort === 'rating') clauses.push('ratings_count:[10 TO *]');
    const params = new URLSearchParams({
      q: clauses.join(' AND '),
      sort: sort === 'popular' ? 'readinglog' : sort,
      fields,
      limit: String(discoveryPageSize),
      page,
    });
    return this.page(`/search.json?${params}`, false);
  }

  private async page(path: string, weekly: boolean): Promise<CatalogPage> {
    const saved = this.cache.get(path);
    if (saved && Date.now() - saved.at < 15 * 60000) return saved.page;
    const pending = this.pending.get(path);
    if (pending) return pending;
    const task = this.gate
      .catch(() => undefined)
      .then(async () => {
        const delay = Math.max(0, 1100 - (Date.now() - this.lastCall));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastCall = Date.now();
        const response = object(
          await readJson(
            await upstream(
              'https://openlibrary.org',
              path,
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
        const docs = weekly ? response.works : response.docs;
        const books = parseBooks(docs);
        const total = Number.isSafeInteger(response.numFound)
          ? response.numFound
          : Number.isSafeInteger(response.num_found)
            ? response.num_found
            : undefined;
        const page: CatalogPage = {
          books,
          total,
          hasMore:
            total === undefined
              ? docs.length >= discoveryPageSize
              : Number(new URLSearchParams(path.split('?')[1]).get('page') || 1) *
                  discoveryPageSize <
                total,
          source: {
            name: weekly ? 'Open Library · trending this week' : 'Open Library',
            url: weekly
              ? 'https://openlibrary.org/trending/weekly'
              : `https://openlibrary.org${path.replace('/search.json?', '/search?')}`,
          },
        };
        if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(path, { at: Date.now(), page });
        return page;
      });
    this.gate = task;
    this.pending.set(path, task);
    try {
      return await task;
    } catch (error) {
      if (saved && Date.now() - saved.at < 24 * 60 * 60000)
        return {
          ...saved.page,
          warning:
            'Open Library could not refresh this list. Showing previously loaded discovery titles.',
        };
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        'Discovery is temporarily unavailable. Direct library search still works.',
      );
    } finally {
      this.pending.delete(path);
    }
  }
}
