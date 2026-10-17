#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run compile --prefix extension
node extension/test/ask.cjs
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/m13-port"
exec "${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}" \
  --user-data-dir "$PWD/.dev-host/m13-test-user" --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --extensionDevelopmentPath="$PWD/extension" --extensionTestsPath="$PWD/extension/test/m13.cjs" "$PWD"
