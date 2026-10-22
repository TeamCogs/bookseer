import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LibraryServerConfig } from '../shared/types.js';
import { librarySource } from '../shared/libraries.js';
import { Grimmory } from '../server/integrations/grimmory.js';
import { Audiobookshelf } from '../server/integrations/audiobookshelf.js';
import { BookOrbit } from '../server/integrations/bookorbit.js';
import { Services } from '../server/services.js';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { normalizeConnections } from '../server/library-config.js';
import { bookResult, groupInventory } from '../server/matching.js';
import { encrypt } from '../server/security.js';
import { book, config, json } from './fixtures.js';

function server(
  provider: LibraryServerConfig['provider'],
  id = provider as string,
): LibraryServerConfig {
  return {
    id,
    provider,
    name: `Family ${provider}`,
    url: `http://${id}.test`,
    publicUrl: '',
    username: provider === 'audiobookshelf' ? '' : 'viewer',
    password: provider === 'audiobookshelf' ? '' : `private-password-${id}`,
    apiKey: provider === 'audiobookshelf' ? `private-token-${id}` : '',
    libraryIds: '',
  };
}
function grimmoryBook(id = 1) {
  return {
    id,
    libraryId: 7,
    title: book.title,
    isPhysical: false,
    primaryFile: { id: 1, isBook: true, extension: 'epub', bookType: 'EPUB' },
    alternativeFormats: [{ id: 2, isBook: true, extension: 'm4b', bookType: 'AUDIOBOOK' }],
    supplementaryFiles: [{ id: 3, extension: 'pdf' }],
    metadata: {
      authors: [book.author],
      isbn13: book.identifiers.isbn[0],
      openlibraryId: book.identifiers.work[0].slice(3),
      publishedDate: '2017-11-14',
      coverUpdatedOn: '2026-01-01T00:00:00Z',
      audiobookCoverUpdatedOn: '2026-01-01T00:00:00Z',
    },
  };
}
function absBook(id = 'item-one', kind: 'ebook' | 'audiobook' = 'audiobook') {
  return {
    id,
    libraryId: 'library-one',
    mediaType: 'book',
    isMissing: false,
    isInvalid: false,
    media: {
      metadata: {
        title: book.title,
        authors: [{ id: 'author-one', name: book.author }],
        isbn: book.identifiers.isbn[0],
        publishedYear: '2017',
      },
      coverPath: '/library/cover.jpg',
      audioFiles: kind === 'audiobook' ? [{ metadata: { ext: '.m4b' }, invalid: false }] : [],
      ebookFile: kind === 'ebook' ? { ebookFormat: 'epub', metadata: { ext: '.epub' } } : null,
    },
  };
}
function owner(store: Store) {
  return store.addUser({
    username: 'owner',
    displayName: 'Owner',
    passwordHash: 'unused',
    role: 'admin',
    autoApprove: true,
    weeklyLimit: 0,
  });
}

test('Grimmory reads selected healthy libraries, includes alternate formats, excludes physical and supplementary copies, and proxies covers', async (t) => {
  const connection = server('grimmory');
  connection.libraryIds = '7';
  const adapter = new Grimmory(connection);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.origin, connection.url);
    assert.equal(url.searchParams.has('token'), false);
    if (url.pathname.endsWith('/auth/login')) {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), {
        username: 'viewer',
        password: connection.password,
      });
      return json({ accessToken: 'private-access-token' });
    }
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      'Bearer private-access-token',
    );
    if (url.pathname.endsWith('/libraries'))
      return json([
        { id: 7, name: 'Books' },
        { id: 8, name: 'Other library' },
      ]);
    if (url.pathname.endsWith('/health')) return json({ 7: true, 8: false });
    if (url.pathname.endsWith('/7/book'))
      return json([grimmoryBook(), { id: 2, libraryId: 7, title: 'Paper book', isPhysical: true }]);
    if (url.pathname.endsWith('/audiobook-thumbnail'))
      return new Response('image', { headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  });
  const copies = await adapter.inventory();
  assert.equal(copies.length, 2);
  assert.deepEqual(
    copies.map((copy) => copy.formats),
    [['EPUB'], ['M4B']],
  );
  assert.equal(copies[0].source, 'library:grimmory');
  assert.equal(copies[0].sourceName, connection.name);
  assert.equal(copies[0].year, 2017);
  assert.deepEqual(copies[0].identifiers.work, book.identifiers.work);
  assert.ok(copies.every((copy) => copy.available));
  assert.equal(copies[0].url, 'http://grimmory.test/book/1');
  assert.ok(copies[0].coverUrl?.startsWith('/api/covers/library'));
  assert.equal((await adapter.cover(copies[1])).status, 200);
  assert.equal(calls.filter((path) => path.endsWith('/health')).length, 2);
  await assert.rejects(
    new Grimmory({ ...connection, url: 'http://replacement.test' }).cover(copies[0]),
    /previous connection/,
  );
});

