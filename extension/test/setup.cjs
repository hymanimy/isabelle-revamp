const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { findIsabelle, setupReport } = require('../out/setup');
const { registrationCommand, claudeArgs } = require('../out/ask');
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
  const usual = executable(path.join(home, 'hack/isabelle-env/Isabelle2025-2.app/bin/isabelle'));
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
    let report = await setupReport(undefined, root, root);
    assert.equal(report.length, 4); assert(report.every(line => line.startsWith('✗')));
    executable(path.join(bin, 'claude'), '#!/bin/sh\necho isabelle:\n');
    report = await setupReport(command, root, root);
    assert(report.every(line => line.startsWith('✓')), report.join('\n'));
  } finally { process.env.PATH = previousPath; }
  const installed = '/Applications/Extensions/Isabelle Revamp';
  assert(registrationCommand(installed).includes("'/Applications/Extensions/Isabelle Revamp/mcp/launch.py'"));
  const args = claudeArgs({ portFile: '/tmp/port', file: '/tmp/A.thy', line: 1 }, installed);
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.isabelle;
  assert.equal(config.command, 'python3'); assert(config.args[0].startsWith(installed));

  // Missing Isabelle must stop before the language client or bridge is created.
  const notices = [], commands = new Map(), called = [], state = new Map();
  const disposable = { dispose() {} };
  const vscode = {
    SemanticTokensLegend: class {},
    window: { visibleTextEditors: [], createOutputChannel: () => ({ ...disposable, show() {}, appendLine() {} }),
      registerWebviewViewProvider: () => disposable,
      showInformationMessage: async (...args) => { notices.push(args); },
      showErrorMessage: () => { throw new Error('Unexpected error notification'); } },
    workspace: { textDocuments: [{ languageId: 'isabelle' }], onDidOpenTextDocument: () => disposable,
      getConfiguration: () => ({ get: () => 'missing' }) },
    commands: { registerCommand: (name, action) => { commands.set(name, action); return disposable; },
      executeCommand: async name => { called.push(name); } },
  };
  const load = Module._load;
  Module._load = function(name, parent, isMain) {
    if (name === 'vscode') return vscode;
    if (name === 'vscode-languageclient/node') return { LanguageClient: class { constructor() { throw new Error('Client started without Isabelle'); } } };
    if (name === './setup' && parent.filename.endsWith('/out/extension.js')) return { findIsabelle: async () => undefined, setupReport };
    return load.apply(this, arguments);
  };
  try {
    const extension = require('../out/extension');
    const api = await extension.activate({ extensionPath: path.join(root, 'extension'), subscriptions: [],
      workspaceState: { get: key => state.get(key), update: async (key, value) => state.set(key, value) } });
    assert(api.setupRequired); assert.equal(notices.length, 1);
    assert.deepEqual(notices[0], ['Isabelle not found', 'Locate…', 'Download']);
    assert(called.includes('isabelleRevamp.showGoals'));
    assert(commands.has('isabelleRevamp.setupCheck'));
    await extension.deactivate();
  } finally { Module._load = load; }
  console.log('PASS: discovery priority, setup fixes, absolute bundled MCP command, one missing-Isabelle notification and first-theory Goals');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
