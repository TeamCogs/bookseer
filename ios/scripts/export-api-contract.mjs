// Synthetic, in-memory API evidence for the native client's decoder tests.
// No socket, real library, saved database, or upstream service is used.
import { randomBytes } from 'node:crypto';
import { buildApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { Store } from '../../server/store.ts';

const password = randomBytes(24).toString('hex');
const config = loadConfig({
  BOOKSEERR_ADMIN_USERNAME: 'contract-reader',
  BOOKSEERR_ADMIN_PASSWORD: password,
  BOOKSEERR_SESSION_SECRET: randomBytes(32).toString('hex'),
});
const store = new Store(':memory:');
const { app, services } = await buildApp(config, { store });
try {
  const identifiers = { isbn: [], work: [] };
  store.replaceInventory('bookorbit', [
    {
      id: 'bookorbit:contract:1:ebook',
      source: 'bookorbit',
      remoteId: '1',
      title: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      mediaKind: 'ebook',
      formats: ['EPUB'],
      available: true,
      identifiers,
    },
  ]);
  const discovery = {
    id: 'contract:persuasion',
    title: 'Persuasion',
    author: 'Jane Austen',
    identifiers,
    origin: 'openlibrary',
  };
  services.discovery.search = async () => [discovery];
  services.enqueue = () => {};
  const login = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { username: config.adminUsername, password },
  });
  if (login.statusCode !== 200) throw new Error('Contract fixture sign-in failed');
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const csrf = login.json().csrf;
  const read = async (url) => {
    const response = await app.inject({ url, headers: { cookie } });
    if (response.statusCode !== 200) throw new Error(`Contract endpoint failed: ${url}`);
    return response.json();
  };
  const search = await read('/api/search?q=Persuasion');
  const requested = await app.inject({
    method: 'POST',
    url: '/api/requests',
    headers: { cookie, 'x-csrf-token': csrf },
    payload: { catalogId: discovery.id, mediaKind: 'ebook' },
  });
  if (requested.statusCode !== 201) throw new Error('Contract request submission failed');
  const session = login.json();
  session.csrf = 'synthetic-contract-token';
  process.stdout.write(
    JSON.stringify({
      session,
      search,
      library: await read('/api/library'),
      status: await read('/api/status'),
      requests: await read('/api/requests'),
      notifications: await read('/api/notifications'),
      requested: requested.json(),
    }),
  );
} finally {
  await app.close();
  store.close();
}
