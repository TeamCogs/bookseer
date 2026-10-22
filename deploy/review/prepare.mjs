// Fetch only these explicitly selected editions. No search result supplies download URLs.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const directory = resolve(process.argv[2] || 'artifacts/private/review-server');
const seeds = [
  { title: 'Frankenstein', author: 'Mary Shelley', gutenberg: 84, preload: false },
  { title: 'Pride and Prejudice', author: 'Jane Austen', gutenberg: 1342, preload: true },
  {
    title: "Alice's Adventures in Wonderland",
    author: 'Lewis Carroll',
    gutenberg: 11,
    preload: true,
  },
  { title: 'A Christmas Carol', author: 'Charles Dickens', gutenberg: 46, preload: false },
];
const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
async function get(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Bookseerr/0.1.0 (https://github.com/TeamCogs/bookseerr)' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`Could not fetch ${new URL(url).hostname}: HTTP ${response.status}`);
  return response;
}
await mkdir(directory + '/assets', { recursive: true, mode: 0o755 });
const catalogue = [];
for (const seed of seeds) {
  const query = new URLSearchParams({
    title: seed.title,
    author: seed.author,
    limit: '5',
    fields: 'key,title,author_name,first_publish_year',
  });
  const found = await (await get('https://openlibrary.org/search.json?' + query)).json();
  const candidate = found.docs?.find(
    (book) =>
      /^\/works\/OL\d+W$/.test(book.key) &&
      (normalize(book.title) === normalize(seed.title) ||
        (seed.gutenberg === 84 && normalize(book.title).startsWith('frankenstein'))) &&
      book.author_name?.some(
        (name) =>
          normalize(name) === normalize(seed.author) ||
          (seed.gutenberg === 84 && /mary.*shelley/i.test(name)),
      ),
  );
  if (!candidate)
    throw new Error(
      `No verified work identity for ${seed.title}. Resolve it explicitly before deployment.`,
    );
  const id = 'ol:' + candidate.key.split('/').pop();
  // Use Gutenberg's text-only Pride and Prejudice edition instead of its 24 MB illustrated edition.
  const format = seed.gutenberg === 1342 ? 'epub.noimages' : 'epub3.images';
  const url = `https://www.gutenberg.org/ebooks/${seed.gutenberg}.${format}`;
  const response = await get(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 4).toString('hex') !== '504b0304')
    throw new Error(`Expected a small EPUB for ${seed.title}`);
  const file = `pg${seed.gutenberg}.epub`;
  await writeFile(directory + '/assets/' + file, bytes, { mode: 0o644 });
  catalogue.push({
    book: {
      id,
      title: seed.title,
      author: seed.author,
      year: candidate.first_publish_year,
      origin: 'openlibrary',
      identifiers: { isbn: [], work: [id] },
    },
    formats: ['ebook'],
    preload: seed.preload,
    rights: {
      status: 'Public domain in the USA',
      url: `https://www.gutenberg.org/ebooks/${seed.gutenberg}`,
      checkedAt: new Date().toISOString(),
    },
    asset: {
      file,
      url: response.url,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
  });
  console.log(`${seed.title}: verified work identity and ${bytes.length} EPUB bytes`);
  await new Promise((done) => setTimeout(done, 1100));
}
await writeFile(directory + '/catalogue.json', JSON.stringify(catalogue, null, 2) + '\n', {
  mode: 0o644,
});
console.log(
  'Approved pack prepared at ' +
    directory +
    '. Check territorial rights before making it available.',
);
