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
  await checkGoalMarkup(root,api);
  await checkCartouches(root,api);
  await checkGoalLinks(root,api);
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
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await vscode.commands.executeCommand('editor.action.triggerSuggest');
    // The provider result can precede the suggestion widget. Wait for an actual
    // accepted edit instead of assuming it renders within a fixed 200 ms.
    const deadline = Date.now() + 3000;
    while (!doc.getText().includes(expected) && Date.now() < deadline) {
      await pause(100);
      await vscode.commands.executeCommand('acceptSelectedSuggestion');
    }
    assert(doc.getText().includes(expected),JSON.stringify({ text:doc.getText(), focused:vscode.window.state.focused,
      editor:vscode.window.activeTextEditor?.document.uri.fsPath, selection:vscode.window.activeTextEditor?.selection }));
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

async function checkGoalMarkup(root,api) {
  require('./goalHtml.cjs').checkGoalHtml();
  const {goalsHtml}=require('../out/goalsView');
  const file=path.join(root,'examples/Sqrt2.thy');
  const doc=await vscode.workspace.openTextDocument(file),editor=await vscode.window.showTextDocument(doc);
  editor.selection=new vscode.Selection(16,4,16,4);
  for(let i=0;i<200;i++) { await pause(50);if(api.getGoalState().text.includes('(sqrt 2)²') && api.getGoalState().checkStatus==='fully_checked')break; }
  const state=api.getGoalState(),html=goalsHtml(state);
  assert(state.html.includes('class="keyword1"'));
  assert(state.html.includes('⇧2'));
  assert(html.includes('class="keyword1"'));
  assert(html.includes('class="isabelle-script-sup">2'));
  assert(!html.includes('href="file:'));
  assert(state.text.includes('(sqrt 2)²'));
  fs.writeFileSync(path.join(root,'.dev-host/m10-goal-rendered.html'),html);
  console.log('PASS: real server goal classes and superscript render in sidebar while plain goal text remains unchanged');
}

async function checkCartouches(root,api) {
  const {quotesToCartouche}=require('../out/cartouches');
  assert.equal(quotesToCartouche('"plain"'),String.raw`\<open>plain\<close>`);
  assert.equal(quotesToCartouche(String.raw`"say \"hi\""`),String.raw`\<open>say "hi"\<close>`);
  assert.throws(()=>quotesToCartouche('"one" "two"'));
  assert.throws(()=>quotesToCartouche(String.raw`"\<close>"`));
  const file=path.join(root,'.dev-host/m10-fixture/Cartouches.thy');
  fs.writeFileSync(file,'theory Cartouches imports Main begin\nlemma "(n::nat) = n" by simp\nend\n');
  const doc=await vscode.workspace.openTextDocument(file),editor=await vscode.window.showTextDocument(doc);
  editor.selection=new vscode.Selection(1,6,1,20);
  assert(await vscode.commands.executeCommand('isabelleRevamp.convertQuotes'));
  await doc.save();assert(doc.getText().includes(String.raw`lemma \<open>(n::nat) = n\<close> by simp`));
  editor.selection=new vscode.Selection(1,1,1,1);
  for(let i=0;i<200;i++){ await pause(50);if(api.getGoalState().checkStatus==='fully_checked')break; }
  assert.equal(api.getGoalState().checkStatus,'fully_checked',JSON.stringify(api.getGoalState()));
  for(const [abbr,expected] of [['<<',String.raw`\<open>`],['>>',String.raw`\<close>`]]) {
    await editor.edit(edit=>edit.insert(new vscode.Position(2,0),'text '+abbr+'\n'));
    const pos=new vscode.Position(2,5+abbr.length);editor.selection=new vscode.Selection(pos,pos);await pause(100);
    const items=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',doc.uri,pos);
    assert(items.items.some(item=>(item.textEdit?.newText??item.insertText)===expected),JSON.stringify(items));
    await vscode.commands.executeCommand('editor.action.triggerSuggest');await pause(150);
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    assert(doc.lineAt(2).text.includes(expected),doc.lineAt(2).text);
    await editor.edit(edit=>edit.delete(new vscode.Range(2,0,3,0)));
  }
  // Actual editor auto-closing, then default save converts both glyphs to ASCII.
  await editor.edit(edit=>edit.insert(new vscode.Position(2,0),'text \n'));
  editor.selection=new vscode.Selection(2,5,2,5);
  await vscode.commands.executeCommand('type',{text:'‹'});
  assert.equal(doc.lineAt(2).text,'text ‹›');
  await doc.save();assert.equal(doc.lineAt(2).text,String.raw`text \<open>\<close>`);
  console.log('PASS: selected quote conversion kernel-checks, cartouche abbreviations accept ASCII, Unicode auto-close saves ASCII');
}

async function checkGoalLinks(root,api) {
  const {GoalLinks,hoverText}=require('../out/goalLinks');
  const {goalMarkup}=require('../out/goalHtml');
  const doc=await vscode.workspace.openTextDocument(path.join(root,'examples/Sqrt2.thy'));
  const editor=await vscode.window.showTextDocument(doc);
  editor.selection=new vscode.Selection(16,4,16,4);
  let snapshot;
  for(let i=0;i<200;i++) {
    await pause(50);snapshot=api.getGoalLinks();
    if(snapshot.links.some(link=>link.label==='sqrt') && api.getGoalState().checkStatus==='fully_checked')break;
  }
  const index=snapshot.links.findIndex(link=>link.label==='sqrt');assert(index>=0,JSON.stringify(snapshot));
  const link=snapshot.links[index];assert(link.file.endsWith('/HOL/NthRoot.thy'));assert.equal(link.line,396);
  const driver=new GoalLinks([path.resolve(root,'../Isabelle2025-2.app')]);
  await assert.rejects(()=>driver.target({file:'/etc/hosts',line:0,label:'localhost'}),/outside/);
  const target=await driver.target(link);
  let tooltip='';
  for(let i=0;i<15 && !tooltip;i++) {
    snapshot=api.getGoalLinks();const id=snapshot.links.findIndex(link=>link.label==='sqrt');
    tooltip=await api.hoverGoalLink(id,snapshot.revision);await pause(50);
  }
  assert(tooltip, 'Real editor hover should be present for sqrt');
  const hovers=await vscode.commands.executeCommand('vscode.executeHoverProvider',target.document.uri,target.range.start);
  assert.equal(tooltip,hoverText(hovers));
  const before=vscode.window.activeTextEditor.document.uri.toString();
  await api.followGoalLink(index,snapshot.revision-1);
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(),before);
  // Opening/hovering a library can publish new goal markup. Click the current
  // revision, after checking that the intentionally stale one was rejected.
  const current=api.getGoalLinks();
  await api.followGoalLink(current.links.findIndex(item=>item.label==='sqrt'),current.revision);
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath,link.file);
  assert(vscode.window.activeTextEditor.selection.start.isEqual(target.range.start));
  const bytes=target.document.getText();await vscode.commands.executeCommand('type',{text:'X'});
  assert.equal(target.document.getText(),bytes,'Navigated library remains read-only');
  fs.writeFileSync(path.join(root,'.dev-host/m10-goal-links.json'),JSON.stringify({link,range:target.range,tooltip},null,2));
  console.log('PASS: live goal link, exact editor-provider hover, stale-click refusal, canonical path boundary and read-only navigation');
}
