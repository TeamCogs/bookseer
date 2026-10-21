import type {
  Availability,
  BookResult,
  CatalogBook,
  Identifiers,
  LibraryGroup,
  LibraryItem,
  MediaKind,
  SourceState,
} from '../shared/types.js';
import type { Store } from './store.js';

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function normalizeAuthor(value: string): string {
  return normalizeText(value)
    .split(' ')
    .filter((word) => word && !['dr', 'mr', 'mrs', 'jr', 'sr'].includes(word))
    .sort()
    .join(' ');
}
export function displayAuthor(value: string): string {
  const parts = value.split(',').map((s) => s.trim());
  return parts.length === 2 && parts.every(Boolean) ? `${parts[1]} ${parts[0]}` : value;
}
export function displayTitle(value: string, author: string): string {
  let title = value.replace(/\.(epub|pdf|mobi|azw3?|m4b|mp3|flac|cbz|cbr)$/i, '').trim();
  const parts = title.split(/\s+-\s+/);
  if (
    parts.length > 1 &&
    normalizeAuthor(parts[0]) === normalizeAuthor(author) &&
    normalizeAuthor(author).split(' ').length >= 2
  ) {
    parts.shift();
    // Only discard a filename's series prefix when it explicitly ends in an index.
    if (parts.length > 1 && /(?:\b\d+(?:\.\d+)?|\[\d+\])\s*$/.test(parts[0])) parts.shift();
    title = parts.join(' - ');
  }
  return title;
}
export function catalogueIdentity(book: Pick<CatalogBook, 'title' | 'author'>): string {
  const title = normalizeText(displayTitle(book.title, book.author));
  const author = normalizeAuthor(book.author);
  return title && author && completeAuthor(author) ? `${title}|${author}` : '';
}
export function compatibleAuthorNames(a: string, b: string): boolean {
  const left = normalizeAuthor(a);
  const right = normalizeAuthor(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const x = left.split(' ');
  const y = right.split(' ');
  return (
    x.length >= 2 &&
    y.length >= 2 &&
    (x.every((word) => y.includes(word)) || y.every((word) => x.includes(word)))
  );
}
export function sameCatalogueWork(
  a: Pick<CatalogBook, 'title' | 'author' | 'identifiers'>,
  b: Pick<CatalogBook, 'title' | 'author' | 'identifiers'>,
): boolean {
  const identity = catalogueIdentity(a);
  return Boolean(
    identity &&
    (identity === catalogueIdentity(b) ||
      (shared(a.identifiers.work, b.identifiers.work) &&
        compatibleExtent(a.title, b.title) &&
        compatibleAuthorNames(a.author, b.author))),
  );
}
export function normalizeIsbn(value: string): string | undefined {
  const isbn = value.toUpperCase().replace(/[^0-9X]/g, '');
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((n, digit, i) => n + Number(digit) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? isbn : undefined;
  }
  if (/^\d{9}[0-9X]$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (n, digit, i) => n + (digit === 'X' ? 10 : Number(digit)) * (10 - i),
      0,
    );
    if (sum % 11 !== 0) return undefined;
    const prefix = '978' + isbn.slice(0, 9);
    const check =
      (10 - ([...prefix].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return prefix + check;
  }
  return undefined;
}
export function identifiers(isbn: unknown[], work: unknown[]): Identifiers {
  return {
    isbn: [
      ...new Set(
        isbn
          .filter((v): v is string => typeof v === 'string')
          .map(normalizeIsbn)
          .filter((v): v is string => Boolean(v)),
      ),
    ],
    work: [
      ...new Set(
        work
          .filter((v): v is string => typeof v === 'string' && Boolean(v))
          .map((value) => {
            const ol = value.match(/(?:^ol:|\/works\/)(OL\d+W)$/i);
            return ol ? `ol:${ol[1].toUpperCase()}` : value.replace(/^hardcover:/, 'hc:');
          }),
      ),
    ],
  };
}
const shared = (a: string[], b: string[]) => a.some((value) => b.includes(value));
function overlap(a: string, b: string): number {
  const x = new Set(a.split(' ').filter(Boolean));
  const y = new Set(b.split(' ').filter(Boolean));
  return x.size && y.size
    ? (2 * [...x].filter((word) => y.has(word)).length) / (x.size + y.size)
    : 0;
}
function part(value: string): string {
  const match = normalizeText(value).match(
    /\b(part|volume|vol)\s+(\d+|one|two|three|four|five|i|ii|iii|iv|v)\b/,
  );
  if (!match) return '';
  const aliases: Record<string, string> = {
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    i: '1',
    ii: '2',
    iii: '3',
    iv: '4',
    v: '5',
  };
  return `${match[1] === 'part' ? 'part' : 'volume'}:${aliases[match[2]] || match[2]}`;
}
export function compatibleExtent(a: string, b: string): boolean {
  const collection = /\b(collection|omnibus|boxed set|box set|complete works|books \d+ \d+)\b/;
  return (
    part(a) === part(b) && collection.test(normalizeText(a)) === collection.test(normalizeText(b))
  );
}
const normalizedItems = new WeakMap<
  LibraryItem,
  { title: string; author: string; extent: string; collection: boolean }
>();
function normalizedItem(item: LibraryItem) {
  let value = normalizedItems.get(item);
  if (!value) {
    const title = normalizeText(displayTitle(item.title, item.author));
    value = {
      title,
      author: normalizeAuthor(item.author),
      extent: part(item.title),
      collection: /\b(collection|omnibus|boxed set|box set|books \d+ \d+)\b/.test(title),
    };
    normalizedItems.set(item, value);
  }
  return value;
}
function completeAuthor(author: string): boolean {
  if (!knownAuthor(author)) return false;
  return (
    author.split(' ').length >= 2 ||
    (author.length >= 2 &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(author))
  );
}
function knownAuthor(author: string): boolean {
  return Boolean(author) && !placeholderAuthors.has(author);
}
const placeholderAuthors = new Set(
  [
    'unknown',
    'unknown author',
    'unknown authors',
    'various',
    'various authors',
    'n a',
    'none',
    'not available',
  ].map(normalizeAuthor),
);
export function sourceIsFresh(
  state: SourceState | undefined,
  maxAgeHours: number,
  now = Date.now(),
): boolean {
  return Boolean(
    state?.configured &&
    ['healthy', 'syncing'].includes(state.status) &&
    state.lastSuccess &&
    now - Date.parse(state.lastSuccess) < maxAgeHours * 3600000,
  );
}
export function matchAvailability(
  book: CatalogBook,
  kind: MediaKind,
  items: LibraryItem[],
  states: SourceState[],
  maxAgeHours: number,
  confirmedIds?: string[],
): Availability {
  const title = normalizeText(book.title);
  const author = normalizeAuthor(book.author);
  const extent = part(book.title);
  const collection = /\b(collection|omnibus|boxed set|box set|books \d+ \d+)\b/.test(title);
  const candidates: LibraryItem[] = [];
  const exact: LibraryItem[] = [];
  for (const item of items.filter((i) => i.mediaKind === kind)) {
    const normalized = normalizedItem(item);
    const itemTitle = normalized.title;
    const itemAuthor = normalized.author;
    const titleEqual = Boolean(title) && title === itemTitle;
    const authorEqual = Boolean(author) && completeAuthor(author) && author === itemAuthor;
    const sameWork = shared(book.identifiers.work, item.identifiers.work);
    const sameIdentifier = shared(book.identifiers.isbn, item.identifiers.isbn) || sameWork;
    const compatibleAuthor =
      authorEqual || (sameWork && compatibleAuthorNames(book.author, item.author));
    const conflictingAuthors =
      completeAuthor(author) && completeAuthor(itemAuthor) && !compatibleAuthor;
    const safeExtent = extent === normalized.extent && collection === normalized.collection;
    if (
      book.id === `local:${item.id}` ||
      (safeExtent &&
        ((titleEqual && authorEqual) ||
          (sameIdentifier && titleEqual && !conflictingAuthors) ||
          (sameWork && compatibleAuthor && completeAuthor(author))))
    )
      exact.push(item);
    else if (
      sameIdentifier ||
      (titleEqual &&
        (!knownAuthor(author) || !knownAuthor(itemAuthor) || overlap(author, itemAuthor) >= 0.5)) ||
      (overlap(title, itemTitle) >= 0.6 && overlap(author, itemAuthor) >= 0.5)
    )
      candidates.push(item);
  }
  const confirmed = confirmedIds !== undefined;
  const matched = confirmed
    ? items.filter((i) => confirmedIds.includes(i.id) && i.mediaKind === kind)
    : exact;
  const available = matched.filter((i) => i.available);
  const fresh = available.filter((item) =>
    sourceIsFresh(
      states.find((s) => s.source === item.source)!,
      maxAgeHours,
    ),
  );
  if (fresh.length)
    return {
      status: 'available',
      label: 'Available',
      reason: confirmed
        ? 'You confirmed this identity match. The connected library reports files present.'
        : 'Title and author, or a compatible identifier, match a copy with files present.',
      items: fresh,
      candidates: [],
      stale: false,
      confirmed,
    };
  const configured = states.filter((s) => s.configured);
  const complete = configured.length > 0 && configured.every((s) => sourceIsFresh(s, maxAgeHours));
  if (matched.length && !available.length && complete)
    return {
      status: 'not_found',
      label: 'Tracked · file missing',
      reason:
        'Matching records have no available file in the complete, recently synced inventories. Acquisition can reuse an existing Chaptarr record.',
      items: matched,
      candidates: [],
      stale: false,
      confirmed,
    };
  if (matched.length || confirmed)
    return {
      status: 'unknown',
      label: available.length ? 'Last seen in library' : 'File unavailable',
      reason: available.length
        ? 'This copy was present at the last successful sync. Refresh the source to verify current availability.'
        : 'The linked record has no available file, or its saved identity is no longer in the inventory.',
      items: matched,
      candidates,
      stale: true,
      confirmed,
    };
  if (candidates.length)
    return {
      status: 'needs_review',
      label: 'Check existing copy',
      reason:
        'A related copy is in your library. Confirm its identity before creating another request. Parts and collections are not treated as the whole book automatically.',
      items: [],
      candidates: candidates.slice(0, 8),
      stale: false,
      confirmed: false,
    };
  return {
    status: complete ? 'not_found' : 'unknown',
    label: complete ? 'Not found in library' : 'Availability unknown',
    reason: complete
      ? 'No match was found in the complete, recently synced connected inventories.'
      : 'Connect and successfully sync your libraries before requesting a copy.',
    items: [],
    candidates: [],
    stale: !complete,
    confirmed: false,
  };
}
export function bookResult(
  book: CatalogBook,
  store: Store,
  maxAgeHours: number,
  inventory = store.inventory(),
  copies?: LibraryItem[],
): BookResult {
  const states = [store.state('bookorbit'), store.state('chaptarr')];
  if (!copies && book.id.startsWith('local:'))
    copies = groupInventory(inventory, store.libraryGroups()).find((g) =>
      g.copies.some((i) => book.id === `local:${i.id}`),
    )?.copies;
  if (!copies) {
    const title = normalizeText(book.title);
    const author = normalizeAuthor(book.author);
    const linked = store.libraryGroups().find((g) =>
      g.itemIds.some((id) => {
        const item = store.item(id);
        if (!item) return false;
        const value = normalizedItem(item);
        return value.title === title && value.author === author && Boolean(author);
      }),
    );
    if (linked) copies = inventory.filter((i) => linked.itemIds.includes(i.id));
  }
  const dismissedEbook = new Set(store.dismissedMatches(book.id, 'ebook'));
  const dismissedAudio = new Set(store.dismissedMatches(book.id, 'audiobook'));
  const result: BookResult = {
    book,
    availability: {
      ebook: matchAvailability(
        book,
        'ebook',
        inventory.filter((i) => !dismissedEbook.has(i.id)),
        states,
        maxAgeHours,
        store.confirmedMatches(book.id, 'ebook') ??
          (copies?.some((i) => i.mediaKind === 'ebook')
            ? copies.filter((i) => i.mediaKind === 'ebook').map((i) => i.id)
            : undefined),
      ),
      audiobook: matchAvailability(
        book,
        'audiobook',
        inventory.filter((i) => !dismissedAudio.has(i.id)),
        states,
        maxAgeHours,
        store.confirmedMatches(book.id, 'audiobook') ??
          (copies?.some((i) => i.mediaKind === 'audiobook')
            ? copies.filter((i) => i.mediaKind === 'audiobook').map((i) => i.id)
            : undefined),
      ),
    },
    copies,
  };
  for (const kind of ['ebook', 'audiobook'] as MediaKind[]) {
    if (copies && !store.confirmedMatches(book.id, kind)) {
      result.availability[kind].confirmed = false;
      if (result.availability[kind].status === 'available')
        result.availability[kind].reason =
          'A grouped copy in a recently synced connected library has files present.';
    }
  }
  return result;
}
export function itemAsBook(item: LibraryItem): CatalogBook {
  return {
    id: `local:${item.id}`,
    title: displayTitle(item.title, item.author),
    author: displayAuthor(item.author),
    year: item.year,
    coverUrl: item.coverUrl,
    identifiers: item.identifiers,
    origin: item.source,
  };
}
export function searchInventory(items: LibraryItem[], query: string): LibraryItem[] {
  const words = normalizeText(query).split(' ').filter(Boolean);
  return items
    .filter((item) => {
      const text = normalizeText(
        `${displayTitle(item.title, item.author)} ${item.author} ${item.identifiers.isbn.join(' ')}`,
      );
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => displayTitle(a.title, a.author).localeCompare(displayTitle(b.title, b.author)));
}
export function distinctBooks(items: LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = normalizedItem(item);
    if (!value.title || !value.author) return true;
    const key = `${value.title}|${value.author}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function groupInventory(
  items: LibraryItem[],
  saved: LibraryGroup[] = [],
): { primary: LibraryItem; copies: LibraryItem[]; duplicates: number }[] {
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(b), find(a));
  };
  const keys = new Map<string, string>();
  const workOwners = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const n = normalizedItem(item);
    if (!n.title || !knownAuthor(n.author)) continue;
    const key = `${n.title}|${n.author}`;
    const previous = keys.get(key);
    if (previous) union(previous, item.id);
    else keys.set(key, item.id);
    for (const workId of item.identifiers.work) {
      const owners = workOwners.get(workId) || [];
      owners
        .filter((owner) => sameCatalogueWork(owner, item))
        .forEach((owner) => union(owner.id, item.id));
      owners.push(item);
      workOwners.set(workId, owners);
    }
  }
  for (const group of saved) {
    const first = group.itemIds.find((id) => parent.has(id));
    if (first) group.itemIds.forEach((id) => union(first, id));
  }
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const root = find(item.id);
    const group = groups.get(root) || [];
    group.push(item);
    groups.set(root, group);
  }
  return [...groups.values()]
    .map((copies) => {
      const preferred = saved.find((group) =>
        copies.some((i) => i.id === group.canonicalId),
      )?.canonicalId;
      const primary =
        copies.find((i) => i.id === preferred) ||
        copies.find((i) => i.available && i.coverUrl) ||
        copies.find((i) => i.available) ||
        copies[0];
      const formats = new Set(copies.map((i) => i.mediaKind));
      return { primary, copies, duplicates: copies.length - formats.size };
    })
    .sort((a, b) =>
      displayTitle(a.primary.title, a.primary.author).localeCompare(
        displayTitle(b.primary.title, b.primary.author),
      ),
    );
}
