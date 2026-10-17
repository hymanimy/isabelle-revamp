#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run compile --prefix extension
node extension/test/setup.cjs
node extension/test/ask.cjs
npm run package --prefix extension
(cd extension && npx vsce ls)
python3 - <<'PY'
import json
from pathlib import Path
from zipfile import ZipFile
package = json.loads(Path('extension/package.json').read_text())
file = Path('dist') / f"isabelle-revamp-{package['version']}.vsix"
assert file.stat().st_size < 5_000_000
with ZipFile(file) as archive:
    names = archive.namelist()
    assert not any('/node_modules/' in name or '/src/' in name or '/test/' in name or '/.dev-host/' in name for name in names)
    assert set(name for name in names if name.endswith('.js')) == {'extension/out/extension.js', 'extension/media/proofGraph.js'}
    for name in ['mcp/server.py', 'mcp/requirements.txt', 'mcp/launch.py', 'media/icon.png', 'out/symbolCodes.json']:
        assert 'extension/' + name in names, name
    manifest = json.loads(archive.read('extension/package.json'))
    assert manifest['engines']['vscode'] == '^' + package['devDependencies']['@types/vscode']
    assert manifest['publisher'] == 'hymanimy' and manifest['license'] == 'MIT'
print(f'PASS: {file} — {file.stat().st_size:,} bytes; host and offline webview bundles, no runtime node_modules')
PY
