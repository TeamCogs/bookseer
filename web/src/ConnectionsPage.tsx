import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, LockKeyhole, PlugZap, Plus, Save } from 'lucide-react';
import type { AppStatus, LibraryProvider, LibraryServerConfig } from '../../shared/types';
import { libraryProviders, sourceName } from '../../shared/libraries';
import type { ConnectionConfig } from '../../server/config';
import { api, message, time } from './api';
import {
  LibraryServerCard,
  type EditableLibraryServer,
  type LibraryCheck,
} from './LibraryServerCard';

type Connections = Omit<ConnectionConfig, 'libraryServers'> & {
  libraryServers: EditableLibraryServer[];
  bookorbitPasswordSet: boolean;
  chaptarrApiKeySet: boolean;
};
type ScalarConnectionKey = Exclude<keyof ConnectionConfig, 'libraryServers'>;
type Choice = { id: number; name: string; type?: string | number };
type Checks = {
  libraryServers: LibraryCheck[];
  chaptarr: {
    ok: boolean;
    error?: string;
    version?: string;
    roots?: (Choice & { path: string })[];
    quality?: Choice[];
    metadata?: Choice[];
  };
};
export function ConnectionsPage({
  status,
  refresh,
  toast,
}: {
  status: AppStatus | null;
  refresh: () => void;
  toast: (s: string) => void;
}) {
  const [value, setValue] = useState<Connections>();
  const [checks, setChecks] = useState<Checks>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [provider, setProvider] = useState<LibraryProvider>('bookorbit');
  useEffect(() => {
    const controller = new AbortController();
    api<{ connections: Connections }>('/settings', 'GET', undefined, controller.signal)
      .then((r) => setValue(r.connections))
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, []);
  function input() {
    const { bookorbitPasswordSet: _b, chaptarrApiKeySet: _c, ...result } = value!;
    return {
      ...result,
      libraryServers: result.libraryServers.map(
        ({ passwordSet: _password, apiKeySet: _api, ...server }) => server,
      ),
    };
  }
  async function check() {
    if (!value) return;
    setBusy('check');
    setError('');
    try {
      setChecks(await api<Checks>('/settings/check', 'POST', input()));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value) return;
    setBusy('save');
    setError('');
    try {
      await api('/settings', 'PUT', input());
      refresh();
      toast('Connections saved. Check the complete sync results below.');
      setValue((await api<{ connections: Connections }>('/settings')).connections);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  function change(key: ScalarConnectionKey, next: string | number) {
    setValue((current) =>
      current
        ? {
            ...current,
            [key]: next,
            ...(key === 'chaptarrUrl' && next !== current.chaptarrUrl
              ? { chaptarrApiKeySet: false }
              : {}),
          }
        : current,
    );
    if (['chaptarrUrl', 'chaptarrApiKey'].includes(key)) setChecks(undefined);
  }
  function changeServer(id: string, key: keyof LibraryServerConfig, next: string) {
    setValue((current) =>
      current
        ? {
            ...current,
            libraryServers: current.libraryServers.map((server) =>
              server.id === id
                ? {
                    ...server,
                    [key]: next,
                    ...(['url', 'username'].includes(key) && next !== server[key]
                      ? { passwordSet: false, apiKeySet: false }
                      : {}),
                  }
                : server,
            ),
          }
        : current,
    );
    if (['url', 'username', 'password', 'apiKey'].includes(key))
      setChecks((current) =>
        current
          ? {
              ...current,
              libraryServers: current.libraryServers.filter((server) => server.id !== id),
            }
          : current,
      );
  }
  function addServer() {
    setValue((current) => {
      if (!current) return current;
      const count = current.libraryServers.filter((server) => server.provider === provider).length;
      return {
        ...current,
        libraryServers: [
          ...current.libraryServers,
          {
            id: crypto.randomUUID(),
            provider,
            name: `${libraryProviders[provider]}${count ? ` ${count + 1}` : ''}`,
            url: '',
            publicUrl: '',
            username: '',
            password: '',
            apiKey: '',
            libraryIds: '',
            passwordSet: false,
            apiKeySet: false,
          },
        ],
      };
    });
  }
  const field = (key: ScalarConnectionKey, label: string, placeholder = '', secret = false) => (
    <label className="field">
      {label}
      <input
        type={secret ? 'password' : typeof value?.[key] === 'number' ? 'number' : 'text'}
        min={0}
        value={value?.[key] ?? ''}
        autoComplete={secret ? 'new-password' : 'off'}
        placeholder={placeholder}
        onChange={(e) =>
          change(key, typeof value?.[key] === 'number' ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  );
  function destination(kind: 'ebook' | 'audiobook') {
    const rootKey = `${kind}RootFolder` as const;
    const qualityKey = `${kind}QualityProfileId` as const;
    const metadataKey = `${kind}MetadataProfileId` as const;
    function profile(
      key: typeof qualityKey | typeof metadataKey,
      label: string,
      options?: Choice[],
    ) {
      if (!options) return field(key, label + ' ID', 'Use Check connections to load names');
      return (
        <label className="field">
          {label}
          <select value={value?.[key]} onChange={(e) => change(key, Number(e.target.value))}>
            <option value={0}>Choose a profile · acquisition disabled</option>
            {options
              .filter(
                (p) =>
                  typeof p.type !== 'string' ||
                  p.type.toLowerCase() === kind ||
                  p.type.toLowerCase() === 'general',
              )
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      );
    }
    return (
      <div className="destination-settings">
        <h3>{kind === 'ebook' ? 'Ebook requests' : 'Audiobook requests'}</h3>
        <div className="form-grid">
          {checks?.chaptarr.roots ? (
            <label className="field">
              Destination folder
              <select value={value?.[rootKey]} onChange={(e) => change(rootKey, e.target.value)}>
                <option value="">Choose a destination · acquisition disabled</option>
                {checks.chaptarr.roots
                  .filter(
                    (root) =>
                      root.type === undefined ||
                      root.type === 0 ||
                      root.type === (kind === 'ebook' ? 2 : 1) ||
                      String(root.type).toLowerCase() === 'mixed' ||
                      String(root.type).toLowerCase() === kind,
                  )
                  .map((root) => (
                    <option key={root.id} value={root.path}>
                      {root.name || root.path} · {root.path}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            field(
              rootKey,
              'Destination folder',
              kind === 'ebook' ? '/books/ebooks' : '/books/audiobooks',
            )
          )}
          {profile(qualityKey, 'Quality profile', checks?.chaptarr.quality)}
          {profile(metadataKey, 'Metadata profile', checks?.chaptarr.metadata)}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Connected libraries</h1>
          <p>Your shelves are the source of truth. Acquisition stays in Chaptarr.</p>
        </div>
      </div>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="source-grid">
        {status?.sources.map((source) => (
          <div className="panel source-card" key={source.source}>
            <div className="section-title">
              <h3>{sourceName(source)}</h3>
              <span className={`pill ${source.status === 'healthy' ? 'success' : ''}`}>
                {source.status === 'healthy'
                  ? 'Connected'
                  : source.status === 'syncing'
                    ? 'Syncing'
                    : source.configured
                      ? 'Check connection'
                      : 'Not connected'}
              </span>
            </div>
            <p>{source.count.toLocaleString()} format records</p>
            <small className="muted">Last complete sync · {time(source.lastSuccess)}</small>
            {source.error ? <p className="small amber-text">{source.error}</p> : null}
          </div>
        ))}
      </div>
      {value ? (
        <form onSubmit={(e) => void save(e)}>
          <section className="panel settings-section">
            <div className="section-title">
              <h2>Library servers</h2>
              <span className="pill success">Read-only inventory</span>
            </div>
            <p className="muted">
              Connect BookOrbit, Grimmory, or Audiobookshelf. You can include several servers of
              each type. Copies appear together under one book, with separate ebook and audiobook
              availability.
            </p>
            <div className="button-row">
              <label className="field">
                Server type
                <select
                  value={provider}
                  disabled={Boolean(busy) || status?.demo}
                  onChange={(event) => setProvider(event.target.value as LibraryProvider)}
                >
                  {Object.entries(libraryProviders).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                type="button"
                disabled={Boolean(busy) || status?.demo || value.libraryServers.length >= 20}
                onClick={addServer}
              >
                <Plus size={16} /> Add library server
              </button>
              <button
                className="button"
                type="button"
                disabled={Boolean(busy) || status?.demo}
                onClick={() => void check()}
              >
                <PlugZap size={16} />{' '}
                {busy === 'check' ? 'Checking connections…' : 'Check connections & load choices'}
              </button>
            </div>
            <p className="small muted">
              Bookseerr reads your inventory and covers. Removing a connection forgets its cached
              copies; your server’s files and metadata stay in place. Changes take effect when you
              save.
            </p>
          </section>
          {value.libraryServers.map((server) => (
            <LibraryServerCard
              key={server.id}
              server={server}
              check={checks?.libraryServers.find((entry) => entry.id === server.id)}
              disabled={Boolean(busy) || Boolean(status?.demo)}
              change={changeServer}
              remove={(id) =>
                setValue((current) =>
                  current
                    ? {
                        ...current,
                        libraryServers: current.libraryServers.filter((entry) => entry.id !== id),
                      }
                    : current,
                )
              }
            />
          ))}
          <div className="panel settings-section">
            <div className="section-title">
              <h2>Official Chaptarr</h2>
              <a
                className="text-button"
                href="https://github.com/Chaptarr/chaptarr"
                target="_blank"
                rel="noreferrer"
              >
                Official project
                <ExternalLink size={14} />
              </a>
            </div>
            <p className="muted">
              Enter the upstream connection, then check it to choose destinations and profiles by
              name.
            </p>
            <div className="form-grid">
              {field('chaptarrUrl', 'Internal URL', 'http://chaptarr:8789')}
              {field('chaptarrPublicUrl', 'Browser URL (optional)')}
              {field(
                'chaptarrApiKey',
                'API key',
                value.chaptarrApiKeySet ? 'Saved · leave blank to keep' : 'Chaptarr API key',
                true,
              )}
            </div>
            <button
              className="button"
              type="button"
              disabled={Boolean(busy) || status?.demo}
              onClick={() => void check()}
            >
              <PlugZap size={16} />
              {busy === 'check' ? 'Checking connections…' : 'Check connections & load choices'}
            </button>
            {checks ? (
              <p
                className={`small connection-check ${checks.chaptarr.ok ? 'green-text' : 'amber-text'}`}
              >
                {checks.chaptarr.ok
                  ? `Connected to Chaptarr ${checks.chaptarr.version || ''}.`
                  : checks.chaptarr.error}
              </p>
            ) : null}
            {destination('ebook')}
            {destination('audiobook')}
            <p className="small muted">
              A destination and both profiles are required for each format. Configure indexers,
              downloads, and imports in Chaptarr.
            </p>
            <p className="small muted">
              Bookseerr uses Chaptarr’s native Goodreads search, with Hardcover as an optional
              fallback. Configure a Hardcover token in Chaptarr if you use that provider. Check a
              real title in Chaptarr before enabling automatic requests.
            </p>
          </div>
          <div className="button-row">
            <button className="button primary" disabled={Boolean(busy) || status?.demo}>
              <Save size={17} />
              {busy === 'save'
                ? 'Saving and syncing complete inventories…'
                : 'Save connections & sync'}
            </button>
            <span className="small muted">
              <LockKeyhole size={14} /> Saved credentials are encrypted on disk.
            </span>
          </div>
        </form>
      ) : (
        <p className="muted">Loading connection settings…</p>
      )}
    </>
  );
}
