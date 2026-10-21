import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Headphones,
  Library,
  ListPlus,
  LogOut,
  Menu,
  Network,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import type { AppStatus, BookRequest, BookResult, Notification, User } from '../../shared/types';
import { api, message, setCsrf, time } from './api';
import { BookDialog, BookGrid, Cover } from './Books';
import { AccountPage, ConnectionsPage, UsersPage } from './Admin';
import { LibraryPage } from './LibraryPage';

type Session = { user: User | null; csrf: string | null; demo: boolean };
type Page =
  'discover' | 'library' | 'requests' | 'notifications' | 'connections' | 'users' | 'account';
const labels: Record<BookRequest['status'], string> = {
  pending_approval: 'Awaiting approval',
  pending_setup: 'Approved · setup needed',
  submitting: 'Sending request',
  requested: 'Requested',
  downloading: 'Downloading',
  importing: 'Importing',
  available: 'Available',
  failed: 'Failed',
  needs_review: 'Needs review',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};
const names: Record<Page, string> = {
  discover: 'Discover',
  library: 'Your library',
  requests: 'Requests',
  notifications: 'Notifications',
  connections: 'Connections',
  users: 'Users',
  account: 'Your account',
};

export function App() {
  const [session, setSession] = useState<Session>();
  const [initialError, setInitialError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Session>('/session', 'GET', undefined, controller.signal)
      .then((s) => {
        setCsrf(s.csrf || '');
        setSession(s);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setInitialError(message(e));
      });
    const expired = () => setSession({ user: null, csrf: null, demo: false });
    window.addEventListener('session-expired', expired);
    return () => {
      controller.abort();
      window.removeEventListener('session-expired', expired);
    };
  }, []);
  if (initialError)
    return (
      <div className="login">
        <div className="panel login-panel">
          <Brand />
          <p role="alert" className="alert error">
            {initialError}
          </p>
          <button className="button" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!session)
    return (
      <div className="loading-screen">
        <Brand />
        <span>Opening your library…</span>
      </div>
    );
  const acceptSession = (s: Session) => {
    setCsrf(s.csrf || '');
    setSession(s);
  };
  if (!session.user) return <Login onSession={acceptSession} />;
  return (
    <Shell
      user={session.user}
      demo={session.demo}
      signedOut={() => acceptSession({ user: null, csrf: null, demo: false })}
    />
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <BookOpen size={22} />
      </span>
      <span>
        bookseer<span className="brand-period">.</span>
      </span>
    </div>
  );
}
function Login({ onSession }: { onSession: (s: Session) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      onSession(
        await api<Session>('/session', 'POST', {
          username: form.get('username'),
          password: form.get('password'),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-art">
        <div className="shelf-line" />
        <p className="eyebrow">A PLACE FOR EVERY CHAPTER</p>
        <h1>
          Your books.
          <br />
          Everyone’s next read.
        </h1>
        <p>
          One place to discover, find, and request
          <br />
          the books you love.
        </p>
        <div className="spines">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <form className="panel login-panel" onSubmit={(e) => void submit(e)}>
        <Brand />
        <h2>Welcome to your library</h2>
        <p className="muted">Sign in to find your next chapter.</p>
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Username
          <input name="username" required autoComplete="username" autoFocus />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="button primary full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
          <ArrowRight size={17} />
        </button>
        <p className="small muted">Need an account? Ask your library administrator.</p>
      </form>
    </div>
  );
}

function Shell({ user, demo, signedOut }: { user: User; demo: boolean; signedOut: () => void }) {
  const [page, setPage] = useState<Page>('discover');
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [requests, setRequests] = useState<BookRequest[]>([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<BookResult>();
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const [s, n, r] = await Promise.all([
          api<AppStatus>('/status', 'GET', undefined, controller.signal),
          api<{ items: Notification[] }>('/notifications', 'GET', undefined, controller.signal),
          api<{ items: BookRequest[] }>('/requests', 'GET', undefined, controller.signal),
        ]);
        if (active) {
          setStatus(s);
          setNotifications(n.items);
          setRequests(r.items);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(message(e));
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const nav = (next: Page) => {
    setPage(next);
    setMenu(false);
    setError('');
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(query.trim());
    nav('discover');
    refresh();
  };
  async function sync() {
    setSyncing(true);
    setError('');
    try {
      await api('/sync', 'POST', {});
      refresh();
      setToast('Library check finished. Connection status shows any sources needing attention.');
    } catch (e) {
      setError(message(e));
    } finally {
      setSyncing(false);
    }
  }
  async function logout() {
    try {
      await api('/session', 'DELETE');
      signedOut();
    } catch (e) {
      setError(message(e));
    }
  }
  const unread = notifications.filter((n) => !n.read).length;
  const navButton = (p: Page, Icon: typeof Compass, count?: number) => (
    <button
      className={`nav-item ${page === p ? 'active' : ''}`}
      onClick={() => nav(p)}
      aria-current={page === p ? 'page' : undefined}
    >
      <Icon size={19} />
      <span>{names[p]}</span>
      {count ? <small>{count}</small> : null}
    </button>
  );
  return (
    <div className="app">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <Brand />
        <div className="sidebar-group-label">YOUR READING ROOM</div>
        <nav aria-label="Main navigation">
          {navButton('discover', Compass)}
          {navButton('library', Library)}
          {navButton('requests', ListPlus, status?.requestCount)}
          {navButton('notifications', Bell, unread)}
        </nav>
        {user.role === 'admin' ? (
          <>
            <div className="sidebar-group-label">MANAGE</div>
            <nav aria-label="Administration">
              {navButton('connections', Network)}
              {navButton('users', Users)}
            </nav>
          </>
        ) : null}
        <div className="sidebar-bottom">
          <div className="nas-note">
            <span className="live-dot" />
            <span>
              Your library, at home<small>Self-hosted · Bookseer v0.1</small>
            </span>
          </div>
          <button className="profile" onClick={() => nav('account')}>
            <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <span>
              {user.displayName}
              <small>{user.role === 'admin' ? 'Administrator' : 'Reader'}</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="signout" onClick={() => void logout()}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>
      {menu ? (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      ) : null}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <form className="global-search" onSubmit={search}>
            <Search size={18} />
            <input
              aria-label="Search books by title, author, or ISBN"
              placeholder="Find a book, an author, your next read…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <button
            className="icon-button notification-button"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            onClick={() => nav('notifications')}
          >
            <Bell size={20} />
            {unread ? <i /> : null}
          </button>
          <span className="avatar top-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
        </header>
        {demo ? (
          <div className="demo-banner">
            DEMO LIBRARY · Sample books and accounts · No downloads are sent
          </div>
        ) : null}
        <main id="content" tabIndex={-1}>
          {error ? (
            <p className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </p>
          ) : null}
          {page === 'discover' ? (
            <Discover
              query={submitted}
              revision={revision}
              user={user}
              status={status}
              select={setSelected}
              browse={() => nav('library')}
              configure={() => nav('connections')}
            />
          ) : null}
          {page === 'library' ? (
            <LibraryPage
              revision={revision}
              select={setSelected}
              sync={() => void sync()}
              syncing={syncing}
              admin={user.role === 'admin'}
            />
          ) : null}
          {page === 'requests' ? (
            <RequestsPage requests={requests} user={user} refresh={refresh} toast={setToast} />
          ) : null}
          {page === 'notifications' ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">YOUR UPDATES</p>
                  <h1>Notifications</h1>
                  <p>Request decisions and available books, just for you.</p>
                </div>
                <button
                  className="button"
                  onClick={() => {
                    void api('/notifications/read', 'POST', {})
                      .then(refresh)
                      .catch((e) => setError(message(e)));
                  }}
                >
                  <Check size={16} />
                  Mark all read
                </button>
              </div>
              <div className="panel">
                {notifications.length ? (
                  notifications.map((n) => (
                    <div className={`notification-row ${n.read ? '' : 'unread'}`} key={n.id}>
                      <Bell size={18} />
                      <div>
                        <p>{n.message}</p>
                        <small className="muted">{time(n.createdAt)}</small>
                      </div>
                      {n.requestId ? (
                        <button className="text-button" onClick={() => nav('requests')}>
                          View request
                          <ArrowRight size={14} />
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <Empty
                    title="You’re all caught up"
                    text="Updates about your requests will appear here."
                  />
                )}
              </div>
            </>
          ) : null}
          {page === 'connections' && user.role === 'admin' ? (
            <ConnectionsPage status={status} refresh={refresh} toast={setToast} />
          ) : null}
          {page === 'users' && user.role === 'admin' ? (
            <UsersPage current={user} toast={setToast} />
          ) : null}
          {page === 'account' ? <AccountPage user={user} signedOut={signedOut} /> : null}
          <footer className="page-footer">
            <span>Made for your next chapter.</span>
            <a href="https://github.com/TeamCogs/bookseer" target="_blank" rel="noreferrer">
              Bookseer on GitHub ↗
            </a>
          </footer>
        </main>
      </div>
      {toast ? (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {selected ? (
        <BookDialog
          key={selected.book.id}
          initial={selected}
          user={user}
          onClose={() => setSelected(undefined)}
          onUpdate={refresh}
          onRequested={setToast}
        />
      ) : null}
    </div>
  );
}

function Discover({
  query,
  revision,
  user,
  status,
  select,
  browse,
  configure,
}: {
  query: string;
  revision: number;
  user: User;
  status: AppStatus | null;
  select: (b: BookResult) => void;
  browse: () => void;
  configure: () => void;
}) {
  const [data, setData] = useState<{
    library: BookResult[];
    discovery: BookResult[];
    warning?: string;
  }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<typeof data>(`/search?q=${encodeURIComponent(query)}`, 'GET', undefined, controller.signal)
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [query, revision]);
  const connected = status?.sources.filter((s) => s.status === 'healthy').length || 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
          <h1>
            {query
              ? `Results for “${query}”`
              : `Welcome to your reading room${user.displayName === 'Administrator' ? '.' : `, ${user.displayName.split(' ')[0]}.`}`}
          </h1>
          <p>
            {query
              ? 'Your connected shelves come first. Request only the formats you need.'
              : 'Find something you love. We’ll tell you if it’s already on your shelf.'}
          </p>
        </div>
        <span className="pill live-status">
          <span className={connected ? 'live-dot' : 'warning-dot'} />
          {connected
            ? `${connected} librar${connected === 1 ? 'y' : 'ies'} connected`
            : 'Connect your libraries'}
        </span>
      </div>
      {!query ? (
        <section className="hero">
          <div>
            <span className="eyebrow">ALL YOUR SHELVES. ONE PLACE.</span>
            <h2>
              A good story is
              <br />
              closer than you think.
            </h2>
            <p>
              Browse the books you own, discover something new,
              <br className="desktop-break" /> and keep everyone’s requests together.
            </p>
            <button className="button primary" onClick={browse}>
              Explore your library
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-orbit" />
            <div className="hero-book back">
              <Headphones size={32} />
              <span>
                Listen.
                <br />
                Imagine.
              </span>
              <i />
            </div>
            <div className="hero-book front">
              <BookOpen size={28} />
              <span>
                One more
                <br />
                <em>chapter.</em>
              </span>
              <i />
            </div>
            <span className="hero-label">
              <Check size={14} />
              Already on your shelf
            </span>
          </div>
        </section>
      ) : null}
      {!query ? (
        <div className="stat-strip">
          <div>
            <Library size={20} />
            <span>
              <strong>{status?.libraryCount.toLocaleString() ?? '—'}</strong> library books
            </span>
          </div>
          <div>
            <ListPlus size={20} />
            <span>
              <strong>{status?.requestCount ?? '—'}</strong> active requests
            </span>
          </div>
          <div>
            <ShieldCheck size={20} />
            <span>
              Shared shelves · <strong>personal accounts</strong>
            </span>
          </div>
        </div>
      ) : null}
      {status && status.sources.some((s) => s.configured && s.status === 'error') ? (
        <p className="alert">
          A library needs attention. Previously seen copies remain visible; uncertain availability
          blocks duplicate requests.
          {user.role === 'admin' ? (
            <button className="text-button" onClick={configure}>
              Check connections <ArrowRight size={14} />
            </button>
          ) : null}
        </p>
      ) : null}
      {status && !status.sources.some((s) => s.configured) ? (
        <div className="alert">
          Connect BookOrbit or Chaptarr to see your books and verify ownership.
          {user.role === 'admin' ? (
            <button className="text-button" onClick={configure}>
              Set up connections
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="skeleton-grid" aria-label="Loading books">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : (
        <>
          <section className="book-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CONNECTED SHELVES</p>
                <h2>{query ? 'In your library' : 'From your library'}</h2>
              </div>
              <button className="text-button" onClick={browse}>
                View library
                <ArrowRight size={16} />
              </button>
            </div>
            {data?.library.length ? (
              <BookGrid results={data.library.slice(0, query ? 18 : 12)} select={select} />
            ) : (
              <Empty
                title={query ? 'No exact library search results' : 'Your shelves are waiting'}
                text={
                  query
                    ? 'Online results below also check identifiers and related copies in your library.'
                    : 'Connect your existing library to bring your books together here.'
                }
              />
            )}
          </section>
          {data?.warning ? <p className="alert">{data.warning}</p> : null}
          <section className="book-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">A WORLD OF STORIES</p>
                <h2>{query ? 'Discover & request' : 'Find your next read'}</h2>
              </div>
              <span className="muted small">
                {query ? 'Metadata from Open Library' : 'Search by title, author, or ISBN'}
              </span>
            </div>
            {data?.discovery.length ? (
              <BookGrid results={data.discovery} select={select} />
            ) : (
              <div className="search-prompt">
                <Search size={25} />
                <p>
                  {query
                    ? 'No online matches found. Try the title and author together.'
                    : 'Start with a book you’ve been meaning to read.'}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
function RequestsPage({
  requests,
  user,
  refresh,
  toast,
}: {
  requests: BookRequest[];
  user: User;
  refresh: () => void;
  toast: (s: string) => void;
}) {
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const shown = requests.filter(
    (r) =>
      filter === 'all' ||
      (filter === 'approval' && r.status === 'pending_approval') ||
      (filter === 'active' && !['available', 'rejected', 'cancelled'].includes(r.status)) ||
      (filter === 'available' && r.status === 'available'),
  );
  async function action(id: string, action: string) {
    setBusy(id);
    setError('');
    try {
      await api(`/requests/${id}/${action}`, 'POST', {});
      refresh();
      toast('Request updated.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE NEXT CHAPTER</p>
          <h1>{user.role === 'admin' ? 'Library requests' : 'Your requests'}</h1>
          <p>
            {user.role === 'admin'
              ? 'Approve, follow, and manage requests from your readers.'
              : 'Your requests and the shared requests you follow.'}
          </p>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Filter requests">
        {[
          ['active', 'Active'],
          ['approval', 'Awaiting approval'],
          ['available', 'Available'],
          ['all', 'All requests'],
        ].map(([value, label]) => (
          <button
            className={filter === value ? 'selected' : ''}
            key={value}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {shown.length ? (
        <div className="request-list">
          {shown.map((r) => (
            <article className="panel request-card" key={r.id}>
              <Cover title={r.title} author={r.author} url={r.coverUrl} />
              <div className="request-info">
                <span className="eyebrow">
                  {r.mediaKind === 'ebook' ? <BookOpen size={12} /> : <Headphones size={12} />}{' '}
                  {r.mediaKind}
                </span>
                <h3>{r.title}</h3>
                <p className="muted">{r.author}</p>
                <span
                  className={`pill ${r.status === 'available' ? 'success' : r.status === 'needs_review' ? 'warning' : ''}`}
                >
                  {labels[r.status]}
                </span>
                <p className="small request-message">{r.message}</p>
                <small className="muted">
                  Requested by {r.requestedBy} · {time(r.createdAt)}
                  {r.followers > 1 ? ` · ${r.followers} readers following` : ''}
                </small>
                {['needs_review', 'failed', 'cancelled', 'rejected'].includes(r.status) &&
                user.role === 'admin' ? (
                  <div className="retry-controls">
                    <label className="checkbox small">
                      <input
                        type="checkbox"
                        checked={Boolean(reviewed[r.id])}
                        onChange={(e) => setReviewed({ ...reviewed, [r.id]: e.target.checked })}
                      />
                      I checked Chaptarr for an existing or pending copy.
                    </label>
                    <button
                      className="button small-button"
                      disabled={!reviewed[r.id] || busy === r.id}
                      onClick={() => void action(r.id, 'retry')}
                    >
                      Reopen request
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="request-actions">
                {user.role === 'admin' &&
                ['pending_approval', 'pending_setup'].includes(r.status) ? (
                  <>
                    <button
                      className="button primary small-button"
                      disabled={busy === r.id}
                      onClick={() => void action(r.id, 'approve')}
                    >
                      {r.status === 'pending_setup' ? 'Try acquisition' : 'Approve'}
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={busy === r.id}
                      onClick={() => void action(r.id, 'reject')}
                    >
                      Decline
                    </button>
                  </>
                ) : null}
                {['pending_approval', 'pending_setup'].includes(r.status) &&
                (user.id === r.requesterId || user.role === 'admin') ? (
                  <button
                    className="text-button"
                    disabled={busy === r.id}
                    onClick={() => void action(r.id, 'cancel')}
                  >
                    Cancel request
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="A little room for your next read"
          text={
            filter === 'approval'
              ? 'No requests are waiting for approval.'
              : 'Search for a book and request a format you don’t already own.'
          }
        />
      )}
    </>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <BookOpen size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
