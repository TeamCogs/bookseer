# TestFlight preparation

Use the maintainer's existing paid Apple Developer membership. Bookseerr has a separate App Store Connect app record and explicit bundle ID, `com.teamcogs.bookseerr`. Do not reuse another product's app record, bundle ID, provisioning profile, credentials, or customer data.

## Signing and build

Sign in under Xcode → Settings → Apple Accounts. Select the existing paid developer team for the Bookseerr target. The Team ID is an identifier, not a password. It must be verified from that account; the repository does not assume a particular team.

Run the backend checks, `bash ios/scripts/check.sh`, and a native simulator build. Test on a physical iPhone before external submission, including login/logout, background/foreground, local/public routing and request progress. Verify both iPhone and iPad layouts because this target supports both.

Create a signed Release archive and export an IPA:

```sh
BOOKSEERR_BUILD_NUMBER=2 bash ios/scripts/archive-testflight.sh YOURTEAMID
```

Use a new build number for every upload. The archive, export options, signatures, and IPA remain under ignored `ios/.local/TestFlight/`. The script allows Xcode to manage signing for the selected team. It does not upload a build, submit an app for review, invite testers, or publish a release.

In App Store Connect, create the iOS app record, matching bundle ID, app name, primary language and a distinct SKU. Upload the signed build using Xcode Organizer or Transporter. Complete encryption/export-compliance questions based on the actual build. The app uses normal HTTPS and system Keychain, and currently declares no non-exempt encryption.

## Live review environment

Use an ordinary authenticated deployment of the shipping backend and app, with the optional operator-managed catalogue policy. The normal “Take a look around” sample mode is explicitly simulated and does not replace the live acquisition test. See [the isolated review stack](../deploy/review/README.md).

Keep the app and reader HTTPS endpoints working through review and subsequent updates. Confirm the public privacy policy at `/privacy.html` and support link are accessible without signing in. Use a reader account and an administrator account with distinct generated review-only passwords. The administrator can approve requests, but the server's catalogue and connections are managed by the operator. Review credentials belong only in private operational records and App Store Connect's review fields.

Review notes should identify all services involved, including the upstream metadata provider, Chaptarr and its restricted Torznab source, the VPN-protected downloader, and the connected reader. Explain that acquisition runs on the server. The selected source offers ebooks only; the app must show unavailable request formats rather than simulate successful audiobook acquisition. Do not claim completed acquisition based on a request merely being accepted.

## Notes for Apple, to fill from verified deployment evidence

> Bookseerr is a native client for an independently hosted book library and request server. Users configure their own server addresses and sign in with accounts provided by that server's administrator.
>
> For review, tap Connect your server, enter the public review URL below, and use the supplied reader credentials. The second address can be left empty. The separate administrator credentials exercise approvals. Both accounts access the same isolated server.
>
> The review environment offers four explicitly selected public-domain EPUB editions. Two are initially in the library; the other titles can be requested. Acquisition is performed on the server by official Chaptarr through a restricted source, a VPN-protected downloader, and automatic import into the connected reader. The source offers ebooks only. The native app does not contain a torrent client or an embedded reader.
>
> Please search for an initially missing title, request the ebook as the reader, sign in as the administrator to approve it, and refresh Requests and Library after import. Open an available title in the linked reader using the separately supplied reader credentials. Requests already completed by another reviewer will show as owned; use another initially missing title if available.
>
> The separately labelled sample mode contains simulated data and never sends downloads. It is available to all users for exploring the interface. The live review account uses the regular application features.

Add the real URLs, both account credentials, connected-reader credentials, tested titles, typical measured completion time, rights/source URLs and any limitations only after the deployed workflow passes. Keep a small test catalogue refresh procedure for later reviews; never reset reviewer sessions or records during an active review.

## Privacy and listing metadata

The policy is in [docs/privacy.md](../docs/privacy.md), included in the server's public build, and summarized inside the app before and after sign-in. Complete App Store Connect's privacy disclosures from actual retention and access practices. Do not automatically select “Data Not Collected”: developer-operated review accounts retain account identifiers and request/approval activity. Data on independently operated servers is controlled by their operators. There are no advertising or analytics SDKs in this build.

Set the support URL, privacy URL, age rating, description, screenshots, review contact, beta description and “What to Test” instructions. Bookseerr requires an existing server and account; state that requirement in the description. Avoid claims of unrestricted free access to copyrighted books. The selected editions are identified by Gutenberg as public domain in the United States; check territorial rights before selecting distribution regions. The server policy and source restriction do not guarantee Apple's acceptance of acquisition features.

Start with internal TestFlight testing. The first external TestFlight build goes through beta App Review; public App Store distribution is a separate submission. Do not select “TestFlight Internal Only” on a build intended to progress to external testing.

Sources: [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/), [review information](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Gutenberg permissions](https://www.gutenberg.org/policy/permission.html).
