#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

code_executable="${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
isabelle_executable="${ISABELLE_EXECUTABLE:-$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle}"
"$isabelle_executable" process_theories -D examples -O Swarm_solution
npm run compile --prefix extension
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/m7-port"
exec "$code_executable" \
  --user-data-dir "$PWD/.dev-host/m7-test-user" \
  --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$PWD/extension" \
  --extensionTestsPath="$PWD/extension/test/m7.cjs" \
  "$PWD"
