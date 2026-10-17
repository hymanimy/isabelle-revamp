const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const receipts = [];
  const graph = () => api.getProofGraph();
  async function until(label, predicate, limit = 45000) {
    const end = Date.now() + limit;
    while (Date.now() < end) { if (predicate()) return; await pause(25); }
    throw new Error(label + ': ' + JSON.stringify(graph()));
  }
  async function open(name) {
    const doc = await vscode.workspace.openTextDocument(path.join(root, 'examples', name + '.thy'));
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('isabelleRevamp.demoLayout');
    await until(name + ' current graph', () => graph()?.uri === doc.uri.toString() && graph().complete);
    return doc;
  }
  function fitted(view) {
    const b = view.bounds;
    assert(b.tx >= 0 && b.ty >= 0 && b.tx + b.scale * b.graphWidth <= b.width + 1
      && b.ty + b.scale * b.graphHeight <= b.height + 1, JSON.stringify(b));
  }
  const sqrt = await open('Sqrt2');
  await until('Sqrt2 fully checked', () => graph().fully_checked);
  await pause(2200);
  let view = await api.inspectProofGraph('snapshot', { width: 900, height: 400 });
  assert.equal(graph().total, 17); assert.equal(view.nodes.length, 17);
  assert.equal(view.hidden.length, 0); assert.equal(view.foldProved, false); assert.equal(view.replaySpeed, 2);
  assert.equal(view.names.sqrt2_irrational, 'sqrt2_irrational');
  assert(view.header.includes('proved · 17 steps · kernel ✓'));
  assert(!view.rootText.includes('kernel ✓') && !view.rootText.includes('17 steps'));
  assert(view.readable && view.fontPixels >= 11, JSON.stringify(view)); fitted(view);
  for (const node of graph().nodes) { assert.equal(view.names[node.id], node.name); assert.equal(view.labels[node.id], 'L' + node.line); assert.equal(view.statuses[node.id], 'proved'); }
  receipts.push({ check: 'Sqrt2 seventeen names and line numbers visible, green and readable at 900x400', view });
  const elapsed = graph().elapsed; await pause(1200); assert.equal(graph().elapsed, elapsed);
  await api.inspectProofGraph('snapshot', { fold: true }); await pause(6200);
  view = await api.inspectProofGraph('snapshot');
  assert.equal(view.nodes.length, 1); assert.equal(view.names.sqrt2_irrational, 'sqrt2_irrational');
  assert.equal(view.contained.sqrt2_irrational.length, 16);
  for (const node of graph().nodes.slice(1)) assert(view.contained.sqrt2_irrational.includes(`${node.name} · L${node.line}`));
  fitted(view); receipts.push({ check: 'optional fold lists every contained step and preserves theorem name', view });
  await api.inspectProofGraph('snapshot', { fold: false });
  view = await api.inspectProofGraph('snapshot'); assert.equal(view.nodes.length, 17);

  // Replay actual recorded model states. A short synthetic timestamp gap avoids
  // waiting for setup time; the acceptance order is deliberately not source order.
  const final = graph(), nodes = [final.nodes[0], ...final.nodes.filter(n => n.parent === final.nodes[0].id).slice(0, 2)];
  const first = { ...final, nodes: nodes.map(n => ({ ...n, status: 'open' })), edges: [], total: 3, proved: 0, fully_checked: false, elapsed: 0 };
  const middle = { ...first, nodes: first.nodes.map((n, i) => i === 2 ? { ...n, status: 'proved' } : n), proved: 1, elapsed: 10 };
  const last = { ...first, nodes: nodes.map(n => ({ ...n, status: 'proved' })), proved: 3, fully_checked: true, elapsed: 20 };
  const frames = [first, middle, last].map((state, i) => ({ at: i * 10, state }));
  const source = sqrt.getText(), version = sqrt.version;
  for (const speed of [1, 2, 4, 8]) {
    view = await api.inspectProofGraph('replay', { speed, frames });
    assert.deepEqual(view.replayEvents.map(event => event.id), [nodes[2].id, nodes[1].id, nodes[0].id]);
    assert(view.replayEvents.slice(1).every((event, i) => event.at - view.replayEvents[i].at >= 400 / speed - 2), JSON.stringify(view.replayEvents));
    assert.equal(view.playing, false); assert.equal(view.nodes.length, 17); fitted(view);
    receipts.push({ check: 'replay order, visible spacing and final auto Fit at x' + speed, events: view.replayEvents, fit: view.bounds });
  }
  assert.equal(sqrt.version, version); assert.equal(sqrt.getText(), source);
  const swarm = await open('Swarm');
  await until('Swarm admissions annotated', () => graph().nodes.length === 7 && graph().nodes.every(node => node.status === 'open'));
  await pause(200); // Let the 150 ms model-to-webview debounce publish the annotations.
  view = await api.inspectProofGraph('snapshot', { fold: false, speed: 2 });
  assert.equal(view.nodes.length, 7); assert.equal(view.dashed.length, 7);
  assert(view.readable && view.fontPixels >= 11); fitted(view);
  await pause(1500); const before = graph(); assert(before.elapsed >= 1500);
  // The test PATH supplies the existing fake CLI. No model is invoked or file
  // edited: exercise the real Ask active-state callback and Stop lifecycle.
  const sourceBefore = swarm.getText();
  const request = api.sendAsk('Timer lifecycle check');
  await until('new Ask resets timer', () => api.getAskState().active && graph().epoch !== before.epoch, 2000);
  const restarted = graph(); assert(restarted.elapsed < 1000);
  assert.equal(await api.sendAsk('Concurrent request must not restart the timer'), false);
  assert.equal(graph().epoch, restarted.epoch);
  api.stopAsk(); await request;
  assert.equal(swarm.getText(), sourceBefore);
  receipts.push({ check: 'Swarm visible; Ask start resets once; refused concurrent run does not reset', before: before.elapsed, restarted: restarted.elapsed });
  await open('Sqrt2');
  assert(graph().elapsed < 1000, 'Returning to a checked file cannot resurrect its old duration');
  const frozen = graph().elapsed; await pause(1100); assert.equal(graph().elapsed, frozen);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await open('Sqrt2'); assert(graph().elapsed < 1000, 'Closing/reopening resets its duration');
  view = await api.inspectProofGraph('snapshot', { width: 0, height: 0 }); fitted(view);
  fs.writeFileSync(path.join(root, '.dev-host/graph-demo-results.json'), JSON.stringify(receipts, null, 2));
  console.log('PASS: Sqrt2 17 visible names at 900x400, optional named fold, all replay speeds/order/spacing/Fit, Swarm and file/Ask clocks');
};