test('Audiobookshelf reads all pages using a bearer API token, excludes podcasts, and distinguishes ebook, audio, and missing files', async (t) => {
  const connection = server('audiobookshelf');
  const adapter = new Audiobookshelf(connection);
  const pages: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, connection.url);
    assert.equal(init.method || 'GET', 'GET');
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      `Bearer ${connection.apiKey}`,
    );
    assert.equal(url.searchParams.has('token'), false);
    if (url.pathname.endsWith('/libraries'))
      return json({
        libraries: [
          { id: 'library-one', name: 'Books', mediaType: 'book' },
          { id: 'podcasts', name: 'Podcasts', mediaType: 'podcast' },
        ],
      });
    if (url.pathname.endsWith('/cover'))
      return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    assert.equal(url.pathname, '/api/libraries/library-one/items');
    assert.equal(url.searchParams.get('minified'), '0');
    assert.equal(url.searchParams.get('collapseseries'), '0');
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    return json({
      total: 2,
      page,
      results: page === 0 ? [absBook()] : [{ ...absBook('ebook', 'ebook'), isMissing: true }],
    });
  });
  const copies = await adapter.inventory();
  assert.deepEqual(pages, [0, 1]);
  assert.deepEqual(
    copies.map((copy) => copy.mediaKind),
    ['audiobook', 'ebook'],
  );
  assert.deepEqual(
    copies.map((copy) => copy.formats),
    [['M4B'], ['EPUB']],
  );
  assert.deepEqual(
    copies.map((copy) => copy.available),
    [true, false],
  );
  assert.equal(copies[0].author, book.author);
  assert.equal(copies[0].url, 'http://audiobookshelf.test/item/item-one');
  await adapter.cover(copies[0]);
  assert.equal(adapter.map({ ...absBook(), isInvalid: true })[0].available, false);
  const invalidAudio = absBook();
  invalidAudio.media.audioFiles[0].invalid = true;
  assert.equal(adapter.map(invalidAudio)[0].available, false);
  assert.throws(
    () =>
      adapter.map({ ...absBook(), media: { metadata: { title: 'Unsupported minified record' } } }),
    /file details/,
  );
});

for (const failure of [
  'repeated IDs',
  'changing total',
  'missing page',
  'inaccessible library',
  'malformed record',
]) {
  test(`Audiobookshelf preserves its last complete snapshot after ${failure}`, async (t) => {
    const c = config();
    const connection = server('audiobookshelf');
    c.connections.libraryServers = [connection];
    const store = new Store(':memory:');
    const services = new Services(c, store);
    const previous = new Audiobookshelf(connection).map(absBook());
    store.replaceInventory(librarySource(connection), previous);
    t.mock.method(globalThis, 'fetch', async (input: string) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/libraries'))
        return json({
          libraries:
            failure === 'inaccessible library' ? [] : [{ id: 'library-one', mediaType: 'book' }],
        });
      const page = Number(url.searchParams.get('page'));
      if (failure === 'malformed record')
        return json({ total: 1, results: [{ ...absBook(), media: {} }] });
      return json({
        total: page > 0 && failure === 'changing total' ? 3 : 2,
        page,
        results: page === 0 || failure === 'repeated IDs' ? [absBook()] : [],
      });
    });
    try {
      await services.sync(librarySource(connection));
      assert.deepEqual(store.inventory(), previous);
      const state = store.state(librarySource(connection));
      assert.equal(state.status, 'error');
      assert.ok(state.lastSuccess);
      assert.equal(bookResult(book, store, 24).availability.audiobook.status, 'unknown');
    } finally {
      services.cancel();
      store.close();
    }
  });
}

