const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { loadSymbols, unicodeSymbols, symbolReplacements } = require('../out/symbols');
const pause = ms => new Promise(r => setTimeout(r, ms));
exports.run = async function () {
  if (!process.env.M9A_ONLY) await require('./m5.cjs').run();
  const root = path.resolve(__dirname, '../..');
  const original = fs.readFileSync(path.join(root, 'examples/Swarm.thy'), 'utf8');
  const table = await loadSymbols(path.resolve(root, '../Isabelle2025-2.app/bin/isabelle'));
  assert(table.count > 400);
  assert.equal(unicodeSymbols(String.raw`\<Sum>i<n. \<And> \<Longrightarrow> \<notin> \<rat> \<open>x\<close> n^2 x^n x^12 x^foo`), '∑\u2009i<n. ⋀ ⟹ ∉ ℚ ‹x› n² xⁿ x^12 x^foo');
  const directory = path.join(root, '.dev-host/m9a-fixture');
  fs.mkdirSync(directory, {recursive:true});
  const file = path.join(directory, 'Pretty.thy');
  const source = String.raw`theory Pretty imports Complex_Main begin
lemma "(\<Sum>i<(n::nat). 2*i+1) = n^2" sorry
end
`;
  fs.writeFileSync(file, source);
  const doc = await vscode.workspace.openTextDocument(file);
  let editor = await vscode.window.showTextDocument(doc);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const settings = vscode.workspace.getConfiguration('isabelleRevamp');
  const settingsFile = path.join(root,'.vscode/settings.json');
  const originalSettings = fs.readFileSync(settingsFile,'utf8');
  const prior = settings.inspect('prettySymbols').workspaceValue;
  try {
    editor.selection = new vscode.Selection(0,0,0,0);
    await settings.update('prettySymbols', true, vscode.ConfigurationTarget.Workspace);
    await pause(100);
    const replacements = api.getPrettySymbols();
    assert(replacements.some(x => x.text === '∑'));
    assert(replacements.some(x => x.text === '²'));
    const sum = replacements.find(x=>x.text==='∑');
    assert.equal(doc.getText(new vscode.Range(doc.positionAt(sum.start), doc.positionAt(sum.end))), String.raw`\<Sum>`);
    const search = source.indexOf('Sum');
    editor.selection = new vscode.Selection(doc.positionAt(search),doc.positionAt(search+3));
    await pause(100);
    assert(!api.getPrettySymbols().some(x=>x.start===sum.start));
    editor.selection = new vscode.Selection(0,0,0,0);
    await vscode.commands.executeCommand('isabelleRevamp.togglePrettySymbols');
    assert.equal(api.getPrettySymbols().length,0);
    await vscode.commands.executeCommand('isabelleRevamp.togglePrettySymbols');
    assert(api.getPrettySymbols().length>0);
    assert.equal(doc.getText(), source);
    assert.equal(fs.readFileSync(file,'utf8'),source);
    console.log('PASS: installed table, display ranges, source search selection reveals ASCII, toggle and unchanged source');
    // Ask the real LSP provider inside an Isar quoted formula, then accept its suggestion.
    const completionSource = 'theory Pretty imports Complex_Main begin\nlemma "\\Sum" sorry\nend\n';
    await editor.edit(edit=>edit.replace(new vscode.Range(0,0,doc.lineCount,0),completionSource));
    editor.selection = new vscode.Selection(1,11,1,11);
    let items;
    for(let i=0;i<40;i++) {
      await pause(100);
      items = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',doc.uri,new vscode.Position(1,11));
      if(items?.items.some(x=>JSON.stringify(x).includes('Sum'))) break;
    }
    fs.writeFileSync(path.join(root,'.dev-host/m9a-completion.json'), JSON.stringify(items,null,2));
    const completion = items?.items.find(x=>JSON.stringify(x).includes('\\<Sum>'));
    assert(completion, JSON.stringify(items));
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    await pause(700);
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    assert(doc.getText().includes(String.raw`\<Sum>`),doc.getText());
    assert(!doc.getText().includes('∑'));
    console.log('PASS: real server completion and stock suggestion acceptance insert ASCII \\<Sum>');
    assert.equal(fs.readFileSync(path.join(root,'examples/Swarm.thy'),'utf8'),original);
    fs.writeFileSync(path.join(root,'.dev-host/m9a-results.json'),JSON.stringify({table,replacements,completion,passed:true},null,2));
  } finally {
    await settings.update('prettySymbols', prior, vscode.ConfigurationTarget.Workspace);
    // VS Code reformats the preceding setting when removing our temporary key.
    if (JSON.stringify(JSON.parse(fs.readFileSync(settingsFile,'utf8'))) === JSON.stringify(JSON.parse(originalSettings))) {
      fs.writeFileSync(settingsFile,originalSettings);
    }
    editor = await vscode.window.showTextDocument(doc);
    await editor.edit(edit=>edit.replace(new vscode.Range(0,0,doc.lineCount,0),source));
    await doc.save();
  }
};
