import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { config, item, json } from './fixtures.js';

test('connection checks load names without saving or exposing secrets', async (t) => {
  const c = config();
  const store = new Store(':memory:');
  const { app } = await buildApp(c, { store });
  const owner = store.users()[0];
  const session = store.createSession(owner.id);
  const headers = { cookie: 'bookseerr_session=' + session.value, 'x-csrf-token': session.csrf };
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/login')) return json({ accessToken: 'private-token-fixture' });
    if (path.endsWith('/libraries')) return json([{ id: 1, name: 'Family books', type: 'books' }]);
    if (path.endsWith('/rootfolder')) return json([{ id: 1, name: 'Ebooks', path: '/ebooks' }]);
    if (path.endsWith('/qualityprofile') || path.endsWith('/metadataprofile'))
      return json([{ id: 2, name: 'Ebook profile', profileType: 'ebook' }]);
    if (path.endsWith('/system/status')) return json({ version: 'fixture-version' });
    throw new Error('Unexpected endpoint');
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/check',
      headers,
      payload: {
        ...c.connections,
        bookorbitUrl: 'http://books.test',
        bookorbitUsername: 'viewer',
        bookorbitPassword: 'private-fixture-password',
        chaptarrUrl: 'http://chaptarr.test',
        chaptarrApiKey: 'private-fixture-key',
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().bookorbit.libraries[0].name, 'Family books');
    assert.equal(response.json().chaptarr.quality[0].name, 'Ebook profile');
    assert.equal(response.body.includes('private-fixture'), false);
    assert.equal(response.body.includes('private-token'), false);
    assert.equal(store.setting('connections'), undefined);
  } finally {
    await app.close();
    store.close();
  }
});

test('library grouping and undo persist, preserve all inventory, and require administrator permission', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookseerr-group-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  let app;
  try {
    ({ app } = await buildApp(config(), { store }));
    const owner = store.users()[0];
    const reader = store.addUser({
      username: 'reader',
      displayName: 'Reader',
      passwordHash: 'not-used',
      role: 'user',
      autoApprove: false,
      weeklyLimit: 5,
    });
    const actor = store.createSession(owner.id);
    const guest = store.createSession(reader.id);
    const headers = { cookie: 'bookseerr_session=' + actor.value, 'x-csrf-token': actor.csrf };
    store.replaceInventory('bookorbit', [
      item,
      { ...item, id: 'alternative', title: 'Alternative title' },
    ]);
    const payload = { itemIds: [item.id, 'alternative'], canonicalId: item.id };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/library/groups',
          headers: { cookie: 'bookseerr_session=' + guest.value, 'x-csrf-token': guest.csrf },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/library/groups', headers, payload }))
        .statusCode,
      200,
    );
    assert.equal((await app.inject({ url: '/api/library', headers })).json().total, 1);
    await app.close();
    store.close();
    store = new Store(path);
    ({ app } = await buildApp(config(), { store }));
    assert.equal(store.libraryGroups().length, 1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const id = store.libraryGroups()[0].id;
    assert.equal(
      (await app.inject({ method: 'DELETE', url: '/api/library/groups/' + id, headers }))
        .statusCode,
      200,
    );
    assert.equal((await app.inject({ url: '/api/library', headers })).json().total, 2);
    assert.equal(store.inventory().length, 2);
  } finally {
    if (app) await app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('the production entry point and assets serve while private API routes remain authenticated', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookseerr-static-'));
  writeFileSync(join(directory, 'index.html'), '<html><title>Bookseerr</title></html>');
  const store = new Store(':memory:');
  const { app } = await buildApp(config(), { store, staticDir: directory });
  try {
    const page = await app.inject('/');
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Bookseerr/);
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.equal((await app.inject('/api/library')).statusCode, 401);
    assert.equal((await app.inject('/api/unknown')).statusCode, 404);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
