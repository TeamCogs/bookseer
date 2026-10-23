import Fastify, { LogController, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  BookRequest,
  CatalogBook,
  LibraryItem,
  MediaKind,
  LibraryServerConfig,
  User,
} from '../shared/types.js';
import type { Config, ConnectionConfig } from './config.js';
import { validateServiceUrl } from './config.js';
import { normalizeConnections } from './library-config.js';
import { libraryProviders } from '../shared/libraries.js';
import { Store } from './store.js';
import { Services } from './services.js';
import {
  browseCatalogue,
  discoveryFilters,
  discoveryPageSize,
  type CatalogPage,
  type DiscoveryQuery,
} from '../shared/discovery.js';
import { libraryAdapter } from './integrations/libraries.js';
import { selectedLibraries } from './integrations/library.js';
import { Chaptarr } from './integrations/chaptarr.js';
import { array, object } from './integrations/http.js';
import { bookResult, groupInventory, itemAsBook, searchInventory } from './matching.js';
import { equal, hashPassword, verifyPassword } from './security.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: User; csrf: string } | null;
  }
}
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const text = (maxLength = 200) => ({ type: 'string', maxLength });
const kindSchema = { type: 'string', enum: ['ebook', 'audiobook'] };
const body = (properties: Record<string, unknown>, required: string[] = []) => ({
  body: { type: 'object', additionalProperties: false, properties, required },
});
const admin = (req: FastifyRequest) => {
  if (req.auth?.user.role !== 'admin')
    throw new AppError(403, 'Administrator permission is required.');
  return req.auth.user;
};
class PrivateLogController extends LogController {
  constructor() {
    super({ disableRequestLogging: true });
  }
}

