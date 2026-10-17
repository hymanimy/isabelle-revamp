const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  require('./isarSteps.cjs').checkSteps();
  await require('./swarmView.cjs').checkSwarmView();
  await require('./m6.cjs').run();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const root = path.resolve(__dirname, '../..');
  const original = fs.readFileSync(path.join(root, 'examples/Swarm.thy'), 'utf8');
  const file = path.join(root, '.dev-host/m7-fixture/Swarm.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, original);
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  const receipts = [];
  const card = label => api.getSwarmState().cards.find(card => card.label === label);
  async function until(label, predicate, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (api.getSwarmState().uri === document.uri.toString()
        && api.getSwarmState().version === document.version && predicate()) {
        const receipt = { check: label, milliseconds: Date.now() - start, state: api.getSwarmState() };
        receipts.push(receipt); console.log('PASS: ' + label); return receipt;
      }
      await pause(20);
    }
    throw new Error(label + ': ' + JSON.stringify({ board: api.getSwarmState(), goals: api.getGoalState(),
      diagnostics: vscode.languages.getDiagnostics(document.uri) }));
  }
  async function replaceFirst(before, after) {
    const offset = document.getText().indexOf(before, document.getText().indexOf('have base:'));
    assert(offset >= 0);
    const start = Date.now();
    assert(await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(offset), document.positionAt(offset + before.length)), after)));
    return start;
  }
  try {
    await vscode.commands.executeCommand('isabelleRevamp.showSwarm');
    await vscode.window.showTextDocument(document);
    await until('opening Swarm shows six grey cards', () => api.getSwarmState().cards.length === 6
      && api.getSwarmState().cards.every(card => card.status === 'sorry'));
    assert.equal(api.getSwarmState().proved, 0);
    assert.equal(api.getSwarmState().fullyChecked, false);
    assert.equal(api.getSwarmState().startedAt, undefined);

    // Simulate selecting the first sorry by hand; opening alone above stays at
    // the theory header and must still display all six admissions.
    editor.selection = new vscode.Selection(9, 4, 9, 9);

    const start = await replaceFirst('sorry', 'by simp');
    await until('hand proof turns base green within two seconds', () => card('base')?.status === 'proved', 2000);
    assert(Date.now() - start < 2000);
    assert(api.getSwarmState().startedAt >= start);
    assert.equal(api.getSwarmState().proved, 1);
    assert.equal(card('base').agent, undefined);
    await replaceFirst('by simp', 'by (rule TrueI)');
    await until('wrong tactic turns base red', () => card('base')?.status === 'error', 2000);
    assert.equal(api.getSwarmState().fullyChecked, false);
    await replaceFirst('by (rule TrueI)', 'by simp');
    await until('restored hand proof is green', () => card('base')?.status === 'proved');

    const state = api.getSwarmState(), clicked = card('next_square');
    await api.selectSwarmStep(state.uri, state.version, clicked.id);
    assert.equal(editor.selection.active.line, clicked.range[0]);
    await until('card click updates cursor goals', () => api.getGoalState().text.includes('(Suc k)²'));
    const selection = editor.selection;
    await api.selectSwarmStep(state.uri, state.version - 1, card('base').id);
    assert(editor.selection.isEqual(selection), 'Stale card clicks must not jump to a moved range');

    const slow = 'proof -\n    ML_prf \\<open>OS.Process.sleep (Time.fromReal 2.0)\\<close>\n    show ?thesis by simp\n  qed';
    await replaceFirst('by simp', slow);
    await until('checking card is amber', () => card('base')?.status === 'checking', 2000);
    await until('checked nested proof returns green', () => card('base')?.status === 'proved');
    await replaceFirst(slow, 'by simp');
    await until('base restored before agent demo', () => card('base')?.status === 'proved');
    await document.save();

    await new Promise((resolve, reject) => {
      const child = spawn(path.join(root, 'mcp/.venv/bin/python'), [path.join(root, 'mcp/check_swarm.py')], {
        cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('M7 MCP check timed out\n' + stderr)); }, 90000);
      child.stderr.on('data', data => { stderr += data; });
      let checks = Promise.resolve();
      readline.createInterface({ input: child.stdout }).on('line', line => {
        checks = checks.then(async () => {
          const receipt = JSON.parse(line);
          const label = receipt.check;
          if (label === 'Claude tag') await until(label, () => card(receipt.label)?.agent === 'Claude' && card(receipt.label)?.status === 'proved');
          else if (label === 'both client tags') await until(label, () => receipt.labels.every((name, i) =>
            card(name)?.agent === receipt.agents[i] && card(name)?.status === 'proved'));
          else if (label === 'card proved by MCP') await until(label + ': ' + receipt.label, () => card(receipt.label)?.status === 'proved');
          else if (label === 'all six proved and kernel checked') await until(label, () => api.getSwarmState().fullyChecked
            && api.getSwarmState().proved === 6 && api.getSwarmState().cards.length === 6);
          else if (label === 'agent tags expire') await until(label, () => api.getSwarmState().cards.every(card => !card.agent), 2000);
          else { receipts.push(receipt); console.log('PASS: ' + label); }
          child.stdin.write('ok\n');
        }).catch(error => { child.kill(); reject(error); });
      });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => {
        clearTimeout(timeout);
        checks.then(() => code === 0 ? resolve() : reject(new Error('M7 MCP exit ' + code + '\n' + stderr)));
      });
    });
    assert.equal(fs.readFileSync(path.join(root, 'examples/Swarm.thy'), 'utf8'), original);
    console.log('M7 live Swarm acceptance passed. Committed skeleton unchanged.');
  } finally {
    fs.writeFileSync(path.join(root, '.dev-host/m7-results.json'), JSON.stringify(receipts, null, 2));
  }
};
