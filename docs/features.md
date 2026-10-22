# Feature and verification scope

The product structure takes inspiration from the everyday flows documented by [Seerr](https://docs.seerr.dev/): multiple local users, restricted administration, shared requests, approvals, request limits, library-aware discovery, progress, and notifications. Bookseerr implements these flows independently for books.

| Area          | Implemented behavior                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts      | Local sign-in; admin-created users; admin/reader roles; disable users; reset and change passwords; session revocation.                                                                                                                |
| Permissions   | Connections, user management, source syncing, and identity/group review require administrator access at the API.                                                                                                                      |
| Discovery     | External weekly trends; topic and keyword browsing; language and first-publication-date filters; trending, most-shelved, rating, and recent-publication sorts. Direct search retains library-first results and ebook/audio ownership. |
| Full library  | Selected libraries across multiple BookOrbit, Grimmory, and Audiobookshelf servers plus owned or monitored Chaptarr records, with server-side search and pagination.                                                                  |
| Dedupe        | One entry per normalized title and author; all formats/copies retained; duplicate-only filter; reviewed preferred-title groups with undo.                                                                                             |
| Identity      | Validated ISBNs and provider IDs; filename normalization; part/volume/collection checks; persistent confirmations and dismissals.                                                                                                     |
| Requests      | Shared work/format requests; follow existing requests; manual or automatic approval; rolling seven-day user limits; pre-dispatch cancellation and rejection; reviewed reopening.                                                      |
| Progress      | Requested, downloading, importing, available, and review states derived from Chaptarr and synced inventory.                                                                                                                           |
| Notifications | Persistent in-app notifications scoped to the affected user; independent read states.                                                                                                                                                 |
| Operations    | Persistent encrypted connection settings, atomic snapshots, source health, stale-state handling, Docker health check, non-root container, multi-architecture container checks, backup/restore guidance.                               |

This repository does **not** claim feature parity with Seerr. OIDC/SSO, public registration, user import from media servers, email/push/Discord notification delivery, reading-progress sync, ebook conversion, indexer management, and file deletion are outside the current implemented feature set. The connected library servers remain the readers and Chaptarr remains the acquisition engine. Web access at a URL is not proof that every acquisition/import path works on a particular installation.

## Discovery browsing

The web and iOS Discover screens open an external book catalogue rather than a selection from the connected inventory. The default uses [Open Library’s weekly trending chart](https://openlibrary.org/trending/weekly). Choosing a topic, keywords, language, publication period, or another sort queries the [Open Library Search API](https://openlibrary.org/dev/docs/api/search) across its catalogue, with 24 titles per page. Filtered trending uses Open Library’s search trending score, which differs from the unfiltered weekly chart. Top-rated browsing requires at least ten ratings; most-shelved sorting uses Open Library reading-log counts. Publication filters use a work’s first publication year, not a recent reprint’s date. Open Library’s coverage and community activity shape these lists; they are not a claim about worldwide sales charts.

The same provider lists appear for every reader. Browsing filters are temporary screen state, with no preference profile or personalized recommendation engine. Each result still checks the connected inventory and existing requests. Opening a discovered title uses the existing format-specific request and identity-review flow. The Library tab remains the collection browser; typing a direct title, author, or ISBN search still returns local matches independently of online availability.

Online responses are coalesced and cached for 15 minutes, with shared upstream pacing for search and browsing. During an outage, a previously fetched list under 24 hours old can be shown with an explicit warning. Without one, Discover reports the outage and offers retry; it does not substitute the owned library. Sample mode browses its separate local catalogue and never calls public discovery endpoints. Its lists are labelled as sample rather than live trends.

## Multiple library servers

Connections can include up to 20 named servers in any combination, including several of the same type. Each has independent credentials, library selection, atomic inventory snapshots, freshness, cover routing, and reader links. Matching copies share a card while retaining their source names and formats. Existing single-BookOrbit settings migrate without changing saved copy identities. Removing one connection only removes that connection's cached inventory.

## Evidence

Automated tests exercise matching, duplicate grouping and undo, persisted decisions, permissions, CSRF and origin checks, session revocation, quotas, request concurrency, uncertain add responses, and complete versus partial inventory snapshots. Container checks build and run the production image with its read-only root, non-root user, persistent volume, and reader account restrictions on x86-64 and ARM64 runners.

Live BookOrbit inventory and ownership were exercised against a large library. The Chaptarr adapter also has HTTP contract tests and an optional compatibility workflow using a disposable official Chaptarr container. A separate live Docker deployment verified a permitted ebook request, native Chaptarr search against a labelled Gutenberg test source, qBittorrent download, automatic import, BookOrbit detection, and Bookseerr completion. This establishes the recorded ebook path, rather than public tracker discovery or every audiobook workflow. See the [verification record](validation.md) and CI for the revision you deploy.

Grimmory and Audiobookshelf have automated tests against their upstream HTTP response contracts, including missing/invalid files, selected libraries, path health, incomplete reads, independent servers, credentials, old-settings migration, and request rechecks. Live download/import and reading on those two servers remain unverified.
