# How Bookseer works

Bookseer is a self-hosted discovery, availability, and request portal. Official [Chaptarr](https://github.com/Chaptarr/chaptarr) manages acquisition and imports. [BookOrbit](https://github.com/bookorbit/bookorbit) supplies existing inventory and reader links. Bookseer is an independent application, not a fork or an official part of either project.

```mermaid
flowchart LR
  Readers[Household readers] --> Bookseer[Bookseer: accounts, search, requests]
  Bookseer --> Catalogue[Open Library metadata]
  BookOrbit[BookOrbit inventory] --> Bookseer
  Chaptarr[Official Chaptarr inventory and queue] --> Bookseer
  Bookseer -->|Approved missing format| Chaptarr
  Chaptarr --> Clients[Existing indexers and download clients]
  Clients --> Files[Existing library files]
  Files --> BookOrbit
```

## Accounts and permissions

The first run creates one administrator from the private environment file. Administrators create local reader accounts, choose automatic or manual approval, set a rolling seven-day request limit, disable users, reset passwords, manage connections, review matching decisions, and undo saved duplicate groups. Readers search the same shared library, request missing formats, follow existing requests, see their own followed requests and notifications, and change their password. Joining a shared request does not consume another request allocation. Administrators see all requests. Search exposes the existence of an existing request without exposing its requester or follower list.

Public registration is closed. Users cannot change their own role, quota, approval policy, or connection settings. Administrators cannot demote or disable their own account. Password changes, password resets, permission changes, and account disabling revoke prior sessions. There is no default public password.

## Availability and matching

Ebooks and audiobooks are independent. A monitored Chaptarr record is not a file. BookOrbit records marked missing are not available copies. A full recent inventory must support a negative ownership result before Bookseer sends an acquisition request.

Chaptarr may create an author's unmonitored catalogue during a single-book add. Bookseer reads the complete response but excludes catalogue-only records with no files and no active monitoring. Existing files remain included even if their Chaptarr monitoring is disabled. Actively tracked books without files remain visible with unavailable format badges.

Matching checks normalized title and author, validated ISBNs, and provider work identities. Filename prefixes such as `Author, First - Series 03 - Title.epub` are normalized for display and matching. Parts, volumes, and collections are kept distinct. Related or conflicting metadata requires an administrator's persistent identity decision. Confirming identity does not invent a missing file. Dismissing a possible match applies only to the reviewed item, not future copies.

Each source commits its inventory as one SQLite transaction after all pages have been validated. Repeated IDs, changing totals, missing pages, inaccessible selected libraries, malformed responses, and authentication failures retain the previous snapshot. A failed or expired source cannot prove absence. Previously seen copies remain visible with unverified availability. Startup requires a fresh source check before trusting a previous snapshot.

BookOrbit uses zero-based pages of at most 100 records. Chaptarr's general book endpoint explicitly includes authors. These details are covered by adapter contract tests; assumptions here caused real integration failures during development.

## Duplicate grouping

Matching titles and authors share one library card across formats and sources. Compatible records with the same provider work identity also share one card when subtitles or expanded author names differ. Unknown authors and conflicting identities are not automatically merged. Each card retains all underlying format records and source links. Parts, volumes, and collections stay separate. Administrators can select differently named entries, confirm that they represent the same complete work, choose a preferred title, and save a group. Saved groups persist and can be undone. Grouping never deletes files or changes upstream metadata.

## Request lifecycle

```text
requested by a reader -> pending approval -> approved / waiting for setup
                     -> submitting -> requested -> downloading -> importing -> available
                     -> declined or cancelled before acquisition
                     -> needs review if identity, network outcome, or import is uncertain
```

A unique database constraint coalesces concurrent requests for the same catalogue work and medium. Approved requests are processed in the background with a visible inventory-checking state. Complete connected inventories are refreshed before acquisition, then every remote write checks availability again. The browser can leave the page while verification proceeds. Cancellation during checking prevents submission. Chaptarr lookup must resolve a unique compatible work. Existing local instances are reused. Only the requested medium is submitted, with separate destination and profile settings. New authors do not automatically monitor their entire catalogue.

Requests made from a connected-library card and an online result with the same complete normalized title and author, or a compatible resolved work identity, join the same format request. This identity check runs inside the database transaction, before applying a new-request quota. Both views show the same request and following state. Incomplete identities, parts, volumes, and different authors remain separate. Chaptarr's validated canonical work aliases persist in Bookseer's catalogue through later discovery refreshes so an imported edition can fulfill the original request despite a subtitle difference.

An empty metadata lookup is retried with persistent backoff before any add is attempted. Six unsuccessful retries eventually require review. A Chaptarr `202` response with a valid pending-operation ID is saved and followed through read-only lookups for up to six hours. Once its local instance exists, Bookseer reuses it and sends the format's search command without repeating the add. An HTTP timeout during submission, unexpected response, unresolved pending operation, or restart during an uncertain write moves the request to review. An administrator must check Chaptarr before reopening it. Cancellation remains available during metadata and inventory checks; active acquisition is managed in Chaptarr. Readers can stop following a shared request without cancelling it for others. A previously fulfilled request can acquire the format again if a fresh complete inventory confirms its files are now missing; each new acquisition still counts toward the requester's limit.

## Runtime and data

The production container serves the React interface and Fastify API from one origin and stores SQLite in `/data`. No Redis, external database, Docker socket, media mount, or privileged container is required. One instance should own one data volume. Do not run replicas against the same SQLite database. Place the database volume on local storage with reliable locking, not an SMB or NFS mount.

Passwords use salted scrypt hashes. Session cookies are opaque and HTTP-only; session tokens are hashed in the database. Writes require CSRF tokens and same-origin checks. Connection credentials saved in the interface use authenticated encryption with the private installation key. Request logging omits credentials and search contents. Cover access is authenticated and bounded. Only administrators can configure upstream service URLs.

Search queries go to Open Library. BookOrbit login and inventory requests go to the configured BookOrbit server. Chaptarr receives work identifiers and approved acquisition requests. Bookseer does not run downloads or change your download clients' routing. Configure VPN isolation and import paths in the acquisition stack itself.
