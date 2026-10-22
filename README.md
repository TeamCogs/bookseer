# Bookseerr

[![Verify Bookseerr](https://github.com/TeamCogs/bookseerr/actions/workflows/ci.yml/badge.svg)](https://github.com/TeamCogs/bookseerr/actions/workflows/ci.yml)

**Your books. Everyone's next read.**

A self-hosted book discovery and request portal for Docker and NAS deployments. Connect [BookOrbit](https://github.com/bookorbit/bookorbit), [Grimmory](https://github.com/grimmory-tools/grimmory), or [Audiobookshelf](https://github.com/advplyr/audiobookshelf) with official [Chaptarr](https://github.com/Chaptarr/chaptarr), see what you already own, and request the formats you're missing.

![Bookseerr reading room with sample books and a reader account](docs/images/reading-room.jpg)

## What it does

- **Your whole connected library**, including books acquired outside Bookseerr. Library results appear before online discovery results.
- **Multiple library servers.** Mix BookOrbit, Grimmory, and Audiobookshelf, including several servers of the same type. Each connection has its own name, library selection, credentials, and sync status.
- **Clear ebook and audiobook ownership.** Existing files, monitored records, stale inventories, and uncertain matches are distinguished.
- **One book, every copy.** Duplicates share one entry with all formats and source locations. Review differently named copies, save a preferred title, and undo grouping without deleting files.
- **Multiple readers.** Administrator and reader accounts, approval controls, rolling request limits, shared requests, password management, and personal notifications.
- **Official Chaptarr acquisition.** Separate destination and profile settings for each format, queue tracking, and no required fork.
- **Persistent identity review.** Filename normalization, validated identifiers, and administrator-confirmed matches. Parts and collections aren't automatically treated as the whole book.
- **A small Docker deployment.** One application container and a persistent SQLite volume. No extra database, media mount, or Docker socket.

## Run on your NAS

```sh
git clone https://github.com/TeamCogs/bookseerr.git
cd bookseerr
umask 077
cp .env.example .env
```

Generate **two different** private values with `openssl rand -hex 24` and `openssl rand -hex 32`. Set `BOOKSEERR_ADMIN_PASSWORD` and `BOOKSEERR_SESSION_SECRET` in `.env`, then:

```sh
docker compose up -d
```

Open `http://YOUR-NAS-ADDRESS:5057`, sign in as `admin`, connect your existing services in **Connections**, and create reader accounts in **Users**. If Node.js is installed, `node scripts/setup.mjs` can generate the private environment file for you instead.

Docker Compose is the primary deployment method. The same setup applies to Synology, QNAP, TrueNAS releases with Docker support, Unraid, UGREEN, Portainer, and Linux hosts. The container targets x86-64 and ARM64. Platform-specific instructions, networking, permissions, HTTPS, updates, and backups are in [the deployment guide](docs/deployment.md).

The public image is `ghcr.io/teamcogs/bookseerr:latest`, with x86-64 and ARM64 variants. Use `docker compose up -d --build` to build the checked-out source. Portainer users can use [the standalone stack file](deploy/portainer-compose.yaml), which does not require a local environment file.

## How it fits

Bookseerr handles discovery, ownership, users, approvals, and request tracking. Chaptarr handles indexers, downloads, and imports. Your connected BookOrbit, Grimmory, and Audiobookshelf servers supply inventory and remain the readers. Bookseerr reads their inventory and covers without editing metadata or library files. Existing BookOrbit settings migrate automatically, preserving saved copy identities and reviews.

Successful complete inventory snapshots establish availability. A failed or partial sync preserves the previous snapshot and cannot prove a book is absent. Uncertain submissions require review rather than automatic replay. [Read the architecture](docs/architecture.md).

Add servers in **Connections → Library servers**. BookOrbit and Grimmory use a username and password; Audiobookshelf uses an API token. You can select libraries by name after checking the connections. For example, connect Grimmory for ebooks and Audiobookshelf for audio, with both formats shown under one book. Chaptarr's import destinations must be included in the relevant server's watched or regularly scanned library folders.

## Status and validation

This is an actively developed independent project. Automated tests cover account boundaries, request safety, matching, grouping, persistence, and upstream HTTP contracts. CI builds and runs the hardened production container on x86-64 and ARM64. A live Docker deployment has verified existing BookOrbit ownership and a public-domain ebook request through official Chaptarr, qBittorrent, automatic import, and BookOrbit inventory. The download used a labelled test source rather than a public tracker search result. See the [live verification record and limits](docs/validation.md), and check the workflow for the revision you deploy.

Grimmory, Audiobookshelf, and multiple-server behavior have automated HTTP contract coverage; live download/import verification with those two servers remains pending. See [implemented features and verification scope](docs/features.md). Bookseerr does not claim all Seerr features: external notification delivery, SSO, reading sync, ebook conversion, and indexer management are not implemented.

![Duplicate ebook copies grouped under one title](docs/images/duplicate-copies.jpg)

For an isolated public-domain review deployment, see [the review stack](deploy/review/README.md). For signed iOS archives and Apple review preparation, see [the TestFlight guide](ios/TESTFLIGHT.md).

## Development

### iOS companion

The [native iOS app](ios/README.md) supports iOS 18 and later, with book search, owned formats, requests, in-app notifications, and multiple server profiles. Each server can have several ordered addresses, automatically preferring a reachable home address and falling back to public HTTPS. Open `ios/Bookseerr.xcodeproj` in Xcode, or explore the built-in sample library without a server. See the [iOS guide](ios/README.md) for signing, connection setup, and verification limits.

### Web and server

Use Node.js 24 and the pinned pnpm version through Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
node scripts/setup.mjs
pnpm dev
```

The development interface is at `http://127.0.0.1:5173`; its API proxy uses port 5057. Run `pnpm check` for type checking, behavioral tests, and a production build. To explore an isolated sample library without touching any services, run `pnpm build` and `pnpm demo`, then visit `http://127.0.0.1:5058`. The demo uses in-memory sample accounts and sends no acquisition requests. Never expose demo mode publicly.

## Maintainer and license

Maintained by [Scott / TeamCogs](https://github.com/TeamCogs). Code contributions are currently owner-only; bug reports and suggestions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

[MIT](LICENSE). Bookseerr is an independent application and is not affiliated with or endorsed by Chaptarr, BookOrbit, Grimmory, Audiobookshelf, or Seerr. Upstream projects and Open Library retain their respective names, licenses, and data policies.
