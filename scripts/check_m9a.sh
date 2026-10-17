#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run compile --prefix extension
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/m9a-port"
exec "${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}" \
 --user-data-dir "$PWD/.dev-host/m9a-test-user" --extensions-dir "$PWD/.dev-host/extensions" \
 --disable-extensions --skip-welcome --skip-release-notes \
 --extensionDevelopmentPath="$PWD/extension" --extensionTestsPath="$PWD/extension/test/m9a.cjs" "$PWD"