test('Grimmory refuses an unavailable path, a duplicate book, and an inaccessible selected library without erasing inventory', async (t) => {
  const c = config();
  const connection = server('grimmory');
  connection.libraryIds = '7';
  c.connections.libraryServers = [connection];
  const store = new Store(':memory:');
  const services = new Services(c, store);
  const previous = new Grimmory(connection).map(grimmoryBook());
  store.replaceInventory(librarySource(connection), previous);
  let mode = 'health';
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/login')) return json({ accessToken: 'private-access-token' });
    if (path.endsWith('/libraries')) return json(mode === 'permission' ? [{ id: 8 }] : [{ id: 7 }]);
    if (path.endsWith('/health')) return json({ 7: mode !== 'health' });
    return json([grimmoryBook(), grimmoryBook()]);
  });
  try {
    for (mode of ['health', 'duplicate', 'permission']) {
      await services.sync(librarySource(connection));
      assert.deepEqual(store.inventory(), previous);
      assert.equal(store.state(librarySource(connection)).status, 'error');
    }
  } finally {
    services.cancel();
    store.close();
  }
});

test('existing encrypted BookOrbit settings retain inventory IDs, groups, and reviewed identities when upgraded', () => {
  const c = config();
  Object.assign(c.connections, {
    bookorbitUrl: 'http://existing.test',
    bookorbitUsername: 'viewer',
    bookorbitPassword: 'private-legacy-password',
  });
  const store = new Store(':memory:');
  const actor = owner(store);
  const old = new BookOrbit(c.connections).map({
    id: 1,
    title: book.title,
    authors: [book.author],
    status: 'present',
    files: [{ role: 'primary', format: 'epub' }],
  });
  store.replaceInventory('bookorbit', old);
  const savedInventory = store.inventory();
  store.db
    .prepare('INSERT INTO library_groups VALUES(?,?,?,?)')
    .run('existing-group', old[0].id, JSON.stringify([old[0].id]), actor.id);
  store.saveBook(book);
  store.confirmMatch(book.id, 'ebook', [old[0].id], actor.id);
  store.setSetting('connections', encrypt(JSON.stringify(c.connections), c.secret));
  const services = new Services(c, store);
  try {
    assert.equal(services.connections.libraryServers[0].id, 'bookorbit');
    assert.equal(services.connections.libraryServers[0].password, 'private-legacy-password');
    assert.deepEqual(store.inventory(), savedInventory);
    assert.equal(store.libraryGroups()[0].canonicalId, old[0].id);
    assert.deepEqual(store.confirmedMatches(book.id, 'ebook'), [old[0].id]);
    assert.equal(store.state('bookorbit').status, 'error');
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'unknown');
    assert.equal(
      new BookOrbit(normalizeConnections(c.connections)).map({
        id: 1,
        title: book.title,
        authors: [book.author],
        status: 'present',
        files: [{ role: 'primary', format: 'epub' }],
      })[0].id,
      old[0].id,
    );
  } finally {
    services.cancel();
    store.close();
  }
});

test('a delayed snapshot from a replaced server cannot overwrite the replacement connection', async (t) => {
  const c = config();
  const connection = server('audiobookshelf');
  c.connections.libraryServers = [connection];
  const store = new Store(':memory:');
  const services = new Services(c, store);
  const actor = owner(store);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/libraries'))
      return json({ libraries: [{ id: 'library-one', mediaType: 'book' }] });
    if (url.hostname === 'audiobookshelf.test') {
      started();
      await waiting;
    }
    return json({ total: 1, results: [absBook(url.hostname)] });
  });
  const delayed = services.sync(librarySource(connection));
  try {
    await began;
    services.saveConnections(
      {
        ...c.connections,
        libraryServers: [
          { ...connection, url: 'http://replacement.test', apiKey: 'replacement-private-key' },
        ],
      },
      actor,
    );
    await services.sync(librarySource(connection));
    const replacement = store.inventory();
    assert.equal(replacement[0].remoteId, 'replacement.test');
    release();
    await delayed;
    assert.deepEqual(store.inventory(), replacement);
    assert.equal(store.state(librarySource(connection)).status, 'healthy');
  } finally {
    release();
    await delayed;
    services.cancel();
    store.close();
  }
});

