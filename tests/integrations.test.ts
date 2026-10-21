import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookOrbit } from '../server/integrations/bookorbit.js';
import { Chaptarr } from '../server/integrations/chaptarr.js';
import { Services } from '../server/services.js';
import { Store } from '../server/store.js';
import { book, config, item, json } from './fixtures.js';

test('BookOrbit reads every page, distinguishes missing files, and never mutates books', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    bookorbitUrl: 'http://books.test',
    bookorbitUsername: 'viewer',
    bookorbitPassword: 'private-test-secret',
  });
  const calls: { url: string; method: string; payload: any }[] = [];
  const make = (id: number, status = 'present') => ({
    id,
    title: book.title,
    authors: [book.author],
    status,
    files: [
      { role: 'primary', format: 'epub' },
      { role: 'content', format: 'm4b' },
      { role: 'extra', format: 'pdf' },
    ],
  });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    const payload = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: url.pathname, method: init.method || 'GET', payload });
    if (url.pathname.endsWith('/auth/login')) return json({ accessToken: 'test-access-token' });
    if (url.pathname.endsWith('/libraries')) return json([{ id: 1, type: 'books' }]);
    if (url.pathname.endsWith('/books'))
      return json({
        items: payload.pagination.page === 0 ? [make(1)] : [make(2, 'missing')],
        total: 2,
      });
    throw new Error('Unexpected endpoint');
  });
  const result = await new BookOrbit(c).inventory();
  assert.equal(result.length, 4);
  assert.equal(result.filter((i) => i.available).length, 2);
  assert.equal(result[0].formats.join(','), 'EPUB');
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      '/api/v1/auth/login',
      '/api/v1/libraries',
      '/api/v1/libraries/1/books',
      '/api/v1/libraries/1/books',
    ],
  );
  assert.equal(calls[2].payload.collapseSeries, false);
  assert.equal(calls[2].payload.pagination.page, 0);
  assert.equal(calls[2].payload.pagination.size, 100);
});
test('an incomplete inventory fails atomically and preserves the last complete snapshot', async (t) => {
  const c = config();
  Object.assign(c.connections, {
    bookorbitUrl: 'http://books.test',
    bookorbitUsername: 'viewer',
    bookorbitPassword: 'private-test-secret',
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  store.replaceInventory('bookorbit', [item]);
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) return json({ accessToken: 'test' });
    if (url.endsWith('/libraries')) return json([{ id: 1, type: 'books' }]);
    const page = JSON.parse(String(init.body)).pagination.page;
    return json({
      items:
        page === 0
          ? [
              {
                id: 2,
                title: 'Other Book',
                authors: [],
                status: 'present',
                files: [{ role: 'primary', format: 'epub' }],
              },
            ]
          : [],
      total: 2,
    });
  });
  try {
    await services.sync('bookorbit');
    assert.deepEqual(store.inventory(), [item]);
    assert.equal(store.state('bookorbit').status, 'error');
    assert.ok(store.state('bookorbit').lastSuccess);
  } finally {
    store.close();
  }
});
test('Chaptarr inventory requests authors and hasFiles overrides monitored flags or stale file arrays', async (t) => {
  const c = config().connections;
  Object.assign(c, { chaptarrUrl: 'http://chaptarr.test', chaptarrApiKey: 'private-key' });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.ok(String(input).includes('include=author'));
    assert.equal((init.headers as Record<string, string>)['X-Api-Key'], 'private-key');
    return json([
      {
        id: 4,
        title: book.title,
        author: { authorName: book.author },
        mediaType: 'ebook',
        hasFiles: false,
        monitored: true,
        bookFiles: [{ path: '/old/book.epub' }],
        editions: [],
        openLibraryWorkId: 'OL20158882W',
      },
    ]);
  });
  const result = await new Chaptarr(c).inventory();
  assert.equal(result[0].available, false);
  assert.equal(result[0].author, book.author);
  assert.deepEqual(result[0].identifiers.work, ['ol:OL20158882W']);
});
test('dispatch uses official scoped book lookup/add/search, coalesces concurrency, and never retries a 202 add', async (t) => {
  const c = config();
  Object.assign(c.connections, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'private-key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  store.replaceInventory('bookorbit', []);
  store.replaceInventory('chaptarr', []);
  store.saveBook(book);
  const actor = store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'test',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
  const writes: { path: string; body: any }[] = [];
  let pending = false;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/book') && init.method === 'GET') return json([]);
    if (url.pathname.endsWith('/lookup')) {
      assert.equal(url.searchParams.get('mediaType'), 'ebook');
      assert.equal(url.searchParams.get('term'), book.identifiers.work[0]);
      return json([
        {
          id: 0,
          title: book.title,
          foreignBookId: book.identifiers.work[0],
          author: { authorName: book.author, foreignAuthorId: 'ol:OL23919A' },
          localEbookBooks: [],
        },
      ]);
    }
    const body = JSON.parse(String(init.body));
    writes.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/book')) {
      assert.equal(body.mediaType, 'ebook');
      assert.equal(body.author.rootFolderPath, '/ebooks');
      assert.equal(body.addOptions.searchForNewBook, false);
      return pending ? json({ pendingId: 99 }, 202) : json({ id: 42 });
    }
    if (url.pathname.endsWith('/command')) {
      assert.deepEqual(body, { name: 'BookSearch', bookIds: [42] });
      return json({ id: 8 });
    }
    throw new Error('Unexpected write');
  });
  try {
    const request = store.createRequest(book, 'ebook', actor);
    await Promise.all([services.dispatch(request.id), services.dispatch(request.id)]);
    assert.equal(writes.length, 2);
    assert.equal(store.request(request.id)?.status, 'requested');
    pending = true;
    const other = { ...book, id: 'ol:other' };
    store.saveBook(other);
    const uncertain = store.createRequest(other, 'ebook', actor);
    await services.dispatch(uncertain.id);
    await services.dispatch(uncertain.id);
    assert.equal(writes.length, 3);
    assert.equal(store.request(uncertain.id)?.status, 'needs_review');
  } finally {
    store.close();
  }
});
test('dispatch rechecks complete inventory and finds a new copy before writing to Chaptarr', async (t) => {
  const c = config();
  Object.assign(c.connections, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  store.replaceInventory('chaptarr', []);
  store.saveBook(book);
  const actor = store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'test',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method !== 'GET') writes++;
    return json([
      {
        id: 7,
        title: book.title,
        author: { authorName: book.author },
        mediaType: 'ebook',
        hasFiles: true,
        formats: ['EPUB'],
      },
    ]);
  });
  try {
    const request = store.createRequest(book, 'ebook', actor);
    await services.dispatch(request.id);
    assert.equal(store.request(request.id)?.status, 'available');
    assert.equal(writes, 0);
  } finally {
    store.close();
  }
});
test('cancelling during inventory verification prevents any remote submission', async (t) => {
  const c = config();
  Object.assign(c.connections, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  store.replaceInventory('chaptarr', []);
  store.saveBook(book);
  const actor = store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'test',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
  let finish!: (response: Response) => void;
  let writes = 0;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method !== 'GET') {
      writes++;
      return json({});
    }
    if (reads++ > 0) return json([]);
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  try {
    const request = store.createRequest(book, 'ebook', actor);
    const running = services.dispatch(request.id);
    assert.equal(store.request(request.id)?.status, 'checking');
    store.updateRequest(request.id, 'cancelled', 'Cancelled during verification.');
    finish(json([]));
    await running;
    assert.equal(store.request(request.id)?.status, 'cancelled');
    assert.equal(writes, 0);
  } finally {
    store.close();
  }
});
test('a newly available copy between lookup and write stops acquisition', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  let wrote = false;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') wrote = true;
    return json([{ id: 0, title: book.title, author: { authorName: book.author } }]);
  });
  await assert.rejects(
    new Chaptarr(c).submit(book, 'ebook', () => {
      throw new Error('Library changed');
    }),
    /Library changed/,
  );
  assert.equal(wrote, false);
});
test('a missing unmonitored work is reused and monitored without adding another book or changing author policy', async (t) => {
  const c = config().connections;
  Object.assign(c, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const calls: { path: string; method: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init.method || 'GET', body });
    if (path.endsWith('/lookup'))
      return json([
        {
          title: book.title + ': A Stormlight novel',
          openLibraryWorkId: 'OL20158882W',
          author: { authorName: book.author },
          localEbookBooks: [{ id: 9, hasFiles: false, monitored: false }],
        },
      ]);
    if (path.endsWith('/book/9')) {
      if (init.method === 'GET')
        return json({
          id: 9,
          title: book.title,
          mediaType: 'ebook',
          hasFiles: false,
          ebookMonitored: false,
          audiobookMonitored: false,
          author: { id: 2, ebookMonitored: true, ebookMonitorNewItems: 'all' },
        });
      assert.equal(init.method, 'PUT');
      assert.equal(body.ebookMonitored, true);
      assert.equal(body.audiobookMonitored, false);
      assert.equal(body.author.ebookMonitorNewItems, 'all');
      return json(body);
    }
    if (path.endsWith('/command')) {
      assert.deepEqual(body.bookIds, [9]);
      return json({ id: 1 });
    }
    throw new Error('Unexpected book creation');
  });
  const result = await new Chaptarr(c).submit(book, 'ebook', () => {});
  assert.equal(result.id, 9);
  assert.equal(calls.filter((c) => c.path.endsWith('/book')).length, 0);
});
test('metadata warmup retries only lookups with persistent backoff and never sends a blind add', async (t) => {
  const c = config();
  Object.assign(c.connections, {
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  store.replaceInventory('chaptarr', []);
  store.saveBook(book);
  const actor = store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'test',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(init.method, 'GET');
    assert.ok(String(url).includes('/lookup'));
    return json([]);
  });
  try {
    const request = store.createRequest(book, 'ebook', actor);
    await services.dispatch(request.id);
    assert.equal(store.request(request.id)?.status, 'pending_metadata');
    await services.dispatch(request.id);
    assert.equal(calls, 2);
    assert.ok(store.setting(`lookup_retry:${request.id}`));
  } finally {
    store.close();
  }
});
test('connection settings are encrypted and never returned as plaintext secrets', async () => {
  const c = config();
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
  try {
    services.saveConnections(
      {
        ...c.connections,
        bookorbitPassword: 'top-secret-private-password',
        chaptarrApiKey: 'top-secret-private-api-key',
      },
      actor,
    );
    assert.ok(store.setting('connections'));
    assert.equal(store.setting('connections')!.includes('top-secret'), false);
    const restarted = new Services(c, store);
    assert.equal(restarted.connections.bookorbitPassword, 'top-secret-private-password');
  } finally {
    store.close();
  }
});
