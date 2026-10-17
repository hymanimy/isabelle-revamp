const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { proofStructure } = require('../out/isarSteps');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');

async function run() {
  if (!process.env.M12_ONLY) await require('./m10.cjs').run();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const skeleton = fs.readFileSync(path.join(root, 'examples/Cascade.thy'), 'utf8');
  const solution = fs.readFileSync(path.join(root, 'examples/Cascade_solution.thy'), 'utf8');
  const reference = proofStructure(solution);
  const leaves = reference.nodes.filter(node => !reference.nodes.some(child => child.parent === node.id));
  const file = path.join(root, '.dev-host/m12-fixture/Cascade.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, skeleton);
  const doc = await vscode.workspace.openTextDocument(file);
  let editor = await vscode.window.showTextDocument(doc);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const receipts = [];
  const graph = () => api.getProofGraph();
  const node = id => graph()?.nodes.find(node => node.id === id);
  async function rendered(predicate, timeout = 2000) {
    const deadline = Date.now() + timeout;
    let view;
    do {
      view = await api.inspectProofGraph('snapshot');
      if (predicate(view)) return view;
      await pause(25);
    } while (Date.now() < deadline);
    throw new Error('Webview did not render the expected state: ' + JSON.stringify(view));
  }
  async function until(label, predicate, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (graph()?.uri === doc.uri.toString() && graph().version === doc.version && predicate()) {
        console.log('PASS: ' + label); return;
      }
      await pause(25);
    }
    throw new Error(label + ': ' + JSON.stringify({ graph: graph(), goals: api.getGoalState() }));
  }
  async function replaceLeaf(id, text) {
    const leaf = proofStructure(doc.getText()).nodes.find(node => node.id === id);
    assert(leaf?.finish);
    editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    const position = doc.positionAt(leaf.start); editor.selection = new vscode.Selection(position, position);
    const start = Date.now();
    assert(await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(leaf.finish.start), doc.positionAt(leaf.end)), text)));
    await doc.save();
    await vscode.commands.executeCommand('isabelleRevamp.showProofGraph');
    return start;
  }
  await vscode.commands.executeCommand('isabelleRevamp.showProofGraph');
  await until('Cascade has 52 kernel-annotated nodes and 38 open leaves', () => graph().complete && graph().total === 52
    && leaves.every(leaf => node(leaf.id)?.status === 'open'));
  assert.equal(graph().proved, 0);
  let view = await rendered(view => view.dashed.length === 52);
  assert.equal(view.nodes.length, 52); assert.equal(view.dashed.length, 52);
  assert(view.containers >= 10 && view.edges > 30, JSON.stringify(view)); receipts.push({ check: 'open graph', view, model: graph() });
  if (process.env.M12_BENCH_ONLY) {
    await api.fullscreenProofGraph();
    const result = await api.inspectProofGraph('benchmark');
    fs.writeFileSync(path.join(root, '.dev-host/m12-benchmark.json'), JSON.stringify(result, null, 2));
    assert.equal(result.droppedFrames, 0, JSON.stringify(result));
    console.log('PASS: focused 200-node benchmark'); return;
  }
  const leaf = leaves[0], proof = solution.slice(leaf.finish.start, leaf.end);
  const start = await replaceLeaf(leaf.id, proof);
  await until('hand proof turns leaf green within two seconds', () => node(leaf.id)?.status === 'proved', 2000);
  view = await rendered(view => view.statuses[leaf.id] === 'proved');
  assert(Date.now() - start < 2000, 'The rendered leaf must also turn green within two seconds');
  assert(view.pulseCount > 0 && view.edgePulseCount > 0);
  receipts.push({ check: 'hand proof pulse', milliseconds: Date.now() - start, view });
  await replaceLeaf(leaf.id, 'by (rule TrueI)');
  await until('wrong tactic turns leaf red', () => node(leaf.id)?.status === 'error');
  await pause(2000); view = await api.inspectProofGraph('snapshot'); assert(view.nodes.includes(leaf.id), 'Red must not fold');
  await replaceLeaf(leaf.id, 'sorry');
  await until('restored leaf is open', () => node(leaf.id)?.status === 'open');
  const target = node(leaves[3].id), old = graph();
  await api.selectProofNode(old.uri, old.version - 1, target.id);
  await api.selectProofNode(old.uri, old.version, target.id);
  assert.equal(vscode.window.activeTextEditor.selection.active.line, target.range[0]);
  await vscode.commands.executeCommand('isabelleRevamp.showProofGraph');

  if (process.env.M12_LIVE) {
    // This is the same Ask controller as the panel; each actual edit goes through MCP.
    editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('isabelleRevamp.ask');
    await vscode.commands.executeCommand('isabelleRevamp.showProofGraph');
    let previousText = doc.getText(), previousVersion = doc.version, lastChecked = graph();
    const observed = [], edits = [], timer = setInterval(() => {
      const state = graph();
      if (state.complete) lastChecked = state;
      observed.push({ graph: state, ask: api.getAskState() });
    }, 100);
    const subscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document !== doc || !event.contentChanges.length) return;
      const before = proofStructure(previousText);
      for (const change of event.contentChanges) {
        const leaf = before.nodes.find(node => node.start <= change.rangeOffset && node.end >= change.rangeOffset + change.rangeLength
          && !before.nodes.some(child => child.parent === node.id));
        const dependencies = lastChecked?.version === previousVersion && leaf
          ? lastChecked.edges.filter(edge => edge.to === leaf.id).map(edge => lastChecked.nodes.find(node => node.id === edge.from)) : undefined;
        edits.push({ version: doc.version, leaf: leaf?.id, dependencies, range: change.range, text: change.text });
      }
      previousText = doc.getText(); previousVersion = doc.version;
    });
    try {
      assert(await api.sendAsk('Prove this theorem. Use proof_graph, work bottom-up, and replace exactly one leaf sorry per edit. Preserve the named steps and nested proof structure.'));
      await until('Ask fills the tree and kernel checks the theorem', () => graph().fully_checked, 30000);
      assert(observed.some(item => item.graph.nodes.some(node => node.agent === 'Claude')));
      assert(observed.some(item => item.ask.entries.some(entry => entry.kind === 'tool' && entry.text === 'proof_graph Cascade.thy')));
      assert(edits.length >= 38 && edits.every(edit => edit.leaf && edit.dependencies?.every(node => node.status === 'proved')),
        'Each MCP edit must target one dependency-ready leaf: ' + JSON.stringify(edits));
      assert.deepEqual(graph().nodes.map(node => node.id), reference.nodes.map(node => node.id));
      receipts.push({ check: 'real Claude bottom-up proof', transcript: api.getAskState(), graph: graph(), edits });
      fs.writeFileSync(path.join(root, '.dev-host/m12-live-stream.json'), JSON.stringify(observed, null, 2));
    } finally {
      clearInterval(timer); subscription.dispose(); api.stopAsk();
      fs.writeFileSync(path.join(root, '.dev-host/m12-live-receipt.json'), JSON.stringify({ transcript: api.getAskState(), graph: graph(), edits }, null, 2));
    }
  } else {
    for (const leaf of leaves) {
      await replaceLeaf(leaf.id, solution.slice(leaf.finish.start, leaf.end));
      await until('reference leaf ' + leaf.name, () => node(leaf.id)?.status === 'proved');
    }
    await until('reference leaves kernel check the full tree', () => graph().fully_checked);
  }
  assert(!/\bsorry\b/.test(doc.getText()));
  await pause(6000);
  view = await rendered(view => view.nodes.length === 1, 15000);
  assert.equal(view.nodes.length, 1, JSON.stringify(view)); assert(view.rootText.includes('kernel-checked ✓'));
  receipts.push({ check: 'folded root', view });
  const version = doc.version, before = doc.getText();
  const replay = await api.inspectProofGraph('replay');
  assert.equal(replay.nodes.length, 1, JSON.stringify(replay)); assert.equal(doc.version, version); assert.equal(doc.getText(), before);
  receipts.push({ check: 'offline replay', replay }); console.log('PASS: replay reaches the proved root without editing or querying the prover');
  await api.fullscreenProofGraph();
  const benchmark = await api.inspectProofGraph('benchmark');
  receipts.push({ check: '200-node SVG animation', benchmark });
  fs.writeFileSync(path.join(root, '.dev-host/m12-results.json'), JSON.stringify(receipts, null, 2));
  assert.equal(benchmark.count, 200); assert.equal(benchmark.colourLayouts, 0, JSON.stringify(benchmark));
  assert(benchmark.frames >= 60 && benchmark.pulses >= 199, JSON.stringify(benchmark));
  assert.equal(benchmark.droppedFrames, 0, JSON.stringify(benchmark));
  assert.equal(fs.readFileSync(path.join(root, 'examples/Cascade.thy'), 'utf8'), skeleton);
  console.log('PASS: 200 SVG nodes animate with zero measured dropped frames; no status-only layout; committed skeleton unchanged');
}
exports.run = async () => { try { await run(); } catch (error) { fs.writeFileSync(path.join(root, '.dev-host/m12-failure.txt'), error.stack); throw error; } };
