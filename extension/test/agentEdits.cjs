const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');

async function until(label, predicate, limit = 5000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await predicate()) return; await pause(10); }
  throw new Error('Timed out: ' + label);
}

async function connect(name) {
  const { port, token } = JSON.parse(fs.readFileSync(process.env.ISABELLE_REVAMP_PORT_FILE, 'utf8'));
  const socket = net.connect(port, '127.0.0.1');
  const pending = new Map(); let next = 0;
  const lines = readline.createInterface({ input: socket });
  const hello = new Promise(resolve => pending.set(undefined, resolve));
  lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
  socket.write(JSON.stringify({ token }) + '\n');
  assert.equal((await hello).ok, true);
  return {
    async call(method, params) {
      const id = ++next;
      let timer;
      const response = new Promise((resolve, reject) => {
        pending.set(id, resolve);
        timer = setTimeout(() => reject(new Error('Bridge request timed out: ' + method)), 35000);
      });
      socket.write(JSON.stringify({ id, method, params, client_name: name }) + '\n');
      let value;
      try { value = await response; } finally { clearTimeout(timer); pending.delete(id); }
      if (value.error) throw new Error(value.error);
      return value.result;
    },
    close() { lines.close(); socket.destroy(); },
  };
}

exports.run = async function () {
  const directory = path.join(root, '.dev-host/agent-edits-fixture');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'AgentEdits.thy');
  const spacer = name => Array.from({length: 85}, (_, i) => `(* ${name} ${i} *)`).join('\n');
  const source = `theory AgentEdits imports Main begin\nlemma anchor: True by simp\n${spacer('before')}\nlemma first: True\n  sorry\n${spacer('between')}\nlemma second: True\n  sorry\n${spacer('after')}\nend\n`;
  fs.writeFileSync(file, source);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const state = () => api.getAgentEdits();
  const config = vscode.workspace.getConfiguration('isabelleRevamp', document.uri);
  // Global here is the disposable --user-data-dir inside .dev-host, never the user's profile.
  const previous = config.inspect('showAgentEdits').globalValue;
  const claude = await connect('Claude Code'), codex = await connect('Codex');
  const receipts = [];
  const receipt = check => { console.log('PASS: ' + check); receipts.push({ check, at: new Date().toISOString(), state: state() }); };
  function find(text) {
    const offset = document.getText().indexOf(text); assert(offset >= 0, text);
    return new vscode.Range(document.positionAt(offset), document.positionAt(offset + text.length));
  }
  const params = (range, text) => ({ file, start_line: range.start.line, start_col: range.start.character,
    end_line: range.end.line, end_col: range.end.character, text });
  try {
    await config.update('showAgentEdits', true, vscode.ConfigurationTarget.Global);
    await claude.call('open', { file });
    const below = find('(* after 80 *)').start;
    editor.selections = [new vscode.Selection(1, 7, 1, 7), new vscode.Selection(below, below)];
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    await pause(100);
    const top = editor.visibleRanges[0].start.line;
    const old = find('sorry'), version = document.version, started = Date.now();
    const replacement = 'proof -\n    show True by simp\n  qed';
    const first = claude.call('edit', params(old, replacement));
    await until('strike preview', () => state().preview);
    assert.equal(document.getText(old), 'sorry'); assert.equal(document.version, version);
    assert.deepEqual(state().preview.range, [old.start.line, old.start.character, old.end.line, old.end.character]);
    // A user can move the caret during the preview. Do not restore its old position.
    editor.selections = [new vscode.Selection(1, 8, 1, 8), new vscode.Selection(below, below)];
    await first;
    assert(Date.now() - started >= 195);
    assert.equal(document.version, version + 1, 'Exactly one document replacement');
    assert.equal(document.getText().split('sorry').length - 1, 1);
    assert.equal(state().preview, undefined); assert.equal(state().flashes[0].marker, '✎ Claude');
    assert(state().flashes[0].opacity >= 24);
    assert.deepEqual(editor.selections.map(s => [s.active.line, s.active.character]), [[1, 8], [below.line + 2, below.character]]);
    await pause(100);
    assert.equal(editor.visibleRanges[0].start.line, top, 'An agent edit must not scroll the user\'s view');
    receipt('200 ms strike preview keeps sorry, one replacement, no scrolling, multi-caret tracking and Claude marker');

    // Insert above the first flash: its text/range and marker must follow.
    await codex.call('open', { file });
    const insertion = new vscode.Range(1, 0, 1, 0);
    await codex.call('edit', params(insertion, '(* Codex insertion *)\n'));
    assert.equal(state().flashes.length, 2);
    assert.equal(state().flashes.find(f => f.agent === 'Claude').range[0], old.start.line + 1);
    assert.equal(state().flashes.find(f => f.agent === 'Codex').marker, '✎ Codex');
    await pause(600);
    const opacity = state().flashes.find(f => f.agent === 'Claude').opacity;
    assert(opacity > 0 && opacity < 24);
    await until('background ends before marker', () => state().flashes.some(f => f.agent === 'Claude' && f.opacity === 0));
    receipt('independent agent flashes rebase across earlier insertions; background fades by two seconds');
    await until('three-second marker cleanup', () => state().flashes.length === 0);

    // Human typing during the display delay must abort the stale agent edit.
    await claude.call('open', { file });
    const secondRange = find('sorry');
    const rejected = claude.call('edit', params(secondRange, 'by simp')).then(() => null, error => error);
    await until('second preview', () => state().preview);
    await editor.edit(edit => edit.insert(new vscode.Position(1, 0), '(* human typing *)\n'));
    const error = await rejected;
    assert.match(error?.message, /changed during the edit preview/);
    assert(document.getText().includes('(* human typing *)')); assert(document.getText().includes('sorry'));
    assert.equal(state().preview, undefined); assert.equal(state().flashes.length, 0);
    receipt('human edit during preview is preserved and rejects stale MCP edit');

    await claude.call('open', { file });
    const target = find('sorry');
    // Keep the terminal focused: an edit reveals text without taking the input focus.
    const terminal = vscode.window.createTerminal({ name: 'Agent edit focus check' });
    terminal.show(); await pause(150);
    const active = vscode.window.activeTextEditor;
    await claude.call('edit', params(target, 'by simp'));
    assert.equal(vscode.window.activeTextEditor, active);
    assert.equal(state().flashes[0].marker, '✎ Claude');
    let checked;
    try { await until('kernel accepts both proofs', async () => (checked = await claude.call('status', {})).fully_checked, 20000); }
    catch (error) { throw new Error(error.message + ': ' + JSON.stringify({ checked, errors: await claude.call('errors', { file }) })); }
    receipt('MCP replacement preserves Terminal focus and both proofs become kernel-checked');
    terminal.dispose();

    await config.update('showAgentEdits', false, vscode.ConfigurationTarget.Global);
    await until('setting clears effects', () => state().flashes.length === 0);
    await vscode.window.showTextDocument(document);
    await claude.call('open', { file });
    editor.selection = new vscode.Selection(5, 3, 5, 3);
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop); await pause(100);
    const visibleStart = editor.visibleRanges[0].start.line;
    const proof = find('by simp'), beforeEdit = document.getText();
    const disabledAt = Date.now();
    await claude.call('edit', params(proof, 'by (simp)'));
    assert.equal(state().preview, undefined); assert.equal(state().flashes.length, 0);
    assert.equal(editor.selection.active.line, 5);
    await pause(100); assert.equal(editor.visibleRanges[0].start.line, visibleStart);
    receipt('showAgentEdits=false disables decorations and forced reveal while edits still work');
    receipts.push({check: 'disabled edit duration (no preview delay)', milliseconds: Date.now() - disabledAt - 100});
    await vscode.commands.executeCommand('undo');
    assert.equal(document.getText(), beforeEdit, 'A single undo restores the entire replacement');
    await document.save();
    receipt('one undo restores the replacement; no intermediate deletion in the buffer');

    // CRLF plus Unicode from an agent must use the actual saved ASCII coordinates.
    await config.update('showAgentEdits', true, vscode.ConfigurationTarget.Global);
    await editor.edit(edit => edit.setEndOfLine(vscode.EndOfLine.CRLF));
    await claude.call('open', { file });
    const comment = new vscode.Range(1, 0, 1, 0), unicode = '(* ∑ *)\n(* next *)\n';
    await claude.call('edit', params(comment, unicode));
    const flash = state().flashes[0], flashRange = new vscode.Range(...flash.range);
    assert.equal(document.getText(flashRange), '(* \\<Sum> *)\r\n(* next *)\r\n');
    assert.deepEqual(flash.range, [1, 0, 3, 0]);
    receipt('CRLF normalization and Unicode-to-ASCII encoding keep highlight/MCP ranges correct');
  } finally {
    claude.close(); codex.close();
    await config.update('showAgentEdits', previous, vscode.ConfigurationTarget.Global);
    fs.writeFileSync(path.join(root, '.dev-host/agent-edits-results.json'), JSON.stringify(receipts, null, 2));
  }
};
