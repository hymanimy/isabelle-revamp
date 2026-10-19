#!/usr/bin/env python3
"""Start the bundled MCP server with a private, lazily installed environment.

Only runs when a client explicitly starts the registered MCP command. Dependency
installation writes to stderr; stdout remains exclusively MCP JSON-RPC.
"""
import os
from pathlib import Path
import subprocess
import sys
import time
import venv


def main():
    if sys.version_info < (3, 11):
        raise RuntimeError('The Isabelle MCP server needs Python 3.11 or newer.')
    root = Path(__file__).resolve().parent
    environment = root / '.venv'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    ready = environment / '.isabelle-ready'
    lock = root / '.setup-lock'
    if not ready.exists():
        deadline = time.monotonic() + 300
        while True:
            try:
                lock.mkdir()
                break
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f'MCP setup is still locked at {lock}. Close other MCP clients before removing a stale lock.')
                time.sleep(0.2)
        try:
            if not ready.exists():
                # A repository development environment may already be installed.
                installed = python.exists() and subprocess.run(
                    [str(python), '-c', "from importlib.metadata import version; assert version('fastmcp') == '4.1.0'"],
                    stdout=sys.stderr, stderr=subprocess.DEVNULL).returncode == 0
                if not installed:
                    print('Isabelle MCP: installing the private Python environment (first use only)…', file=sys.stderr)
                    venv.EnvBuilder(with_pip=True).create(environment)
                    subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                                    '-r', str(root / 'requirements.txt')], check=True, stdout=sys.stderr)
                ready.touch()
        finally:
            lock.rmdir()
    os.execv(str(python), [str(python), str(root / 'server.py'), *sys.argv[1:]])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Isabelle MCP: {error}', file=sys.stderr)
        sys.exit(1)
