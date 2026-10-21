import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { book, config, item } from './fixtures.js';
import { hashPassword } from '../server/security.js';

async function setup() {
  const store = new Store(':memory:');
  const context = await buildApp(config(), { store });
  await context.app.ready();
  store.replaceInventory('bookorbit', [item]);
  store.saveBook(book);
  const login = async (username = 'admin', password = 'a-strong-test-password') => {
    const res = await context.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username, password },
    });
    assert.equal(res.statusCode, 200, res.body);
    return {
      cookie: res.cookies[0].name + '=' + res.cookies[0].value,
      'x-csrf-token': res.json().csrf,
    };
  };
  return {
    ...context,
    login,
    async close() {
      await context.app.close();
      store.close();
    },
  };
}
test('authentication, CSRF, roles, secret redaction, and disabled sessions are enforced at the API', async () => {
  const ctx = await setup();
  const { app, store } = ctx;
  try {
    assert.equal((await app.inject('/api/library')).statusCode, 401);
    const admin = await ctx.login();
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sync',
          headers: { cookie: admin.cookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sync',
          headers: { ...admin, origin: 'https://other.example' },
          payload: {},
        })
      ).statusCode,
      403,
    );
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: {
        username: 'reader',
        displayName: 'Reader',
        password: 'a-private-reader-password',
        role: 'user',
        autoApprove: false,
        weeklyLimit: 2,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.body.includes('password'), false);
    const reader = await ctx.login('reader', 'a-private-reader-password');
    for (const url of ['/api/settings', '/api/users'])
      assert.equal((await app.inject({ url, headers: reader })).statusCode, 403);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/sync', headers: reader, payload: {} }))
        .statusCode,
      403,
    );
    const user = created.json().user;
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${user.id}`,
          headers: admin,
          payload: {
            displayName: 'Reader',
            role: 'user',
            autoApprove: false,
            weeklyLimit: 2,
            disabled: true,
          },
        })
      ).statusCode,
      200,
    );
    assert.equal((await app.inject({ url: '/api/status', headers: reader })).statusCode, 401);
    const owner = store.users()[0];
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/users/${owner.id}`,
          headers: admin,
          payload: {
            displayName: 'Owner',
            role: 'user',
            autoApprove: false,
            weeklyLimit: 2,
            disabled: true,
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await ctx.close();
  }
});
test('shared requests coalesce, remain private to followers, respect quotas, and require approval', async () => {
  const ctx = await setup();
  const { app, store } = ctx;
  try {
    const hashed = await hashPassword('reader-test-password');
    for (const username of ['reader1', 'reader2', 'reader3'])
      store.addUser({
        username,
        displayName: username,
        passwordHash: hashed,
        role: 'user',
        autoApprove: false,
        weeklyLimit: 1,
      });
    const [a, b, c, admin] = await Promise.all([
      ctx.login('reader1', 'reader-test-password'),
      ctx.login('reader2', 'reader-test-password'),
      ctx.login('reader3', 'reader-test-password'),
      ctx.login(),
    ]);
    const unavailable = {
      ...book,
      id: 'ol:new',
      title: 'The Missing Book',
      identifiers: { isbn: [], work: ['ol:new'] },
    };
    store.saveBook(unavailable);
    const request = {
      method: 'POST' as const,
      url: '/api/requests',
      payload: { catalogId: unavailable.id, mediaKind: 'ebook' },
    };
    const responses = await Promise.all([
      app.inject({ ...request, headers: a }),
      app.inject({ ...request, headers: b }),
    ]);
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 201]);
    const id = responses[0].json().request.id;
    assert.equal(responses[0].json().request.status, 'pending_approval');
    assert.equal((await app.inject({ url: '/api/requests', headers: c })).json().items.length, 0);
    assert.equal(
      (await app.inject({ url: '/api/requests', headers: b })).json().items[0].followers,
      2,
    );
    store.saveBook({
      ...unavailable,
      id: 'ol:next',
      title: 'Another Missing Book',
      identifiers: { isbn: [], work: ['ol:next'] },
    });
    const creator = responses[0].statusCode === 201 ? a : b;
    assert.equal(
      (
        await app.inject({
          ...request,
          headers: creator,
          payload: { catalogId: 'ol:next', mediaKind: 'ebook' },
        })
      ).statusCode,
      429,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/requests/${id}/approve`,
          headers: a,
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/requests/${id}/approve`,
          headers: admin,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(store.request(id)?.status, 'pending_setup');
    assert.ok(
      (await app.inject({ url: '/api/notifications', headers: a })).json().items.length > 0,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/notifications/read',
          headers: a,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.ok(
      (await app.inject({ url: '/api/notifications', headers: b }))
        .json()
        .items.some((n: { read: boolean }) => !n.read),
    );
  } finally {
    await ctx.close();
  }
});
test('owned or stale copies block duplicate requests and a newly found copy completes an approved request', async () => {
  const ctx = await setup();
  const { app, store, services } = ctx;
  try {
    const headers = await ctx.login();
    const payload = { catalogId: book.id, mediaKind: 'ebook' };
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/requests', headers, payload })).statusCode,
      409,
    );
    store.replaceInventory('bookorbit', []);
    const created = await app.inject({ method: 'POST', url: '/api/requests', headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().request.id;
    store.replaceInventory('bookorbit', [item]);
    await services.refreshRequests();
    assert.equal(store.request(id)?.status, 'available');
    store.setState({ ...store.state('bookorbit'), status: 'error' });
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/requests',
          headers,
          payload: { ...payload, mediaKind: 'audiobook' },
        })
      ).statusCode,
      409,
    );
  } finally {
    await ctx.close();
  }
});
test('password changes verify current password and revoke every old session', async () => {
  const ctx = await setup();
  try {
    const headers = await ctx.login();
    const second = await ctx.login();
    assert.equal(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: '/api/account/password',
          headers,
          payload: { currentPassword: 'wrong', newPassword: 'a-new-private-password' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: '/api/account/password',
          headers,
          payload: {
            currentPassword: 'a-strong-test-password',
            newPassword: 'a-new-private-password',
          },
        })
      ).statusCode,
      200,
    );
    assert.equal((await ctx.app.inject({ url: '/api/status', headers: second })).statusCode, 401);
    await ctx.login('admin', 'a-new-private-password');
  } finally {
    await ctx.close();
  }
});
test('sign out accepts a bodyless DELETE and invalidates the session', async () => {
  const ctx = await setup();
  try {
    const headers = await ctx.login();
    assert.equal(
      (await ctx.app.inject({ method: 'DELETE', url: '/api/session', headers })).statusCode,
      200,
    );
    assert.equal((await ctx.app.inject({ url: '/api/status', headers })).statusCode, 401);
  } finally {
    await ctx.close();
  }
});
test('local shelf search stays independent of online metadata availability', async (t) => {
  const ctx = await setup();
  let onlineCalls = 0;
  t.mock.method(ctx.services.discovery, 'search', async () => {
    onlineCalls++;
    throw new Error('Catalogue unavailable');
  });
  try {
    const headers = await ctx.login();
    const local = await ctx.app.inject({ url: '/api/search?q=oathbringer&scope=local', headers });
    assert.equal(local.statusCode, 200);
    assert.equal(local.json().library[0].availability.ebook.status, 'available');
    assert.equal(onlineCalls, 0);
    const online = await ctx.app.inject({ url: '/api/search?q=oathbringer&scope=online', headers });
    assert.equal(online.statusCode, 200);
    assert.equal(onlineCalls, 1);
    assert.ok(online.json().warning);
  } finally {
    await ctx.close();
  }
});

