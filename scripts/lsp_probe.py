#!/usr/bin/env python3
"""M1: print Isabelle's LSP traffic and the sqrt-2 theorem's goal.

Uses only Python's standard library. Positions are zero-based; the default
caret is on the theorem statement in the completed M4 example. Isabelle can
still display that command's goal when the rest of its proof is complete.
"""

import argparse
import asyncio
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shlex
import signal
import sys


ROOT = Path(__file__).resolve().parents[1]


class OutputText(HTMLParser):
    """Read Isabelle's preformatted output as text, without rendering HTML."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")


def plain_text(html):
    parser = OutputText()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


async def send(process, method, params=None, request_id=None):
    message = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        message["params"] = params
    if request_id is not None:
        message["id"] = request_id
    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    print("--> " + body.decode("utf-8"), flush=True)
    process.stdin.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
    await process.stdin.drain()


async def receive(process):
    header = await process.stdout.readuntil(b"\r\n\r\n")
    fields = dict(line.split(b":", 1) for line in header.strip().split(b"\r\n"))
    size = int(fields[b"Content-Length"].strip())
    message = json.loads(await process.stdout.readexactly(size))
    print("<-- " + json.dumps(message, ensure_ascii=False), flush=True)
    return message


async def response(process, request_id):
    while True:
        message = await receive(process)
        if message.get("id") == request_id:
            if "error" in message:
                raise RuntimeError(message["error"])
            return message["result"]


async def probe(process, args, path, source):
    await send(process, "initialize", {
        "processId": os.getpid(),
        "rootUri": ROOT.as_uri(),
        "capabilities": {},
        "clientInfo": {"name": "isabelle-revamp-lsp-probe", "version": "0.1"},
    }, request_id=1)
    await response(process, 1)
    await send(process, "initialized", {})
    await send(process, "textDocument/didOpen", {"textDocument": {
        "uri": path.as_uri(), "languageId": "isabelle", "version": 1,
        "text": source,
    }})
    await send(process, "PIDE/caret_update", {
        "uri": path.as_uri(), "line": args.line, "character": args.character,
    })
    while True:
        message = await receive(process)
        if message.get("method") == "PIDE/dynamic_output":
            content = message["params"]["content"]
            text = content if args.server_plaintext else plain_text(content)
            print("\n--- Goal state (plain text) ---\n" + text + "\n", flush=True)
            if "goal (1 subgoal):" in text and "sqrt 2 ∉ ℚ" in text:
                print("PASS: printed the sqrt 2 goal as plain text.", flush=True)
                return


async def run(args):
    path = args.file.expanduser().resolve()
    source = path.read_text(encoding="utf-8")
    html = "false" if args.server_plaintext else "true"
    command = [args.isabelle, "vscode_server", "-n", "-l", "HOL",
               "-o", f"vscode_html_output={html}", "-o", "editor_output_state=true"]
    print("Starting: " + shlex.join(command), flush=True)
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        await asyncio.wait_for(probe(process, args, path, source), args.timeout)
    finally:
        # Drain and print notifications during shutdown too. Never leave a prover
        # running after the foreground probe has finished or failed.
        try:
            if process.returncode is None:
                await send(process, "shutdown", request_id=2)
                await asyncio.wait_for(response(process, 2), 10)
                await send(process, "exit")
                await asyncio.wait_for(process.wait(), 10)
        finally:
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except TimeoutError:
                    os.killpg(process.pid, signal.SIGKILL)
                    await process.wait()
    if process.returncode != 0:
        raise RuntimeError(f"Server exited with code {process.returncode}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--isabelle", default="isabelle", help="Isabelle executable")
    parser.add_argument("--file", type=Path, default=ROOT / "examples/Sqrt2.thy")
    parser.add_argument("--line", type=int, default=6, help="Zero-based caret line (default: 6)")
    parser.add_argument("--character", type=int, default=4, help="Zero-based caret column (default: 4)")
    parser.add_argument("--timeout", type=float, default=90, help="Startup and goal timeout in seconds")
    parser.add_argument("--server-plaintext", action="store_true",
                        help="Reproduce the Isabelle2025-2 plaintext serialization bug")
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except (OSError, RuntimeError, TimeoutError, asyncio.IncompleteReadError) as error:
        print(f"FAIL: {str(error) or 'timed out waiting for the goal state'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
