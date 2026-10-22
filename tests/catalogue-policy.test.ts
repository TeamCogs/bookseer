import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { CataloguePolicy } from '../server/catalogue-policy.js';
import { Store } from '../server/store.js';
import { config, book as unlisted } from './fixtures.js';

const approved = {
  id: 'ol:OL450063W',
  title: 'Frankenstein',
  author: 'Mary Shelley',
  origin: 'openlibrary' as const,
  identifiers: { isbn: [], work: ['ol:OL450063W'] },
};
function manifest(value: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'bookseerr-catalogue-'));
  const path = join(dir, 'catalogue.json');
  writeFileSync(path, JSON.stringify(value));
  return { path, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('invalid, empty, missing and duplicate catalogues fail closed', () => {
  for (const value of [
    [],
    {},
    [{ book: approved, formats: [] }],
    [
      { book: approved, formats: ['ebook'] },
      { book: approved, formats: ['ebook'] },
    ],
  ]) {
    const file = manifest(value);
    try {
      assert.throws(() => new CataloguePolicy(file.path));
    } finally {
      file.close();
    }
  }
  assert.throws(() => new CataloguePolicy(join(tmpdir(), 'no-such-bookseerr-catalogue.json')));
});

test('curated discovery never calls online search and forged or unlisted formats cannot dispatch', async () => {
  const file = manifest([{ book: approved, formats: ['ebook'] }]);
  const store = new Store(':memory:');
  const ctx = await buildApp({ ...config(), catalogueFile: file.path }, { store });
  try {
    store.replaceInventory('bookorbit', []);
    store.saveBook(unlisted);
    let externalCalls = 0;
    ctx.services.discovery.search = async () => {
      externalCalls++;
      throw new Error('Must not search externally');
    };
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: {
        username: 'admin',
        password: 'a-strong-test-password',
      },
    });
    const headers = {
      cookie: `bookseerr_session=${login.cookies[0].value}`,
      'x-csrf-token': login.json().csrf,
    };
    const search = await ctx.app.inject({ url: '/api/search?q=', headers });
    assert.equal(search.statusCode, 200);
    assert.deepEqual(
      search.json().discovery.map((r: any) => r.book.id),
      [approved.id],
    );
    assert.deepEqual(search.json().discovery[0].requestPolicy.ebook, true);
    assert.equal(search.json().discovery[0].requestPolicy.audiobook, false);
    assert.equal(
      (await ctx.app.inject({ url: '/api/search?q=Oathbringer', headers })).json().discovery.length,
      0,
    );
    assert.equal(externalCalls, 0);
    for (const request of [
      { method: 'POST' as const, url: '/api/settings/check' },
      { method: 'PUT' as const, url: '/api/settings' },
    ]) {
      const response = await ctx.app.inject({
        ...request,
        headers,
        payload: ctx.services.connections,
      });
      assert.equal(response.statusCode, 403, response.body);
    }
    for (const payload of [
      { catalogId: unlisted.id, mediaKind: 'ebook' },
      { catalogId: approved.id, mediaKind: 'audiobook' },
    ]) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/requests',
        headers,
        payload,
      });
      assert.equal(response.statusCode, 403, response.body);
    }
    const accepted = await ctx.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers,
      payload: { catalogId: approved.id, mediaKind: 'ebook' },
    });
    assert.equal(accepted.statusCode, 201, accepted.body);
    await ctx.services.drain();
    assert.equal(store.requestsFor(store.users()[0]).length, 1);
    const old = store.createRequest(unlisted, 'ebook', store.users()[0]);
    for (const action of ['approve', 'retry']) {
      const denied = await ctx.app.inject({
        method: 'POST',
        url: `/api/requests/${old.id}/${action}`,
        headers,
        payload: {},
      });
      assert.equal(denied.statusCode, 403, denied.body);
    }
    await ctx.services.dispatch(old.id);
    assert.equal(store.request(old.id)?.status, 'needs_review');
    store.saveBook({ ...approved, title: 'A different work' });
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/requests',
          headers,
          payload: { catalogId: approved.id, mediaKind: 'ebook' },
        })
      ).statusCode,
      403,
    );
    assert.throws(
      () => ctx.services.saveConnections(ctx.services.connections, store.users()[0]),
      /operator/,
    );
  } finally {
    await ctx.app.close();
    store.close();
    file.close();
  }
});
