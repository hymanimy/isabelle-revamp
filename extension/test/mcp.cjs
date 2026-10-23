const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');
const TOOLS = ['definition', 'edit', 'errors', 'goals_at', 'hover', 'open', 'processing_status', 'sledgehammer', 'sorry_positions', 'status'];

// An MCP client the way Claude Code starts one: the bundled server on VS Code's Node.js.
async function agent(name) {
  const client = new Client({ name, version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, 'extension/out/mcpServer.js')], cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }));
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text ?? '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

// A raw bridge connection, to check the handshake without an MCP server in between.
function handshake(token) {
  const { port } = JSON.parse(fs.readFileSync(process.env.ISABELLE_REVAMP_PORT_FILE, 'utf8'));
  const socket = net.connect(port, '127.0.0.1');
  socket.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    socket.once('data', data => resolve({ reply: JSON.parse(data.split('\n')[0]), socket }));
    socket.once('error', reject);
    socket.write(JSON.stringify({ token }) + '\n');
  });
}

exports.run = async function () {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const original = fs.readFileSync(path.join(root, 'extension/test/fixtures/Sqrt2.thy'), 'utf8');
  const directory = path.join(root, '.dev-host/m5-fixture');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'Sqrt2.thy');
  fs.writeFileSync(file, original.split('\nproof\n')[0] + '\n  sorry\n\nend\n');
  const outside = path.join(directory, 'Outside.thy');
  if (!fs.existsSync(outside)) fs.symlinkSync(require('./isabelle.cjs').library('src/HOL/Main.thy'), outside);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const receipts = [];
  const receipt = (check, result) => { receipts.push({ check, result }); console.log('PASS: ' + check); };
  const discovery = JSON.parse(fs.readFileSync(process.env.ISABELLE_REVAMP_PORT_FILE, 'utf8'));
  assert.deepEqual(discovery.folders, [root]);
  assert.equal(discovery.pid, process.pid);
  receipt('discovery file names this window\'s workspace folders');

  assert.match((await handshake('wrong')).reply.error, /Invalid bridge token/);
  const raw = await Promise.all([1, 2, 3].map(() => handshake(discovery.token)));
  assert(raw.every(({ reply }) => reply.ok === true));
  raw.forEach(({ socket }) => socket.destroy());
  receipt('wrong token refused; any number of clients accepted');

  const claude = await agent('claude-code');
  try {
    assert.deepEqual((await claude.listTools()).tools.map(tool => tool.name).sort(), TOOLS);
    receipt('exactly ten MCP tools');
    const until = async (label, predicate) => {
      let value;
      for (let i = 0; i < 200; i++) {
        value = await call(claude, 'status');
        const item = value.files.find(entry => entry.file === file);
        if (item && predicate(item)) { receipt(label, value); return item; }
        await pause(100);
      }
      throw new Error(label + ': ' + JSON.stringify(value));
    };
    const replace = async text => {
      const lines = (await call(claude, 'open', { file })).text.split('\n');
      return call(claude, 'edit', { file, start_line: 0, start_col: 0, end_line: lines.length - 1,
        end_col: lines.at(-1).length, text });
    };
    const untouched = (result) => {
      // MCP works on the document model: no tab opens, the Goals panel stays on the user's own cursor.
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
      assert(!tabs.some(tab => tab.input?.uri?.fsPath === file), 'MCP opened a tab');
      assert.notEqual(api.getGoalState().theory, 'Sqrt2');
      assert.equal(result.theory, 'Sqrt2');
    };

    assert((await call(claude, 'open', { file })).text.includes('sorry'));
    let goal = await call(claude, 'goals_at', { file, line: 6, col: 4 });
    assert(goal.text.includes('sqrt 2 ∉ ℚ'), goal.text);
    untouched(goal);
    receipt('goals_at leaves the user editor alone', goal);
    await until('sorry is processed but not fully checked', item => item.processed && item.state === 'unfinished');
    const sorry = await call(claude, 'sorry_positions', { file });
    assert(sorry.complete); assert.deepEqual(sorry.positions, [[7, 2, 7, 7]]);
    assert.deepEqual((await call(claude, 'errors', { file })).errors, []);
    receipt('sorry positions are exact', sorry);

    // The full sqrt-2 proof, not a trivial control.
    await replace(original);
    const checked = await until('real proof fully checked after MCP edit', item => item.fully_checked);
    assert(checked.saved); assert.equal(checked.sorry_count, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual((await call(claude, 'sorry_positions', { file })).positions, []);
    goal = await call(claude, 'goals_at', { file, line: 49, col: 5 });
    assert(goal.text.includes('No subgoals!'), goal.text);
    untouched(goal);
    // Messages arrive one output batch after the proof state; goals_at waits for them.
    assert(goal.text.includes('Successful attempt to solve goal'), goal.text);
    receipt('goals_at includes the command messages', goal);

    // The first occurrence of `word` on the line containing `context`.
    const at = (context, word) => {
      const line = original.split('\n').findIndex(text => text.includes(context));
      return { file, line, col: original.split('\n')[line].indexOf(word, original.split('\n')[line].indexOf(context)) };
    };
    let hover = await call(claude, 'hover', at('theorem sqrt2', 'sqrt ('));
    assert.match(hover.text, /constant "NthRoot\.sqrt"\n:: real ⇒ real/);
    hover = await call(claude, 'hover', at('where denominator', 'n \\<noteq>'));
    assert.match(hover.text, /fixed "n"\n:: nat/); assert.deepEqual(hover.range, [10, 24, 10, 25]);
    receipt('hover names constants and variables with their types', hover);
    let definition = await call(claude, 'definition', at('theorem sqrt2', '\\<rat>'));
    assert(definition.definitions[0].file.endsWith('/src/HOL/Rat.thy'), JSON.stringify(definition));
    assert(definition.definitions[0].source.startsWith('definition Rats :: "\'a set" (‹ℚ›)'), JSON.stringify(definition));
    definition = await call(claude, 'definition', at('using denominator fraction', 'denominator'));
    assert.equal(definition.definitions[0].file, file); assert.deepEqual(definition.definitions[0].range, [10, 10, 10, 21]);
    receipt('definition finds library and local definitions with their source', definition);

    await replace(original.replace('    by simp\nqed', '    by (rule TrueI)\nqed'));
    await until('wrong tactic is not fully checked', item => item.state === 'error');
    let errors;
    for (let i = 0; i < 100; i++) {
      errors = await call(claude, 'errors', { file });
      if (errors.complete && errors.errors.length) break;
      await pause(50);
    }
    assert(errors.complete && errors.has_errors && errors.errors.some(error => error.message.includes('Failed to apply')),
      JSON.stringify(errors));
    receipt('MCP returns inline errors with ranges', errors);

    // A misspelt constant silently becomes a free variable; hover shows it.
    await replace(original.replace('"sqrt (2 :: real) \\<notin>', '"sqrrt (2 :: real) \\<notin>'));
    hover = await call(claude, 'hover', at('theorem sqrt2', 'sqrt ('));
    assert.match(hover.text, /free variable/, hover.text);
    receipt('hover shows a misspelt constant as a free variable', hover);

    // A bounded quantifier reports its variable twice: ∀i < n. P is ∀i. i < n ⟶ P.
    const bounded = 'lemma bounded: "\\<forall>i < (n::nat). i < n" by simp\n';
    await replace(original.slice(0, original.lastIndexOf('\nend')) + '\n\n' + bounded + original.slice(original.lastIndexOf('\nend')));
    const boundedLine = (await call(claude, 'open', { file })).text.split('\n').indexOf(bounded.trimEnd());
    hover = await call(claude, 'hover', { file, line: boundedLine, col: bounded.indexOf('i <') });
    assert.match(hover.text, /bound "i"/, hover.text);
    assert.equal(hover.text.split('\n').length, new Set(hover.text.split('\n')).size, 'Repeated hover lines: ' + hover.text);
    receipt('hover lists a bounded variable once', hover);

    // Sledgehammer runs as Isabelle's query: the theory is not edited.
    const hammerFile = path.join(directory, 'Hammer.thy');
    const hammerSource = 'theory Hammer imports Main begin\nlemma comm: "(a::int) * b + c = c + b * a"\n  sorry\n'
      + 'lemma fermat3: "(x::nat) ^ 3 + y ^ 3 \\<noteq> z ^ 3 \\<or> x * y * z = 0"\n  sorry\nend\n';
    fs.writeFileSync(hammerFile, hammerSource);
    let hammer = await call(claude, 'sledgehammer', { file: hammerFile, line: 1, col: 2, wait_seconds: 55 });
    assert.equal(hammer.status, 'finished', JSON.stringify(hammer));
    assert(hammer.proofs.length && hammer.proofs.every(proof => proof.startsWith('by ')), JSON.stringify(hammer));
    assert.equal(fs.readFileSync(hammerFile, 'utf8'), hammerSource);
    receipt('sledgehammer returns proofs without editing the theory', hammer);
    // A hard goal: the call returns while running; other clients go on but cannot start or cancel one.
    hammer = await call(claude, 'sledgehammer', { file: hammerFile, line: 3, col: 2, wait_seconds: 1 });
    assert.notEqual(hammer.status, 'finished', JSON.stringify(hammer));
    const waiting = call(claude, 'sledgehammer', { file: hammerFile, line: 3, col: 2, wait_seconds: 50 });
    const other = await agent('other-agent');
    try {
      const asked = Date.now();
      assert.equal((await call(other, 'open', { file: hammerFile })).text, hammerSource);
      assert(Date.now() - asked < 5000, 'A waiting sledgehammer held up another client');
      await assert.rejects(call(other, 'sledgehammer', { file: hammerFile, line: 1, col: 2 }), /already running for claude-code/);
      await assert.rejects(call(other, 'sledgehammer', { file: hammerFile, line: 3, col: 2, cancel: true }), /belongs to claude-code/);
    } finally { await other.close(); }
    // The user cancels from the editor; the waiting call returns at once.
    await api.sledgehammer.cancel();
    hammer = await waiting;
    assert(hammer.status === 'finished' && hammer.cancelled, JSON.stringify(hammer));
    // The agent cancels its own run.
    assert.notEqual((await call(claude, 'sledgehammer', { file: hammerFile, line: 3, col: 2, wait_seconds: 1 })).status, 'finished');
    hammer = await call(claude, 'sledgehammer', { file: hammerFile, line: 3, col: 2, cancel: true });
    assert(hammer.status === 'finished' && hammer.cancelled, JSON.stringify(hammer));
    receipt('a long sledgehammer does not block other calls, refuses other clients and cancels', hammer);

    // processing_status checks for at most 5 s and status for 15 s, so a 25 s command is still running.
    await replace(original.replace('proof\n', 'proof\n  ML_prf \\<open>OS.Process.sleep (Time.fromReal 25.0)\\<close>\n'));
    await pause(700);
    const pending = await call(claude, 'processing_status');
    assert(pending.processing);
    const pendingFile = pending.files.find(item => item.file === file);
    assert(pendingFile.pending.some(item => item.type.includes('running')), JSON.stringify(pendingFile));
    assert(!(await call(claude, 'status')).fully_checked);
    receipt('processing status remains pending during slow command', pending);
    await until('slow proof finishes', item => item.fully_checked);

    // Invalid edits and canonical path escapes must not touch the source.
    const before = fs.readFileSync(file, 'utf8');
    await assert.rejects(call(claude, 'edit', { file, start_line: 9999, start_col: 0, end_line: 9999, end_col: 0, text: 'x' }));
    await assert.rejects(call(claude, 'open', { file: outside }));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    receipt('invalid ranges and symlink escape rejected');

    await replace(original.split('\nend').slice(0, -1).join('\nend') + '\n');
    await until('missing theory end is never fully checked', item => item.known && !item.theory_closed && !item.fully_checked);
    await replace(original);
    await until('final restored theory fully checked', item => item.fully_checked);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  } finally {
    await claude.close();
  }

  // status covers the user's tabs and this client's files; a new client has read none yet.
  const codex = await agent('codex');
  try {
    assert.equal((await call(codex, 'status')).files.length, 0);
    await call(codex, 'open', { file });
    assert((await call(codex, 'status')).fully_checked);
    receipt('a new client sees only its own files and the user\'s tabs');
  } finally {
    await codex.close();
  }
  fs.writeFileSync(path.join(root, '.dev-host/m5-results.json'), JSON.stringify(receipts, null, 2));
  console.log('MCP end-to-end checks passed. Fixture source unchanged.');
};
