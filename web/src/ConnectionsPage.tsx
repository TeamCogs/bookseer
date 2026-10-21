import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, LockKeyhole, PlugZap, Save } from 'lucide-react';
import type { AppStatus } from '../../shared/types';
import type { ConnectionConfig } from '../../server/config';
import { api, message, time } from './api';

type Connections = ConnectionConfig & { bookorbitPasswordSet: boolean; chaptarrApiKeySet: boolean };
type Choice = { id: number; name: string; type?: string | number };
type Checks = {
  bookorbit: { ok: boolean; error?: string; libraries?: Choice[] };
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
    return result;
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
      setValue({
        ...value,
        bookorbitPassword: '',
        chaptarrApiKey: '',
        bookorbitPasswordSet: Boolean(value.bookorbitPassword) || value.bookorbitPasswordSet,
        chaptarrApiKeySet: Boolean(value.chaptarrApiKey) || value.chaptarrApiKeySet,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  function change(key: keyof ConnectionConfig, next: string | number) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    if (
      [
        'bookorbitUrl',
        'bookorbitUsername',
        'bookorbitPassword',
        'chaptarrUrl',
        'chaptarrApiKey',
      ].includes(key)
    )
      setChecks(undefined);
  }
  const field = (key: keyof ConnectionConfig, label: string, placeholder = '', secret = false) => (
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
              <h3>{source.source === 'bookorbit' ? 'BookOrbit' : 'Official Chaptarr'}</h3>
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
          <div className="panel settings-section">
            <div className="section-title">
              <h2>BookOrbit</h2>
              <span className="pill success">Read-only inventory</span>
            </div>
            <p className="muted">
              Include the libraries you already own. Bookseer reads records and covers without
              changing your books.
            </p>
            <div className="form-grid">
              {field('bookorbitUrl', 'Internal URL', 'http://bookorbit:3000')}
              {field('bookorbitPublicUrl', 'Reader URL', 'https://books.example.com')}
              {field('bookorbitUsername', 'Username')}
              {field(
                'bookorbitPassword',
                'Password',
                value.bookorbitPasswordSet ? 'Saved · leave blank to keep' : 'BookOrbit password',
                true,
              )}
            </div>
            {checks?.bookorbit.libraries ? (
              <div className="library-choices">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!value.bookorbitLibraryIds}
                    onChange={(e) =>
                      change(
                        'bookorbitLibraryIds',
                        e.target.checked ? '' : String(checks.bookorbit.libraries?.[0]?.id || ''),
                      )
                    }
                  />
                  Include every accessible book library
                </label>
                <div className="button-row">
                  {checks.bookorbit.libraries.map((library) => (
                    <label className="checkbox" key={library.id}>
                      <input
                        type="checkbox"
                        disabled={!value.bookorbitLibraryIds}
                        checked={
                          !value.bookorbitLibraryIds ||
                          value.bookorbitLibraryIds.split(',').includes(String(library.id))
                        }
                        onChange={(e) => {
                          const selected = new Set(value.bookorbitLibraryIds.split(','));
                          if (e.target.checked) selected.add(String(library.id));
                          else selected.delete(String(library.id));
                          if (selected.size) change('bookorbitLibraryIds', [...selected].join(','));
                        }}
                      />
                      {library.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              field(
                'bookorbitLibraryIds',
                'Library selection (optional IDs)',
                'Leave blank for all; check the connection to choose by name',
              )
            )}
            {checks ? (
              <p className={`small ${checks.bookorbit.ok ? 'green-text' : 'amber-text'}`}>
                {checks.bookorbit.ok
                  ? 'Connection verified. Accessible libraries are shown above.'
                  : checks.bookorbit.error}
              </p>
            ) : null}
          </div>
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
              Enable Chaptarr’s Hardcover provider and set its API token there for new-title search.
              Check a real title in Chaptarr before enabling automatic requests.
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
