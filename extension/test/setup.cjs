const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { findIsabelle, mcpLaunch, registerWithClaude, registrationCommand, setupReport } = require('../out/setup');
const root = path.resolve(__dirname, '../..');

async function run() {
  const fixture = path.join(root, '.dev-host/m11-discovery');
  fs.rmSync(fixture, { recursive: true, force: true });
  fs.mkdirSync(fixture, { recursive: true });
  const home = path.join(fixture, 'home'), apps = path.join(fixture, 'apps'), bin = path.join(fixture, 'bin');
  function executable(file, source = '#!/bin/sh\nexit 0\n') {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source, { mode: 0o755 }); return file;
  }
  assert.equal(await findIsabelle('missing', home, bin, apps), undefined);
  const usual = executable(path.join(home, 'Isabelle2025-2/bin/isabelle'));
  assert.equal(await findIsabelle('missing', home, bin, apps), usual);
  const application = executable(path.join(apps, 'Isabelle2025-2.app/bin/isabelle'));
  assert.equal(await findIsabelle('', home, bin, apps), application);
  const command = executable(path.join(bin, 'isabelle'), '#!/bin/sh\nif [ "$1" = version ]; then echo Isabelle2025-2; fi\nexit 0\n');
  assert.equal(await findIsabelle('', home, bin, apps), command);
  const explicit = executable(path.join(home, 'custom/bin/isabelle'));
  assert.equal(await findIsabelle('~/custom/bin/isabelle', home, bin, apps), explicit);
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = bin;
    const launch = mcpLaunch('/ext', '/vscode/code');
    let report = await setupReport(undefined, root, launch);
    assert.equal(report.length, 4);
    assert.deepEqual(report.map(line => line[0]), ['✗', '✗', '–', '–'], report.join('\n'));
    // A fake claude that logs its arguments and reports what was registered last.
    const log = path.join(fixture, 'claude.log');
    executable(path.join(bin, 'claude'), `#!/bin/sh\necho "$*" >> '${log}'\n[ "$2" = get ] && /bin/cat '${fixture}/registered' 2>/dev/null\nexit 0\n`);
    fs.writeFileSync(path.join(fixture, 'registered'), 'isabelle:\n  Command: python3 /old/mcp/launch.py\n');
    report = await setupReport(command, root, launch);
    assert.match(report[3], /^– MCP \(optional\): isabelle is registered for another install/, report.join('\n'));
    await registerWithClaude(path.join(bin, 'claude'), launch, root);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').slice(-3), [
      'mcp get isabelle', 'mcp remove --scope local isabelle', 'mcp remove --scope user isabelle',
    ].slice(1).concat('mcp add --scope user isabelle -e ELECTRON_RUN_AS_NODE=1 -- /vscode/code /ext/out/mcpServer.js'));
    fs.writeFileSync(path.join(fixture, 'registered'), 'isabelle:\n  Command: /vscode/code\n  Args: /ext/out/mcpServer.js\n');
    report = await setupReport(command, root, launch);
    assert(report.every(line => line.startsWith('✓')), report.join('\n'));
  } finally { process.env.PATH = previousPath; }
  assert.equal(registrationCommand(mcpLaunch('/Applications/Isabelle Revamp', '/vscode/code')),
    "claude mcp add --scope user isabelle -e ELECTRON_RUN_AS_NODE=1 -- /vscode/code '/Applications/Isabelle Revamp/out/mcpServer.js'");

  // Missing Isabelle must stop before the language client or bridge is created.
  const notices = [], commands = new Map(), called = [], state = new Map(), providers = [];
  const disposable = { dispose() {} };
  const vscode = {
    SemanticTokensLegend: class {}, ThemeColor: class {}, OverviewRulerLane: {},
    window: { visibleTextEditors: [], createOutputChannel: () => ({ ...disposable, show() {}, appendLine() {} }),
      registerWebviewViewProvider: name => { providers.push(name); return disposable; },
      showInformationMessage: async (...args) => { notices.push(args); },
      showErrorMessage: () => { throw new Error('Unexpected error notification'); } },
    workspace: { textDocuments: [{ languageId: 'isabelle' }], onDidOpenTextDocument: () => disposable,
      getConfiguration: () => ({ get: (key, fallback) => key === 'executable' ? 'missing' : fallback }) },
    commands: { registerCommand: (name, action) => { commands.set(name, action); return disposable; },
      executeCommand: async name => { called.push(name); } },
  };
  const load = Module._load;
  Module._load = function(name, parent, isMain) {
    if (name === 'vscode') return vscode;
    if (name === 'vscode-languageclient/node') return { LanguageClient: class { constructor() { throw new Error('Client started without Isabelle'); } } };
    if (name === './setup' && parent.filename.endsWith('/out/extension.js')) return { ...require('../out/setup'), findIsabelle: async () => undefined };
    return load.apply(this, arguments);
  };
  try {
    const extension = require('../out/extension');
    const api = await extension.activate({ extensionPath: path.join(root, 'extension'), subscriptions: [],
      workspaceState: { get: key => state.get(key), update: async (key, value) => state.set(key, value) },
      globalState: { get: () => undefined, update: async () => {} } });
    assert(api.setupRequired); assert.equal(notices.length, 1);
    assert.deepEqual(notices[0], ['Isabelle not found', 'Locate…', 'Download']);
    assert(called.includes('isabelleRevamp.showGoals'));
    assert(commands.has('isabelleRevamp.setupCheck'));
    assert.deepEqual(providers, ['isabelleRevamp.goals']);
    await extension.deactivate();
  } finally { Module._load = load; }
  console.log('PASS: discovery priority, setup fixes, MCP registration replacing older installs, one missing-Isabelle notification and first-theory Goals');
}
exports.run = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
