# Docker and NAS deployment

Use a maintained Docker Engine and Docker Compose installation on an x86-64 or ARM64 NAS/server. The repository includes native container checks for both architectures. Vendor instructions below describe installation approaches; passing container checks does not certify every NAS model or operating-system release.

## First installation

```sh
git clone https://github.com/TeamCogs/bookseerr.git
cd bookseerr
```

Create a private environment file. If Node.js is available, `node scripts/setup.mjs` generates independent random credentials and refuses to overwrite an existing configuration. Otherwise:

```sh
umask 077
cp .env.example .env
openssl rand -hex 24
openssl rand -hex 32
```

Put the first generated value in `BOOKSEERR_ADMIN_PASSWORD` and the second in `BOOKSEERR_SESSION_SECRET`. Keep `.env` private. Start the application:

```sh
docker compose up -d
docker compose ps
```

Open `http://YOUR-NAS-ADDRESS:5057`. Sign in as `admin` with the password from your environment file. **Users → Add user** creates household reader accounts. **Connections** configures your BookOrbit, Grimmory, Audiobookshelf, and official Chaptarr servers. The administrator environment password bootstraps an empty database; changing that value does not reset an existing account. Use the account interface or administrator reset controls to change existing passwords.

The default Compose file pulls the public multi-platform image without a container-registry login. Anonymous pulls and both CPU architectures have been verified. Set `BOOKSEERR_IMAGE_TAG=sha-COMMIT` for a published revision tag, or use `docker compose up -d --build` to build the checked-out source. Check the workflow for the revision being deployed.

## Networking

Server-to-server addresses must be reachable **from the Bookseerr container**. `localhost` inside a container refers to that container. Use an existing service's LAN address and published port, or join its Docker network:

```sh
BOOKSEERR_BOOKS_NETWORK=books docker compose \
  -f compose.yaml -f deploy/compose.network.yaml up -d --build
```

The optional network must already exist. Use service names such as `http://bookorbit:3000` or `http://chaptarr:8789` only when they resolve on that network. Set each library server's reader URL and the Chaptarr browser URL separately so links open at addresses your readers can reach. Bookseerr does not need access to media folders or download paths.

Port `5057` is published on the NAS's interfaces by default. Set `BOOKSEERR_BIND_ADDRESS=127.0.0.1` when a reverse proxy on the same host is the only intended entry point. Change `BOOKSEERR_PORT` if the port is already used. For an HTTPS reverse proxy, set the full external origin in `BOOKSEERR_PUBLIC_URL` and `BOOKSEERR_SECURE_COOKIES=true`. Forward the original Host header. Bookseerr expects to run at `/`, rather than under a subpath. Tailscale or another private access path is suitable for a household deployment.

## NAS platforms

| Platform                 | Installation approach                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Synology                 | Container Manager project using the repository folder and Compose file; keep the named data volume on local storage.                 |
| QNAP                     | Container Station application/Compose import, with the same environment variables and local persistent volume.                       |
| TrueNAS                  | A release that supports Docker Compose/custom containers; use local dataset storage for `/data` and map port 5057.                   |
| Unraid                   | Docker Compose Manager, or build the image then create a container with the listed variables and `/data` volume.                     |
| Portainer                | Use `deploy/portainer-compose.yaml` in the standalone Docker stack editor and supply the private variables in the stack environment. |
| UGREEN, Linux, other NAS | Standard Docker Compose. No vendor-specific paths or APIs are required.                                                              |

The container runs as UID/GID `1000:1000`. The default named volume initializes with appropriate ownership. For a bind mount, create a dedicated app-data directory owned by the configured container user. An optional Compose `user: "UID:GID"` override works with this image if that user can write `/data`. Bookseerr does not interpret `PUID` or `PGID` variables. Do not make app data world-writable to work around permissions.

## Library servers

In **Connections → Library servers**, select BookOrbit, Grimmory, or Audiobookshelf and click **Add library server**. Give the connection a recognizable name, such as “Family ebooks” or “Audiobooks.” Up to 20 library servers are supported, including several of the same type. All Bookseerr readers share the combined inventory exposed by these upstream accounts; this does not import upstream users or their individual permissions.

| Server         | Credentials                                  | Inventory behavior                                                                                                                                                 |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BookOrbit      | Username and password                        | Accessible book libraries, ebook and audiobook files, missing-file status, covers.                                                                                 |
| Grimmory       | Username and password for a local account    | Accessible libraries, primary and alternate file formats, covers; physical books and supplementary files are excluded. Selected library paths must report healthy. |
| Audiobookshelf | API token for an account with library access | Book libraries, full ebook/audio file details, missing and invalid records, covers; podcasts are excluded.                                                         |

Use an internal URL reachable from Bookseerr and an optional reader URL reachable by your readers. Reverse-proxy subpaths on upstream servers are preserved. Select **Check connections & load choices** to choose libraries by name. Leave library IDs blank to read every accessible book library, or select a subset. Missing or inaccessible selected libraries fail that server's full snapshot rather than quietly shrinking it.

Select **Save connections & sync** to store settings and read complete inventories. Each server has its own health and last successful sync. A failed read retains the previous snapshot. Ownership can be established by any fresh server; a negative ownership result requires every configured source to be fresh. Finish configuring or remove any incomplete connection before enabling requests. Removing a connection only forgets its cached inventory in Bookseerr; upstream metadata and files are untouched. Enter credentials again when changing an internal URL or account; saved secrets are not automatically sent to a different server.

