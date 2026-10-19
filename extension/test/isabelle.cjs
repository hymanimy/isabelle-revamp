// Locate the Isabelle installation the tests run against: ISABELLE_EXECUTABLE, else isabelle on PATH.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const executable = process.env.ISABELLE_EXECUTABLE || 'isabelle';
const home = execFileSync(executable, ['getenv', '-b', 'ISABELLE_HOME'], { encoding: 'utf8' }).trim();
module.exports = { executable, home, library: (...parts) => path.join(home, ...parts) };
