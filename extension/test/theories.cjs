const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Top imports Middle imports Bottom; Bottom has a sorry. Only Top is opened by hand.
exports.run = async function () {
  const root = path.resolve(__dirname, '../..');
  const directory = path.join(root, '.dev-host/theories-fixture');
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(directory, name + '.thy'), text);
  write('Bottom', 'theory Bottom imports Main begin\nlemma b: "False" sorry\nend\n');
  write('Middle', 'theory Middle imports Bottom begin\nlemma m: "x = (x::nat)" by simp\nend\n');
  write('Top', 'theory Top\n  imports Middle "HOL-Library.Multiset"\nbegin\nlemma t: "y = (y::nat)" by simp\nend\n');
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(directory, 'Top.thy')));
  editor.selection = new vscode.Selection(3, 0, 3, 0);
  await vscode.commands.executeCommand('isabelleRevamp.showTheories');
  const statuses = async () => Object.fromEntries((await api.getTheories()).map(theory => [theory.name, theory.status]));
  const deadline = Date.now() + 180000;
  let seen;
  while (Date.now() < deadline) {
    seen = await statuses();
    if (seen.Bottom === 'unfinished' && seen.Middle === 'finished' && seen.Top === 'finished') break;
    await pause(250);
  }
  const theories = await api.getTheories();
  assert.deepEqual(theories.map(theory => theory.name), ['Bottom', 'Middle', 'Top'], 'Imports come first');
  assert.deepEqual(seen, { Bottom: 'unfinished', Middle: 'finished', Top: 'finished' }, JSON.stringify(theories));
  assert.deepEqual(theories.map(theory => theory.open), [false, false, true]);
  console.log('PASS: theories panel lists local imports in order and reports each one\'s status');

  write('Middle', 'theory Middle imports Bottom begin\nlemma m: "x = (x::nat) + 1" by simp\nend\n');
  const failing = Date.now() + 60000;
  while (Date.now() < failing && (await statuses()).Middle !== 'failed') await pause(250);
  assert.equal((await statuses()).Middle, 'failed', JSON.stringify(await api.getTheories()));
  console.log('PASS: a failing import edited on disk shows as failed');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
};
