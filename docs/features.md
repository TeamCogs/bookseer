# Feature and verification scope

The product structure takes inspiration from the everyday flows documented by [Seerr](https://docs.seerr.dev/): multiple local users, restricted administration, shared requests, approvals, request limits, library-aware discovery, progress, and notifications. Bookseerr implements these flows independently for books.

| Area          | Implemented behavior                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts      | Local sign-in; admin-created users; admin/reader roles; disable users; reset and change passwords; session revocation.                                                                                  |
| Permissions   | Connections, user management, source syncing, and identity/group review require administrator access at the API.                                                                                        |
| Discovery     | Open Library search; local library results first; clear separate ebook/audio availability; existing-request indicators.                                                                                 |
| Full library  | All accessible/selected BookOrbit book libraries plus owned or monitored Chaptarr records, with server-side search and pagination.                                                                      |
| Dedupe        | One entry per normalized title and author; all formats/copies retained; duplicate-only filter; reviewed preferred-title groups with undo.                                                               |
| Identity      | Validated ISBNs and provider IDs; filename normalization; part/volume/collection checks; persistent confirmations and dismissals.                                                                       |
| Requests      | Shared work/format requests; follow existing requests; manual or automatic approval; rolling seven-day user limits; pre-dispatch cancellation and rejection; reviewed reopening.                        |
| Progress      | Requested, downloading, importing, available, and review states derived from Chaptarr and synced inventory.                                                                                             |
| Notifications | Persistent in-app notifications scoped to the affected user; independent read states.                                                                                                                   |
| Operations    | Persistent encrypted connection settings, atomic snapshots, source health, stale-state handling, Docker health check, non-root container, multi-architecture container checks, backup/restore guidance. |

This repository does **not** claim feature parity with Seerr. OIDC/SSO, public registration, user import from media servers, email/push/Discord notification delivery, reading-progress sync, ebook conversion, indexer management, and file deletion are outside the current implemented feature set. BookOrbit remains the reader and Chaptarr remains the acquisition engine. Web access at a URL is not proof that every acquisition/import path works on a particular installation.

## Evidence

Automated tests exercise matching, duplicate grouping and undo, persisted decisions, permissions, CSRF and origin checks, session revocation, quotas, request concurrency, uncertain add responses, and complete versus partial inventory snapshots. Container checks build and run the production image with its read-only root, non-root user, persistent volume, and reader account restrictions on x86-64 and ARM64 runners.

Live BookOrbit inventory and ownership were exercised during development against a large library. The Chaptarr adapter has HTTP contract tests and an optional compatibility workflow using a disposable official Chaptarr container with no indexers or download clients. Native Goodreads search, canonical work lookup, and a format-scoped book add were exercised against that real API without a Hardcover account. The workflow also checks file presence and monitoring scope. A verified live end-to-end download/import with actual configured clients must be recorded separately; native API acceptance and mocked responses are not that evidence. See the CI run for a particular revision before assuming its checks passed.