Existing `BOOKORBIT_*` environment settings and saved single-BookOrbit connections carry forward automatically. Their copy IDs, identity reviews, and groups stay intact. Once connection settings are saved in Bookseerr, the saved server list takes precedence over initial environment configuration. Manage additional servers in Connections; no media mounts or new environment variables are required.

Configure Chaptarr's import destinations within the appropriate server's library folders, and enable that server's watcher or scheduled scans. Bookseerr reads inventory and covers; it does not trigger scans or edit books. Verify one imported ebook and audiobook in the chosen reader before relying on the complete flow.

## Official Chaptarr

Configure its internal URL and API key, then a root folder, quality profile, and metadata profile for each requested format. Zero profile IDs leave that format's acquisition disabled. Configure indexers, download clients, routing, permissions, and imports in Chaptarr itself. Bookseerr does not install a fork or duplicate acquisition logic. Test one permitted book request before granting automatic approval to readers.

Bookseerr ranks saved book identities, matching ISBNs, and source work IDs ahead of title-and-author matches. A subtitle is accepted when the main title and complete author agree, while summaries, collections, and conflicting volumes remain separate. Among otherwise equivalent provider matches, Goodreads precedes Hardcover to stay consistent with Chaptarr's native import catalogue; popularity never decides identity. Ties within a provider need an administrator's **Review book match** selection. Choices persist for that book, format, and Chaptarr connection and are revalidated before dispatch. Hardcover is optional and requires its provider and API token configured **in Chaptarr**. A validated native preview can enter Chaptarr's asynchronous metadata-preparation pipeline; Bookseerr follows the accepted operation without repeating the add. Bookseerr's Connections test confirms API access and available profiles, so also verify a real title search in Chaptarr during setup.

## Update and rollback

```sh
docker compose stop bookseerr
# Make the cold backup described below, then update the source.
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Pin a reviewed Git tag or commit for repeatable installations. Retain a pre-update backup of the database and private configuration. To roll back, restore that backup and run its corresponding source revision. Avoid running an older application against a database changed by a newer release.

## Updating from the original spelling

The project is now **Bookseerr**, at `https://github.com/TeamCogs/bookseerr`, and the public image is `ghcr.io/teamcogs/bookseerr:latest`. If you installed an earlier revision under the name **Bookseer**, stop its container and make a cold backup before updating. Keep the same data volume and encryption key.

1. In the old checkout, stop the service with `docker compose stop bookseer`. Find its existing volume with `docker inspect "$(docker compose ps -aq bookseer)" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}'`. For a bind mount, retain its original host directory instead.
2. Update the remote with `git remote set-url origin https://github.com/TeamCogs/bookseerr.git`, then `git pull --ff-only`.
3. In the private environment file, change the `BOOKSEER_` variable prefix to `BOOKSEERR_`, preserving every value. Set `BOOKSEERR_DATA_VOLUME` to the exact old volume name from step 1. The new default is `bookseerr_data`; using a different empty volume would create a new installation. For Portainer, make the equivalent changes in the stack's environment.
4. Start with `docker compose up -d` and verify your existing users, library, requests, and saved connections before removing the stopped old container. Sign in again; the session cookie has the corrected name.

The server accepts the original environment prefix as a fallback, with corrected variables taking precedence. Fresh installations use `bookseerr.sqlite`; an existing `bookseer.sqlite` is opened in place, including its journal, so saved data survives without moving live SQLite files. Original private data directories remain excluded from Git and Docker build contexts. The old `ghcr.io/teamcogs/bookseer` package has been removed. Use `ghcr.io/teamcogs/bookseerr` for installations and updates; existing deployments must use this image before recreating their containers.

## Backup and restore

Back up **both** the private `.env` (especially the encryption key) and the entire `/data` volume. For a consistent cold backup, stop Bookseerr before copying it. A live SQLite database can have active WAL files; copying only `bookseerr.sqlite` while it is running is not a reliable backup. NAS snapshot tools may be used while the container is stopped.

Restore the whole data directory to a local volume with the correct ownership, restore the same encryption key, and start the matching application version. Verify administrator login, users, requests, saved groups, and a fresh source sync. Backups contain personal accounts, inventory, and encrypted service credentials: protect them and keep them out of public issue attachments.

## Troubleshooting

- **No library books:** check Connections and complete a sync. Online search is not a full-library import.
- **Unavailable or stale:** the previous inventory is retained, but a source has failed or exceeded the freshness limit. Fix it and sync again.
- **Cannot request a book:** check the format's availability, possible identity matches, user limit, approval state, and Chaptarr configuration.
- **Needs review after submission:** check Chaptarr for the existing or pending work before reopening the request. Automatic replay is deliberately disabled.
- **Download complete but import blocked:** the request shows Chaptarr's actual import rejection. Resolve the identity and import the existing file using Chaptarr's manual import. Reopening checks the existing queue and does not send a second search while that download is present. Availability still requires a verified library file; completion in the download client alone is insufficient.
- **Books appear twice:** inspect authors and title differences. Use Manage duplicates to save a reviewed group; parts and collections stay separate automatically.
- **Cannot decrypt saved connections:** restore the original `BOOKSEERR_SESSION_SECRET`. It must persist with the database.
- **Container cannot write `/data`:** fix volume ownership. Read-only root storage is expected; `/data` must be writable.

Use `docker compose logs --tail=100 bookseerr` for service startup errors. Do not post private configuration or database files when requesting help.
