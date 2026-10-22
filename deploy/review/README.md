# Isolated public-domain review environment

This stack runs the regular Bookseerr backend with authentication, a persistent database and an optional operator-managed catalogue. It is separate from the unauthenticated local development demo. It does not simulate successful acquisition. Only the selected EPUB files are offered by the private source; online discovery and out-of-policy acquisition are blocked by the backend, including approvals and recovered queued requests. Connections cannot be edited through the API while the operator-managed catalogue is active. Native and web request controls reflect the allowed formats.

## Boundaries

- A dedicated Compose project, subnet and named volumes for Bookseerr, official Chaptarr, its source, downloader, VPN and BookOrbit/PostgreSQL. No personal databases, library folders or Docker socket are mounted.
- Two authenticated public-facing services: Bookseerr and its connected reader. All other services stay private, with no published source, Chaptarr, downloader, database or VPN-control ports.
- The source serves only the immutable catalogue's hash-verified assets. It cannot fetch arbitrary URLs or receive uploads. Its private torrents have no trackers, and the downloader must have DHT, peer exchange and local discovery disabled. Real transfers use the source's HTTP webseed over the private Docker network.
- A separate Surfshark tunnel protects all external downloader traffic. Use a different provider endpoint from any simultaneous tunnel sharing the same WireGuard key. Inspect the live endpoint and verify outage blocking before enabling downloads. The supplied guard allows ordinary-interface traffic only to the source and established local API replies; public traffic must go through WireGuard.
- Operator-managed catalogue files are configuration, not evidence that every book edition is public domain in every territory. Retain source URLs, edition details, hashes and a rights check for the selected regions.

## Prepare the source pack

```sh
node deploy/review/prepare.mjs /private/path/review-pack
```

This fetches four selected Gutenberg editions, verifies their Open Library work identities, and writes a manifest with checksums. Pride and Prejudice and Alice's Adventures in Wonderland are marked for initial import; Frankenstein and A Christmas Carol are reserved for the request flow. This first pack offers ebooks only. An audiobook must have its own verified recording rights and supported acquisition setup before it is added.

The source refuses to start on a checksum mismatch or unsafe asset name. The backend refuses to start with a missing, empty or invalid configured catalogue; it never falls back to unrestricted discovery. `BOOKSEERR_CATALOGUE_FILE` is optional and unset for ordinary existing servers.

## Deployment sequence

1. Inspect Docker/storage availability, free ports, existing subnets and available memory. Record existing service images, running state and configuration hashes. Choose a new project directory. Do not attach this project to personal library or VPN volumes.
2. Copy `.env.example` to a private environment file and generate unique secrets. Supply approved image digests, the reviewed source revision, private source-pack paths and public app/reader URLs. Use distinct review-only reader and administrator credentials. Keep VPN credentials out of application containers and Git.
3. Validate `docker compose --env-file /private/path/runtime.env -f deploy/review/compose.yaml config --quiet`. If changing the default subnet or source IP, update the guard file consistently before starting anything.
4. Initialize only the new project's volumes. Chaptarr's API key goes in its own configuration. Initialize a new downloader password, disable DHT/PeX/local discovery and set its only categories to this review stack's download paths. Use an ordinary authenticated BookOrbit setup with its own database and bootstrap token.
5. Start the source and VPN. Verify the VPN endpoint differs from any simultaneous tunnel sharing its key; verify tunnel egress and failure blocking. Then start the downloader, database, reader and Chaptarr. Configure one ebook root, explicit ebook profiles, one Torznab indexer pointing at the source and one downloader. Leave other authors, new books and audiobook monitoring disabled.
6. Create the dedicated reader library over the review media volume. Import only the two preloaded approved assets. Verify real library inventory. Save the resulting profile and library identifiers in the private environment file, then start Bookseerr.
7. Create normal reader and administrator review accounts. Add DNS and HTTPS routes for only the two new hosts; validate and back up the existing proxy configuration first. Keep Chaptarr and its source private.
8. Exercise reader login, search, missing-format request, administrator approval, native Chaptarr search, actual transfer, import, reader detection and Bookseerr's final available status. Verify the imported file checksum. Test duplicate prevention, unlisted requests, disallowed formats, source path traversal, restart persistence and public access from outside the home network.
9. Save a private deployment receipt, generated account credentials, rights records, build revision and test results. Ensure existing services and their configuration hashes are unchanged. Close temporary administrator access. Follow [the TestFlight guide](../../ios/TESTFLIGHT.md) only after this live verification is complete.

Validate source boundaries independently with `python3 -m unittest discover -s deploy/review -p 'test_*.py'`. A rendered page, an accepted request or a running container is not a completed acquisition test. No live deployment or Apple signing is implied by these source files alone.

## Maintenance and recovery

Keep this deployment available for review, re-review and updates. Back up the new database, its encryption key, connection settings and source manifest together. Copy credentials only into private App Store Connect review fields. Do not expose the development demo, reuse personal passwords or silently replace a failed live acquisition with simulated success.

After a review completes, schedule the operator's review-data cleanup within the privacy policy's retention period. A reset must target only the named review project and its recorded volumes, after checking that no review is active. Never use a blanket Docker prune or delete personal library files. Do not reset shared review accounts during an active review.