for (const scenario of [
  'startup',
  'changed connection',
  'retry after failure',
  'regular background sync',
]) {
  test(`an in-flight ${scenario} uses only a verified snapshot`, async (t) => {
    const c = config();
    const connection = server('audiobookshelf');
    c.connections.libraryServers = [connection];
    const store = new Store(':memory:');
    let services = new Services(c, store);
    const actor = owner(store);
    store.replaceInventory(librarySource(connection), []);
    if (scenario === 'startup') {
      services.cancel();
      services = new Services(c, store);
    } else if (scenario === 'changed connection')
      services.saveConnections(
        { ...c.connections, libraryServers: [{ ...connection, url: 'http://replacement.test' }] },
        actor,
      );
    else if (scenario === 'retry after failure')
      store.setState({ ...store.state(librarySource(connection)), status: 'error' });
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.mock.method(globalThis, 'fetch', async (input: string) => {
      if (String(input).endsWith('/libraries'))
        return json({ libraries: [{ id: 'library-one', mediaType: 'book' }] });
      started();
      await waiting;
      return json({ total: 0, results: [] });
    });
    const syncing = services.sync(librarySource(connection));
    try {
      await began;
      assert.equal(store.state(librarySource(connection)).status, 'syncing');
      assert.ok(store.state(librarySource(connection)).lastSuccess);
      assert.equal(
        bookResult(book, store, 24).availability.ebook.status,
        scenario === 'regular background sync' ? 'not_found' : 'unknown',
      );
      release();
      await syncing;
      assert.equal(bookResult(book, store, 24).availability.ebook.status, 'not_found');
      assert.equal(store.state(librarySource(connection)).snapshotVerified, true);
    } finally {
      release();
      await syncing;
      services.cancel();
      store.close();
    }
  });
}

test('an incomplete saved connection blocks negative ownership until it is configured and synced', async () => {
  const c = config();
  c.connections.libraryServers = [{ ...server('audiobookshelf'), apiKey: '' }];
  const store = new Store(':memory:');
  const services = new Services(c, store);
  try {
    await services.syncAll();
    assert.equal(store.state('library:audiobookshelf').configured, true);
    assert.equal(store.state('library:audiobookshelf').status, 'error');
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'unknown');
  } finally {
    services.cancel();
    store.close();
  }
});

test('named servers, encrypted credentials, snapshots, and identity reviews survive reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookseerr-servers-'));
  const path = join(directory, 'test.sqlite');
  const c = config();
  const connections = [server('grimmory'), server('audiobookshelf')];
  connections[0].libraryIds = '7';
  connections[1].libraryIds = 'library-one';
  let store = new Store(path);
  let services = new Services(c, store);
  try {
    const actor = owner(store);
    services.saveConnections({ ...c.connections, libraryServers: connections }, actor);
    const copies = new Grimmory(connections[0]).map(grimmoryBook());
    store.replaceInventory(librarySource(connections[0]), copies);
    store.saveBook(book);
    store.confirmMatch(book.id, 'ebook', [copies[0].id], actor.id);
    services.cancel();
    store.close();
    store = new Store(path);
    services = new Services(c, store);
    assert.deepEqual(services.connections.libraryServers, connections);
    assert.deepEqual(store.confirmedMatches(book.id, 'ebook'), [copies[0].id]);
    assert.equal(store.inventory().length, 2);
    assert.equal(store.state(librarySource(connections[0])).status, 'error');
    assert.ok(store.state(librarySource(connections[0])).lastSuccess);
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'unknown');
  } finally {
    services.cancel();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('multiple servers of the same type keep independent snapshots and group their copies across providers', async (t) => {
  const c = config();
  const connections = [
    server('bookorbit', 'bookorbit'),
    server('grimmory'),
    server('audiobookshelf', 'audio-one'),
    server('audiobookshelf', 'audio-two'),
  ];
  c.connections.libraryServers = connections;
  const store = new Store(':memory:');
  const services = new Services(c, store);
  let failed = '';
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(String(input));
    if (url.hostname === failed) return json({}, 503);
    if (url.pathname.endsWith('/auth/login')) return json({ accessToken: 'private-token' });
    if (url.pathname.endsWith('/libraries'))
      return url.hostname.startsWith('audio')
        ? json({ libraries: [{ id: 'library-one', mediaType: 'book' }] })
        : json(url.hostname.startsWith('grimmory') ? [{ id: 7 }] : [{ id: 1, type: 'books' }]);
    if (url.pathname.endsWith('/health')) return json({ 7: true });
    if (url.pathname.endsWith('/book')) return json([grimmoryBook()]);
    if (url.pathname.endsWith('/items')) return json({ total: 1, results: [absBook('1')] });
    return json({
      total: 1,
      items: [
        {
          id: 1,
          title: book.title,
          authors: [book.author],
          status: 'present',
          files: [{ role: 'primary', format: 'pdf' }],
        },
      ],
    });
  });
  try {
    await services.syncAll();
    const items = store.inventory();
    assert.equal(items.length, 5);
    assert.equal(new Set(items.map((item) => item.id)).size, 5);
    assert.equal(new Set(items.map((item) => item.source)).size, 4);
    const grouped = groupInventory(items);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].copies.length, 5);
    assert.deepEqual(
      Object.values(bookResult(book, store, 24).availability).map((value) => value.status),
      ['available', 'available'],
    );
    failed = 'audio-one.test';
    await services.syncAll();
    assert.equal(store.inventory().length, 5);
    assert.equal(store.state('library:audio-one').status, 'error');
    assert.equal(store.state('library:audio-two').status, 'healthy');
    assert.equal(bookResult(book, store, 24).availability.audiobook.status, 'available');
    assert.equal(
      bookResult(
        { ...book, id: 'other', title: 'Other complete book', identifiers: { isbn: [], work: [] } },
        store,
        24,
      ).availability.audiobook.status,
      'unknown',
    );
  } finally {
    services.cancel();
    store.close();
  }
});

