// This script mutates only the throwaway official Chaptarr container created by
// chaptarr.yml. It must never be pointed at a household or production library.
import assert from 'node:assert/strict';
import { Chaptarr, PendingAddError } from '../dist/server/integrations/chaptarr.js';
import { loadConfig } from '../dist/server/config.js';
const base = process.env.CHAPTARR_URL;
assert.equal(base, 'http://127.0.0.1:8789', 'Only the isolated workflow endpoint is accepted.');
if (!process.env.GITHUB_ACTIONS)
  throw new Error('Run through the isolated GitHub compatibility workflow.');
const apiKey = process.env.CHAPTARR_API_KEY;
async function api(path, body) {
  const response = await fetch(base + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  assert.ok(
    response.ok,
    `${path}: HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1800)}`,
  );
  return data;
}
const version = await api('/system/status');
const [quality, metadata, clients, indexers] = await Promise.all([
  api('/qualityprofile'),
  api('/metadataprofile'),
  api('/downloadclient'),
  api('/indexer'),
]);
assert.equal(clients.length, 0);
assert.equal(indexers.length, 0);
const q =
  quality.find((p) => String(p.profileType).toLowerCase() === 'ebook') ||
  quality.find((p) => /ebook/i.test(p.name)) ||
  quality[0];
const m = metadata.find((p) => String(p.profileType).toLowerCase() === 'ebook') || metadata[0];
assert.ok(q?.id && m?.id, 'Fresh upstream profiles are required.');
await api('/rootfolder', {
  name: 'Bookseer isolated fixture',
  path: '/ebooks',
  folderType: 2,
  ebook: {
    qualityProfileId: q.id,
    metadataProfileId: m.id,
    monitored: false,
    monitorExistingMode: 'none',
    monitorNewItems: 'none',
    tags: [],
  },
  defaultSyncMonitoredAcrossFormats: false,
});
const c = loadConfig({
  BOOKSEER_DEMO: 'true',
  CHAPTARR_URL: base,
  CHAPTARR_API_KEY: apiKey,
  CHAPTARR_EBOOK_ROOT_FOLDER: '/ebooks',
  CHAPTARR_EBOOK_QUALITY_PROFILE_ID: String(q.id),
  CHAPTARR_EBOOK_METADATA_PROFILE_ID: String(m.id),
}).connections;
const adapter = new Chaptarr(c);
assert.deepEqual(await adapter.inventory(), []);
let found = [];
for (let attempt = 0; attempt < 8; attempt++) {
  found = await api('/book/lookup?term=ol%3AOL450063W&mediaType=ebook');
  if (!found.length) {
    // Legacy text lookup uses audiobook previews; an ebook filter removes them.
    // The Bookseer adapter resolves the provider identity and scopes the actual add.
    const search = await api('/search?term=Frankenstein&provider=goodreads');
    found = search.map((entry) => entry.book).filter(Boolean);
  }
  if (Array.isArray(found) && found.length) break;
  if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 15000));
}
assert.ok(
  Array.isArray(found) && found.length,
  'Upstream metadata must return the public-domain test work.',
);
const candidate = found.find(
  (b) => /^frankenstein\b/i.test(b.title) && /mary.*shelley/i.test(b.author?.authorName || ''),
);
assert.ok(candidate, 'A unique complete Frankenstein work is required.');
const request = {
  id: 'compatibility:frankenstein',
  title: candidate.title,
  author: candidate.author.authorName,
  origin: 'openlibrary',
  identifiers: { isbn: [], work: [candidate.foreignBookId] },
};
let outcome;
let acceptedPending = false;
try {
  outcome = await adapter.submit(request, 'ebook', () => {});
} catch (error) {
  if (!(error instanceof PendingAddError)) throw error;
  acceptedPending = true;
  // Acceptance is not proof that upstream created or imported a book.
  console.log(
    'Official upstream accepted an asynchronous addition. Bookseer tracks it without repeating the add; completed acquisition remains unverified.',
  );
}
const books = await adapter.inventory();
assert.ok(
  books.every((b) => b.mediaKind === 'ebook'),
  'An ebook request must not add an audiobook instance.',
);
assert.ok(
  books.every((b) => !b.available),
  'A monitored record without files must not appear available.',
);
const authors = await api('/author');
assert.ok(
  authors.every((a) => !a.ebookMonitored && !a.audiobookMonitored),
  'A single request must not turn on whole-author monitoring.',
);
console.log(
  JSON.stringify({
    upstreamVersion: version.version,
    lookup: true,
    nativeAdd: Boolean(outcome?.id),
    acceptedPending,
    inventoryBooks: books.length,
    formatScoped: true,
    filePresence: true,
    wholeAuthorMonitoring: false,
  }),
);
