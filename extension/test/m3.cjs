// Runs in stock VS Code via --extensionTestsPath; no test framework dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { outputText } = require('../out/outputText');
const { goalsHtml } = require('../out/goalsView');
const { checkCursorRaces } = require('./cursorRaces.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  const root = path.resolve(__dirname, '../..');
  const original = fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8');
  const directory = path.join(root, '.dev-host/m3-fixture');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'Sqrt2.thy');
  fs.writeFileSync(file, original);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const snapshots = [];

  async function until(label, condition, timeout = 20000) {
    const end = Date.now() + timeout;
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
  async function move(line, column = 4) {
    editor.selection = new vscode.Selection(line, column, line, column);
    await pause(30);
  }
  async function replace(text) {
    const range = new vscode.Range(0, 0, document.lineCount, 0);
    assert(await editor.edit(edit => edit.replace(range, text)));
  }
  const errors = () => vscode.languages.getDiagnostics(document.uri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error);
  const ready = () => api.getGoalState().phase === 'ready';

  try {
    await checkCursorRaces();
    assert.equal(outputText('<pre><a href="a>b">x &lt; 2</a><br>&#x211A; &amp; y</pre>'),
      'x < 2\nℚ & y');
    const hidden = goalsHtml({ phase: 'checking', text: 'STALE_GOAL', errors: [] });
    assert(!hidden.includes('STALE_GOAL'));
    const escaped = goalsHtml({ phase: 'ready', text: '<script>alert(1)</script>', errors: [] });
    assert(!escaped.includes('<script>'));
    assert(escaped.includes('&lt;script&gt;'));

    await vscode.commands.executeCommand('isabelleRevamp.showGoals');
    await vscode.window.showTextDocument(document);
    await move(6);
    await until('sqrt 2 goal at show', () => ready() && api.getGoalState().text.includes('sqrt 2 ∉ ℚ'));
    const first = api.getGoalState().text;
    await move(5);
    assert.equal(api.getGoalState().phase, 'checking');
    assert.equal(api.getGoalState().text, '');
    await until('cursor changes the goal state', () => ready() && api.getGoalState().text !== first);
    await move(4, 8);
    await until('theorem goal', () => ready() && api.getGoalState().text.includes('goal (1 subgoal)'));
    const same = api.getGoalState().text;
    await move(6);
    await until('identical goal is refreshed at a different command', () => ready() && api.getGoalState().text === same);

    for (const line of [4, 6, 4, 6, 5]) await move(line);
    await until('rapid cursor moves settle on the last cursor', () => ready() && api.getGoalState().text !== first);
    await move(6);
    await until('return to show after rapid movement', () => ready() && api.getGoalState().text === first);

    await replace(original.replace('sorry', 'by simp'));
    await move(7, 9);
    assert.equal(api.getGoalState().phase, 'checking');
    await until('wrong tactic produces an editor diagnostic', () => errors().some(d => d.message.includes('Failed to apply')));
    await until('sidebar marks the proof error', () => api.getGoalState().phase === 'error');
    assert.equal(api.getGoalState().text, '');
    assert(errors().some(d => d.range.start.line === 7));

    // M4 owns the sqrt-2 proof. This unsaved test control checks the solved UI path.
    const solved = original.replace('sqrt (2 :: real) \\<notin> \\<rat>', '(2 :: real) = 2')
      .replace('sorry', 'by simp');
    const slow = solved.replace('theorem sqrt2_irrational',
      'ML \\<open>OS.Process.sleep (Time.fromReal 2.0)\\<close>\ntheorem sqrt2_irrational');
    await replace(slow);
    await move(8, 9);
    await pause(700);
    assert.equal(api.getGoalState().phase, 'checking');
    assert.equal(api.getGoalState().text, '');
    snapshots.push({ check: 'slow prover hides old output', ...api.getGoalState() });
    await until('correct control has no subgoals and clears diagnostics', () =>
      ready() && api.getGoalState().text.includes('No subgoals!') && errors().length === 0);

    await replace(original);
    await move(6);
    await until('restore the original sqrt-2 placeholder', () => ready() && api.getGoalState().text === first);
    fs.writeFileSync(path.join(root, '.dev-host/m3-results.json'), JSON.stringify(snapshots, null, 2));
    assert.equal(fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8'), original);
    console.log('M3 integration checks passed. Original example unchanged.');
  } catch (error) {
    fs.writeFileSync(path.join(root, '.dev-host/m3-results.json'), JSON.stringify({
      error: String(error), state: api.getGoalState(), snapshots,
    }, null, 2));
    throw error;
  } finally {
    await replace(original);
    await document.save();
  }
};
