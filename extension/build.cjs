const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function build() {
  fs.mkdirSync('../dist', { recursive: true });
  fs.mkdirSync('mcp', { recursive: true });
  for (const name of ['server.py', 'requirements.txt', 'launch.py']) fs.copyFileSync('../mcp/' + name, 'mcp/' + name);
  fs.copyFileSync('../LICENSE', 'LICENSE');
  // Keep runtime dependency licenses even though their code is in one bundle.
  let notices = '# Bundled dependency licenses\n';
  for (const name of ['vscode-languageclient', 'vscode-languageserver-protocol', 'vscode-languageserver-types',
    'vscode-languageserver-textdocument', 'vscode-jsonrpc', 'semver', 'minimatch', 'brace-expansion', 'balanced-match']) {
    const root = path.join(__dirname, 'node_modules', name);
    const license = fs.readdirSync(root).find(file => /^licen[cs]e/i.test(file));
    if (!license) throw new Error('Missing bundled license: ' + name);
    notices += '\n\n## ' + name + '\n\n' + fs.readFileSync(path.join(root, license), 'utf8');
  }
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/DEPENDENCY_LICENSES.txt', notices);
  fs.copyFileSync('src/symbolCodes.json', 'out/symbolCodes.json');
  await esbuild.build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node',
    format: 'cjs', target: 'node22', outfile: 'out/extension.js', external: ['vscode'],
    sourcemap: false, minify: false, legalComments: 'inline' });
}
build().catch(error => { console.error(error); process.exitCode = 1; });
