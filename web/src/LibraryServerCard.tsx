import { Trash2 } from 'lucide-react';
import type { LibraryServerConfig } from '../../shared/types';
import { libraryProviders } from '../../shared/libraries';

export type EditableLibraryServer = LibraryServerConfig & {
  passwordSet: boolean;
  apiKeySet: boolean;
};
export type LibraryCheck = {
  id: string;
  ok: boolean;
  error?: string;
  libraries?: { id: string; name: string }[];
};

export function LibraryServerCard({
  server,
  check,
  disabled,
  change,
  remove,
}: {
  server: EditableLibraryServer;
  check?: LibraryCheck;
  disabled: boolean;
  change: (id: string, key: keyof LibraryServerConfig, value: string) => void;
  remove: (id: string) => void;
}) {
  const provider = libraryProviders[server.provider];
  const field = (
    key: keyof Omit<LibraryServerConfig, 'id' | 'provider'>,
    label: string,
    placeholder = '',
    secret = false,
  ) => (
    <label className="field">
      {label}
      <input
        type={secret ? 'password' : 'text'}
        value={server[key]}
        disabled={disabled}
        autoComplete={secret ? 'new-password' : 'off'}
        placeholder={placeholder}
        onChange={(event) => change(server.id, key, event.target.value)}
      />
    </label>
  );
  return (
    <section className="panel settings-section" aria-labelledby={`library-server-${server.id}`}>
      <div className="section-title">
        <h3 id={`library-server-${server.id}`}>
          {server.name || provider} <span className="small muted">· {provider}</span>
        </h3>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          aria-label={`Remove ${server.name || provider}`}
          onClick={() => remove(server.id)}
        >
          <Trash2 size={15} /> Remove connection
        </button>
      </div>
      <div className="form-grid">
        {field('name', 'Connection name', 'Family ebooks')}
        {field(
          'url',
          'Internal URL',
          `http://${server.provider}:${server.provider === 'bookorbit' ? '3000' : server.provider === 'grimmory' ? '6060' : '80'}`,
        )}
        {field('publicUrl', 'Reader URL (optional)', 'https://books.example.com')}
        {server.provider === 'audiobookshelf' ? (
          field(
            'apiKey',
            'API token',
            server.apiKeySet ? 'Saved · leave blank to keep' : 'Audiobookshelf API token',
            true,
          )
        ) : (
          <>
            {field('username', 'Username')}
            {field(
              'password',
              'Password',
              server.passwordSet ? 'Saved · leave blank to keep' : `${provider} password`,
              true,
            )}
          </>
        )}
      </div>
      <p className="small muted">
        {server.provider === 'audiobookshelf'
          ? 'Use an API token for an account with access to these book libraries. Podcasts are excluded.'
          : `Use a ${provider} account with access to the libraries you want to include.`}{' '}
        After changing the internal URL or account, enter its credentials again.
      </p>
      {check?.libraries ? (
        <div className="library-choices">
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={disabled}
              checked={!server.libraryIds}
              onChange={(event) =>
                change(
                  server.id,
                  'libraryIds',
                  event.target.checked ? '' : check.libraries?.[0]?.id || '',
                )
              }
            />
            Include every accessible book library
          </label>
          <div className="button-row">
            {check.libraries.map((library) => (
              <label className="checkbox" key={library.id}>
                <input
                  type="checkbox"
                  disabled={disabled || !server.libraryIds}
                  checked={!server.libraryIds || server.libraryIds.split(',').includes(library.id)}
                  onChange={(event) => {
                    const selected = new Set(server.libraryIds.split(','));
                    if (event.target.checked) selected.add(library.id);
                    else selected.delete(library.id);
                    if (selected.size) change(server.id, 'libraryIds', [...selected].join(','));
                  }}
                />
                {library.name}
              </label>
            ))}
          </div>
        </div>
      ) : (
        field(
          'libraryIds',
          'Library selection (optional IDs)',
          'Leave blank for all; check connections to choose by name',
        )
      )}
      {check ? (
        <p className={`small ${check.ok ? 'green-text' : 'amber-text'}`} role="status">
          {check.ok ? 'Connection verified. Accessible libraries are shown above.' : check.error}
        </p>
      ) : null}
    </section>
  );
}
