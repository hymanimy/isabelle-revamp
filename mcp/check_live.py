"""An MCP client drives the real extension. The VS Code test host checks receipts."""
import asyncio
import json
import os
from pathlib import Path
import sys

from fastmcp import Client
from fastmcp.client.transports import StdioTransport

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / '.dev-host/m5-fixture/Sqrt2.thy'
ORIGINAL = (ROOT / 'examples/Sqrt2.thy').read_text()
PORT_FILE = Path(os.environ['ISABELLE_REVAMP_PORT_FILE'])
TOOLS = {'open', 'edit', 'goals_at', 'errors', 'status', 'sorry_positions', 'processing_status'}


async def receipt(check, result=None):
    print(json.dumps({'check': check, 'result': result}, ensure_ascii=False), flush=True)
    if (await asyncio.to_thread(sys.stdin.readline)).strip() != 'ok':
        raise AssertionError('VS Code rejected receipt: ' + check)


async def raw_connection(token=None):
    info = json.loads(PORT_FILE.read_text())
    reader, writer = await asyncio.open_connection('127.0.0.1', info['port'])
    if token is not None:
        writer.write((json.dumps({'token': token}) + '\n').encode())
        await writer.drain()
    reply = json.loads(await asyncio.wait_for(reader.readline(), 5))
    writer.close()
    await writer.wait_closed()
    return reply


async def main():
    assert 'Invalid bridge token' in (await raw_connection('wrong'))['error']
    await asyncio.sleep(0.1)
    transport = StdioTransport(command=sys.executable, args=[str(ROOT / 'mcp/server.py'), '--port-file', str(PORT_FILE)], keep_alive=False)
    async with Client(transport) as client:
        assert {tool.name for tool in await client.list_tools()} == TOOLS
        await receipt('exactly seven MCP tools')
        info = json.loads(PORT_FILE.read_text())
        second_reader, second_writer = await asyncio.open_connection('127.0.0.1', info['port'])
        try:
            second_writer.write((json.dumps({'token': info['token']}) + '\n').encode())
            await second_writer.drain()
            assert json.loads(await second_reader.readline()) == {'ok': True}
            assert 'already connected' in (await raw_connection())['error']
        finally:
            second_writer.close()
            await second_writer.wait_closed()
        await receipt('two connections accepted; third refused')

        async def call(name, **params):
            return (await client.call_tool(name, params)).data

        async def until(label, predicate):
            for _ in range(200):
                value = await call('status')
                file = next((item for item in value['files'] if item['file'] == str(FILE)), None)
                if file and predicate(file):
                    await receipt(label, value)
                    return file
                await asyncio.sleep(0.1)
            raise AssertionError(label + ': ' + json.dumps(value))

        async def replace(text):
            current = await call('open', file=str(FILE))
            lines = current['text'].split('\n')
            return await call('edit', file=str(FILE), start_line=0, start_col=0,
                              end_line=len(lines) - 1, end_col=len(lines[-1]), text=text)

        initial = await call('open', file=str(FILE))
        assert 'sorry' in initial['text']
        goal = await call('goals_at', file=str(FILE), line=6, col=4)
        assert 'sqrt 2 ∉ ℚ' in goal['text']
        await receipt('sidebar matches MCP goals', goal)
        await until('sorry is processed but not fully checked', lambda item: item['processed'] and item['state'] == 'unfinished')
        sorry = await call('sorry_positions', file=str(FILE))
        assert sorry['complete'] and sorry['positions'] == [[7, 2, 7, 7]], sorry
        assert (await call('errors', file=str(FILE)))['errors'] == []
        await receipt('sorry positions are exact', sorry)

        # This call submits the full actual M4 proof, not a trivial solved control.
        await replace(ORIGINAL)
        checked = await until('real proof fully checked after MCP edit', lambda item: item['fully_checked'])
        assert checked['saved'] and checked['sorry_count'] == 0
        assert FILE.read_text() == ORIGINAL
        assert (await call('sorry_positions', file=str(FILE)))['positions'] == []
        goal = await call('goals_at', file=str(FILE), line=49, col=5)
        assert 'No subgoals!' in goal['text']
        await receipt('sidebar matches MCP goals', goal)

        broken = ORIGINAL.replace('    by simp\nqed', '    by (rule TrueI)\nqed')
        await replace(broken)
        await until('wrong tactic is not fully checked', lambda item: item['state'] == 'error')
        for _ in range(100):
            errors = await call('errors', file=str(FILE))
            if errors['complete'] and errors['errors']:
                break
            await asyncio.sleep(0.05)
        assert errors['complete'] and errors['has_errors'] and any('Failed to apply' in error['message'] for error in errors['errors']), errors
        await receipt('MCP returns inline errors with ranges', errors)

        # Keep the theorem cursor on a stable command while a later command runs.
        await call('goals_at', file=str(FILE), line=6, col=4)
        slow = ORIGINAL.replace('proof\n', 'proof\n  ML_prf \\<open>OS.Process.sleep (Time.fromReal 2.0)\\<close>\n', 1)
        await replace(slow)
        await asyncio.sleep(0.7)
        pending = await call('processing_status')
        assert pending['processing']
        pending_file = next(item for item in pending['files'] if item['file'] == str(FILE))
        assert any('running' in item['type'] for item in pending_file['pending']), pending_file
        assert not (await call('status'))['fully_checked']
        await receipt('processing status remains pending during slow command', pending)
        await until('slow proof finishes', lambda item: item['fully_checked'])

        # Invalid edits and canonical path escapes must not touch the source.
        before = FILE.read_text()
        for name, args in [
            ('edit', dict(file=str(FILE), start_line=9999, start_col=0, end_line=9999, end_col=0, text='x')),
            ('open', dict(file=str(FILE.parent / 'Outside.thy'))),
        ]:
            result = await client.call_tool(name, args, raise_on_error=False)
            assert result.is_error
        assert FILE.read_text() == before
        await receipt('invalid ranges and symlink escape rejected')

        await replace(ORIGINAL.rsplit('\nend', 1)[0] + '\n')
        await until('missing theory end is never fully checked', lambda item: item['known']
                    and not item['theory_closed'] and not item['fully_checked'])
        await replace(ORIGINAL)
        await until('final restored theory fully checked', lambda item: item['fully_checked'])
        assert FILE.read_text() == ORIGINAL

    await asyncio.sleep(0.1)
    async with Client(StdioTransport(command=sys.executable, args=[str(ROOT / 'mcp/server.py'), '--port-file', str(PORT_FILE)], keep_alive=False)) as client:
        assert (await client.call_tool('status')).data['fully_checked']
        await receipt('agent slot released on disconnect')


asyncio.run(main())
