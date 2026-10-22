# Bookseerr privacy policy

Effective October 22, 2026.

Bookseerr is an independent, self-hosted library and request application maintained by TeamCogs. This policy covers the iOS app and the project's review service. Operators of other Bookseerr servers control their own services and should provide their own privacy information.

## Data sent to your server

The iOS app sends your username and password to the Bookseerr addresses you explicitly configure when you sign in. Passwords are not stored by the app. An authenticated session is stored in this device's Keychain. Saved server names and addresses are stored in app preferences. Requests can include search terms, library records, book requests, approval decisions, and notification state. Your server stores account and activity records necessary to provide these features.

Every address in a server profile must belong to the same trusted server. The app can send that profile's session to any of its configured addresses. Public connections require HTTPS; local connections may use HTTP on your own network. The app does not access Wi-Fi network names or your location.

## Third parties

There are no advertising SDKs, advertising identifiers, tracking cookies, or analytics SDKs in the iOS app. Bookseerr does not sell personal data. The app communicates with your configured server and may retrieve catalogue artwork from its indicated source. Credentials are not attached to external artwork requests. Opening a connected reader uses that reader's service and privacy policy.

The server operator configures library and acquisition services. Normal online discovery sends search terms to Open Library. A curated server can use a local catalogue without online discovery. Approved acquisition requests are sent to the operator's configured Chaptarr service and its metadata providers, download sources, and downloader. These services have their own policies.

## Review service

The project's isolated review service contains a limited catalogue of public-domain ebooks. Its operator can access reviewer account names, searches received by the service, requests, approval decisions, and security or operational logs. The service does not require an email address, a real personal name, payment information, or access to a user's personal library. Review accounts are shared test identities; do not enter personal or confidential information. Review records are kept while needed for testing and review, normally no longer than 90 days after the relevant review is complete, except where longer retention is necessary for security or legal obligations.

## Retention and control

Sign out to revoke the current session on a reachable server. You can also remove a saved server and its session from the device. Removing local information does not delete server records. A session that cannot be revoked because its server is offline remains subject to that server's expiration policy.

Accounts are created and managed by the administrator of your chosen server. Contact that administrator to request access, correction, or deletion of server-side account and activity data. Retention and backups on self-hosted servers are controlled by their operators. Bookseerr's maintainers cannot access or delete records on independently operated servers.

For questions about the iOS app or the project's review service, use [Bookseerr support](https://github.com/TeamCogs/bookseerr/issues). Do not post passwords, session tokens, private library records, or other sensitive information in public issues. Ask for a private contact method when needed.

Material changes will be reflected in this document and in the policy available inside the app.
