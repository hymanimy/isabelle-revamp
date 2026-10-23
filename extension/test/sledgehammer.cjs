const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async () => {
  const root = path.resolve(__dirname, '../..');
  const { sledgehammer } = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const file = path.join(root, '.dev-host/sledgehammer/Hammer.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const source = 'theory Hammer imports Main begin\n\nlemma comm: "(a::int) * b + c = c + b * a"\n  sorry\n\n'
    + 'lemma fermat3: "(x::nat) ^ 3 + y ^ 3 \\<noteq> z ^ 3 \\<or> x * y * z = 0"\n  sorry\n\nend\n';
  fs.writeFileSync(file, source);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 0, 0, 0);

  // Started as soon as the theory opens, before Isabelle has parsed it.
  let run = await sledgehammer.start(document, 2, 2, 'test');
  await sledgehammer.finished(run, 90000);
  assert.equal(run.status, 'finished');
  assert(run.proofs.length && run.proofs.every(proof => proof.startsWith('by ')), JSON.stringify(run));
  assert(run.messages.at(-1).text === 'Done', JSON.stringify(run.messages));
  assert.equal(document.getText(), source); assert(!document.isDirty);
  assert.deepEqual([editor.selection.active.line, editor.selection.active.character], [0, 0]);
  console.log(`PASS: sledgehammer runs on a just-opened theory without editing it or moving the cursor: ${run.proofs.join(', ')}`);

  // One query at a time: a second caller is refused until the first ends or is cancelled.
  run = await sledgehammer.start(document, 5, 2, 'test');
  for (let i = 0; i < 300 && run.status !== 'running'; i++) await pause(100);
  assert.equal(run.status, 'running');
  await assert.rejects(sledgehammer.start(document, 2, 2, 'agent'), /already running for test at line 6/);
  const cancelled = Date.now();
  await sledgehammer.cancel();
  await sledgehammer.finished(run, 15000);
  assert.equal(run.status, 'finished'); assert(run.cancelled);
  assert(Date.now() - cancelled < 15000);
  console.log(`PASS: a second sledgehammer is refused while one runs; cancel stops it in ${Date.now() - cancelled} ms`);
};
