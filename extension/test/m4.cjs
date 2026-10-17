// M4's real proof and its editable demo, checked in stock VS Code/Isabelle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { goalsHtml } = require('../out/goalsView');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  // Retain the cursor-race, slow-prover, diagnostic, and unfinished controls.
  await require('./m3.cjs').run();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const root = path.resolve(__dirname, '../..');
  const original = fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8');
  assert(!/\bsorry\b|\boops\b/.test(original));
  const directory = path.join(root, '.dev-host/m4-fixture');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'Sqrt2.thy');
  fs.writeFileSync(file, original);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const snapshots = [];
  const errors = () => vscode.languages.getDiagnostics(document.uri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error);

  async function until(label, condition) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if (condition()) {
        snapshots.push({ check: label, ...api.getGoalState() });
        console.log('PASS: ' + label);
        return;
      }
      await pause(25);
    }
    throw new Error(label + ': ' + JSON.stringify(api.getGoalState()));
  }
  async function move(line, col) {
    editor.selection = new vscode.Selection(line, col, line, col);
    await pause(30);
    assert.equal(api.getGoalState().phase, 'checking');
  }
  async function replace(text) {
    assert(await editor.edit(edit => edit.replace(new vscode.Range(0, 0, document.lineCount, 0), text)));
  }
  async function lastStep() {
    const line = document.getText().split('\n').findIndex(text => text === 'qed') - 1;
    await move(line, 5);
  }

  try {
    await vscode.commands.executeCommand('isabelleRevamp.showGoals');
    await vscode.window.showTextDocument(document);
    const seen = new Set();
    const lines = original.split('\n');
    for (let line = 0; line < lines.length; line++) {
      if (!/^\s+have /.test(lines[line])) continue;
      const column = lines[line].indexOf('have ');
      await move(line, column + 1);
      await until('goal at line ' + (line + 1), () => api.getGoalState().phase === 'ready'
        && api.getGoalState().text.includes('goal (1 subgoal)'));
      const goal = api.getGoalState().text.split('goal (1 subgoal):')[1];
      assert(goal, 'The have command must expose a goal.');
      assert(!seen.has(goal), 'Each have must show a different goal: ' + goal);
      seen.add(goal);
      assert.equal(errors().length, 0);
    }
    assert.equal(seen.size, 11);
    await lastStep();
    await until('complete sqrt-2 proof has no subgoals', () => api.getGoalState().phase === 'ready'
      && api.getGoalState().text.includes('No subgoals!') && errors().length === 0);

    const unfinished = original.replace('    by simp\nqed', '    sorry\nqed');
    assert.notEqual(unfinished, original);
    await replace(unfinished);
    await lastStep();
    await until('demo placeholder is unfinished', () => api.getGoalState().phase === 'unfinished'
      && errors().length === 0);
    assert(goalsHtml(api.getGoalState()).includes('unfinished (sorry)'));
    assert(!goalsHtml(api.getGoalState()).includes('Proof error'));

    // Keep a genuine sorry and add a separate failed command: errors still win.
    const broken = unfinished.replace('  then show False\n    sorry',
      '  have bad: False by (rule TrueI)\n  then show False\n    sorry');
    await replace(broken);
    await lastStep();
    await until('real error takes precedence over sorry', () => api.getGoalState().phase === 'error'
      && errors().some(d => d.message.includes('Failed to apply')));
    assert.equal(api.getGoalState().text, '');

    // Merely discussing sorry, even inside nested comments, is not an admission.
    const mentions = original.replace('begin\n', String.raw`begin
(* sorry (* sorry *) *)
text "sorry"
text \<open>sorry\<close>
`);
    await replace(mentions);
    await lastStep();
    await until('comments and text mentioning sorry stay ready', () => api.getGoalState().phase === 'ready'
      && api.getGoalState().text.includes('No subgoals!') && errors().length === 0);

    await replace(original);
    await lastStep();
    await until('restored demo proof is complete', () => api.getGoalState().phase === 'ready'
      && api.getGoalState().text.includes('No subgoals!') && errors().length === 0);
    assert.equal(fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8'), original);
    fs.writeFileSync(path.join(root, '.dev-host/m4-results.json'), JSON.stringify(snapshots, null, 2));
    console.log('M4 integration checks passed. All 11 have goals are distinct.');
  } catch (error) {
    fs.writeFileSync(path.join(root, '.dev-host/m4-results.json'), JSON.stringify({
      error: String(error), state: api.getGoalState(), snapshots,
    }, null, 2));
    throw error;
  } finally {
    await replace(original);
    await document.save();
  }
};
