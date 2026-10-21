import assert from 'node:assert/strict';
const base = process.env.BOOKSEERR_TEST_URL || 'http://127.0.0.1:5057';
const password = process.env.BOOKSEERR_ADMIN_PASSWORD;
if (!password) throw new Error('Set the isolated test admin password.');
async function call(path, options = {}) {
  const response = await fetch(base + path, options);
  return { response, data: await response.json().catch(() => ({})) };
}
const health = await call('/api/health');
assert.equal(health.response.status, 200);
const html = await fetch(base + '/');
assert.equal(html.status, 200);
assert.match(await html.text(), /Bookseerr/);
assert.equal((await call('/api/library')).response.status, 401);
const login = await call('/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password }),
});
assert.equal(login.response.status, 200);
const cookie = login.response.headers.get('set-cookie').split(';')[0];
const headers = { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': login.data.csrf };
const users = await call('/api/users', { headers });
assert.equal(users.response.status, 200);
if (!users.data.items.some((u) => u.username === 'container-reader')) {
  const created = await call('/api/users', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: 'container-reader',
      displayName: 'Container Reader',
      password: 'isolated-container-reader-password',
      role: 'user',
      autoApprove: false,
      weeklyLimit: 5,
    }),
  });
  assert.equal(created.response.status, 201);
}
const reader = await call('/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'container-reader',
    password: 'isolated-container-reader-password',
  }),
});
assert.equal(reader.response.status, 200);
const readerCookie = reader.response.headers.get('set-cookie').split(';')[0];
assert.equal(
  (await call('/api/settings', { headers: { cookie: readerCookie } })).response.status,
  403,
);
assert.equal(
  (await call('/api/users', { headers: { cookie: readerCookie } })).response.status,
  403,
);
console.log(
  'Container smoke checks passed: web, health, authentication, persistent accounts, reader permissions.',
);
