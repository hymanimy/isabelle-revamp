#!/usr/bin/env python3
"""Seven MCP tools, one named connection per client to the VS Code extension."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_context


class Bridge:
    def __init__(self, port_file: Path):
        self.port_file = port_file
        self.reader = None
        self.writer = None
        self.lock = asyncio.Lock()
        self.sequence = 0

    async def connect(self):
        try:
            info = json.loads(self.port_file.read_text())
            port, token = info['port'], info['token']
            if type(port) is not int or not 1 <= port <= 65535 or not isinstance(token, str):
                raise ValueError('Invalid discovery file')
            async with asyncio.timeout(5):
                self.reader, self.writer = await asyncio.open_connection('127.0.0.1', port, limit=2 * 1024 * 1024)
                self.writer.write((json.dumps({'token': token}) + '\n').encode())
                await self.writer.drain()
                reply = json.loads(await self.reader.readline())
                if reply.get('error'):
                    raise RuntimeError(reply['error'])
                if reply != {'ok': True}:
                    raise RuntimeError('Unexpected bridge handshake')
        except Exception as error:
            await self.close()
            raise RuntimeError(f'Cannot connect to Isabelle: {error}. Open a theory in the extension and check {self.port_file}.') from error

    async def close(self):
        if self.writer:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except OSError:
                pass
        self.writer = None
        self.reader = None

    async def request(self, method, **params):
        async with self.lock:
            if not self.writer or not self.reader:
                raise ToolError('The bridge is disconnected. Restart this MCP server; edits are never retried automatically.')
            self.sequence += 1
            client = get_context().session.client_params
            name = client.client_info.name if client else 'MCP agent'
            request = {'id': self.sequence, 'method': method, 'params': params, 'client_name': name}
            body = (json.dumps(request, ensure_ascii=False) + '\n').encode()
            if len(body) > 2 * 1024 * 1024:
                raise ToolError('Request exceeds the 2 MiB limit.')
            try:
                async with asyncio.timeout(35):
                    self.writer.write(body)
                    await self.writer.drain()
                    line = await self.reader.readline()
                    if not line:
                        raise ConnectionError('Extension connection closed')
                    reply = json.loads(line)
                    if reply.get('id') != self.sequence:
                        raise ConnectionError('Bridge response ID mismatch')
            except asyncio.CancelledError:
                await self.close()
                raise
            except Exception as error:
                await self.close()
                raise ToolError(f'Bridge request failed: {error}. An edit may already have applied; inspect the file before retrying.') from error
            if 'error' in reply:
                raise ToolError(reply['error'])
            return reply['result']


bridge = Bridge(Path(os.environ.get('ISABELLE_REVAMP_PORT_FILE', '~/.isabelle-revamp/port')).expanduser())


@asynccontextmanager
async def lifespan(_server):
    await bridge.connect()
    try:
        yield {}
    finally:
        await bridge.close()


mcp = FastMCP('Isabelle Revamp', lifespan=lifespan, strict_input_validation=True,
    instructions='Work in the open VS Code workspace. Positions are zero-based lines and UTF-16 columns; ends are exclusive. '
    'Start with open to read the current buffer. edit changes and saves that buffer. goals_at moves the visible cursor and returns the sidebar text. '
    'Poll processing_status after edits. Empty errors do not prove completion: check status and sorry_positions. '
    'Up to two agents share an extension instance. Read open immediately before every edit; stale edits are rejected. '
    'Never retry an uncertain edit without reading the buffer again.')

READ = {'readOnlyHint': True, 'openWorldHint': False}


@mcp.tool(annotations=READ)
async def open(file: str) -> dict:
    """Open an existing workspace .thy file in VS Code; return its current text and version."""
    return await bridge.request('open', file=file)


@mcp.tool(annotations={'readOnlyHint': False, 'destructiveHint': True, 'openWorldHint': False})
async def edit(file: str, start_line: int, start_col: int, end_line: int, end_col: int, text: str) -> dict:
    """Replace an exclusive-end range using zero-based lines/UTF-16 columns, then save. Read open first. Undo works in VS Code."""
    return await bridge.request('edit', file=file, start_line=start_line, start_col=start_col,
                                end_line=end_line, end_col=end_col, text=text)


@mcp.tool(annotations=READ)
async def goals_at(file: str, line: int, col: int) -> dict:
    """Move the visible cursor to a proof command; wait up to 30s for the same plain text shown in the sidebar. Includes phase and version."""
    return await bridge.request('goals_at', file=file, line=line, col=col)


@mcp.tool(annotations=READ)
async def errors(file: str) -> dict:
    """Return inline error messages and source ranges. complete=false means checking is pending; an empty list is then inconclusive."""
    return await bridge.request('errors', file=file)


@mcp.tool(annotations=READ)
async def status() -> dict:
    """Report completion of open workspace theories, including versions, errors, admissions and saved state. Checking or sorry is never fully_checked."""
    return await bridge.request('status')


@mcp.tool(annotations=READ)
async def sorry_positions(file: str) -> dict:
    """Find server-marked sorry commands as [start_line,start_col,end_line,end_col] ranges. Ignores comments/strings; complete=false means the list is provisional."""
    return await bridge.request('sorry_positions', file=file)


@mcp.tool(annotations=READ)
async def processing_status() -> dict:
    """Report processing/known flags and pending ranges for each open workspace theory. A new or inactive edited file stays unknown until a goal query confirms it."""
    return await bridge.request('processing_status')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port-file', type=Path, default=bridge.port_file)
    bridge.port_file = parser.parse_args().port_file.expanduser()
    mcp.run(transport='stdio', show_banner=False)
