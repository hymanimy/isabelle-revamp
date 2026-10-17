#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
isabelle_executable="${ISABELLE_EXECUTABLE:-$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle}"
"$isabelle_executable" process_theories -D examples -O Cascade_solution
npm run compile --prefix extension
node extension/test/proofGraph.cjs
node extension/test/ask.cjs
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/m12-port"
exec "${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}" \
  --user-data-dir "$PWD/.dev-host/m12-test-user" --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --extensionDevelopmentPath="$PWD/extension" --extensionTestsPath="$PWD/extension/test/m12.cjs" "$PWD"
