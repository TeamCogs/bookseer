#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
scratch_dir="${BOOKSEERR_SWIFT_SCRATCH:-$repo_dir/ios/.local/SwiftBuild}"
fixture_file="$(mktemp "${TMPDIR:-/tmp}/bookseerr-api-contract.XXXXXX")"
trap 'rm -f "$fixture_file"' EXIT

cd "$repo_dir"
node --import tsx ios/scripts/export-api-contract.mjs > "$fixture_file"
if [[ "${BOOKSEERR_SWIFT_DISABLE_SANDBOX:-0}" == "1" ]]; then
  set -- --disable-sandbox
else
  set --
fi
BOOKSEERR_CONTRACT_FIXTURE="$fixture_file" \
CLANG_MODULE_CACHE_PATH="$scratch_dir/clang-module-cache" \
SWIFTPM_MODULECACHE_OVERRIDE="$scratch_dir/swift-module-cache" \
swift test --package-path ios/BookseerrCore \
  --scratch-path "$scratch_dir/build" \
  --cache-path "$scratch_dir/cache" \
  --config-path "$scratch_dir/config" \
  --security-path "$scratch_dir/security" \
  "$@"
