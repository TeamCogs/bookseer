import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  BookRequest,
  CatalogBook,
  LibraryGroup,
  LibraryItem,
  MediaKind,
  Notification,
  RequestStatus,
  Source,
  SourceState,
  User,
} from '../shared/types.js';
import { readerRequestMessage } from '../shared/messages.js';
import { catalogueIdentity } from './matching.js';
import { digest, token } from './security.js';

export class Store {
  private cachedInventory?: LibraryItem[];
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
        auto_approve INTEGER NOT NULL DEFAULT 0, weekly_limit INTEGER NOT NULL DEFAULT 10,
        disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS inventory_source ON inventory(source);
      CREATE TABLE IF NOT EXISTS source_states (source TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS catalogue (id TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (catalog_id TEXT NOT NULL, media_kind TEXT NOT NULL, item_ids TEXT NOT NULL,
        confirmed_by TEXT NOT NULL REFERENCES users(id), confirmed_at TEXT NOT NULL, PRIMARY KEY(catalog_id,media_kind));
      CREATE TABLE IF NOT EXISTS dismissed_matches (catalog_id TEXT NOT NULL, media_kind TEXT NOT NULL, item_id TEXT NOT NULL,
        reviewed_by TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(catalog_id,media_kind,item_id));
      CREATE TABLE IF NOT EXISTS library_groups (id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL, item_ids TEXT NOT NULL, reviewed_by TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, catalog_id TEXT NOT NULL, media_kind TEXT NOT NULL,
        requester_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, upstream_id INTEGER,
        message TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(catalog_id,media_kind));
      CREATE TABLE IF NOT EXISTS followers (request_id TEXT NOT NULL REFERENCES requests(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(request_id,user_id));
      CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT,
        message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  audit(userId: string | null, action: string, detail: string) {
    this.db
      .prepare('INSERT INTO audit(user_id,action,detail,created_at) VALUES(?,?,?,?)')
      .run(userId, action, detail, new Date().toISOString());
  }
  users(): User[] {
    return (
      this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as Record<string, unknown>[]
    ).map(toUser);
  }
  user(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    return row ? toUser(row) : undefined;
  }
  addUser(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    role: 'admin' | 'user';
    autoApprove: boolean;
    weeklyLimit: number;
  }): User {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        input.username,
        input.displayName,
        input.passwordHash,
        input.role,
        Number(input.autoApprove),
        input.weeklyLimit,
        0,
        new Date().toISOString(),
      );
    return this.user(id)!;
  }
  credentials(username: string) {
    return this.db
      .prepare('SELECT id,password_hash,disabled FROM users WHERE username=? COLLATE NOCASE')
      .get(username) as { id: string; password_hash: string; disabled: number } | undefined;
  }
  createSession(userId: string) {
    const value = token();
    const csrf = token();
    this.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(digest(value), userId, csrf, Date.now() + 7 * 86400000);
    return { value, csrf };
  }
  session(value: string | undefined) {
    if (!value || value.length > 200) return undefined;
    const row = this.db
      .prepare('SELECT user_id,csrf FROM sessions WHERE hash=? AND expires_at>?')
      .get(digest(value), Date.now()) as { user_id: string; csrf: string } | undefined;
    if (!row) return undefined;
    const user = this.user(row.user_id);
    return user && !user.disabled ? { user, csrf: row.csrf } : undefined;
  }
  revokeSession(value: string) {
    this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(value));
  }
  setting(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, value);
  }
  inventory(): LibraryItem[] {
    return (this.cachedInventory ||= (
      this.db.prepare('SELECT payload FROM inventory').all() as { payload: string }[]
    ).map((r) => JSON.parse(r.payload)));
  }
  item(id: string): LibraryItem | undefined {
    const row = this.db.prepare('SELECT payload FROM inventory WHERE id=?').get(id) as
      { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  state(source: Source): SourceState {
    const row = this.db.prepare('SELECT payload FROM source_states WHERE source=?').get(source) as
      { payload: string } | undefined;
    return row
      ? JSON.parse(row.payload)
      : { source, configured: false, status: 'unconfigured', count: 0 };
  }
  setState(state: SourceState) {
    this.db
      .prepare(
        'INSERT INTO source_states VALUES(?,?) ON CONFLICT(source) DO UPDATE SET payload=excluded.payload',
      )
      .run(state.source, JSON.stringify(state));
  }
  replaceInventory(source: Source, items: LibraryItem[]) {
    if (
      items.some((item) => item.source !== source) ||
      new Set(items.map((i) => i.id)).size !== items.length
    )
      throw new Error('Invalid inventory snapshot.');
    this.transaction(() => {
      this.db.prepare('DELETE FROM inventory WHERE source=?').run(source);
      const insert = this.db.prepare('INSERT INTO inventory VALUES(?,?,?)');
      items.forEach((item) => insert.run(item.id, source, JSON.stringify(item)));
      this.setState({
        source,
        configured: true,
        status: 'healthy',
        count: items.length,
        lastSuccess: new Date().toISOString(),
        lastAttempt: new Date().toISOString(),
      });
    });
    this.cachedInventory = undefined;
  }
  saveBook(book: CatalogBook) {
    this.db
      .prepare(
        'INSERT INTO catalogue VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at WHERE catalogue.payload<>excluded.payload',
      )
      .run(book.id, JSON.stringify(book), new Date().toISOString());
  }
  book(id: string): CatalogBook | undefined {
    const row = this.db.prepare('SELECT payload FROM catalogue WHERE id=?').get(id) as
      { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  confirmedMatches(catalogId: string, kind: MediaKind): string[] | undefined {
    const row = this.db
      .prepare('SELECT item_ids FROM matches WHERE catalog_id=? AND media_kind=?')
      .get(catalogId, kind) as { item_ids: string } | undefined;
    return row ? JSON.parse(row.item_ids) : undefined;
  }
  confirmMatch(catalogId: string, kind: MediaKind, itemIds: string[], actor: string) {
    itemIds.forEach((id) =>
      this.db
        .prepare('DELETE FROM dismissed_matches WHERE catalog_id=? AND media_kind=? AND item_id=?')
        .run(catalogId, kind, id),
    );
    this.db
      .prepare(
        'INSERT INTO matches VALUES(?,?,?,?,?) ON CONFLICT(catalog_id,media_kind) DO UPDATE SET item_ids=excluded.item_ids,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at',
      )
      .run(catalogId, kind, JSON.stringify(itemIds), actor, new Date().toISOString());
    this.audit(actor, 'match.confirmed', JSON.stringify({ catalogId, kind, itemIds }));
  }
  dismissedMatches(catalogId: string, kind: MediaKind): string[] {
    return (
      this.db
        .prepare('SELECT item_id FROM dismissed_matches WHERE catalog_id=? AND media_kind=?')
        .all(catalogId, kind) as { item_id: string }[]
    ).map((r) => r.item_id);
  }
  libraryGroups(): LibraryGroup[] {
    return (
      this.db.prepare('SELECT * FROM library_groups').all() as {
        id: string;
        canonical_id: string;
        item_ids: string;
      }[]
    ).map((r) => ({ id: r.id, canonicalId: r.canonical_id, itemIds: JSON.parse(r.item_ids) }));
  }
  groupLibrary(itemIds: string[], canonicalId: string, actor: string) {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO library_groups VALUES(?,?,?,?)')
      .run(id, canonicalId, JSON.stringify(itemIds), actor);
    this.audit(actor, 'library.grouped', JSON.stringify({ id, itemIds, canonicalId }));
    return id;
  }
  dismissMatches(catalogId: string, kind: MediaKind, itemIds: string[], actor: string) {
    this.transaction(() => {
      itemIds.forEach((id) =>
        this.db
          .prepare('INSERT OR IGNORE INTO dismissed_matches VALUES(?,?,?,?)')
          .run(catalogId, kind, id, actor),
      );
      this.audit(actor, 'match.dismissed', JSON.stringify({ catalogId, kind, itemIds }));
    });
  }
  requestsFor(user: User): BookRequest[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, u.display_name AS requested_by,
      (SELECT COUNT(*) FROM followers f WHERE f.request_id=r.id) AS followers,
      EXISTS(SELECT 1 FROM followers f WHERE f.request_id=r.id AND f.user_id=?) AS following
      FROM requests r JOIN users u ON u.id=r.requester_id
      WHERE (?='admin' OR r.id IN (SELECT request_id FROM followers WHERE user_id=?)) ORDER BY r.created_at DESC`,
      )
      .all(user.id, user.role, user.id) as Record<string, unknown>[];
    return rows.map((row) => {
      const book = this.book(String(row.catalog_id));
      return {
        id: String(row.id),
        catalogId: String(row.catalog_id),
        mediaKind: row.media_kind as MediaKind,
        title: book?.title || 'Unknown title',
        author: book?.author || '',
        coverUrl: book?.coverUrl,
        status: row.status as RequestStatus,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        upstreamId: row.upstream_id ? Number(row.upstream_id) : undefined,
        message:
          user.role === 'admin'
            ? String(row.message)
            : readerRequestMessage(row.status as RequestStatus, String(row.message)),
        requestedBy: String(row.requested_by),
        requesterId: String(row.requester_id),
        followers: Number(row.followers),
        following: Boolean(row.following),
      };
    });
  }
  request(id: string) {
    return this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
  }
  relatedRequests(book: CatalogBook) {
    const identity = catalogueIdentity(book);
    return (
      this.db
        .prepare(
          "SELECT r.*, c.payload AS book_payload FROM requests r JOIN catalogue c ON c.id=r.catalog_id ORDER BY CASE WHEN r.status IN ('available','cancelled','rejected') THEN 1 ELSE 0 END, r.created_at DESC",
        )
        .all() as Record<string, unknown>[]
    ).filter(
      (row) =>
        row.catalog_id === book.id ||
        (identity && catalogueIdentity(JSON.parse(String(row.book_payload))) === identity),
    );
  }
  createRequest(book: CatalogBook, kind: MediaKind, user: User): { id: string; created: boolean } {
    return this.transaction(() => {
      const existing = this.relatedRequests(book).find((row) => row.media_kind === kind) as
        { id: string; catalog_id: string; status: RequestStatus } | undefined;
      if (existing && existing.status !== 'available') {
        this.db.prepare('INSERT OR IGNORE INTO followers VALUES(?,?)').run(existing.id, user.id);
        return { id: existing.id, created: false };
      }
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const count = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit WHERE user_id=? AND action='request.created' AND created_at>=?",
        )
        .get(user.id, since) as { n: number };
      if (user.role !== 'admin' && user.weeklyLimit > 0 && count.n >= user.weeklyLimit)
        throw new Error('Your weekly request limit has been reached.');
      const id = existing?.id || randomUUID();
      const now = new Date().toISOString();
      const approved = user.role === 'admin' || user.autoApprove;
      this.db
        .prepare(
          'INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(catalog_id,media_kind) DO UPDATE SET requester_id=excluded.requester_id,status=excluded.status,upstream_id=NULL,message=excluded.message,created_at=excluded.created_at,updated_at=excluded.updated_at',
        )
        .run(
          id,
          existing?.catalog_id || book.id,
          kind,
          user.id,
          approved ? 'pending_setup' : 'pending_approval',
          null,
          approved
            ? 'Approved; waiting for acquisition.'
            : 'Waiting for an administrator to approve.',
          now,
          now,
        );
      this.db.prepare('INSERT OR IGNORE INTO followers VALUES(?,?)').run(id, user.id);
      if (existing) {
        this.setSetting(`lookup_retry:${id}`, '');
        this.setSetting(`pending_add:${id}`, '');
      }
      this.audit(user.id, 'request.created', JSON.stringify({ id, catalogId: book.id, kind }));
      this.users()
        .filter((u) => u.role === 'admin' && !u.disabled)
        .forEach((u) =>
          this.notify(u.id, `${user.displayName} requested ${book.title} (${kind}).`, id),
        );
      return { id, created: true };
    });
  }
  updateRequest(id: string, status: RequestStatus, message: string, upstreamId?: number) {
    const previous = this.request(id);
    this.db
      .prepare(
        'UPDATE requests SET status=?,message=?,upstream_id=COALESCE(?,upstream_id),updated_at=? WHERE id=?',
      )
      .run(status, message, upstreamId ?? null, new Date().toISOString(), id);
    if (previous && previous.status !== status) {
      const book = this.book(String(previous.catalog_id));
      const followers = this.db
        .prepare('SELECT user_id FROM followers WHERE request_id=?')
        .all(id) as { user_id: string }[];
      followers.forEach((f) =>
        this.notify(
          f.user_id,
          `${book?.title || 'Your request'}: ${this.user(f.user_id)?.role === 'admin' ? message : readerRequestMessage(status, message)}`,
          id,
        ),
      );
    }
  }
  notify(userId: string, message: string, requestId?: string) {
    if (requestId) {
      const last = this.db
        .prepare(
          'SELECT message FROM notifications WHERE user_id=? AND request_id=? ORDER BY id DESC LIMIT 1',
        )
        .get(userId, requestId) as { message: string } | undefined;
      if (last?.message === message) return;
    }
    this.db
      .prepare('INSERT INTO notifications(user_id,request_id,message,created_at) VALUES(?,?,?,?)')
      .run(userId, requestId ?? null, message, new Date().toISOString());
  }
  notifications(userId: string): Notification[] {
    return (
      this.db
        .prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100')
        .all(userId) as Record<string, unknown>[]
    ).map((r) => ({
      id: Number(r.id),
      message: String(r.message),
      requestId: r.request_id ? String(r.request_id) : undefined,
      read: Boolean(r.read),
      createdAt: String(r.created_at),
    }));
  }
}
function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: row.role as User['role'],
    autoApprove: Boolean(row.auto_approve),
    weeklyLimit: Number(row.weekly_limit),
    disabled: Boolean(row.disabled),
    createdAt: String(row.created_at),
  };
}
