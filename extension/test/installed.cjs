const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  const extension = vscode.extensions.getExtension('hymanimy.isabelle-revamp');
  assert(extension, 'The VSIX must be installed in real VS Code first');
  assert(!extension.extensionPath.startsWith(root), extension.extensionPath);
  assert(!fs.existsSync(path.join(extension.extensionPath, 'node_modules')));
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'extension/test/fixtures/Sqrt2.thy'));
  const editor = await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, 'isabelle');
  const api = await extension.activate();
  const sample = () => ({ goals: api.getGoalState() });
  async function until(predicate, seconds = 60) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) { if (predicate()) return; await pause(100); }
    throw new Error('Installed check timed out: ' + JSON.stringify(sample()));
  }
  const receipts = { extensionPath: extension.extensionPath, mode: extension.extensionMode, vscode: vscode.version };
  editor.selection = new vscode.Selection(16, 4, 16, 4);
  await vscode.commands.executeCommand('isabelleRevamp.showGoals');
  await vscode.window.showTextDocument(doc);
  await until(() => api.getGoalState().checkStatus === 'fully_checked');
  assert(api.getGoalState().html.includes('class='));
  assert(api.getSemanticColors().length > 0);
  assert.equal(vscode.languages.getDiagnostics(doc.uri).filter(d => d.severity === 0).length, 0);
  receipts.sqrt2 = sample();
  receipts.setup = await vscode.commands.executeCommand('isabelleRevamp.setupCheck');
  assert(receipts.setup[0].startsWith('✓') && receipts.setup[1].startsWith('✓'), receipts.setup.join('\n'));
  console.log('PASS: installed bundle, Sqrt2 highlighting tokens, live Goals and Isabelle/HOL setup check');
  fs.writeFileSync(path.join(root, '.dev-host/m11-installed-results.json'), JSON.stringify(receipts, null, 2));
};
