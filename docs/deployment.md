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

Open `http://YOUR-NAS-ADDRESS:5057`. Sign in as `admin` with the password from your environment file. **Users → Add user** creates household reader accounts. **Connections** configures your existing BookOrbit and official Chaptarr servers. The administrator environment password bootstraps an empty database; changing that value does not reset an existing account. Use the account interface or administrator reset controls to change existing passwords.

The default Compose file pulls the public multi-platform image without a container-registry login. Anonymous pulls and both CPU architectures have been verified. Set `BOOKSEERR_IMAGE_TAG=sha-COMMIT` for a published revision tag, or use `docker compose up -d --build` to build the checked-out source. Check the workflow for the revision being deployed.

## Networking

Server-to-server addresses must be reachable **from the Bookseerr container**. `localhost` inside a container refers to that container. Use an existing service's LAN address and published port, or join its Docker network:

```sh
BOOKSEERR_BOOKS_NETWORK=books docker compose \
  -f compose.yaml -f deploy/compose.network.yaml up -d --build
```

The optional network must already exist. Use service names such as `http://bookorbit:3000` or `http://chaptarr:8789` only when they resolve on that network. Set the BookOrbit reader URL and Chaptarr browser URL separately so links open at addresses your readers can reach. Bookseerr does not need access to media folders or download paths.

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

## BookOrbit

Configure a dedicated account with access to the intended libraries and covers. Leave library IDs blank to read all accessible book libraries, or enter a comma-separated selection. Bookseerr reads records and cover images; the integration never changes metadata, scans, or files. Missing or inaccessible selected libraries fail the full snapshot rather than quietly shrinking it.

## Official Chaptarr

Configure its internal URL and API key, then a root folder, quality profile, and metadata profile for each requested format. Zero profile IDs leave that format's acquisition disabled. Configure indexers, download clients, routing, permissions, and imports in Chaptarr itself. Bookseerr does not install a fork or duplicate acquisition logic. Test one permitted book request before granting automatic approval to readers.

Bookseerr first tries a canonical work lookup, then Chaptarr's native Goodreads search and its configured Hardcover search when needed. Native search must resolve one matching title and author with provider-owned identities; unrelated or ambiguous results are blocked. Hardcover is optional and requires its provider and API token configured **in Chaptarr**. A validated native preview can enter Chaptarr's asynchronous metadata-preparation pipeline; Bookseerr follows the accepted operation without repeating the add. Bookseerr's Connections test confirms API access and available profiles, so also verify a real title search in Chaptarr during setup.

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
- **Books appear twice:** inspect authors and title differences. Use Manage duplicates to save a reviewed group; parts and collections stay separate automatically.
- **Cannot decrypt saved connections:** restore the original `BOOKSEERR_SESSION_SECRET`. It must persist with the database.
- **Container cannot write `/data`:** fix volume ownership. Read-only root storage is expected; `/data` must be writable.

Use `docker compose logs --tail=100 bookseerr` for service startup errors. Do not post private configuration or database files when requesting help.
