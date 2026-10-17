const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { graphSummary } = require('../out/graphTypes');
const { askHtml } = require('../out/askView');
const { goalsHtml } = require('../out/goalsView');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');

exports.run = async function () {
  if (!process.env.M13_ONLY) await require('./m10.cjs').run();
  await require('./askView.cjs').checkAskView();
  const manifest = require('../package.json');
  assert(manifest.contributes.viewsContainers.panel.some(container => container.id === 'isabelle-revamp-ask'));
  assert(manifest.contributes.views['isabelle-revamp-ask'].some(view => view.id === 'isabelleRevamp.ask'));
  assert(askHtml().includes('rows="1"'));
  assert(!goalsHtml({ phase: 'idle', text: '', errors: [] }).includes('id="prompt"'));
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const file = path.join(root, '.dev-host/m13-fixture/Layout.thy');
  const source = 'theory Layout imports Main begin\nlemma ready: "(n::nat) = n"\nproof -\n  have first: "n = n" sorry\n  show ?thesis using first .\nqed\nend\n';
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  const doc = await vscode.workspace.openTextDocument(file);
  let editor = await vscode.window.showTextDocument(doc);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const config = vscode.workspace.getConfiguration('isabelleRevamp');
  const previousPretty = config.inspect('prettySymbols').workspaceValue;
  const previousGoals = config.inspect('demoShowGoals').workspaceValue;
  async function until(label, predicate, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (predicate()) { console.log('PASS: ' + label); return; } await pause(25); }
    throw new Error(label + ': ' + JSON.stringify({ graph: api.getProofGraph(), status: api.getProofStatus(), ask: api.getAskView() }));
  }
  try {
    await config.update('prettySymbols', false, vscode.ConfigurationTarget.Workspace);
    await config.update('demoShowGoals', false, vscode.ConfigurationTarget.Workspace);
    assert(await vscode.commands.executeCommand('isabelleRevamp.demoLayout'));
    await until('Ask is visible in its bottom-panel view', () => api.getAskView().visible);
    const initialView = await api.inspectProofGraph('snapshot');
    assert.equal(initialView.visible, 'visible', 'Graph and Ask must both be visible in the bottom container');
    const layout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    assert.equal(layout.orientation, 0); assert.equal(layout.groups.length, 1);
    assert(vscode.window.tabGroups.all[0].tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === doc.uri.toString()));
    assert.equal(config.get('prettySymbols'), true);
    assert.equal(doc.getText(), source); assert.equal(fs.readFileSync(file, 'utf8'), source);
    await until('status bar follows open graph counts', () => api.getProofGraph()?.complete && api.getProofStatus().text.includes('0/2 proved'));
    assert.equal(api.getProofStatus().alignment, vscode.StatusBarAlignment.Right);
    assert.equal(api.getProofStatus().command, 'isabelleRevamp.showProofGraph');
    editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    editor.selection = new vscode.Selection(3, 4, 3, 4);
    const offset = doc.getText().indexOf('sorry');
    assert(await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + 5)), 'by simp')));
    await doc.save();
    await until('status bar reports the kernel-checked graph', () => api.getProofGraph().fully_checked && api.getProofStatus().text.includes('kernel ✓'));
    assert.equal(api.getProofStatus().text, graphSummary(api.getProofGraph()));
    const stopped = api.getProofStatus().text; await pause(2200); assert.equal(api.getProofStatus().text, stopped, 'Completion freezes elapsed time');
    let graphView = await api.inspectProofGraph('snapshot');
    assert.equal(graphView.nodes.length, 1, 'Completion folds to the root');
    editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 1, 0); await pause(250);
    editor.selection = new vscode.Selection(3, 5, 3, 5); await pause(250);
    graphView = await api.inspectProofGraph('snapshot');
    assert(graphView.focused.includes('ready/first') && graphView.nodes.includes('ready/first'), 'Cursor reveals a folded step');
    const bounds = graphView.bounds;
    assert(bounds.tx >= 0 && bounds.ty >= 0 && bounds.tx + bounds.scale * bounds.graphWidth <= bounds.width + 1
      && bounds.ty + bounds.scale * bounds.graphHeight <= bounds.height + 1, JSON.stringify(bounds));
    await vscode.commands.executeCommand('isabelleRevamp.demoLayout');
    await until('Demo Layout is repeatable and keeps Ask visible', () => api.getAskView().visible && vscode.window.tabGroups.all.length === 1);
    await config.update('demoShowGoals', true, vscode.ConfigurationTarget.Workspace);
    assert(await vscode.commands.executeCommand('isabelleRevamp.demoLayout'));
    assert(await vscode.commands.executeCommand('isabelleRevamp.ask') === undefined);
    fs.writeFileSync(path.join(root, '.dev-host/m13-results.json'), JSON.stringify({ layout, graph: api.getProofGraph(), status: api.getProofStatus(), ask: api.getAskView() }, null, 2));
    console.log('PASS: one editor column, bottom Graph and Ask, optional Goals, Unicode display, status click command, preserved source and repeatable Demo Layout');
  } finally {
    await config.update('prettySymbols', previousPretty, vscode.ConfigurationTarget.Workspace);
    await config.update('demoShowGoals', previousGoals, vscode.ConfigurationTarget.Workspace);
  }
};
