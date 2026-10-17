const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async function () {
  await require('./askView.cjs').checkAskView();
  if (!process.env.M8_LIVE_ONLY) await require('./m7.cjs').run();
  if (!process.env.M8_LIVE) { console.log('M8 automated checks passed. Set M8_LIVE=1 for the two real Claude acceptance requests.'); return; }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const root = path.resolve(__dirname, '../..');
  const file = path.join(root, 'examples/Demo.thy');
  const original = fs.readFileSync(file, 'utf8');
  const document = await vscode.workspace.openTextDocument(file);
  let editor = await vscode.window.showTextDocument(document);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  editor.selection = new vscode.Selection(11, 4, 11, 4);
  await vscode.commands.executeCommand('isabelleRevamp.ask');
  await vscode.commands.executeCommand('isabelleRevamp.showSwarm');
  await vscode.window.showTextDocument(document);
  const receipts = [];
  const sample = () => ({ goals: api.getGoalState(), board: api.getSwarmState(), ask: api.getAskState() });
  async function until(predicate, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (predicate()) return; await pause(25); }
    throw new Error('M8 condition timed out: ' + JSON.stringify(sample()));
  }
  let monitor;
  try {
    await until(() => api.getSwarmState().cards.length === 3 && api.getSwarmState().cards.every(c => c.status === 'sorry'));
    receipts.push({ check: 'Demo starts with three grey cards', ...sample() });
    const observed = []; let previous = '';
    monitor = setInterval(() => {
      const state = sample(), key = JSON.stringify(state);
      if (key !== previous) { observed.push({ time: Date.now(), ...state }); previous = key; }
    }, 50);
    assert(await api.sendAsk('prove this'));
    clearInterval(monitor);
    await until(() => api.getSwarmState().fullyChecked && api.getSwarmState().proved === 3);
    assert(!/\bsorry\b/.test(document.getText()));
    assert(observed.some(s => s.ask.active && s.board.cards.some(c => c.agent === 'Claude')), 'A real Claude MCP edit must tag the board');
    assert(observed.some(s => s.ask.active && s.ask.entries.some(e => e.kind === 'tool' && e.text.startsWith('edit Demo.thy'))));
    assert(observed.some(s => s.ask.active && s.goals.phase === 'checking'), 'Goals must update while Claude works');
    receipts.push({ check: 'real Claude proves Demo through MCP; goals and board update live', ...sample() });
    const checked = path.join(root, '.dev-host/m8-checked/Demo.thy');
    fs.mkdirSync(path.dirname(checked), { recursive: true }); fs.writeFileSync(checked, document.getText());
    fs.writeFileSync(path.join(root, '.dev-host/m8-live-stream.json'), JSON.stringify(observed, null, 2));
    console.log('PASS: real Claude "prove this", MCP edit tags, live goals, and kernel-checked board');
    const start = document.getText().indexOf('    ', document.getText().indexOf('have expand:'));
    const next = document.getText().indexOf('  have factor:', start);
    assert(start >= 0 && next > start, 'Claude should preserve named steps');
    editor = await vscode.window.showTextDocument(document);
    assert(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(start), document.positionAt(next)), '    by (rule TrueI)\n')));
    await document.save(); editor.selection = new vscode.Selection(11, 4, 11, 4);
    await until(() => vscode.languages.getDiagnostics(document.uri).some(d => d.severity === vscode.DiagnosticSeverity.Error)
      && api.getSwarmState().cards.some(c => c.status === 'error'));
    const actualErrors = vscode.languages.getDiagnostics(document.uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error).map(d => d.message);
    const before = document.getText(); const count = api.getAskState().entries.length;
    assert(await api.sendAsk('why does this fail?'));
    const answer = api.getAskState().entries.slice(count).filter(e => e.kind === 'assistant').map(e => e.text).join('\n');
    const replies = api.getAskState().entries.slice(count).filter(e => e.kind === 'assistant').map(e => e.text);
    assert.equal(new Set(replies).size, replies.length, 'A completed streamed block must not appear twice');
    assert(answer.includes('TrueI') && /Failed to apply initial proof method/i.test(answer), answer);
    assert(actualErrors.some(error => /Failed to apply initial proof method/i.test(error)), JSON.stringify(actualErrors));
    assert.equal(document.getText(), before, 'Explanation requests must leave the proof unchanged');
    receipts.push({ check: 'real Claude explanation names the actual TrueI diagnostic', actualErrors, answer, ...sample() });
    console.log('PASS: real Claude explains the actual failed TrueI method without editing');
  } finally {
    clearInterval(monitor); api.stopAsk();
    fs.writeFileSync(path.join(root, '.dev-host/m8-results.json'), JSON.stringify(receipts, null, 2));
    // Only this test's edits to the captured skeleton are restored.
    editor = await vscode.window.showTextDocument(document);
    await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), original));
    await document.save();
  }
};
