// Launch VS Code with the development extension and run test/integration.cjs.
//   npm run test:integration [-- suite,suite]     e.g. -- goals,proof
//   npm run test:integration -- installed         checks dist/*.vsix as installed
// VSCODE_EXECUTABLE selects the VS Code binary, VSCODE_CLI its `code` launcher (for
// installing the VSIX), and ISABELLE_EXECUTABLE the Isabelle one.
// Opens a real VS Code window: tests drive the editor and need a display.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'extension');
const host = path.join(root, '.dev-host');

function vscodeExecutable() {
  if (process.env.VSCODE_EXECUTABLE) return process.env.VSCODE_EXECUTABLE;
  // The `code` launcher returns at once; tests need the application binary, which waits.
  const candidates = process.platform === 'darwin' ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Code']
    : process.platform === 'win32' ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Microsoft VS Code/Code.exe')]
    : ['/usr/share/code/code', '/usr/lib/code/code', '/opt/visual-studio-code/code', '/snap/code/current/usr/share/code/code'];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error('VS Code not found; set VSCODE_EXECUTABLE to its application binary.');
  return found;
}

function placeholder() {
  const directory = path.join(host, 'installed-placeholder');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: 'installed-check', publisher: 'test', version: '0.0.0', engines: { vscode: '*' } }));
  return directory;
}

const suites = process.argv[2] ?? '';
const installed = suites === 'installed';
fs.mkdirSync(host, { recursive: true });
const profile = path.join(host, installed ? 'installed-user' : 'test-user');
fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
fs.writeFileSync(path.join(profile, 'User/settings.json'), JSON.stringify({
  'security.workspace.trust.enabled': false, 'update.mode': 'none', 'extensions.autoUpdate': false,
  'workbench.tips.enabled': false, 'chat.disableAIFeatures': true,
}));
const extensions = path.join(host, installed ? 'installed-extensions' : 'extensions');
const code = vscodeExecutable();
if (installed) {
  const version = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8')).version;
  const vsix = path.join(root, 'dist', `isabelle-revamp-${version}.vsix`);
  if (!fs.existsSync(vsix)) throw new Error(`${vsix} is missing; run npm run package first.`);
  execFileSync(process.env.VSCODE_CLI ?? 'code', ['--user-data-dir', profile, '--extensions-dir', extensions,
    '--install-extension', vsix, '--force'], { stdio: 'inherit' });
}
const args = ['--user-data-dir', profile, '--extensions-dir', extensions, '--skip-welcome', '--skip-release-notes',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  // VS Code runs --extensionTestsPath only alongside a development extension; for the
  // installed check that is an empty placeholder, so the VSIX is what gets tested.
  ...(installed ? [`--extensionDevelopmentPath=${placeholder()}`] : ['--disable-extensions', `--extensionDevelopmentPath=${extension}`]),
  `--extensionTestsPath=${path.join(__dirname, 'integration.cjs')}`, root];
const env = { ...process.env, ISABELLE_REVAMP_PORT_FILE: path.join(host, 'test-port'),
  ...(suites ? { ISABELLE_REVAMP_SUITES: suites } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(code, args, { stdio: 'inherit', env });
child.on('exit', status => { process.exitCode = status ?? 1; });
