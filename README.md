# Bookseer

A self-hosted book discovery and request portal for Docker and NAS deployments. Connect official [Chaptarr](https://github.com/Chaptarr/chaptarr) for acquisition and [BookOrbit](https://github.com/bookorbit/bookorbit) for your existing reading library.

**Early development.** The first release focuses on a dependable answer to “Do I already have this book?” before adding a request. Availability belongs on every search result, with ebook and audiobook formats shown separately and uncertain matches explained.

## Project goals

- Search your complete connected library and a public discovery catalogue in one place.
- Show available files, request progress, source, and a link to read an existing copy.
- Keep persistent, user-confirmed identity matches when provider metadata is incomplete.
- Use official Chaptarr APIs rather than require a Chaptarr fork.
- Run in one container with SQLite persistence, with Linux amd64 and arm64 support.
- Work across Synology, QNAP, TrueNAS, Unraid, UGREEN, and other Docker-capable NAS hosts through ordinary Docker Compose. Platform-specific validation will be documented rather than assumed.

## Development status

The implementation, tests, Docker deployment, and setup documentation are being built in this repository. This is not yet a production release. No compatibility or end-to-end acquisition claims are made until backed by tests.

## Maintainer

Bookseer is maintained by [Scott / TeamCogs](https://github.com/TeamCogs). Code contributions are currently owner-only; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Bookseer is an independent application and is not affiliated with or endorsed by Chaptarr, BookOrbit, or Seerr.

