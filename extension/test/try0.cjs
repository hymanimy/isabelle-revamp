const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// try0 finds a proof; the user applies it from the hover or the Goals panel.
exports.run = async function () {
  const root = path.resolve(__dirname, '../..');
  const file = path.join(root, '.dev-host/try0-fixture/Try.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'theory Try imports Main begin\nlemma first: "x + 0 = (x::nat)"\n  try0\n  sorry\n\n'
    + 'lemma second: "(y::nat) * 1 = y"\n  try0\n  sorry\nend\n');
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  async function until(label, predicate, seconds = 60) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) { if (await predicate()) return; await pause(100); }
    throw new Error(label + ': ' + JSON.stringify(api.getGoalState()));
  }
  editor.selection = new vscode.Selection(2, 3, 2, 3);
  await until('try0 reports a proof', () => api.getGoalState().text.includes('Try this:'));
  assert(api.getGoalState().html.includes('class="sendback"'), 'Found proofs keep their sendback markup');

  let links;
  await until('hover offers the proofs', async () => {
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, new vscode.Position(2, 3));
    links = hovers.flatMap(hover => hover.contents.map(content => content.value ?? String(content)))
      .join('\n').match(/command:isabelleRevamp\.applySuggestion\?[^)]+/g);
    return links?.length;
  });
  const args = JSON.parse(decodeURIComponent(links[0].split('?')[1]));
  assert.equal(args[1], 2);
  assert(await vscode.commands.executeCommand('isabelleRevamp.applySuggestion', ...args));
  const lines = document.getText().split('\n');
  assert.match(lines[2], /^  by \w+/, lines.join('\n'));
  assert.equal(lines[3], '', 'The sorry after try0 is gone');
  console.log(`PASS: hover link applies "${args[3]}" in place of try0 and drops the sorry`);

  // The original bug: a closing `by` has no proof state, so show its messages.
  editor.selection = new vscode.Selection(2, 5, 2, 5);
  // "unfinished" is the document's status: the second lemma still has its sorry.
  await until('closing by shows its theorem', () => ['ready', 'unfinished'].includes(api.getGoalState().phase) && api.getGoalState().stateless
    && api.getGoalState().text.includes('theorem first'));
  console.log('PASS: Goals shows the theorem message on a closing by, not "checking…"');
  // Moving within the same command sends no new output; the messages must come back each time.
  const timings = [];
  for (const column of [7, document.lineAt(2).text.length, 4]) {
    const started = Date.now();
    editor.selection = new vscode.Selection(2, column, 2, column);
    await pause(30);
    await until(`theorem again at column ${column}`, () => api.getGoalState().stateless
      && api.getGoalState().text.includes('theorem first'), 10);
    timings.push(Date.now() - started);
  }
  console.log(`PASS: moving within the closing by keeps showing its messages (${timings.join(', ')} ms)`);

  const second = document.getText().split('\n').findIndex(line => line.trim() === 'try0');
  editor.selection = new vscode.Selection(second, 3, second, 3);
  await until('second try0 reports a proof', () => api.getGoalState().text.includes('Try this:'));
  const proof = /Try this: (by [^\n(]+)/.exec(api.getGoalState().text)[1].trim();
  assert(await api.useProofFromGoals(proof) !== false);
  await until('Goals click replaced try0', () => document.getText().split('\n')[second] === '  ' + proof, 10);
  assert(!document.getText().includes('sorry'));
  console.log(`PASS: clicking "${proof}" in Goals replaces the try0 at the cursor`);
  await document.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  // Sledgehammer's provers report one by one; each proof is usable as soon as it arrives.
  const sledge = path.join(path.dirname(file), 'Sledge.thy');
  fs.writeFileSync(sledge, 'theory Sledge imports Main begin\ndefinition f :: nat where [code del]: "f = 0"\n'
    + 'lemma "(a::int) * b + c = c + b * a"\n  sledgehammer\n  sorry\nend\n');
  const hammered = await vscode.workspace.openTextDocument(sledge);
  const hammer = await vscode.window.showTextDocument(hammered);
  hammer.selection = new vscode.Selection(3, 4, 3, 4);
  await until('sledgehammer shows a proof while running', () => api.getGoalState().running
    && api.getGoalState().text.includes(': Try this: by'));
  assert(api.getGoalState().html.includes('class="sendback"'));
  const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', hammered.uri, new vscode.Position(3, 4));
  assert(hover.flatMap(h => h.contents.map(c => c.value ?? String(c))).join('\n').includes('command:isabelleRevamp.applySuggestion'),
    'The hover offers sledgehammer proofs');
  console.log('PASS: sledgehammer proofs show in Goals and the hover while it runs');
  await until('sledgehammer finishes', () => !api.getGoalState().running && api.getGoalState().text.includes('Done'), 120);

  // Isabelle/jEdit shows legacy features as warnings.
  const severities = vscode.languages.getDiagnostics(hammered.uri);
  const legacy = severities.find(d => d.message.startsWith('Legacy feature!'));
  assert(legacy, JSON.stringify(severities));
  assert.equal(legacy.severity, vscode.DiagnosticSeverity.Warning);
  assert(!severities.some(d => d.severity === vscode.DiagnosticSeverity.Error), JSON.stringify(severities));
  console.log('PASS: legacy features are warnings, not errors');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
};
