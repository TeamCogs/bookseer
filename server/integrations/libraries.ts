import type { LibraryServerConfig } from '../../shared/types.js';
import { librarySource } from '../../shared/libraries.js';
import type { ConnectionConfig } from '../config.js';
import { BookOrbit } from './bookorbit.js';
import { Grimmory } from './grimmory.js';
import { Audiobookshelf } from './audiobookshelf.js';
import type { LibraryAdapter } from './library.js';

export function libraryAdapter(
  server: LibraryServerConfig,
  connections: ConnectionConfig,
): LibraryAdapter {
  if (server.provider === 'grimmory') return new Grimmory(server);
  if (server.provider === 'audiobookshelf') return new Audiobookshelf(server);
  return new BookOrbit(
    {
      ...connections,
      bookorbitUrl: server.url,
      bookorbitPublicUrl: server.publicUrl,
      bookorbitUsername: server.username,
      bookorbitPassword: server.password,
      bookorbitLibraryIds: server.libraryIds,
    },
    librarySource(server),
    server.name,
  );
}
