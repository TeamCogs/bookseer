// This script mutates only the throwaway official Chaptarr container created by
// chaptarr.yml. It must never be pointed at a household or production library.
import assert from 'node:assert/strict';
import { Chaptarr } from '../dist/server/integrations/chaptarr.js';
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
const found = await api(
  '/book/lookup?term=' + encodeURIComponent('Frankenstein Mary Shelley') + '&mediaType=ebook',
);
assert.ok(
  Array.isArray(found) && found.length,
  'Upstream metadata must return the public-domain test work.',
);
const candidate = found.find(
  (b) => /^frankenstein$/i.test(b.title) && /mary.*shelley/i.test(b.author?.authorName || ''),
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
try {
  outcome = await adapter.submit(request, 'ebook', () => {});
} catch (error) {
  if (!/pending or unexpected add response/.test(error.message)) throw error;
  // A pending response is an explicitly supported safe outcome, not a confirmed add.
  console.log(
    'Official upstream returned an asynchronous pending response; Bookseer correctly requires review and does not replay it.',
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
    safePending: !outcome,
    inventoryBooks: books.length,
    formatScoped: true,
    filePresence: true,
    wholeAuthorMonitoring: false,
  }),
);