export function databasePath(dataDir: string): string {
  const current = resolve(dataDir, 'bookseerr.sqlite');
  const legacy = resolve(dataDir, 'bookseer.sqlite');
  // Reuse an existing database and its WAL rather than bootstrapping an empty library.
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export async function buildApp(
  config: Config,
  options: { store?: Store; services?: Services; staticDir?: string; logger?: boolean } = {},
) {
  const store = options.store || new Store(config.demo ? ':memory:' : databasePath(config.dataDir));
  if (!store.users().length)
    await store.addUser({
      username: config.adminUsername,
      displayName: 'Administrator',
      passwordHash: await hashPassword(config.adminPassword),
      role: 'admin',
      autoApprove: true,
      weeklyLimit: 0,
    });
  const services = options.services || new Services(config, store);
  const app = Fastify({
    logger: options.logger
      ? {
          level: 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
        }
      : false,
    logController: new PrivateLogController(),
    bodyLimit: 32768,
    trustProxy: false,
  });
  app.addHook('onClose', async () => {
    services.cancel();
    await services.drain();
  });
  app.decorateRequest('auth', null);
  await app.register(cookie);
  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.secureCookies,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { global: false });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.routeOptions.url?.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const path = req.routeOptions.url;
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      const allowed = config.publicUrl
        ? new URL(config.publicUrl).origin
        : `${req.protocol}://${req.headers.host}`;
      if (origin !== allowed) throw new AppError(403, 'Cross-origin writes are not allowed.');
    }
    req.auth =
      store.session(req.cookies.bookseerr_session) ||
      (config.demo ? { user: store.users()[0], csrf: 'demo-csrf' } : null);
    if (path === '/api/health' || (path === '/api/session' && ['GET', 'POST'].includes(req.method)))
      return;
    if (!req.auth) throw new AppError(401, 'Sign in to continue.');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !equal(String(req.headers['x-csrf-token'] || ''), req.auth.csrf)
    )
      throw new AppError(403, 'Your session token is missing or expired. Refresh and try again.');
  });
  app.setErrorHandler((error, _request, reply) => {
    const problem = error as Error & { statusCode?: number };
    const status = problem.statusCode || 500;
    reply.code(status).send({
      error:
        status >= 500
          ? 'Bookseerr could not complete the operation. Check the service configuration and server logs.'
          : problem.message,
    });
    if (status >= 500) app.log.error({ name: problem.name }, 'Operation failed');
  });
  const authCookie = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.secureCookies,
    maxAge: 7 * 86400,
  };
  const dummyPassword = await hashPassword('unusable-dummy-password-value');
  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));
  app.get('/api/session', async (req) => ({
    user: req.auth?.user || null,
    csrf: req.auth?.csrf || null,
    demo: config.demo,
  }));
  app.post<{ Body: { username: string; password: string } }>(
    '/api/session',
    {
      schema: body(
        { username: { ...text(40), minLength: 1 }, password: { ...text(256), minLength: 1 } },
        ['username', 'password'],
      ),
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (req, reply) => {
      const credentials = store.credentials(req.body.username);
      const valid = await verifyPassword(
        req.body.password,
        credentials?.password_hash || dummyPassword,
      );
      if (!valid || !credentials || credentials.disabled)
        throw new AppError(401, 'Username or password is incorrect.');
      if (req.cookies.bookseerr_session) store.revokeSession(req.cookies.bookseerr_session);
      const session = store.createSession(credentials.id);
      reply.setCookie('bookseerr_session', session.value, authCookie);
      return { user: store.user(credentials.id), csrf: session.csrf, demo: config.demo };
    },
  );
  app.delete('/api/session', async (req, reply) => {
    if (req.cookies.bookseerr_session) store.revokeSession(req.cookies.bookseerr_session);
    reply.clearCookie('bookseerr_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/status', async (req) => ({
    version: '0.1.0',
    demo: config.demo,
    sources: store.states(),
    libraryCount: groupInventory(store.inventory(), store.libraryGroups()).filter((g) =>
      g.copies.some((i) => i.available),
    ).length,
    requestCount: store
      .requestsFor(req.auth!.user)
      .filter((r) => !['available', 'rejected', 'cancelled'].includes(r.status)).length,
    acquisitionReady: services.chaptarr.ready('ebook') || services.chaptarr.ready('audiobook'),
    syncIntervalMinutes: config.syncIntervalMinutes,
    inventoryMaxAgeHours: config.inventoryMaxAgeHours,
  }));
  const result = (
    book: CatalogBook,
    items = store.inventory(),
    viewer?: User,
    copies?: LibraryItem[],
  ) => {
    const value = bookResult(
      store.book(book.id) || book,
      store,
      config.inventoryMaxAgeHours,
      items,
      copies,
    );
    if (viewer) {
      const summaries = store.relatedRequests(book);
      value.requests = Object.fromEntries(
        summaries.reverse().map((r) => [
          String(r.media_kind),
          {
            id: String(r.id),
            status: r.status as BookRequest['status'],
            following: Boolean(
              store.db
                .prepare('SELECT 1 FROM followers WHERE request_id=? AND user_id=?')
                .get(String(r.id), viewer.id),
            ),
          },
        ]),
      );
    }
    return value;
  };
  app.get<{ Querystring: DiscoveryQuery }>(
    '/api/discover',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: text(200),
            topic: { type: 'string', enum: discoveryFilters.topics.map((f) => f.id) },
            sort: { type: 'string', enum: discoveryFilters.sorts.map((f) => f.id) },
            language: { type: 'string', enum: discoveryFilters.languages.map((f) => f.id) },
            era: { type: 'string', enum: discoveryFilters.eras.map((f) => f.id) },
            page: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const query = req.query;
      const mode = config.demo ? 'demo' : 'live';
      let page: CatalogPage;
      if (config.demo) {
        const books = (
          store.db.prepare('SELECT payload FROM catalogue WHERE id NOT LIKE ?').all('local:%') as {
            payload: string;
          }[]
        ).map((r) => JSON.parse(r.payload) as CatalogBook);
        page = browseCatalogue(books, query);
        page.source = { name: 'Sample discovery catalogue' };
      } else {
        try {
          page = await services.discovery.browse(query);
        } catch {
          page = {
            books: [],
            hasMore: false,
            source: { name: 'Open Library', url: 'https://openlibrary.org' },
            warning:
              'Book discovery is temporarily unavailable. Try again shortly, or use direct search to find a title in your library.',
          };
        }
      }
      const inventory = store.inventory();
      page.books.forEach((book) => store.saveBook(book));
      const { books, ...details } = page;
      return {
        ...details,
        items: books.map((book) => result(book, inventory, req.auth!.user)),
        page: query.page || 1,
        pageSize: discoveryPageSize,
        mode,
        filters: discoveryFilters,
      };
    },
  );
  app.get<{ Querystring: { q?: string; scope?: 'all' | 'local' | 'online' } }>(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { q: text(200), scope: { type: 'string', enum: ['all', 'local', 'online'] } },
          additionalProperties: false,
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const query = req.query.q?.trim() || '';
      const inventory = store.inventory();
      const library = (
        req.query.scope === 'online' ? [] : groupInventory(inventory, store.libraryGroups())
      )
        .filter((g) => g.copies.some((i) => i.available) && searchInventory(g.copies, query).length)
        .slice(0, query ? 18 : 24)
        .map((g) => {
          const book = itemAsBook(g.primary);
          store.saveBook(book);
          return result(book, inventory, req.auth!.user, g.copies);
        });
      let discovery: CatalogBook[] = [];
      let warning: string | undefined;
      if (req.query.scope !== 'local' && query.length >= 2 && !config.demo) {
        try {
          discovery = await services.discovery.search(query);
          discovery.forEach((book) => store.saveBook(book));
        } catch {
          warning =
            'Online discovery is unavailable right now. Your connected library results are still shown.';
        }
      } else if (req.query.scope !== 'local' && config.demo) {
        discovery = (
          store.db.prepare('SELECT payload FROM catalogue WHERE id NOT LIKE ?').all('local:%') as {
            payload: string;
          }[]
        )
          .map((r) => JSON.parse(r.payload))
          .filter(
            (b) => !query || `${b.title} ${b.author}`.toLowerCase().includes(query.toLowerCase()),
          );
      }
      return {
        library,
        discovery: discovery.map((book) => result(book, inventory, req.auth!.user)),
        warning,
        query,
      };
    },
  );
  app.get<{
    Querystring: {
      q?: string;
      kind?: MediaKind;
      offset?: number;
      limit?: number;
      duplicates?: boolean;
    };
  }>(
    '/api/library',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: text(200),
            kind: kindSchema,
            duplicates: { type: 'boolean' },
            offset: { type: 'integer', minimum: 0, maximum: 1000000 },
            limit: { type: 'integer', minimum: 1, maximum: 60 },
          },
        },
      },
    },
    async (req) => {
      const inventory = store.inventory();
      const items = groupInventory(inventory, store.libraryGroups()).filter(
        (g) =>
          g.copies.some((i) => !req.query.kind || i.mediaKind === req.query.kind) &&
          searchInventory(g.copies, req.query.q || '').length &&
          (!req.query.duplicates || g.duplicates > 0),
      );
      const offset = req.query.offset || 0;
      const limit = req.query.limit || 24;
      return {
        total: items.length,
        rawCopies: items.reduce((n, g) => n + g.copies.length, 0),
        hiddenDuplicates: items.reduce((n, g) => n + g.duplicates, 0),
        offset,
        limit,
        items: items.slice(offset, offset + limit).map((g) => {
          const book = itemAsBook(g.primary);
          store.saveBook(book);
          return result(book, inventory, req.auth!.user, g.copies);
        }),
      };
    },
  );
  app.get('/api/library/groups', async (req) => {
    admin(req);
    return {
      items: store
        .libraryGroups()
        .map((g) => ({ ...g, title: store.item(g.canonicalId)?.title || 'Saved group' })),
    };
  });
  app.post<{ Body: { itemIds: string[]; canonicalId: string } }>(
    '/api/library/groups',
    {
      schema: body(
        {
          itemIds: {
            type: 'array',
            minItems: 2,
            maxItems: 100,
            uniqueItems: true,
            items: text(300),
          },
          canonicalId: text(300),
        },
        ['itemIds', 'canonicalId'],
      ),
    },
    async (req) => {
      const actor = admin(req);
      const { itemIds, canonicalId } = req.body;
      if (!itemIds.includes(canonicalId) || itemIds.some((id) => !store.item(id)))
        throw new AppError(400, 'Choose existing copies and one preferred title.');
      if (store.libraryGroups().some((g) => g.itemIds.some((id) => itemIds.includes(id))))
        throw new AppError(409, 'Undo the existing saved group before regrouping these copies.');
      store.groupLibrary(itemIds, canonicalId, actor.id);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>('/api/library/groups/:id', async (req) => {
    const actor = admin(req);
    store.db.prepare('DELETE FROM library_groups WHERE id=?').run(req.params.id);
    store.audit(actor.id, 'library.group_removed', req.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/covers/:id', async (req, reply) => {
    const item = store.item(req.params.id);
    if (!item || config.demo) return reply.code(404).send();
    let upstream: Response;
    try {
      upstream = await services.cover(item);
    } catch {
      return reply.code(404).send();
    }
    const mime = upstream.headers.get('content-type')?.split(';')[0] || '';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(mime))
      return reply.code(404).send();
    const size = Number(upstream.headers.get('content-length') || 0);
    if (size > 5 * 1024 * 1024) return reply.code(413).send();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (!upstream.body) return reply.code(404).send();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > 5 * 1024 * 1024) {
        await reader.cancel();
        return reply.code(413).send();
      }
      chunks.push(value);
    }
    reply.type(mime).header('Cache-Control', 'private, max-age=3600');
    return Buffer.concat(chunks);
  });
  app.post('/api/sync', { schema: body({}) }, async (req) => {
    admin(req);
    await services.syncAll();
    return { sources: store.states() };
  });
  app.post<{ Body: { catalogId: string; mediaKind: MediaKind; itemIds: string[] } }>(
    '/api/matches',
    {
      schema: body(
        {
          catalogId: text(300),
          mediaKind: kindSchema,
          itemIds: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: text(300),
          },
        },
        ['catalogId', 'mediaKind', 'itemIds'],
      ),
    },
    async (req) => {
      const actor = admin(req);
      const { catalogId, mediaKind, itemIds } = req.body;
      const book = store.book(catalogId);
      if (!book) throw new AppError(404, 'Search for the book before linking a copy.');
      const items = itemIds.map((id) => store.item(id));
      if (items.some((item) => !item || item.mediaKind !== mediaKind))
        throw new AppError(400, 'Choose existing copies of the same medium.');
      store.confirmMatch(catalogId, mediaKind, itemIds, actor.id);
      return result(book);
    },
  );
  app.delete<{ Params: { catalogId: string; kind: MediaKind } }>(
    '/api/matches/:catalogId/:kind',
    async (req) => {
      const actor = admin(req);
      store.db
        .prepare('DELETE FROM matches WHERE catalog_id=? AND media_kind=?')
        .run(req.params.catalogId, req.params.kind);
      store.audit(actor.id, 'match.removed', req.params.catalogId);
      return { ok: true };
    },
  );
  app.post<{ Body: { catalogId: string; mediaKind: MediaKind; itemIds: string[] } }>(
    '/api/matches/dismiss',
    {
      schema: body(
        {
          catalogId: text(300),
          mediaKind: kindSchema,
          itemIds: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: text(300),
          },
        },
        ['catalogId', 'mediaKind', 'itemIds'],
      ),
    },
    async (req) => {
      const actor = admin(req);
      const book = store.book(req.body.catalogId);
      if (!book) throw new AppError(404, 'Search for the book before reviewing a match.');
      const candidates = result(book).availability[req.body.mediaKind].candidates;
      if (req.body.itemIds.some((id) => !candidates.some((item) => item.id === id)))
        throw new AppError(400, 'Only possible matches can be dismissed.');
      store.dismissMatches(book.id, req.body.mediaKind, req.body.itemIds, actor.id);
      return result(book);
    },
  );
  app.get('/api/requests', async (req) => ({ items: store.requestsFor(req.auth!.user) }));
  app.get<{ Params: { id: string } }>('/api/requests/:id/matches', async (req) => {
    admin(req);
    if (!store.request(req.params.id)) throw new AppError(404, 'Request not found.');
    return services.requestMatches(req.params.id);
  });
  app.post<{ Params: { id: string }; Body: { workId: string } }>(
    '/api/requests/:id/match',
    {
      schema: body({ workId: { ...text(100), pattern: '^(gr|hc|ol|gb):[A-Za-z0-9_-]+$' } }, [
        'workId',
      ]),
    },
    async (req) => {
      admin(req);
      if (!store.request(req.params.id)) throw new AppError(404, 'Request not found.');
      try {
        await services.confirmRequestMatch(req.params.id, req.body.workId, req.auth!.user);
      } catch (error) {
        throw new AppError(
          409,
          error instanceof Error ? error.message : 'Book matching changed. Review it again.',
        );
      }
      return { ok: true };
    },
  );
  app.post<{ Body: { catalogId: string; mediaKind: MediaKind } }>(
    '/api/requests',
    { schema: body({ catalogId: text(300), mediaKind: kindSchema }, ['catalogId', 'mediaKind']) },
    async (req, reply) => {
      const book = store.book(req.body.catalogId);
      if (!book) throw new AppError(404, 'Search for the book before requesting it.');
      const availability = result(book).availability[req.body.mediaKind];
      if (availability.status !== 'not_found')
        throw new AppError(
          409,
          availability.status === 'available'
            ? 'This format is already available in your library.'
            : availability.reason,
        );
      let created: { id: string; created: boolean };
      try {
        created = store.createRequest(book, req.body.mediaKind, req.auth!.user);
      } catch (error) {
        throw new AppError(
          429,
          error instanceof Error ? error.message : 'Request could not be saved.',
        );
      }
      if (created.created) services.enqueue(created.id);
      reply.code(created.created ? 201 : 200);
      return {
        request: store.requestsFor(req.auth!.user).find((r) => r.id === created.id),
        joined: !created.created,
      };
    },
  );
  app.post<{ Params: { id: string; action: string } }>(
    '/api/requests/:id/:action',
    { schema: body({}) },
    async (req) => {
      const actor = req.auth!.user;
      const record = store.request(req.params.id);
      if (!record) throw new AppError(404, 'Request not found.');
      const action = req.params.action;
      if (action === 'approve') {
        admin(req);
        if (
          !['pending_approval', 'pending_setup', 'pending_metadata'].includes(String(record.status))
        )
          throw new AppError(409, 'Only pending requests can be approved.');
        store.updateRequest(
          String(record.id),
          'pending_setup',
          'Approved. Waiting for acquisition.',
        );
        store.setSetting(`lookup_retry:${record.id}`, '');
        services.enqueue(String(record.id));
      } else if (action === 'retry') {
        admin(req);
        if (!['needs_review', 'failed', 'cancelled', 'rejected'].includes(String(record.status)))
          throw new AppError(409, 'This request is already active.');
        store.updateRequest(
          String(record.id),
          'pending_setup',
          'Administrator reviewed the upstream state and reopened the request.',
        );
        store.setSetting(`lookup_retry:${record.id}`, '');
        store.setSetting(`pending_add:${record.id}`, '');
        services.enqueue(String(record.id));
      } else if (action === 'unfollow') {
        const removed = store.db
          .prepare('DELETE FROM followers WHERE request_id=? AND user_id=?')
          .run(String(record.id), actor.id);
        if (!removed.changes) throw new AppError(404, 'You are not following this request.');
        const count = store.db
          .prepare('SELECT COUNT(*) AS n FROM followers WHERE request_id=?')
          .get(String(record.id)) as { n: number };
        if (
          !count.n &&
          ['pending_approval', 'pending_setup', 'pending_metadata', 'checking'].includes(
            String(record.status),
          )
        )
          store.updateRequest(
            String(record.id),
            'cancelled',
            'Cancelled before acquisition because no readers are following.',
          );
      } else if (action === 'reject' || action === 'cancel') {
        if (action === 'reject') admin(req);
        else if (actor.role !== 'admin' && record.requester_id !== actor.id)
          throw new AppError(403, 'You cannot cancel another user’s request.');
        if (action === 'cancel' && actor.role !== 'admin') {
          if (
            !store.db
              .prepare('SELECT 1 FROM followers WHERE request_id=? AND user_id=?')
              .get(String(record.id), actor.id)
          )
            throw new AppError(403, 'You are no longer following this request.');
          const followers = store.db
            .prepare('SELECT COUNT(*) AS n FROM followers WHERE request_id=?')
            .get(String(record.id)) as { n: number };
          if (followers.n > 1)
            throw new AppError(
              409,
              'Other readers are following this request. Stop following it without cancelling their request.',
            );
        }
        if (
          !['pending_approval', 'pending_setup', 'pending_metadata', 'checking'].includes(
            String(record.status),
          )
        )
          throw new AppError(
            409,
            'This request has already progressed. Manage active downloads in Chaptarr.',
          );
        store.updateRequest(
          String(record.id),
          action === 'reject' ? 'rejected' : 'cancelled',
          action === 'reject' ? 'Declined by an administrator.' : 'Cancelled before acquisition.',
        );
      } else throw new AppError(400, 'Unknown request action.');
      store.audit(actor.id, `request.${action}`, String(record.id));
      return { items: store.requestsFor(actor) };
    },
  );
  app.get('/api/notifications', async (req) => ({ items: store.notifications(req.auth!.user.id) }));
  app.post('/api/notifications/read', { schema: body({}) }, async (req) => {
    store.db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.auth!.user.id);
    return { ok: true };
  });
  app.get('/api/settings', async (req) => {
    admin(req);
    const c = services.connections;
    return {
      connections: {
        ...c,
        libraryServers: c.libraryServers.map((server) => ({
          ...server,
          password: '',
          apiKey: '',
          passwordSet: Boolean(server.password),
          apiKeySet: Boolean(server.apiKey),
        })),
        bookorbitPassword: '',
        chaptarrApiKey: '',
        bookorbitPasswordSet: Boolean(c.bookorbitPassword),
        chaptarrApiKeySet: Boolean(c.chaptarrApiKey),
      },
      deployment: {
        secureCookies: config.secureCookies,
        syncIntervalMinutes: config.syncIntervalMinutes,
        inventoryMaxAgeHours: config.inventoryMaxAgeHours,
      },
    };
  });
  const connectionProperties: Record<keyof ConnectionConfig, unknown> = {
    libraryServers: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'provider',
          'name',
          'url',
          'publicUrl',
          'username',
          'password',
          'apiKey',
          'libraryIds',
        ],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' },
          provider: { type: 'string', enum: Object.keys(libraryProviders) },
          name: { ...text(80), minLength: 1 },
          url: text(500),
          publicUrl: text(500),
          username: text(100),
          password: text(1000),
          apiKey: text(2000),
          libraryIds: text(2000),
        },
      },
    },
    bookorbitUrl: text(500),
    bookorbitPublicUrl: text(500),
    bookorbitUsername: text(100),
    bookorbitPassword: text(1000),
    bookorbitLibraryIds: text(2000),
    chaptarrUrl: text(500),
    chaptarrPublicUrl: text(500),
    chaptarrApiKey: text(1000),
    ebookRootFolder: text(1000),
    audiobookRootFolder: text(1000),
    ebookQualityProfileId: { type: 'integer', minimum: 0, maximum: 1000000 },
    ebookMetadataProfileId: { type: 'integer', minimum: 0, maximum: 1000000 },
    audiobookQualityProfileId: { type: 'integer', minimum: 0, maximum: 1000000 },
    audiobookMetadataProfileId: { type: 'integer', minimum: 0, maximum: 1000000 },
  };
  function connectionInput(value: ConnectionConfig) {
    const input = { ...value };
    const previous = services.connections;
    try {
      for (const key of [
        'bookorbitUrl',
        'bookorbitPublicUrl',
        'chaptarrUrl',
        'chaptarrPublicUrl',
      ] as const)
        input[key] = validateServiceUrl(input[key]);
      const servers = value.libraryServers ?? [
        ...normalizeConnections({ ...input, libraryServers: undefined }).libraryServers,
        ...previous.libraryServers.filter((server) => server.id !== 'bookorbit'),
      ];
      if (servers.length > 20) throw new AppError(400, 'You can connect up to 20 library servers.');
      if (new Set(servers.map((server) => server.id)).size !== servers.length)
        throw new AppError(400, 'Each library server must have a different connection ID.');
      input.libraryServers = servers.map((server): LibraryServerConfig => {
        const saved = previous.libraryServers.find((entry) => entry.id === server.id);
        if (
          (server.id === 'bookorbit' && server.provider !== 'bookorbit') ||
          (saved && saved.provider !== server.provider)
        )
          throw new AppError(
            400,
            'To change a server type, remove the connection and add a new one.',
          );
        const url = validateServiceUrl(server.url);
        const publicUrl = validateServiceUrl(server.publicUrl);
        const name = server.name.trim();
        if (!name) throw new AppError(400, 'Give each library server a name.');
        const libraryIds = server.libraryIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
          .join(',');
        const pattern =
          server.provider === 'audiobookshelf'
            ? /^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/
            : /^\d+(,\d+)*$/;
        if (libraryIds && !pattern.test(libraryIds))
          throw new AppError(
            400,
            'Library IDs must be comma-separated IDs from the selected server.',
          );
        // A blank credential only reuses a secret for the same server and account.
        const sameAccount =
          saved?.url === url &&
          saved?.username === server.username &&
          saved?.provider === server.provider;
        return {
          ...server,
          name,
          url,
          publicUrl,
          libraryIds,
          password:
            server.provider === 'audiobookshelf'
              ? ''
              : server.password || (sameAccount ? saved.password : ''),
          apiKey:
            server.provider === 'audiobookshelf'
              ? server.apiKey || (sameAccount ? saved.apiKey : '')
              : '',
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        400,
        'Use HTTP or HTTPS service URLs without embedded credentials or query strings.',
      );
    }
    if (input.bookorbitLibraryIds && !/^\d+(\s*,\s*\d+)*$/.test(input.bookorbitLibraryIds.trim()))
      throw new AppError(400, 'Library IDs must be comma-separated numbers.');
    if (!input.chaptarrApiKey && input.chaptarrUrl === previous.chaptarrUrl)
      input.chaptarrApiKey = previous.chaptarrApiKey;
    return normalizeConnections(input);
  }
  const requiredConnections = Object.keys(connectionProperties).filter(
    (key) => key !== 'libraryServers',
  );
  app.post<{ Body: ConnectionConfig }>(
    '/api/settings/check',
    {
      bodyLimit: 256 * 1024,
      schema: body(connectionProperties, requiredConnections),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      admin(req);
      if (config.demo) throw new AppError(409, 'Demo connections cannot be changed.');
      const input = connectionInput(req.body);
      const ch = new Chaptarr(input);
      const libraries = Promise.all(
        input.libraryServers.map(async (server) => {
          const adapter = libraryAdapter(server, input);
          try {
            if (!adapter.configured)
              return {
                id: server.id,
                ok: false,
                error: `Enter the ${libraryProviders[server.provider]} URL and required credentials.`,
              };
            const libraries = await adapter.libraries();
            selectedLibraries(libraries, server.libraryIds, libraryProviders[server.provider]);
            return { id: server.id, ok: true, libraries };
          } catch (error) {
            return {
              id: server.id,
              ok: false,
              error: error instanceof Error ? error.message : 'Connection check failed.',
            };
          } finally {
            adapter.cancel();
          }
        }),
      );
      const chaptarr = (async () => {
        if (!ch.configured) return { ok: false, error: 'Enter the Chaptarr URL and API key.' };
        try {
          const [roots, quality, metadata, status] = await Promise.all([
            ch.json('/rootfolder'),
            ch.json('/qualityprofile'),
            ch.json('/metadataprofile'),
            ch.json('/system/status'),
          ]);
          return {
            ok: true,
            roots: array(roots).map((r) => ({ id: r.id, name: r.name, path: r.path })),
            quality: array(quality).map((p) => ({ id: p.id, name: p.name, type: p.profileType })),
            metadata: array(metadata).map((p) => ({ id: p.id, name: p.name, type: p.profileType })),
            version: object(status).version,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Connection check failed.',
          };
        } finally {
          ch.cancel();
        }
      })();
      const checked = await Promise.all([libraries, chaptarr]);
      return {
        libraryServers: checked[0],
        chaptarr: checked[1],
        bookorbit: checked[0].find((server) => server.id === 'bookorbit') || {
          ok: false,
          error: 'BookOrbit is not connected.',
        },
      };
    },
  );
  app.put<{ Body: ConnectionConfig }>(
    '/api/settings',
    { bodyLimit: 256 * 1024, schema: body(connectionProperties, requiredConnections) },
    async (req) => {
      const actor = admin(req);
      if (config.demo) throw new AppError(409, 'Demo connections cannot be changed.');
      const input = connectionInput(req.body);
      services.saveConnections(input, actor);
      await services.syncAll();
      return { ok: true, sources: store.states() };
    },
  );
  app.get('/api/users', async (req) => {
    admin(req);
    return { items: store.users() };
  });
  app.put<{ Params: { id: string }; Body: { password: string } }>(
    '/api/users/:id/password',
    { schema: body({ password: { ...text(256), minLength: 12 } }, ['password']) },
    async (req) => {
      const actor = admin(req);
      if (config.demo) throw new AppError(409, 'Passwords cannot be reset in the demo.');
      if (!store.user(req.params.id)) throw new AppError(404, 'User not found.');
      const hashed = await hashPassword(req.body.password);
      store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashed, req.params.id);
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
      store.audit(actor.id, 'user.password_reset', req.params.id);
      return { ok: true };
    },
  );
  app.post<{
    Body: {
      username: string;
      displayName: string;
      password: string;
      role: 'admin' | 'user';
      autoApprove: boolean;
      weeklyLimit: number;
    };
  }>(
    '/api/users',
    {
      schema: body(
        {
          username: { type: 'string', pattern: '^[A-Za-z0-9_.-]{3,40}$' },
          displayName: { ...text(80), minLength: 1 },
          password: { ...text(256), minLength: 12 },
          role: { type: 'string', enum: ['admin', 'user'] },
          autoApprove: { type: 'boolean' },
          weeklyLimit: { type: 'integer', minimum: 0, maximum: 1000 },
        },
        ['username', 'displayName', 'password', 'role', 'autoApprove', 'weeklyLimit'],
      ),
    },
    async (req, reply) => {
      const actor = admin(req);
      if (store.credentials(req.body.username))
        throw new AppError(409, 'That username is already in use.');
      const user = store.addUser({
        ...req.body,
        passwordHash: await hashPassword(req.body.password),
      });
      store.audit(actor.id, 'user.created', user.id);
      reply.code(201);
      return { user };
    },
  );
  app.patch<{
    Params: { id: string };
    Body: {
      displayName: string;
      role: 'admin' | 'user';
      autoApprove: boolean;
      weeklyLimit: number;
      disabled: boolean;
    };
  }>(
    '/api/users/:id',
    {
      schema: body(
        {
          displayName: { ...text(80), minLength: 1 },
          role: { type: 'string', enum: ['admin', 'user'] },
          autoApprove: { type: 'boolean' },
          weeklyLimit: { type: 'integer', minimum: 0, maximum: 1000 },
          disabled: { type: 'boolean' },
        },
        ['displayName', 'role', 'autoApprove', 'weeklyLimit', 'disabled'],
      ),
    },
    async (req) => {
      const actor = admin(req);
      const target = store.user(req.params.id);
      if (!target) throw new AppError(404, 'User not found.');
      if (actor.id === target.id && (req.body.disabled || req.body.role !== 'admin'))
        throw new AppError(400, 'You cannot disable or demote your own administrator account.');
      const u = req.body;
      store.db
        .prepare(
          'UPDATE users SET display_name=?,role=?,auto_approve=?,weekly_limit=?,disabled=? WHERE id=?',
        )
        .run(
          u.displayName,
          u.role,
          Number(u.autoApprove),
          u.weeklyLimit,
          Number(u.disabled),
          target.id,
        );
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      store.audit(actor.id, 'user.updated', target.id);
      return { user: store.user(target.id) };
    },
  );
  app.put<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/account/password',
    {
      schema: body({ currentPassword: text(256), newPassword: { ...text(256), minLength: 12 } }, [
        'currentPassword',
        'newPassword',
      ]),
    },
    async (req, reply) => {
      if (config.demo) throw new AppError(409, 'Demo passwords cannot be changed.');
      const user = req.auth!.user;
      const credentials = store.credentials(user.username)!;
      if (!(await verifyPassword(req.body.currentPassword, credentials.password_hash)))
        throw new AppError(403, 'Current password is incorrect.');
      const hash = await hashPassword(req.body.newPassword);
      store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      store.audit(user.id, 'password.changed', 'All sessions revoked.');
      reply.clearCookie('bookseerr_session', { path: '/' });
      return { ok: true };
    },
  );
  const staticDir = options.staticDir || resolve('dist/web');
  if (existsSync(resolve(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      maxAge: '1h',
      setHeaders(reply, path) {
        if (path.endsWith('index.html')) reply.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Endpoint not found.' })
        : reply.header('Cache-Control', 'no-cache').sendFile('index.html'),
    );
  }
  return { app, store, services };
}
