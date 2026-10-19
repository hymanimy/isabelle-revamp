const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const vscode = require('vscode');

exports.run = async function () {
  await require('./m4.cjs').run();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8');
  const directory = path.join(root, '.dev-host/m5-fixture');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'Sqrt2.thy'), source.split('\nproof\n')[0] + '\n  sorry\n\nend\n');
  const outside = path.join(directory, 'Outside.thy');
  if (!fs.existsSync(outside)) fs.symlinkSync(path.resolve(root, '../Isabelle2025-2.app/src/HOL/Main.thy'), outside);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const receipts = [];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(root, 'mcp/.venv/bin/python'), [path.join(root, 'mcp/check_live.py')], {
        cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('M5 client timed out.\n' + stderr)); }, 180000);
      child.stderr.on('data', data => { stderr += data; });
      readline.createInterface({ input: child.stdout }).on('line', line => {
        try {
          const receipt = JSON.parse(line);
          if (receipt.check === 'sidebar matches MCP goals') {
            const state = api.getGoalState();
            for (const key of ['phase', 'text', 'errors', 'theory', 'checkStatus']) {
              assert.deepEqual(state[key], receipt.result[key], key);
            }
          }
          receipts.push(receipt);
          console.log('PASS: ' + receipt.check);
          child.stdin.write('ok\n');
        } catch (error) { child.stdin.end('failed\n'); reject(error); }
      });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(new Error('MCP client exit ' + code + '\n' + stderr));
      });
    });
    assert.equal(fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8'), source);
    assert.equal(fs.readFileSync(path.join(directory, 'Sqrt2.thy'), 'utf8'), source);
    console.log('M5 end-to-end MCP checks passed. Actual demo source unchanged.');
  } finally {
    fs.writeFileSync(path.join(root, '.dev-host/m5-results.json'), JSON.stringify(receipts, null, 2));
  }
};
