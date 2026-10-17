#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
isabelle_executable="${ISABELLE_EXECUTABLE:-$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle}"
"$isabelle_executable" process_theories -D examples -O Sqrt2
npm run compile --prefix extension
node extension/test/proofGraph.cjs
node extension/test/graphReplay.cjs
node extension/test/ask.cjs
mkdir -p .dev-host/graph-test-bin
ln -sf "$PWD/extension/test/fakeClaude.cjs" .dev-host/graph-test-bin/claude
export PATH="$PWD/.dev-host/graph-test-bin:$PATH"
export M8_SCENARIO=preflight-stop
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/graph-demo-port"
exec "${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}" \
  --user-data-dir "$PWD/.dev-host/graph-demo-test-user" --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --extensionDevelopmentPath="$PWD/extension" --extensionTestsPath="$PWD/extension/test/graphDemo.cjs" "$PWD"
