#!/bin/bash
# Build and export a signed IPA; never submit a version or invite external testers.
set -euo pipefail
cd "$(dirname "$0")/../.."
task_team_id="${1:-${BOOKSEERR_DEVELOPMENT_TEAM:-}}"
task_build_number="${BOOKSEERR_BUILD_NUMBER:-2}"
if [[ ! "$task_team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo 'Pass the existing paid Apple developer Team ID (10 letters/numbers). Sign in to that account in Xcode first.' >&2
  exit 2
fi
if [[ ! "$task_build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo 'BOOKSEERR_BUILD_NUMBER must be a positive integer unused in App Store Connect.' >&2
  exit 2
fi
task_output="$PWD/ios/.local/TestFlight"
mkdir -p "$task_output"
python3 - "$task_output/ExportOptions.plist" "$task_team_id" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as output:
    plistlib.dump({'method': 'app-store-connect', 'destination': 'export',
                  'teamID': sys.argv[2], 'signingStyle': 'automatic',
                  'manageAppVersionAndBuildNumber': False, 'uploadSymbols': True}, output)
PY
xcodebuild -project ios/Bookseerr.xcodeproj -scheme Bookseerr \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$task_output/Bookseerr.xcarchive" \
  -derivedDataPath ios/.local/ArchiveDerivedData \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$task_team_id" \
  CURRENT_PROJECT_VERSION="$task_build_number" archive
xcodebuild -exportArchive -archivePath "$task_output/Bookseerr.xcarchive" \
  -exportPath "$task_output/Export" -exportOptionsPlist "$task_output/ExportOptions.plist" \
  -allowProvisioningUpdates
echo "Signed archive and exported IPA are in $task_output"
