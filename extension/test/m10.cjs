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
  await checkColors(root,api);
  await checkSymbols(root,api);
  await checkScripts(root,api);
};

exports.run = async () => { try { await run(); } catch(error) { fs.writeFileSync(path.resolve(__dirname,'../../.dev-host/m10-failure.txt'),String(error.stack ?? error)); console.error(error); throw error; } };

async function checkColors(root,api) {
  const file = path.join(root,'.dev-host/m10-fixture/Colours.thy');
  fs.writeFileSync(file,String.raw`theory Colours imports Main begin
lemma "(\<lambda>x::nat. x) n = n"
proof -
  fix k :: nat
  have "k = k" by simp
  show ?thesis by simp
qed
end
`);
  const doc = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(4,8,4,8);
  let colors;
  for(let i=0;i<200;i++) {
    await pause(50); colors = api.getSemanticColors();
    if(['free','bound','skolem'].every(kind=>colors.some(c=>c.kind===kind))) break;
  }
  fs.writeFileSync(path.join(root,'.dev-host/m10-colours.json'),JSON.stringify(colors,null,2));
  for(const kind of ['free','bound','skolem']) assert(colors.some(c=>c.kind===kind),JSON.stringify(colors));
  assert(colors.some(c=>c.kind==='free' && c.text==='n'));
  assert(colors.some(c=>c.kind==='bound' && c.text==='x'));
  assert(colors.some(c=>c.kind==='skolem' && c.text==='k'));
  console.log('PASS: live PIDE free n, bound x, and fixed skolem k map to standard theme scopes');
}

async function checkSymbols(root,api) {
  const { encodeSymbols, decodeSymbols } = require('../out/symbols');
  assert.equal(encodeSymbols('≠ ⟹ ⋀ ‹› 𝒜'),String.raw`\<noteq> \<Longrightarrow> \<And> \<open>\<close> \<A>`);
  assert.equal(decodeSymbols(String.raw`\<noteq>`),'≠');
  const file=path.join(root,'.dev-host/m10-fixture/Input.thy');
  fs.writeFileSync(file,'theory Input imports Main begin\ntext ""\nend\n');
  const doc=await vscode.workspace.openTextDocument(file);
  let editor=await vscode.window.showTextDocument(doc);
  const settings=vscode.workspace.getConfiguration('isabelleRevamp',doc.uri);
  assert.equal(settings.get('unicodeOnSave'),false);
  const samples=[[String.raw`\noteq`,String.raw`\<noteq>`],['~=',String.raw`\<noteq>`],['==>',String.raw`\<Longrightarrow>`],['!!',String.raw`\<And>`]];
  const receipts=[];
  for(const [abbr,expected] of samples) {
    await editor.edit(edit=>edit.replace(new vscode.Range(1,0,1,doc.lineAt(1).text.length),'text "'+abbr+'"'));
    const position=new vscode.Position(1,6+abbr.length);
    editor.selection=new vscode.Selection(position,position);
    await pause(150);
    const completions=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',doc.uri,position);
    assert(completions.items.some(item=>(item.textEdit?.newText??item.insertText)===expected),JSON.stringify(completions));
    assert(completions.items.every(item=>!/[≠⟹⋀]/.test(item.textEdit?.newText??item.insertText??'')));
    await vscode.commands.executeCommand('editor.action.triggerSuggest');await pause(200);
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    assert(doc.getText().includes(expected),doc.getText());
    receipts.push({abbr,inserted:doc.lineAt(1).text});
  }
  assert(api.getAbbreviations().some(pair=>pair[0]==='hence' && pair[1]==='then have'));
  // Direct pasted Unicode is normalised on save; opt-in permits Unicode.
  await editor.edit(edit=>edit.replace(new vscode.Range(1,0,1,doc.lineAt(1).text.length),'text "≠ ⟹ ⋀ ‹›"'));
  await doc.save();assert(fs.readFileSync(file,'utf8').includes(String.raw`\<noteq>`));
  const configFile=path.join(root,'.vscode/settings.json'),original=fs.readFileSync(configFile,'utf8');
  const prior=settings.inspect('unicodeOnSave').workspaceValue;
  try {
    await settings.update('unicodeOnSave',true,vscode.ConfigurationTarget.Workspace);
    await editor.edit(edit=>edit.insert(new vscode.Position(1,0),' '));
    await doc.save();assert(fs.readFileSync(file,'utf8').includes('≠'));
  } finally {
    await settings.update('unicodeOnSave',prior,vscode.ConfigurationTarget.Workspace);
    if(JSON.stringify(JSON.parse(fs.readFileSync(configFile,'utf8')))===JSON.stringify(JSON.parse(original))) fs.writeFileSync(configFile,original);
    await editor.edit(edit=>edit.insert(new vscode.Position(1,0),' '));await doc.save();
  }
  assert(!/[≠⟹⋀‹›]/.test(fs.readFileSync(file,'utf8')));
  fs.writeFileSync(path.join(root,'.dev-host/m10-symbols.json'),JSON.stringify({receipts,abbrevs:api.getAbbreviations()},null,2));
  console.log('PASS: session abbreviations, four accepted symbol completions, ASCII saves, explicit Unicode opt-in and restoration');
}

async function checkScripts(root,api) {
  const {scriptRanges}=require('../out/scriptDecorations');
  const source=String.raw`m\<^sup>2 x\<^sub>1 y\<^sup>\<alpha> z\<^bsup>n+1\<^esup> v\<^bsub>i+1\<^esub> \<^bold>A`;
  const groups=scriptRanges(source);
  assert.deepEqual(groups.map(group=>[group.style,source.slice(...group.content)]),[['sup','2'],['sub','1'],['sup',String.raw`\<alpha>`],['sup','n+1'],['sub','i+1'],['bold','A']]);
  assert.equal(scriptRanges(String.raw`x\<^sup> y\<^sub>
z\<^bsup>n`).length,0);
  assert.equal(scriptRanges('x⇧𝒜')[0].content[1]-scriptRanges('x⇧𝒜')[0].content[0],2);
  const file=path.join(root,'.dev-host/m10-fixture/Scripts.thy');
  const original='theory Scripts imports Main begin\ntext "'+source+'"\nend\n';
  fs.writeFileSync(file,original);
  const doc=await vscode.workspace.openTextDocument(file),editor=await vscode.window.showTextDocument(doc);
  editor.selection=new vscode.Selection(0,0,0,0);await pause(100);
  assert.equal(api.getScriptDecorations().length,6);
  assert(!api.getPrettySymbols().some(item=>item.text==='⇧' || item.text==='⇩'));
  const group=api.getScriptDecorations()[0],caret=doc.positionAt(group.controls[0][0]+3);
  editor.selection=new vscode.Selection(caret,caret);await pause(100);
  assert.equal(api.getScriptDecorations().length,5);
  assert.equal(doc.getText(),original);assert.equal(fs.readFileSync(file,'utf8'),original);
  console.log('PASS: ASCII/Unicode script controls, symbol arguments, nested-capable blocks, cursor reveal and unchanged bytes');
}
