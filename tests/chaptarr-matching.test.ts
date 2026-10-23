import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankChaptarrMatches,
  uniqueChaptarrMatch,
} from '../server/integrations/chaptarr-matching.js';
import { Chaptarr, queueReviewMessage } from '../server/integrations/chaptarr.js';
import { book, config, json } from './fixtures.js';
import { Store } from '../server/store.js';
import { Services } from '../server/services.js';

const requested = {
  ...book,
  id: 'ol:OL100W',
  title: 'The Science of Savings',
  author: 'Taylor Rivers',
  identifiers: { isbn: [], work: ['ol:OL100W'] },
};
const candidate = (id: string, title = requested.title, extra: Record<string, unknown> = {}) => ({
  title,
  foreignBookId: id,
  author: { authorName: requested.author, foreignAuthorId: 'gr:100' },
  ...extra,
});

test('subtitle editions outrank a cross-provider fallback without choosing by popularity', () => {
  const ranked = rankChaptarrMatches(requested, 'ebook', [
    { book: candidate('hc:1'), canonical: true },
    { book: candidate('hc:2', undefined, { ratings: { votes: 999999 } }) },
    { book: candidate('gr:3', 'The Science of Savings: Lasting Lessons') },
  ]);
  assert.equal(uniqueChaptarrMatch(ranked)?.summary.workId, 'gr:3');
  assert.match(ranked[0].summary.reason, /subtitle/);
});

test('matching ISBN and source work identity precede provider preference', () => {
  const b = { ...requested, identifiers: { isbn: ['9780306406157'], work: ['ol:OL100W'] } };
  const ranked = rankChaptarrMatches(b, 'ebook', [
    { book: candidate('gr:1') },
    { book: candidate('hc:2', undefined, { editions: [{ isbn10: '0306406152' }] }) },
  ]);
  assert.equal(uniqueChaptarrMatch(ranked)?.summary.workId, 'hc:2');
  const source = rankChaptarrMatches(requested, 'ebook', [
    { book: candidate('gr:1') },
    { book: candidate('ol:OL100W') },
  ]);
  assert.equal(uniqueChaptarrMatch(source)?.summary.workId, 'ol:OL100W');
});

test('saved identities win but cannot override a conflicting author, volume, derivative, or collection', () => {
  const rejected = [
    candidate('gr:2', undefined, { author: { authorName: 'Someone Else' } }),
    candidate('gr:2', requested.title + ': Volume 2'),
    candidate('gr:2', 'Summary of ' + requested.title),
    candidate('gr:2', requested.title + ': A Workbook'),
    candidate('gr:2', requested.title + ': Three Books Collection Set'),
    candidate('gr:2', undefined, { isOmnibus: true }),
  ];
  for (const b of rejected)
    assert.equal(rankChaptarrMatches(requested, 'ebook', [{ book: b }], 'gr:2').length, 0, b.title);
  const valid = rankChaptarrMatches(
    requested,
    'ebook',
    [{ book: candidate('gr:1') }, { book: candidate('hc:2') }],
    'hc:2',
  );
  assert.equal(uniqueChaptarrMatch(valid, 'hc:2')?.summary.workId, 'hc:2');
});

test('same-provider ties require review and duplicate search hits do not create ambiguity', () => {
  const a = { book: candidate('gr:1') };
  const b = { book: candidate('gr:2') };
  assert.equal(uniqueChaptarrMatch(rankChaptarrMatches(requested, 'ebook', [a, b])), undefined);
  assert.equal(rankChaptarrMatches(requested, 'ebook', [a, a]).length, 1);
});

test('an existing copy is preferred only within the stronger identity tier and correct format', () => {
  const otherFormat = candidate('hc:2', undefined, {
    localAudiobookBooks: [{ id: 9, hasFiles: true }],
  });
  const ebook = candidate('hc:3', undefined, { localEbookBooks: [{ id: 10, hasFiles: true }] });
  assert.equal(
    uniqueChaptarrMatch(
      rankChaptarrMatches(requested, 'ebook', [{ book: candidate('gr:1') }, { book: otherFormat }]),
    )?.summary.workId,
    'gr:1',
  );
  assert.equal(
    uniqueChaptarrMatch(
      rankChaptarrMatches(requested, 'ebook', [{ book: candidate('gr:1') }, { book: ebook }]),
    )?.summary.workId,
    'hc:3',
  );
});

