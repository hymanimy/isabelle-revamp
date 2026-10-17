#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

code_executable="${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
npm run compile --prefix extension
test_user="$PWD/.dev-host/agent-edits-user"
mkdir -p "$test_user/User"
cat > "$test_user/User/settings.json" <<'JSON'
{"security.workspace.trust.enabled":false,"update.mode":"none","extensions.autoUpdate":false,"workbench.tips.enabled":false,"chat.disableAIFeatures":true,"isabelleRevamp.showAsk":false}
JSON
export ISABELLE_REVAMP_PORT_FILE="$PWD/.dev-host/agent-edits-port"
exec "$code_executable" \
  --user-data-dir "$test_user" --extensions-dir "$PWD/.dev-host/extensions" \
  --disable-extensions --skip-welcome --skip-release-notes \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --extensionDevelopmentPath="$PWD/extension" \
  --extensionTestsPath="$PWD/extension/test/agentEdits.cjs" "$PWD"
