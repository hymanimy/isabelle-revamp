const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vscode = require('vscode');
const { proofStructure } = require('../out/isarSteps');
const exec = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');
const isabelle = process.env.ISABELLE_EXECUTABLE || path.resolve(root, '../Isabelle2025-2.app/bin/isabelle');
const originalName = 'sqrt4_irrational', counterName = originalName + '_refuted';

exports.run = async function () {
  if (!process.env.M14_ONLY) await require('./m10.cjs').run();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const skeleton = fs.readFileSync(path.join(root, 'examples/card/Sqrt4.thy'), 'utf8');
  const solution = fs.readFileSync(path.join(root, 'examples/card/Sqrt4_solution.thy'), 'utf8');
  const reference = solution.slice(solution.indexOf('lemma '), solution.lastIndexOf('\nend'));
  const file = path.join(root, '.dev-host/m14-fixture/Sqrt4.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, skeleton);
  const doc = await vscode.workspace.openTextDocument(file);
  let editor = await vscode.window.showTextDocument(doc);
  editor.selection = new vscode.Selection(4, 0, 4, 0);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  const graph = () => api.getProofGraph();
  const node = name => graph()?.nodes.find(n => n.name === name);
  const receipts = [];
  async function until(label, predicate, limit = 30000) {
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (graph()?.uri === doc.uri.toString() && graph().version === doc.version && predicate()) return;
      await pause(20);
    }
    throw new Error(label + ': ' + JSON.stringify({ graph: graph(), goals: api.getGoalState() }));
  }
  async function rendered(predicate, limit = 2000) {
    const start = Date.now(); let view;
    do { view = await api.inspectProofGraph('snapshot'); if (predicate(view)) return view; await pause(20); } while (Date.now() - start < limit);
    throw new Error('Rendered graph: ' + JSON.stringify(view));
  }
  async function replace(start, end, text, line = 4) {
    editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    editor.selection = new vscode.Selection(line, 0, line, 0);
    const when = Date.now();
    assert(await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(start), doc.positionAt(end)), text)));
    await doc.save(); await vscode.commands.executeCommand('isabelleRevamp.showProofGraph');
    return when;
  }
  async function wireCheck() {
    const result = await exec(path.join(root, 'mcp/.venv/bin/python'), [path.join(root, 'mcp/check_refutation.py'), file], { cwd: root, env: process.env, timeout: 30000 });
    const wire = JSON.parse(result.stdout);
    for (const key of ['nodes', 'edges', 'complete', 'fully_checked', 'version']) assert.deepEqual(wire.graph[key], JSON.parse(JSON.stringify(graph()[key])));
    return wire;
  }
  async function kernelCheck() {
    assert.equal((doc.getText().match(/\bsorry\b/g) || []).length, 1);
    const combined = await exec(isabelle, ['process_theories', '-o', 'quick_and_dirty=true', '-D', path.dirname(file), '-O', 'Sqrt4'], { timeout: 120000 });
    const counter = proofStructure(doc.getText()).nodes.find(n => n.name === counterName);
    assert(counter?.closed && counter.command === 'lemma');
    const independent = 'theory Refutation imports Complex_Main begin\n' + doc.getText().slice(counter.start, counter.end) + '\nend\n';
    fs.writeFileSync(path.join(path.dirname(file), 'Refutation.thy'), independent);
    const strict = await exec(isabelle, ['process_theories', '-D', path.dirname(file), '-O', 'Refutation'], { timeout: 120000 });
    return { combined: combined.stdout + combined.stderr, strict: strict.stdout + strict.stderr, independent };
  }
  try {
    await vscode.commands.executeCommand('isabelleRevamp.demoLayout');
    await until('original admission is open', () => graph().complete && node(originalName)?.status === 'open');
    await rendered(view => view.dashed.includes(originalName));
    const index = doc.getText().indexOf('sorry');
    const when = await replace(index, index + 5, 'by (rule TrueI)');
    await until('wrong tactic red within two seconds', () => node(originalName)?.status === 'error', 2000);
    let view = await rendered(view => view.statuses[originalName] === 'error');
    assert(Date.now() - when < 2000);
    assert(api.getProofStatus().text.includes('error'));
    receipts.push({ check: 'honest kernel rejection', milliseconds: Date.now() - when, view });
    await replace(index, index + 'by (rule TrueI)'.length, 'sorry');
    await until('restored original admission', () => graph().complete && node(originalName)?.status === 'open');
    const insert = doc.getText().lastIndexOf('\nend');
    await replace(insert, insert, '\n' + reference);
    await until('independent refutation accepted while original stays unfinished', () => graph().complete && node(counterName)?.status === 'proved' && node(originalName)?.status === 'refuted');
    view = await rendered(view => view.statuses[originalName] === 'refuted' && view.labels[originalName].includes('refuted'));
    assert.equal(api.getProofStatus().text, 'refuted · kernel ✓');
    assert(view.edgePulseCount > 0); const layoutCount = view.layoutCount;
    const wire = await wireCheck();
    await pause(2200); view = await api.inspectProofGraph('snapshot');
    assert(view.nodes.includes(originalName) && view.nodes.includes(counterName), 'Red original and green counter-lemma must stay visible');
    assert.equal(view.layoutCount, layoutCount, 'Status transitions do not relayout');
    receipts.push({ check: 'kernel refutation, stable layout and matching MCP model', view, wire });
    const refProof = doc.getText().indexOf('by simp', insert);
    await replace(refProof, refProof + 'by simp'.length, 'sorry', 7);
    await until('admitting the counter-proof retracts refuted', () => graph().complete && node(counterName)?.status === 'open' && node(originalName)?.status === 'open' && !api.getProofStatus().text.includes('kernel ✓'));
    assert(!api.getProofStatus().text.includes('kernel ✓'));
    await replace(0, doc.getText().length, skeleton);
    await until('removing the counter-lemma retracts its edge', () => graph().complete && graph().total === 1 && node(originalName)?.status === 'open');
    assert(!graph().edges.some(e => e.kind === 'refutation'));
    console.log('PASS: real kernel rejection <2s, accepted counter-lemma, red original, MCP parity, no folding red and retraction');

    if (process.env.M14_LIVE) {
      const events = [], edits = [];
      const protectedEnd = skeleton.indexOf('sorry') + 5;
      let previous = skeleton, acceptedAt, finishedAt, failure, inspecting = false, lastProgress = '';
      const subscription = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document !== doc || !event.contentChanges.length) return;
        for (const change of event.contentChanges) edits.push({ milliseconds: Date.now() - started,
          offset: change.rangeOffset, length: change.rangeLength, text: change.text,
          originalUntouched: change.rangeOffset >= protectedEnd && previous.slice(0, protectedEnd) === skeleton.slice(0, protectedEnd) });
        previous = doc.getText();
      });
      await vscode.commands.executeCommand('isabelleRevamp.demoLayout');
      const started = Date.now();
      const timer = setInterval(() => {
        const state = graph();
        if (!acceptedAt && !inspecting && node(counterName)?.status === 'proved' && node(originalName)?.status === 'refuted') {
          inspecting = true;
          api.inspectProofGraph('snapshot').then(view => {
            if (view.statuses[counterName] === 'proved' && view.statuses[originalName] === 'refuted') acceptedAt = Date.now() - started;
          }).finally(() => { inspecting = false; });
        }
        events.push({ milliseconds: Date.now() - started, graph: state, ask: api.getAskState() });
        const entry = api.getAskState().entries.at(-1);
        const progress = entry && `${entry.kind}: ${entry.text}`;
        if (progress && progress !== lastProgress) {
          lastProgress = progress;
          fs.writeFileSync(path.join(root, '.dev-host/m14-progress.json'), JSON.stringify({ milliseconds: Date.now() - started, ask: api.getAskState() }, null, 2));
        }
      }, 50);
      const timeout = setTimeout(() => api.stopAsk(), 120000);
      let kernel;
      try {
        assert(await api.sendAsk('prove that the square root of 4 is irrational'));
        finishedAt = Date.now() - started;
        await until('live Claude counter-proof accepted', () => node(counterName)?.status === 'proved' && node(originalName)?.status === 'refuted', 5000);
        assert(edits.length > 0 && edits.every(edit => edit.originalUntouched), JSON.stringify(edits));
        assert.equal(doc.getText().slice(0, protectedEnd), skeleton.slice(0, protectedEnd));
        assert.equal((doc.getText().match(/\bsorry\b/g) || []).length, 1);
        view = await rendered(view => view.statuses[originalName] === 'refuted' && view.statuses[counterName] === 'proved');
        assert.equal(api.getProofStatus().text, 'refuted · kernel ✓');
        assert(api.getAskState().entries.some(entry => entry.kind === 'tool' && entry.text.startsWith('edit ')));
        for (const tool of ['errors Sqrt4.thy', 'status', 'proof_graph Sqrt4.thy']) {
          assert(api.getAskState().entries.some(entry => entry.kind === 'tool' && entry.text === tool), 'Claude must check ' + tool);
        }
        assert(events.some(event => event.graph.nodes.some(n => n.agent === 'Claude')));
        await wireCheck();
        // Stop the live stopwatch before running the separate batch audit.
        clearInterval(timer); clearTimeout(timeout);
        kernel = await kernelCheck();
        assert(acceptedAt <= 30000, 'Refutation took ' + acceptedAt + ' ms; required <=30000');
      } catch (error) { failure = error; }
      finally {
        clearInterval(timer); clearTimeout(timeout); subscription.dispose(); api.stopAsk();
        const transcript = api.getAskState();
        const receipt = { acceptedAt, finishedAt, failure: failure?.stack, edits, graph: graph(), view, transcript, kernel, source: doc.getText() };
        fs.writeFileSync(path.join(root, '.dev-host/m14-live.json'), JSON.stringify(receipt, null, 2));
        fs.writeFileSync(path.join(root, '.dev-host/m14-stream.json'), JSON.stringify(events, null, 2));
        const directory = path.join(root, 'docs/card-runs'); fs.mkdirSync(directory, { recursive: true });
        let run = 1; while (fs.existsSync(path.join(directory, `Sqrt4-${run}.md`))) run++;
        const log = `# Sqrt4 refutation — run ${run}\n\nDate: ${new Date().toISOString()}\n\nPrompt: prove that the square root of 4 is irrational\n\nReal Ask controller in VS Code, real Claude Code and MCP, real Isabelle2025-2.\n\nAccepted after: ${acceptedAt ?? 'not accepted'} ms. Reply completed after: ${finishedAt ?? 'not completed'} ms.\n\nResult: ${failure ? 'FAIL\n\n```text\n' + failure.stack + '\n```' : 'PASS — original theorem unchanged; one sorry; green counter-lemma; red original; status bar refuted · kernel ✓.'}\n\n${kernel ? 'Batch checks: combined file exits 0 with -o quick_and_dirty=true for the original sorry; extracted counter-lemma exits 0 with default admissions disabled.\n\n' : ''}## Transcript\n\n`;
        fs.writeFileSync(path.join(directory, `Sqrt4-${run}.md`), log + transcript.entries.map(entry => `**${entry.kind}**\n\n\`\`\`text\n${entry.text}\n\`\`\`\n`).join('\n') + '\n## Resulting source\n\n```isabelle\n' + doc.getText() + '```\n');
      }
      if (failure) throw failure;
      console.log('PASS: real Ask refutation accepted in ' + acceptedAt + ' ms, original untouched, independent batch proof checked');
    }
  } finally { fs.writeFileSync(path.join(root, '.dev-host/m14-results.json'), JSON.stringify(receipts, null, 2)); }
};
