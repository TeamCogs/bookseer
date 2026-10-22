# Bookseerr working instructions

- Docker and NAS deployments are the primary product. Avoid vendor-specific paths, credentials, or network assumptions in source, fixtures, screenshots, and documentation.
- Integrate with official Chaptarr/chaptarr through its HTTP API. Keep upstream acquisition, import, and library-management responsibilities upstream.
- BookOrbit, Grimmory, and Audiobookshelf integrations read inventory and covers. Do not modify book metadata or files through these integrations.
- Availability must distinguish ebooks and audiobooks, physical files and monitored records, uncertainty and confirmed ownership, and complete and failed/stale syncs.
- Failed or partial inventory reads must never erase previously verified inventory or present missing evidence as proof that a book is absent.
- Ambiguous matches need a persistent, explainable user confirmation. Request dispatch must recheck availability and be idempotent.
- Keep secrets, user databases, real inventory exports, environment files, and local operational evidence out of Git.
- Validate core matching behavior, HTTP integration contracts, request safety, and production build. Document live verification limits honestly.
- Scott / TeamCogs is the sole commit author and maintainer. Do not add co-author trailers, collaborators, bot-authored commits, or auto-merge automation.
