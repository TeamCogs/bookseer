# Bookseerr for iOS

A native SwiftUI companion for your self-hosted Bookseerr server. Requires iOS 18 or later; includes iPhone and iPad layouts. The existing Docker application remains the server.

## Open and run

Open `Bookseerr.xcodeproj` in Xcode, choose the **Bookseerr** scheme and an iPhone simulator, and press Run. No third-party Swift dependencies are needed.

Choose **Take a look around** for an isolated sample reading room. Requests in sample mode stay in memory and never reach acquisition services. Alternatively, enable `-demo` in the scheme’s Run arguments; it is disabled by default.

To install on an iPhone, select your development team under **Signing & Capabilities**, connect the device, select it as the destination, and run. Device signing, TestFlight, and App Store distribution are separate from the unsigned simulator build.

## Connect at home and away

Choose **Connect your server**, give the server a name, and add locations in preference order. For example:

| Location        | Example address                                 |
| --------------- | ----------------------------------------------- |
| Home, preferred | `http://books.local:5057`                       |
| Public          | `https://books.example.com`                     |
| Optional backup | Another address for the same Bookseerr instance |

Use **Edit** to reorder locations. Add as many as needed. All addresses in one profile must reach the **same Bookseerr instance and database**; use another server profile for a different instance. Each profile has a separate Keychain session.

The client probes `/api/health` in order, with a short timeout for the preferred address, then uses the first reachable location. It rechecks preference on network updates, when the app returns to the foreground, and after the route’s 30-second cache expires. Failed reads can try each other saved location once. SSID access and location permission are unnecessary. The **You** tab shows the current address and lets you recheck it manually.

Writes are never automatically repeated after a connection failure. The app asks you to check Requests before sending another request because the first operation might already have reached the server. The server also retains its own idempotence and availability checks.

Public addresses require HTTPS. Local HTTP addresses are supported through Apple’s [local-network ATS exception](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking). If the server marks its session cookie `Secure`, authenticated traffic uses HTTPS locations, including an HTTPS local location if supplied. Certificates are validated normally. Reverse proxies must forward the API and session cookies; an additional proxy sign-in page requires a compatible authentication setup.

## Included

- Discover: library-first search by title, author, or ISBN, plus online catalogue results.
- Library: format filters, grouped copies, pagination, pull to refresh, and authenticated covers.
- Book details: separate ebook and audiobook ownership, actual file presence, monitored records, stale inventories, and possible matches. Requests require confirmed absence; unknown or stale inventory does not enable them.
- Requests: submit or follow a shared request, inspect acquisition status, and stop following. Authorized administrators can approve, decline, or reopen requests; cancellation controls follow the server’s restrictions.
- Match review: administrators can explicitly confirm or dismiss possible matches through the server’s persistent review API.
- Account: multiple server profiles and locations, source health, administrator inventory checks, and in-app notifications.
- Privacy: no password storage, per-profile sessions in device-only Keychain, no shared cookie jar, no credentials on external artwork requests, and no arbitrary redirects. Server changes reset navigation and in-memory covers. The privacy manifest declares app-only preferences using Apple’s [UserDefaults reason](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype).

Library administration and user management remain available through the linked web app. Notifications refresh while the app is active; this version does not register for push notifications. Reading opens the connected reader’s own link. Offline downloads and an embedded ebook or audiobook reader are not included.

## Check the app

After installing the root project’s Node dependencies:

```sh
bash ios/scripts/check.sh
xcodebuild -project ios/Bookseerr.xcodeproj -scheme Bookseerr \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/.local/DerivedData CODE_SIGNING_ALLOWED=NO build
```

Run these commands from the repository root. The check script runs native routing and request-safety tests and generates synthetic responses from the real backend using Fastify injection. It opens no listening socket, uses an in-memory database, and sends no upstream requests. Native code must continue to decode the backend’s actual session, search, library, request, status, and notification responses.

Core-only tests can run directly with `swift test --package-path ios/BookseerrCore`; the cross-language contract test skips unless its generated fixture is supplied. `BOOKSEERR_SWIFT_DISABLE_SANDBOX=1` is available for hosts that already sandbox build processes and cannot run SwiftPM’s nested sandbox. The CI workflow runs the full contract check and an unsigned native build on macOS.

The app icon is source generated: run `swift ios/scripts/generate-icon.swift` from the repository root to regenerate it.

## Verification record

Local verification on October 22, 2026:

- Native build and launch on the iPhone 17 simulator, using Xcode 27.1 and iOS 27.0.
- Core tests cover home preference, public failover, returning home after a network change, three-location failover, session and CSRF continuity, authentication expiry, secure-cookie transport, artwork credential isolation, no mutation replay, uncertain/stale availability, and actual backend response decoding.
- Simulator interaction checks exercised search, book details, isolated request creation, disabled duplicate submission, and the server location editor.
- Existing application checks passed: type checking, 61 behavioral tests, and the production web/server build.

Live cellular-to-home switching against a deployed server, physical-device signing, and real request acquisition through the native app have not been verified. The GitHub workflow is added but has not been run remotely. Local operational screenshots and build products stay under ignored `.local/`.
