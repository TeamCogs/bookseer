import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, databasePath } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { config, item } from './fixtures.js';

test('existing environment credentials survive the rename and corrected variables take precedence', () => {
  const original = config();
  const legacy = {
    BOOKSEER_ADMIN_PASSWORD: original.adminPassword,
    BOOKSEER_SESSION_SECRET: original.secret,
    BOOKSEER_DATA_DIR: original.dataDir,
    BOOKSEER_SECURE_COOKIES: 'true',
    BOOKSEER_PORT: '5059',
  };
  const retained = loadConfig(legacy);
  assert.equal(retained.adminPassword, original.adminPassword);
  assert.equal(retained.secret, original.secret);
  assert.equal(retained.dataDir, original.dataDir);
  assert.equal(retained.secureCookies, true);
  assert.equal(retained.port, 5059);
  const corrected = loadConfig({
    ...legacy,
    BOOKSEERR_ADMIN_PASSWORD: 'a-different-test-password',
    BOOKSEERR_SESSION_SECRET: 'a-different-private-key-at-least-32-characters',
    BOOKSEERR_SECURE_COOKIES: 'false',
    BOOKSEERR_PORT: '5060',
  });
  assert.equal(corrected.adminPassword, 'a-different-test-password');
  assert.equal(corrected.secret, 'a-different-private-key-at-least-32-characters');
  assert.equal(corrected.secureCookies, false);
  assert.equal(corrected.port, 5060);
});

test('the renamed application reuses an existing database instead of losing saved library state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookseerr-rename-'));
  const canonical = join(directory, 'bookseerr.sqlite');
  const legacy = join(directory, 'bookseer.sqlite');
  assert.equal(databasePath(directory), canonical);
  const previous = new Store(legacy);
  previous.replaceInventory('bookorbit', [item]);
  previous.setSetting('rename-proof', 'saved settings');
  previous.close();
  const { app, store } = await buildApp({ ...config(), dataDir: directory });
  try {
    assert.equal(databasePath(directory), legacy);
    assert.equal(store.inventory().length, 1);
    assert.equal(store.inventory()[0].id, item.id);
    assert.equal(store.setting('rename-proof'), 'saved settings');
    const current = new Store(canonical);
    current.close();
    assert.equal(databasePath(directory), canonical);
  } finally {
    await app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
