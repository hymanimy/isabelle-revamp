require('esbuild').build({ entryPoints: ['src/proofGraphWebview.ts'], bundle: true, platform: 'browser',
  format: 'iife', target: 'es2022', outfile: 'media/proofGraph.js', legalComments: 'inline' })
  .catch(error => { console.error(error); process.exitCode = 1; });
