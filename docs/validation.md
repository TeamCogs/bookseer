# Live verification record

## Docker deployment, 2026-10-21

The application code at `24173e2e12b25f4535d444465bbeb363a3857649` was deployed on an x86-64 Linux NAS with Docker Compose, official Chaptarr `0.9.965.0`, an existing BookOrbit library, Prowlarr, and qBittorrent. Private credentials, inventory exports, screenshots of real libraries, and operational reports remain outside this repository.

| Boundary                 | Observed result                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing inventory       | Both connected sources completed full inventory reads; books acquired outside Bookseerr appeared in the library.                                                                                                                                                                         |
| Ownership and duplicates | Existing ebook copies appeared under one title, with separate audiobook availability and both source links retained. A duplicate request for an owned ebook returned HTTP 409 without creating another request.                                                                          |
| Metadata                 | Chaptarr's configured Hardcover provider returned the requested title and author.                                                                                                                                                                                                        |
| Request dispatch         | A real Bookseerr request resolved the canonical work and created one monitored ebook in official Chaptarr. Other author titles and the audiobook format were not monitored by this request.                                                                                              |
| Download                 | Chaptarr's native book search grabbed the labelled public-domain test torrent and sent it to a dedicated qBittorrent category. The torrent completed.                                                                                                                                    |
| Import                   | Chaptarr automatically imported the EPUB into its configured ebook root. BookOrbit detected the file in its watched managed library.                                                                                                                                                     |
| Completion               | A fresh Bookseerr sync marked the original request available.                                                                                                                                                                                                                            |
| Reader                   | The imported EPUB opened in BookOrbit in a regular browser, with its cover and readable book text confirmed.                                                                                                                                                                             |
| Identity review          | BookOrbit shortened the imported author's name. After both records were verified to reference the same file, a reversible saved group combined the two application records.                                                                                                              |
| Persistence              | Administrator login, the request, the saved duplicate group, and Chaptarr's Hardcover configuration survived application restarts.                                                                                                                                                       |
| VPN isolation            | Both new applications used the VPN exit address. During an authenticated tunnel outage, their outbound requests failed, their local interfaces remained reachable, and packet-header inspection found no prohibited direct egress. The tunnel and fresh DNS lookups recovered afterward. |

The test book was [The Yellow Wallpaper, Project Gutenberg number 1952](https://www.gutenberg.org/ebooks/1952), which its source identifies as public domain in the United States. A temporary loopback Torznab endpoint supplied one explicitly labelled torrent with a Gutenberg HTTP webseed. It was removed after the test. Chaptarr handled search, the grab, and import through its normal APIs and downloader integration; no files were inserted into its database to simulate success.

Chaptarr rejected the first test labels under its title/author matching checks. Its torrent parser did not use the separate author attribute. A release label retaining the full author, an EPUB marker, and the complete title passed its native matching checks. Matching settings were not relaxed.

The outage test exposed an existing gateway rule that its reconnect parser could not process. Equivalent egress restrictions were expressed in a dedicated guard chain, then the outage and fresh DNS recovery checks passed. This was a deployment configuration correction; Bookseerr does not install or manage a VPN gateway.

## Scope and limits

- This verifies one controlled ebook acquisition and import. It does not demonstrate that a public tracker will supply a particular title or edition.
- Audiobook destinations, profiles, downloader categories, and API compatibility were configured and checked. A live audiobook download and import has not been recorded here.
- Native container CI runs on x86-64 and ARM64; this live NAS deployment was x86-64. It does not certify every NAS model or operating system.
- Automatic grouping requires compatible identity evidence. Different or incomplete metadata can require an administrator's saved confirmation. Grouping does not delete files or rewrite upstream metadata.
- HTTP contract tests and successful API additions are separate evidence from this live download/import test. Check the CI run associated with the version being deployed.
