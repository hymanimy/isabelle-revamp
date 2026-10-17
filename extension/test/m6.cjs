const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { goalsHtml, GoalsView } = require('../out/goalsView');
const { outputText } = require('../out/outputText');
const { unicodeSymbols } = require('../out/symbols');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  await require('./highlighting.cjs').checkHighlighting(vscode.env.appRoot);
  assert.equal(outputText('<pre>(sqrt 2)<span>⇧2</span> = 2 &amp; x⇩1</pre>'), '(sqrt 2)² = 2 & x₁');
  assert.equal(unicodeSymbols(String.raw`\<forall>x. x \<notin> \<rat> \<longrightarrow> x\<^sup>2`), '∀x. x ∉ ℚ ⟶ x²');
  assert.equal(unicodeSymbols(String.raw`\<alpha> \<A> \<^here>`), 'α 𝒜 ⌂');
  assert.equal(unicodeSymbols(String.raw`\<custom_symbol> ⇧q`), String.raw`\<custom_symbol> ⇧q`);
  assert.equal(unicodeSymbols(String.raw`\<constructor>`), String.raw`\<constructor>`);
  const escaped = goalsHtml({ theory: '<img>', phase: 'error', text: '', errors: ['<script>'] });
  assert(escaped.includes('<h1>&lt;img&gt;</h1>') && escaped.includes('&lt;script&gt;'));
  const hidden = goalsHtml({ phase: 'ready', checkStatus: 'checking', text: 'STALE', errors: ['STALE_ERROR'] });
  assert(!hidden.includes('STALE'));
  assert(hidden.includes('checking…'));
  // Exercise the actual WebviewView provider, including retained state on reopen.
  const view = new GoalsView();
  const state = { theory: 'Sqrt2', phase: 'ready', checkStatus: 'fully_checked', text: 'm² = 2 * n²', errors: [] };
  view.update(state);
  const fake = { webview: { onDidReceiveMessage() { return { dispose() {} }; }, postMessage() {} }, onDidDispose() {} };
  view.resolveWebviewView(fake);
  assert.equal(fake.webview.options.enableScripts, true);
  assert(fake.webview.html.includes("script-src 'nonce-"));
  assert(fake.webview.html.includes('<h1>Sqrt2</h1>'));
  assert(fake.webview.html.includes('fully checked') && fake.webview.html.includes('m² = 2 * n²'));
  for (const variable of ['foreground', 'sideBar-background', 'editor-font-family', 'errorForeground', 'contrastBorder']) {
    assert(fake.webview.html.includes('var(--vscode-' + variable + ')'));
  }
  console.log('PASS: Unicode output/diagnostics, escaped header, hidden pending state, and theme-aware webview');

  await require('./m5.cjs').run();
  const root = path.resolve(__dirname, '../..');
  const snapshots = JSON.parse(fs.readFileSync(path.join(root, '.dev-host/m4-results.json'), 'utf8'));
  assert(snapshots.find(s => s.check === 'goal at line 17').text.includes('(sqrt 2)² = 2'));
  assert(snapshots.every(s => !s.text.includes('⇧2')));
  const diagnosticStates = JSON.parse(fs.readFileSync(path.join(root, '.dev-host/m3-results.json'), 'utf8'));
  assert(diagnosticStates.some(s => s.errors.some(error => error.includes('sqrt 2 ∉ ℚ'))));
  assert(diagnosticStates.every(s => s.errors.every(error => !error.includes('\\<notin>'))));
  const api = await vscode.extensions.getExtension('hymanimy.isabelle-revamp').activate();
  assert.equal(api.getGoalState().theory, 'Sqrt2');
  assert.equal(api.getGoalState().checkStatus, 'fully_checked', JSON.stringify(api.getGoalState()));

  // A second theory ensures the header follows the active editor, not a cached name.
  const file = path.join(root, '.dev-host/m6-fixture/Header.thy');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'theory Header imports Main begin\nlemma "True" by simp\nend\n');
  const document = await vscode.workspace.openTextDocument(file);
  assert.equal(document.languageId, 'isabelle');
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(1, 1, 1, 1); // The lemma's open goal, before its closing tactic.
  await pause(30);
  assert.equal(api.getGoalState().theory, 'Header');
  assert.equal(api.getGoalState().phase, 'checking');
  const end = Date.now() + 20000;
  while (Date.now() < end && api.getGoalState().checkStatus !== 'fully_checked') await pause(25);
  assert.equal(api.getGoalState().checkStatus, 'fully_checked', JSON.stringify({
    state: api.getGoalState(), diagnostics: vscode.languages.getDiagnostics(document.uri),
  }));
  assert(goalsHtml(api.getGoalState()).includes('<h1>Header</h1>'));
  console.log('PASS: live Unicode square goal, fully checked header, and theory switching');
  fs.writeFileSync(path.join(root, '.dev-host/m6-results.json'), JSON.stringify({
    passed: true, themes: ['Dark+', 'Light+', 'High Contrast', 'High Contrast Light'],
    square: snapshots.find(s => s.check === 'goal at line 17'), header: api.getGoalState(),
  }, null, 2));
};
