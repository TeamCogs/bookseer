import type { BookResult, CatalogBook } from './types.js';

export const discoveryFilters = {
  topics: [
    { id: '', label: 'All topics' },
    { id: 'fiction', label: 'Fiction' },
    { id: 'nonfiction', label: 'Nonfiction' },
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'science_fiction', label: 'Science fiction' },
    { id: 'mystery', label: 'Mystery & thrillers' },
    { id: 'romance', label: 'Romance' },
    { id: 'horror', label: 'Horror' },
    { id: 'history', label: 'History' },
    { id: 'biography', label: 'Biography' },
    { id: 'science', label: 'Science' },
    { id: 'business', label: 'Business' },
    { id: 'self_help', label: 'Personal growth' },
    { id: 'young_adult', label: 'Young adult' },
    { id: 'children', label: 'Children’s books' },
  ],
  sorts: [
    { id: 'trending', label: 'Trending' },
    { id: 'popular', label: 'Most shelved' },
    { id: 'rating', label: 'Top rated' },
    { id: 'new', label: 'Recently published' },
  ],
  languages: [
    { id: '', label: 'All languages' },
    { id: 'eng', label: 'English' },
    { id: 'spa', label: 'Spanish' },
    { id: 'fre', label: 'French' },
    { id: 'ger', label: 'German' },
    { id: 'ita', label: 'Italian' },
    { id: 'por', label: 'Portuguese' },
  ],
  eras: [
    { id: '', label: 'Any publication date' },
    { id: 'recent', label: 'Last 5 years' },
    { id: 'decade', label: 'Last 10 years' },
    { id: 'classics', label: 'Before 1970' },
  ],
};

export interface DiscoveryQuery {
  q?: string;
  topic?: string;
  sort?: 'trending' | 'popular' | 'rating' | 'new';
  language?: string;
  era?: '' | 'recent' | 'decade' | 'classics';
  page?: number;
}
export interface CatalogPage {
  books: CatalogBook[];
  total?: number;
  hasMore: boolean;
  source: { name: string; url?: string };
  warning?: string;
}
export interface DiscoveryResponse extends Omit<CatalogPage, 'books'> {
  items: BookResult[];
  page: number;
  pageSize: number;
  mode: 'live' | 'demo' | 'curated';
  filters: typeof discoveryFilters;
}
export const discoveryPageSize = 24;
export function topicSubjects(topic: string): string[] {
  const aliases: Record<string, string[]> = {
    nonfiction: ['nonfiction', 'non-fiction'],
    mystery: ['mystery', 'thriller', 'detective and mystery stories'],
    self_help: ['self-help', 'self help', 'personal growth'],
    young_adult: ['young adult', 'young adult fiction'],
    children: ['children', "children's fiction", 'juvenile fiction', "children's literature"],
  };
  return aliases[topic] || [topic.replaceAll('_', ' ')];
}
export function publicationRange(era: DiscoveryQuery['era'], year = new Date().getUTCFullYear()) {
  return {
    from: era === 'recent' ? year - 4 : era === 'decade' ? year - 9 : undefined,
    to: era === 'classics' ? 1969 : year,
  };
}

/** Sample and operator catalogues never call a public provider or invent missing metadata. */
export function browseCatalogue(books: CatalogBook[], query: DiscoveryQuery): CatalogPage {
  const words = (query.q || '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const range = publicationRange(query.era);
  const normalizeSubject = (value: string) => value.toLowerCase().replace(/[_-]/g, ' ');
  const subjects = new Set(query.topic ? topicSubjects(query.topic).map(normalizeSubject) : []);
  const found = books.filter((book) => {
    const text =
      `${book.title} ${book.author} ${(book.subjects || []).join(' ')}`.toLocaleLowerCase();
    return (
      words.every((word) => text.includes(word)) &&
      (!query.topic || book.subjects?.some((subject) => subjects.has(normalizeSubject(subject)))) &&
      (!query.language || book.languages?.includes(query.language)) &&
      (!query.era ||
        (book.year !== undefined &&
          book.year <= range.to &&
          (range.from === undefined || book.year >= range.from)))
    );
  });
  if (query.sort === 'new') found.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (query.sort === 'rating') found.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const offset = ((query.page || 1) - 1) * discoveryPageSize;
  return {
    books: found.slice(offset, offset + discoveryPageSize),
    total: found.length,
    hasMore: offset + discoveryPageSize < found.length,
    source: { name: 'Catalogue' },
  };
}