test('a completed blocked download cannot trigger another search or addition', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    if (init.method !== 'GET') writes++;
    const path = new URL(String(input)).pathname;
    assert.ok(path.endsWith('/queue'));
    return json({
      totalRecords: 1,
      records: [
        {
          bookId: 9,
          status: 'completed',
          trackedDownloadState: 'importBlocked',
          statusMessages: [{ messages: ['Conflicting catalogue identities.'] }],
        },
      ],
    });
  });
  await assert.rejects(
    new Chaptarr(c).submit(
      requested,
      'ebook',
      () => {},
      candidate('gr:1', undefined, { localEbookBooks: [{ id: 9, hasFiles: false }] }),
    ),
    /Download complete.*Conflicting catalogue identities/,
  );
  assert.equal(writes, 0);
  assert.match(
    queueReviewMessage({ trackedDownloadState: 'importBlocked' }),
    /will not be requested again/,
  );
});

test('confirmed matches persist by connection, book and format, and reject unlisted works', async (t) => {
  const c = config();
  c.demo = true;
  Object.assign(c.connections, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  const actor = store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'test',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
  store.saveBook(requested);
  const request = store.createRequest(requested, 'ebook', actor);
  store.updateRequest(request.id, 'needs_review', 'Review identity');
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    if (init.method !== 'GET') writes++;
    const url = new URL(String(input));
    const candidates = [candidate('gr:1'), candidate('gr:2')];
    if (url.pathname.endsWith('/lookup'))
      return json(url.searchParams.get('term') === 'gr:2' ? [candidates[1]] : candidates);
    return json(candidates.map((book) => ({ book })));
  });
  try {
    await assert.rejects(
      services.confirmRequestMatch(request.id, 'gr:999', actor),
      /verified matching works/,
    );
    assert.equal(services.savedMatch(requested.id, 'ebook'), undefined);
    await services.confirmRequestMatch(request.id, 'gr:2', actor);
    assert.equal(store.request(request.id)?.status, 'pending_setup');
    assert.equal(services.savedMatch(requested.id, 'ebook')?.workId, 'gr:2');
    assert.equal(services.savedMatch(requested.id, 'ebook')?.confirmedBy, actor.id);
    assert.equal(services.savedMatch(requested.id, 'audiobook'), undefined);
    const restarted = new Services(c, store);
    assert.equal(restarted.savedMatch(requested.id, 'ebook')?.workId, 'gr:2');
    restarted.saveConnections({ ...c.connections, chaptarrUrl: 'http://other.test' }, actor);
    assert.equal(restarted.savedMatch(requested.id, 'ebook'), undefined);
    assert.equal(writes, 0);
  } finally {
    store.close();
  }
});

test('a unique canonical lookup preserves a saved alias without waiving title or author checks', () => {
  const input = { book: candidate('hc:2'), canonical: true, lookupWorkId: 'gr:1' };
  const ranked = rankChaptarrMatches(requested, 'ebook', [input], 'gr:1');
  assert.equal(uniqueChaptarrMatch(ranked, 'gr:1')?.summary.workId, 'hc:2');
  assert.ok(ranked[0].summary.aliases?.includes('gr:1'));
  assert.equal(
    rankChaptarrMatches(
      requested,
      'ebook',
      [{ ...input, book: candidate('hc:2', 'Unrelated Work') }],
      'gr:1',
    ).length,
    0,
  );
  assert.equal(
    rankChaptarrMatches(
      requested,
      'ebook',
      [
        {
          ...input,
          book: candidate('hc:2', undefined, { author: { authorName: 'Someone Else' } }),
        },
      ],
      'gr:1',
    ).length,
    0,
  );
});

test('native previews can hydrate to a different canonical provider and persist the identity actually used', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/lookup'))
      return json(
        url.searchParams.get('term') === 'gr:1'
          ? [
              candidate('hc:2', requested.title + ': Lasting Lessons', {
                localEbookBooks: [{ id: 9, hasFiles: false }],
              }),
            ]
          : [],
      );
    return json(
      url.searchParams.get('provider') === 'goodreads'
        ? [{ book: candidate('gr:1', requested.title + ': Lasting Lessons') }]
        : [],
    );
  });
  const result = await new Chaptarr(c).lookup(requested, 'ebook');
  assert.equal(result.foreignBookId, 'hc:2');
  assert.equal(result.bookseerrMatch.workId, 'hc:2');
  assert.ok(result.bookseerrMatch.aliases.includes('gr:1'));
});

test('multiple canonical results cannot claim a saved alias without unique identity evidence', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  t.mock.method(globalThis, 'fetch', async () => json([candidate('hc:2'), candidate('hc:3')]));
  await assert.rejects(new Chaptarr(c).lookup(requested, 'ebook', 'gr:1'), /unique matching work/);
});
