"""Compare the real FastMCP wire result with the extension's refutation model."""
import asyncio
import json
import os
from pathlib import Path
import sys
from fastmcp import Client
from fastmcp.client.transports import StdioTransport

async def main():
    root = Path(__file__).resolve().parents[1]
    transport = StdioTransport(command=sys.executable, args=[str(root / 'mcp/server.py'),
        '--port-file', os.environ['ISABELLE_REVAMP_PORT_FILE']], keep_alive=False)
    async with Client(transport) as client:
        async def call(name, **params):
            return (await client.call_tool(name, params)).data
        file = sys.argv[1]
        graph = await call('proof_graph', file=file)
        nodes = {node['name']: node for node in graph['nodes']}
        assert nodes['sqrt4_irrational']['status'] == 'refuted', graph
        assert nodes['sqrt4_irrational_refuted']['status'] == 'proved', graph
        assert not graph['fully_checked'] and graph['complete'], graph
        assert all(node['line'] == node['range'][0] + 1 for node in graph['nodes'])
        assert any(edge['kind'] == 'refutation' for edge in graph['edges'])
        errors = await call('errors', file=file)
        assert not errors['errors'] and errors['complete'], errors
        sorry = await call('sorry_positions', file=file)
        assert sorry['complete'] and sorry['positions'] == [[5, 2, 5, 7]], sorry
        status = await call('status')
        target = next(item for item in status['files'] if item['file'] == file)
        assert not target['fully_checked'] and target['sorry_count'] == 1 and target['saved'], target
        print(json.dumps({'graph': graph, 'errors': errors, 'sorry': sorry, 'status': status}))

asyncio.run(main())
