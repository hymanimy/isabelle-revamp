#!/usr/bin/env node
// Deterministic process fixture, not a model backend.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.M8_SCENARIO || 'stream';
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  if (mode === 'missing') { console.error('No MCP server named "isabelle".'); process.exit(1); }
  if (mode === 'preflight-stop') { setInterval(() => {}, 1000); }
  else { console.log('isabelle:\n  Type: stdio\n  Status: connected'); }
} else {
  let prompt = '';
  process.stdin.on('data', data => { prompt += data; });
  process.stdin.on('end', () => {
    if (process.env.M8_CAPTURE) fs.writeFileSync(process.env.M8_CAPTURE, JSON.stringify({ args, prompt }));
    if (mode === 'hold') {
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      if (process.env.M8_PID_FILE) fs.writeFileSync(process.env.M8_PID_FILE, String(descendant.pid));
      // Exercise Stop's escalation as well as killing the MCP-like descendant.
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000); return;
    }
    if (mode === 'bad-json') { console.log('not JSON'); return; }
    if (mode === 'exit-error') { console.error('Authentication required for this fixture'); process.exitCode = 1; return; }
    const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
    const event = value => emit({ type: 'stream_event', event: value });
    event({ type: 'message_start', message: { id: 'm1' } });
    event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
    emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'not displayed' }] } });
    event({ type: 'content_block_stop', index: 0 });
    event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking ' } });
    setTimeout(() => {
      // Split a UTF-8 character and a JSON line across writes.
      const chunk = Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1,
        delta: { type: 'text_delta', text: '√2.' } } }) + '\n');
      const cut = chunk.indexOf(Buffer.from('√')) + 1;
      process.stdout.write(chunk.subarray(0, cut));
      setTimeout(() => {
        process.stdout.write(chunk.subarray(cut));
        emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Checking √2.' }] } });
        event({ type: 'message_start', message: { id: 'm2' } });
        event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'mcp__isabelle__edit', input: {} } });
        event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file":"/demo/Demo.thy","start_line":7,' } });
        event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"start_col":4,"end_line":9,"end_col":10}' } });
        emit({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't1', name: 'mcp__isabelle__edit',
          input: { file: '/demo/Demo.thy', start_line: 7, start_col: 4, end_line: 9, end_col: 10 } }] } });
        emit({ type: 'assistant', message: { id: 'm3', content: [{ type: 'tool_use', id: 't2', name: 'mcp__isabelle__goals_at', input: { line: 12, col: 6 } }] } });
        emit({ type: 'assistant', message: { id: 'm4', content: [{ type: 'text', text: 'Fully checked.' }] } });
        emit({ type: 'result', is_error: false, result: 'Fully checked.' });
      }, 30);
    }, 120);
  });
}
