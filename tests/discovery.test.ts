import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenLibrary } from '../server/integrations/openlibrary.js';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { browseCatalogue, type CatalogPage } from '../shared/discovery.js';
import { book, config, item, json } from './fixtures.js';

const doc = {
  key: '/works/OL20158882W',
  title: book.title,
  author_name: [book.author],
  first_publish_year: 2017,
  cover_i: 100,
  isbn: ['9780765326379'],
  subject: ['Fantasy'],
  language: ['eng'],
  ratings_average: 4.25,
  ratings_count: 50,
};
const chart = (books = [book]): CatalogPage => ({
  books,
  hasMore: false,
  source: { name: 'Open Library', url: 'https://openlibrary.org/trending/weekly' },
});

async function setup(demo = false) {
  const store = new Store(':memory:');
  const context = await buildApp({ ...config(), demo }, { store });
  store.replaceInventory('bookorbit', [
    item,
    {
      ...item,
      id: 'bookorbit:library-only:ebook',
      remoteId: '2',
      title: 'A private local-only book',
      author: 'Local Writer',
    },
  ]);
  const login = await context.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: 'admin', password: 'a-strong-test-password' },
  });
  assert.equal(login.statusCode, 200);
  const headers = {
    cookie: `bookseerr_session=${login.cookies[0].value}`,
    'x-csrf-token': login.json().csrf,
  };
  return {
    ...context,
    headers,
    close: async () => {
      await context.app.close();
      store.close();
    },
  };
}

test('weekly discovery uses the public chart, parses work IDs and metadata, coalesces calls, and caches pages', async (t) => {
  const client = new OpenLibrary('https://example.com/contact');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.origin, 'https://openlibrary.org');
    assert.equal(url.pathname, '/trending/weekly.json');
    assert.equal(url.searchParams.get('limit'), '24');
    assert.equal(url.searchParams.get('page'), '1');
    assert.match(
      String((init.headers as Record<string, string>)['User-Agent']),
      /Bookseerr.*example.com/,
    );
    return json({ works: [doc, doc, { ...doc, key: 'OL123W' }, { ...doc, key: '/books/OL1M' }] });
  });
  const [one, two] = await Promise.all([
    client.browse(),
    client.browse({ sort: 'trending', page: 1 }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(one, two);
  assert.deepEqual(
    one.books.map((b) => b.id),
    [book.id, 'ol:OL123W'],
  );
  assert.equal(one.books[0].rating, 4.25);
  assert.deepEqual(one.books[0].languages, ['eng']);
  assert.deepEqual(one.books[0].identifiers.work, [book.id]);
  assert.equal(one.source.name, 'Open Library · trending this week');
  assert.equal(one.hasMore, false);
  await client.browse();
  assert.equal(calls, 1);
});

test('topic, keyword, language and publication filters reach the full catalogue with correct sort and pagination', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const paths: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    now += 1200;
    const url = new URL(input);
    paths.push(url);
    return json({ numFound: 55, docs: [{ ...doc, key: `OL${paths.length}W` }] });
  });
  const client = new OpenLibrary();
  const response = await client.browse({
    topic: 'science_fiction',
    q: 'space adventure',
    language: 'eng',
    era: 'recent',
    sort: 'rating',
    page: 2,
  });
  const params = paths[0].searchParams;
  assert.equal(paths[0].pathname, '/search.json');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('sort'), 'rating');
  const year = new Date().getUTCFullYear();
  assert.equal(
    params.get('q'),
    `first_publish_year:[${year - 4} TO ${year}] AND "space" AND "adventure" AND subject:"science fiction" AND language:"eng" AND ratings_count:[10 TO *]`,
  );
  assert.equal(response.total, 55);
  assert.equal(response.hasMore, true);
  await client.browse({ sort: 'popular', page: 3 });
  assert.equal(paths[1].searchParams.get('sort'), 'readinglog');
  const final = await client.browse({ sort: 'new', page: 3, era: 'classics' });
  assert.equal(paths[2].searchParams.get('sort'), 'new');
  assert.equal(paths[2].searchParams.get('q'), 'first_publish_year:[* TO 1969]');
  assert.equal(final.hasMore, false);
  await client.browse({ topic: 'fantasy', sort: 'trending' });
  assert.equal(paths[3].searchParams.get('sort'), 'trending');
});

test('keywords are literal terms so Solr operators cannot bypass selected filters', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const q = new URL(input).searchParams.get('q')!;
    assert.match(q, /AND "OR" AND "language:spa"/);
    assert.match(q, /AND subject:"history" AND language:"eng"$/);
    assert.ok(q.includes('"\\"quoted\\""'));
    return json({ num_found: 0, docs: [] });
  });
  assert.equal(
    (
      await new OpenLibrary().browse({
        q: 'OR language:spa "quoted"',
        topic: 'history',
        language: 'eng',
      })
    ).total,
    0,
  );
});

test('expired lists are explicitly stale during an outage, retry recovers, and malformed feeds never become library results', async (t) => {
  let now = Date.now();
  let failure = false;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () =>
    failure ? json({}, 503) : json({ works: [doc] }),
  );
  const client = new OpenLibrary();
  await client.browse();
  now += 16 * 60000;
  failure = true;
  const stale = await client.browse();
  assert.equal(stale.books[0].title, book.title);
  assert.match(stale.warning!, /previously loaded discovery/);
  now += 1200;
  failure = false;
  assert.equal((await client.browse()).warning, undefined);
  now += 25 * 60 * 60000;
  failure = true;
  await assert.rejects(client.browse());
  t.mock.method(globalThis, 'fetch', async () => json({ works: 'invalid' }));
  await assert.rejects(new OpenLibrary().browse(), /unexpected list/);
});

