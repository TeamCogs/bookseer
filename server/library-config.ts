import type { LibraryServerConfig } from '../shared/types.js';
import type { ConnectionConfig } from './config.js';

export function normalizeConnections(
  value: ConnectionConfig,
): ConnectionConfig & { libraryServers: LibraryServerConfig[] } {
  const legacy: LibraryServerConfig = {
    id: 'bookorbit',
    provider: 'bookorbit',
    name: 'BookOrbit',
    url: value.bookorbitUrl,
    publicUrl: value.bookorbitPublicUrl,
    username: value.bookorbitUsername,
    password: value.bookorbitPassword,
    apiKey: '',
    libraryIds: value.bookorbitLibraryIds,
  };
  const libraryServers =
    value.libraryServers ??
    ([legacy.url, legacy.username, legacy.password].some(Boolean) ? [legacy] : []);
  const existing = libraryServers.find((server) => server.id === 'bookorbit');
  return {
    ...value,
    libraryServers,
    bookorbitUrl: existing?.url || '',
    bookorbitPublicUrl: existing?.publicUrl || '',
    bookorbitUsername: existing?.username || '',
    bookorbitPassword: existing?.password || '',
    bookorbitLibraryIds: existing?.libraryIds || '',
  };
}