test('settings check and save support named servers, protect credentials, and remove only the selected connection cache', async (t) => {
  const c = config();
  const store = new Store(':memory:');
  const { app, services } = await buildApp(c, { store });
  const actor = store.users()[0];
  const session = store.createSession(actor.id);
  const headers = { cookie: `bookseerr_session=${session.value}`, 'x-csrf-token': session.csrf };
  const connections = [server('grimmory'), server('audiobookshelf')];
  const origins: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    origins.push(url.origin);
    if (url.pathname.endsWith('/auth/login')) return json({ accessToken: 'private-access-token' });
    if (url.pathname.endsWith('/libraries'))
      return url.hostname.startsWith('grimmory')
        ? json([{ id: 7, name: 'Family ebooks' }])
        : json({ libraries: [{ id: 'library-one', name: 'Family audio', mediaType: 'book' }] });
    if (url.pathname.endsWith('/health')) return json({ 7: true });
    if (url.pathname.endsWith('/book')) return json([grimmoryBook()]);
    if (url.pathname.endsWith('/cover') || url.pathname.includes('thumbnail')) {
      assert.ok((init.headers as Record<string, string>).Authorization.startsWith('Bearer '));
      return new Response('image', { headers: { 'content-type': 'image/png' } });
    }
    return json({ total: 1, results: [absBook()] });
  });
  try {
    const payload = { ...c.connections, libraryServers: connections };
    const check = await app.inject({
      method: 'POST',
      url: '/api/settings/check',
      headers,
      payload,
    });
    assert.equal(check.statusCode, 200, check.body);
    assert.deepEqual(
      check.json().libraryServers.map((server: { ok: boolean }) => server.ok),
      [true, true],
    );
    assert.equal(check.body.includes('private-'), false);
    assert.equal(store.setting('connections'), undefined);
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', headers, payload });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(store.inventory().length, 3);
    assert.equal(store.setting('connections')!.includes('private-'), false);
    const settings = await app.inject({ url: '/api/settings', headers });
    assert.equal(settings.body.includes('private-'), false);
    const redacted = settings.json().connections.libraryServers;
    assert.equal(redacted[0].passwordSet, true);
    assert.equal(redacted[1].apiKeySet, true);
    const blank = redacted.map(({ passwordSet: _p, apiKeySet: _a, ...value }: any) => value);
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/settings',
          headers,
          payload: { ...payload, libraryServers: blank },
        })
      ).statusCode,
      200,
    );
    assert.equal(services.connections.libraryServers[0].password, connections[0].password);
    assert.equal(services.connections.libraryServers[1].apiKey, connections[1].apiKey);
    const library = (await app.inject({ url: '/api/library', headers })).json();
    assert.equal(library.total, 1);
    assert.equal(library.rawCopies, 3);
    const copies = store.inventory();
    for (const item of copies)
      assert.equal((await app.inject({ url: item.coverUrl!, headers })).statusCode, 200);
    assert.ok(
      origins.includes('http://grimmory.test') && origins.includes('http://audiobookshelf.test'),
    );
    const obsoleteCover = copies.find(
      (item) => item.source === 'library:audiobookshelf',
    )!.coverUrl!;
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers,
      payload: { ...payload, libraryServers: [blank[0]] },
    });
    assert.equal(store.inventory().length, 2);
    assert.equal(
      store.states().some((state) => state.source === 'library:audiobookshelf'),
      false,
    );
    assert.equal((await app.inject({ url: obsoleteCover, headers })).statusCode, 404);
    const duplicate = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers,
      payload: { ...payload, libraryServers: [connections[0], connections[0]] },
    });
    assert.equal(duplicate.statusCode, 400);
    origins.length = 0;
    const changed = { ...blank[0], url: 'http://replacement.test' };
    const changedCheck = await app.inject({
      method: 'POST',
      url: '/api/settings/check',
      headers,
      payload: { ...payload, libraryServers: [changed] },
    });
    assert.equal(changedCheck.json().libraryServers[0].ok, false);
    assert.deepEqual(origins, []);
  } finally {
    await app.close();
    store.close();
  }
});