test('discovery starts without a query, requires authentication, checks ownership and persists requestable catalogue identities', async () => {
  const ctx = await setup();
  try {
    let calls = 0;
    const other = {
      ...book,
      id: 'ol:OL123W',
      title: 'A new discovery',
      author: 'New Author',
      identifiers: { isbn: [], work: ['ol:OL123W'] },
    };
    ctx.services.discovery.browse = async (query) => {
      calls++;
      assert.deepEqual(query, {});
      return chart([book, other]);
    };
    assert.equal((await ctx.app.inject('/api/discover')).statusCode, 401);
    const inventory = ctx.store.inventory();
    const states = ctx.store.states();
    const res = await ctx.app.inject({ url: '/api/discover', headers: ctx.headers });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(calls, 1);
    const payload = res.json();
    assert.equal(payload.page, 1);
    assert.equal(payload.mode, 'live');
    assert.deepEqual(
      payload.items.map((r: any) => r.book.title),
      [book.title, other.title],
    );
    assert.equal(payload.items[0].availability.ebook.status, 'available');
    assert.ok(payload.filters.topics.some((f: any) => f.id === 'fantasy'));
    assert.equal(ctx.store.book(other.id)?.title, other.title);
    assert.deepEqual(ctx.store.inventory(), inventory);
    assert.deepEqual(ctx.store.states(), states);
    ctx.services.enqueue = () => {};
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: ctx.headers,
      payload: { catalogId: other.id, mediaKind: 'ebook' },
    });
    assert.equal(request.statusCode, 201, request.body);
    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: ctx.headers,
      payload: { catalogId: book.id, mediaKind: 'ebook' },
    });
    assert.equal(duplicate.statusCode, 409);
  } finally {
    await ctx.close();
  }
});

test('invalid discovery filters are rejected before any upstream call', async () => {
  const ctx = await setup();
  try {
    let calls = 0;
    ctx.services.discovery.browse = async (query) => {
      calls++;
      assert.equal('extra' in (query || {}), false);
      return chart();
    };
    for (const query of [
      'sort=made-up',
      'topic=made-up',
      'language=xx',
      'era=forever',
      'page=0',
      'page=101',
      'page=1.5',
      'page=abc',
      'q=' + 'x'.repeat(201),
    ]) {
      const response = await ctx.app.inject({
        url: '/api/discover?' + query,
        headers: ctx.headers,
      });
      assert.equal(response.statusCode, 400, query + ': ' + response.body);
    }
    assert.equal(calls, 0);
    assert.equal(
      (await ctx.app.inject({ url: '/api/discover?extra=true', headers: ctx.headers })).statusCode,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    await ctx.close();
  }
});

test('an online discovery outage leaves the feed empty and preserves direct library search', async () => {
  const ctx = await setup();
  try {
    ctx.services.discovery.browse = async () => {
      throw new Error('offline');
    };
    const response = await ctx.app.inject({ url: '/api/discover', headers: ctx.headers });
    assert.deepEqual(response.json().items, []);
    assert.match(response.json().warning, /temporarily unavailable/);
    const local = await ctx.app.inject({
      url: '/api/search?q=private&scope=local',
      headers: ctx.headers,
    });
    assert.equal(local.json().library[0].book.title, 'A private local-only book');
  } finally {
    await ctx.close();
  }
});

test('demo browsing filters the sample catalogue without reading the library or calling an external provider', async () => {
  const ctx = await setup(true);
  try {
    ctx.services.discovery.browse = async () => {
      throw new Error('Demo must not call a provider');
    };
    ctx.store.saveBook({ ...book, subjects: ['fantasy'], languages: ['eng'], year: 2017 });
    const response = await ctx.app.inject({
      url: '/api/discover?topic=fantasy&language=eng&q=Oath',
      headers: ctx.headers,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().mode, 'demo');
    assert.deepEqual(
      response.json().items.map((r: any) => r.book.title),
      [book.title],
    );
    assert.equal(
      (await ctx.app.inject({ url: '/api/discover?topic=history', headers: ctx.headers })).json()
        .items.length,
      0,
    );
  } finally {
    await ctx.close();
  }
});

test('local catalogue filters treat unknown metadata as unknown and paginate only the filtered titles', () => {
  const catalog = Array.from({ length: 30 }, (_, i) => ({
    ...book,
    id: 'book-' + i,
    year: 1900 + i,
    languages: ['eng'],
    subjects: ['history'],
  }));
  assert.equal(browseCatalogue(catalog, { topic: 'history', page: 2 }).books.length, 6);
  assert.equal(browseCatalogue(catalog, { topic: 'history', page: 2 }).hasMore, false);
  assert.equal(browseCatalogue(catalog, { language: 'spa' }).total, 0);
  assert.equal(browseCatalogue([book], { era: 'recent' }).total, 0);
  assert.equal(browseCatalogue(catalog, { sort: 'new' }).books[0].year, 1929);
  assert.equal(browseCatalogue(catalog, { era: 'classics', q: 'Oathbringer' }).total, 30);
  assert.equal(
    browseCatalogue([{ ...book, subjects: ["Children's fiction"] }], { topic: 'children' }).total,
    1,
  );
  assert.equal(
    browseCatalogue([{ ...book, subjects: ['thriller'] }], { topic: 'mystery' }).total,
    1,
  );
  assert.equal(
    browseCatalogue([{ ...book, subjects: ['non-fiction'] }], { topic: 'nonfiction' }).total,
    1,
  );
});
