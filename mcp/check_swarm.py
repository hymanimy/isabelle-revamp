"""Two named MCP clients exercise the live Swarm board; no model inference."""
import asyncio
import json
import os
from pathlib import Path
import sys

from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from mcp.types import Implementation

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / '.dev-host/m7-fixture/Swarm.thy'
SOLUTION = (ROOT / 'examples/Swarm_solution.thy').read_text().replace('theory Swarm_solution', 'theory Swarm')


async def receipt(check, **data):
    print(json.dumps({'check': check, **data}), flush=True)
    if (await asyncio.to_thread(sys.stdin.readline)).strip() != 'ok':
        raise AssertionError('Editor rejected ' + check)


def client(name):
    return Client(StdioTransport(command=sys.executable, args=[str(ROOT / 'mcp/server.py')],
                                env=os.environ.copy(), keep_alive=False),
                  client_info=Implementation(name=name, version='m7-test'))


async def call(agent, tool, **args):
    return (await agent.call_tool(tool, args)).data


async def replace_sorry(agent, label, proof, read=True):
    data = await call(agent, 'open', file=str(FILE)) if read else {'text': FILE.read_text()}
    source = data['text']
    start = source.index('sorry', source.index('have ' + label + ':'))
    line = source[:start].count('\n')
    col = start - source.rfind('\n', 0, start) - 1
    return await agent.call_tool('edit', dict(file=str(FILE), start_line=line, start_col=col,
        end_line=line, end_col=col + 5, text=proof), raise_on_error=False)


async def main():
    async with client('claude-code') as claude, client('codex-mcp-client') as codex:
        await call(claude, 'open', file=str(FILE))
        await call(codex, 'open', file=str(FILE))
        assert not (await replace_sorry(claude, 'next_sum', 'by simp')).is_error
        await receipt('Claude tag', label='next_sum', agent='Claude')
        stale = await replace_sorry(codex, 'next_square', 'by simp', read=False)
        assert stale.is_error and 'buffer changed' in str(stale.content)
        await receipt('stale second-client edit refused')
        assert not (await replace_sorry(codex, 'next_square', 'by (simp add: power2_eq_square algebra_simps)')).is_error
        await receipt('both client tags', labels=['next_sum', 'next_square'], agents=['Claude', 'Codex'])
        # Finish the remaining cards individually, reading again before each edit.
        proofs = {
            'induction_step': 'using next_sum next_square by simp',
            'all_n': 'proof -\n    fix k :: nat\n    show "(\\<Sum>i<k. 2 * i + 1) = k^2"\n'
                     '      by (induction k) (use base induction_step in auto)\n  qed',
            'result': 'by (rule all_n)',
        }
        for index, (label, proof) in enumerate(proofs.items()):
            agent = claude if index % 2 == 0 else codex
            assert not (await replace_sorry(agent, label, proof)).is_error
            await receipt('card proved by MCP', label=label)
        for _ in range(200):
            status = await call(codex, 'status')
            if status['fully_checked']:
                break
            await asyncio.sleep(.1)
        assert status['fully_checked'], status
        assert (await call(codex, 'sorry_positions', file=str(FILE)))['positions'] == []
        assert (await call(codex, 'errors', file=str(FILE)))['errors'] == []
        await receipt('all six proved and kernel checked', status=status)
    await asyncio.sleep(10.5)
    await receipt('agent tags expire')


asyncio.run(main())