test('dispatch rechecks every library server and finds an acquired copy before any Chaptarr write', async (t) => {
  const c = config();
  const connections = [server('grimmory'), server('audiobookshelf')];
  Object.assign(c.connections, {
    libraryServers: connections,
    chaptarrUrl: 'http://chaptarr.test',
    chaptarrApiKey: 'private-chaptarr-key',
    ebookRootFolder: '/ebooks',
    ebookQualityProfileId: 1,
    ebookMetadataProfileId: 1,
  });
  const store = new Store(':memory:');
  const services = new Services(c, store);
  const actor = owner(store);
  for (const connection of connections) store.replaceInventory(librarySource(connection), []);
  store.replaceInventory('chaptarr', []);
  store.saveBook(book);
  const seen = new Set<string>();
  const writes: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(String(input));
    seen.add(url.hostname);
    if (url.hostname === 'chaptarr.test') {
      if (init.method && init.method !== 'GET') {
        writes.push(url.pathname);
        throw new Error('Unexpected acquisition');
      }
      if (url.pathname.endsWith('/lookup'))
        return json([
          {
            id: 0,
            title: book.title,
            foreignBookId: book.identifiers.work[0],
            author: { authorName: book.author, foreignAuthorId: 'ol:OL23919A' },
            localEbookBooks: [],
          },
        ]);
      return json([]);
    }
    if (url.pathname.endsWith('/auth/login')) return json({ accessToken: 'private-token' });
    if (url.pathname.endsWith('/libraries'))
      return url.hostname.startsWith('grimmory')
        ? json([{ id: 7 }])
        : json({ libraries: [{ id: 'library-one', mediaType: 'book' }] });
    if (url.pathname.endsWith('/health')) return json({ 7: true });
    if (url.pathname.endsWith('/book')) return json([grimmoryBook()]);
    return json({ results: [], total: 0 });
  });
  try {
    const request = store.createRequest(book, 'ebook', actor);
    await services.dispatch(request.id);
    assert.equal(store.request(request.id)?.status, 'available');
    assert.deepEqual(writes, []);
    assert.deepEqual([...seen].sort(), ['audiobookshelf.test', 'chaptarr.test', 'grimmory.test']);
    const other = {
      ...book,
      id: 'other',
      title: 'An unrelated complete book',
      identifiers: { isbn: [], work: [] },
    };
    store.saveBook(other);
    store.setState({ ...store.state('library:audiobookshelf'), status: 'error' });
    const pending = store.createRequest(other, 'ebook', actor);
    seen.clear();
    await services.dispatch(pending.id);
    assert.equal(store.request(pending.id)?.status, 'pending_setup');
    assert.equal(seen.size, 0);
  } finally {
    services.cancel();
    store.close();
  }
});
