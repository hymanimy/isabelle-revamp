#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Use the app executable, not the `code` launcher: wait for the test exit code.
code_executable="${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
npm run compile --prefix extension
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/m3-port"
exec "$code_executable" \
  --user-data-dir "$PWD/.dev-host/m3-test-user" \
  --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$PWD/extension" \
  --extensionTestsPath="$PWD/extension/test/m3.cjs" \
  "$PWD"
