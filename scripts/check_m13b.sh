#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash -n scripts/demo-env.sh
python3 scripts/check_demo_env.py
# Real CLI/package installation, wholly inside the ignored test directory.
bash scripts/demo-env.sh --directory "$PWD/.dev-host/demo-install-check" --vsix "$PWD/dist/isabelle-revamp-0.1.0.vsix"
