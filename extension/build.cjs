const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

// The package that owns a bundled file, e.g. node_modules/@scope/name/dist/x.js -> @scope/name.
function owner(input) {
  const parts = input.split('node_modules/').at(-1).split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

async function build() {
  fs.mkdirSync('../dist', { recursive: true });
  fs.copyFileSync('../LICENSE', 'LICENSE');
  fs.mkdirSync('out', { recursive: true });
  fs.copyFileSync('src/symbolCodes.json', 'out/symbolCodes.json');
  const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'],
    sourcemap: false, minify: false, legalComments: 'inline', metafile: true };
  const results = await Promise.all([
    esbuild.build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' }),
    // Started by agents with VS Code's own Node.js; must not need node_modules.
    esbuild.build({ ...common, entryPoints: ['src/mcpServer.ts'], outfile: 'out/mcpServer.js' }),
  ]);
  // Keep the license of every runtime dependency whose code is in a bundle.
  const packages = new Set(results.flatMap(result => Object.keys(result.metafile.inputs))
    .filter(input => input.includes('node_modules/')).map(owner));
  let notices = '# Bundled dependency licenses\n';
  for (const name of [...packages].sort()) {
    const root = path.join(__dirname, 'node_modules', name);
    const license = fs.readdirSync(root).find(file => /^licen[cs]e/i.test(file));
    if (!license) throw new Error('Missing bundled license: ' + name);
    notices += '\n\n## ' + name + '\n\n' + fs.readFileSync(path.join(root, license), 'utf8');
  }
  fs.writeFileSync('out/DEPENDENCY_LICENSES.txt', notices);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