test('online and local versions show and join the same missing-format request', async () => {
  const ctx = await setup();
  try {
    const headers = await ctx.login();
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers,
      payload: { catalogId: book.id, mediaKind: 'audiobook' },
    });
    assert.equal(request.statusCode, 201, request.body);
    const library = await ctx.app.inject({ url: '/api/library?q=Oathbringer', headers });
    const local = library.json().items[0];
    assert.equal(local.requests.audiobook.id, request.json().request.id);
    assert.equal(local.requests.audiobook.following, true);
    const joined = await ctx.app.inject({
      method: 'POST',
      url: '/api/requests',
      headers,
      payload: { catalogId: local.book.id, mediaKind: 'audiobook' },
    });
    assert.equal(joined.statusCode, 200, joined.body);
    assert.equal(joined.json().request.id, request.json().request.id);
    assert.equal((await ctx.app.inject({ url: '/api/requests', headers })).json().items.length, 1);
  } finally {
    await ctx.close();
  }
});
test('readers can leave a shared request without cancelling another reader’s request', async () => {
  const ctx = await setup();
  try {
    const hashed = await hashPassword('a-shared-reader-password');
    const users = ['shared1', 'shared2'].map((username) =>
      ctx.store.addUser({
        username,
        displayName: username,
        passwordHash: hashed,
        role: 'user',
        autoApprove: false,
        weeklyLimit: 5,
      }),
    );
    const missing = { ...book, id: 'shared:missing', title: 'A Different Missing Work' };
    ctx.store.saveBook(missing);
    const request = ctx.store.createRequest(missing, 'ebook', users[0]);
    ctx.store.createRequest(missing, 'ebook', users[1]);
    const headers = await ctx.login('shared1', 'a-shared-reader-password');
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/requests/${request.id}/cancel`,
          headers,
          payload: {},
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/requests/${request.id}/unfollow`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(ctx.store.requestsFor(users[0]).length, 0);
    assert.equal(ctx.store.requestsFor(users[1]).length, 1);
    assert.equal(ctx.store.request(request.id)?.status, 'pending_approval');
    assert.equal(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/requests/${request.id}/cancel`,
          headers,
          payload: {},
        })
      ).statusCode,
      403,
    );
  } finally {
    await ctx.close();
  }
});
