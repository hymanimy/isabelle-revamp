// Entry point for --extensionTestsPath: runs inside VS Code against a real Isabelle.
// Order matters: goalsPanel reads proof's receipts from .dev-host/.
const suites = ['goals', 'proof', 'mcp', 'goalsPanel', 'prettySymbols', 'editor', 'agentEdits'];
exports.run = async function () {
  const selected = process.env.ISABELLE_REVAMP_SUITES?.split(',').filter(Boolean) ?? suites;
  for (const name of selected) {
    if (!suites.includes(name) && name !== 'installed') throw new Error(`Unknown suite ${name}; choose from ${suites.join(', ')}, installed`);
    console.log(`--- ${name}`);
    await require(`./${name}.cjs`).run();
  }
};
