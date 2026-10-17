const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function run() {
  if (!process.env.M10_ONLY) await require('./m8.cjs').run();
  const root = path.resolve(__dirname,'../..');
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const home = path.resolve(root,'../Isabelle2025-2.app');
  const includes = vscode.workspace.getConfiguration('files').get('readonlyInclude');
  assert.equal(includes[home+'/**'],true);
  assert.equal(includes[path.resolve(process.env.HOME,'.isabelle')+'/**'],true);
  const file = path.join(root,'.dev-host/m10-fixture/Library.thy');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,'theory Library imports Complex_Main begin\nlemma "(0::real) = 0" by simp\nend\n');
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(1,12,1,12);
  let definitions;
  for(let i=0;i<100;i++) {
    await pause(100);
    definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider',doc.uri,new vscode.Position(1,12));
    if(definitions?.length) break;
  }
  assert(definitions?.length,'real has a server definition');
  const target = definitions[0].targetUri ?? definitions[0].uri;
  assert(target.fsPath.endsWith('/HOL/Real.thy'),target.fsPath);
  const bytes = fs.readFileSync(target.fsPath);
  const library = await vscode.workspace.openTextDocument(target);
  const libEditor = await vscode.window.showTextDocument(library);
  // readonlyInclude guards editor typing, not trusted extension API edits.
  assert.equal(vscode.workspace.getConfiguration('files',target).get('autoSave'),'off');
  const before = library.getText();
  await vscode.commands.executeCommand('type',{text:'X'});
  const after = library.getText();
  if(after !== before) await vscode.commands.executeCommand('undo');
  assert.equal(after,before,'Read-only library must reject typing');
  assert.equal(library.isDirty,false);
  assert.deepEqual(fs.readFileSync(target.fsPath),bytes);
  console.log('PASS: real definition opens HOL/Real.thy read-only; editor rejects edits; distribution bytes unchanged');
};

exports.run = async () => { try { await run(); } catch(error) { fs.writeFileSync(path.resolve(__dirname,'../../.dev-host/m10-failure.txt'),String(error.stack ?? error)); console.error(error); throw error; } };
