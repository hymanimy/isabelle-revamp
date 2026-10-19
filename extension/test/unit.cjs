// Fast checks of pure modules: no VS Code window, no Isabelle process.
const assert = require('node:assert/strict');
require('./vscodeStub.cjs');

function checkScriptRanges() {
  const { scriptRanges } = require('../out/scriptRanges');
  const source = String.raw`m\<^sup>2 x\<^sub>1 y\<^sup>\<alpha> z\<^bsup>n+1\<^esup> v\<^bsub>i+1\<^esub> \<^bold>A`;
  assert.deepEqual(scriptRanges(source).map(group => [group.style, source.slice(...group.content)]),
    [['sup', '2'], ['sub', '1'], ['sup', String.raw`\<alpha>`], ['sup', 'n+1'], ['sub', 'i+1'], ['bold', 'A']]);
  assert.equal(scriptRanges(String.raw`x\<^sup> y\<^sub>` + '\n' + String.raw`z\<^bsup>n`).length, 0);
  const astral = scriptRanges('x⇧𝒜')[0];
  assert.equal(astral.content[1] - astral.content[0], 2);
  console.log('PASS: script ranges for ASCII and decoded controls, unclosed groups and astral characters');
}

function checkServerSettings() {
  const { serverArgs, serverSettings } = require('../out/serverSettings');
  const config = values => ({ get: (key, fallback) => key in values ? values[key] : fallback });
  const defaults = serverArgs(serverSettings(config({}), '/work'));
  assert.deepEqual(defaults.slice(0, 4), ['vscode_server', '-n', '-l', 'HOL']);
  assert(defaults.includes('vscode_caret_perspective=50'));
  const custom = serverSettings(config({ logic: 'HOL-Analysis', sessionDirs: ['~/afp/thys', 'sessions', ' '], checkingPerspective: 0 }), '/work');
  assert.deepEqual(custom.sessionDirs, [require('node:os').homedir() + '/afp/thys', '/work/sessions']);
  assert(serverArgs(custom).join(' ').includes(`-d /work/sessions -l HOL-Analysis`));
  assert.deepEqual(serverSettings(config({ logic: ' ', checkingPerspective: -1 }), '/work'), { logic: 'HOL', sessionDirs: [], perspective: 50 });
  console.log('PASS: server arguments for default, custom and invalid settings');
}

function checkTheoryHeader() {
  const { theoryHeader, importFile } = require('../out/theoryHeader');
  const source = String.raw`(* comment mentioning theory X imports Y begin *)
section \<open>A cartouche with theory and begin\<close>
text ‹nested ‹cartouche› imports Z›
theory "Top" imports Base "../Shared/Util" "HOL-Library.Multiset" Main
  keywords "foo" :: thy_decl
begin
theory Ignored imports After begin`;
  assert.deepEqual(theoryHeader(source), { name: 'Top', imports: ['Base', '../Shared/Util', 'HOL-Library.Multiset', 'Main'] });
  assert.deepEqual(theoryHeader('theory A begin'), { name: 'A', imports: [] });
  assert.equal(theoryHeader('theory A imports B'), undefined, 'An unfinished header has no begin yet');
  const files = new Set(['/p/Base.thy', '/Shared/Util.thy']);
  const exists = file => files.has(file);
  assert.equal(importFile('Base', '/p', exists), '/p/Base.thy');
  assert.equal(importFile('../Shared/Util', '/p', exists), '/Shared/Util.thy');
  assert.equal(importFile('Main', '/p', exists), undefined, 'Not a local file: a theory of the logic image');
  assert.equal(importFile('HOL-Library.Multiset', '/p', () => true), undefined, 'Session-qualified');
  assert.equal(importFile('~~/src/HOL/Library/Multiset', '/p', () => true), undefined);
  console.log('PASS: theory headers skip comments and cartouches; local imports resolve, library imports do not');
}

function checkLastProofLine() {
  const { lastProofLine } = require('../out/goals');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/Sqrt2.thy'), 'utf8');
  assert.equal(source.split('\n')[lastProofLine(source)].trim(), 'by simp', 'qed and end have no proof state');
  assert.equal(lastProofLine('theory A imports Main begin\ndefinition f where "f x = x"\nend\n'), undefined);
  console.log('PASS: whole-theory checks confirm with the last proof command, not qed or end');
}

function checkWindowChoice() {
  const { chooseWindow } = require('../out/discovery');
  const window = (port, ...folders) => ({ port, token: 't', pid: 1, folders });
  const project = window(1, '/home/u/project'), nested = window(2, '/home/u/project/sub'), other = window(3, '/home/u/other');
  assert.equal(chooseWindow([project, other], '/home/u/project/thys'), project);
  assert.equal(chooseWindow([project, nested], '/home/u/project/sub/A'), nested, 'The closest workspace folder wins');
  assert.equal(chooseWindow([other], '/tmp'), other, 'A single window serves any directory');
  assert.match(chooseWindow([project, other], '/tmp'), /Several VS Code windows/);
  assert.match(chooseWindow([], '/tmp'), /No VS Code window/);
  assert.match(chooseWindow([project, other], '/home/u/projector'), /Several/, 'Folder prefixes are not containment');
  console.log('PASS: MCP servers pick the VS Code window whose workspace contains the agent');
}

(async () => {
  checkTheoryHeader();
  checkWindowChoice();
  checkLastProofLine();
  require('./goalHtml.cjs').checkGoalHtml();
  checkScriptRanges();
  checkServerSettings();
  await require('./cursorRaces.cjs').checkCursorRaces();
  await require('./setup.cjs').run();
})().catch(error => { console.error(error); process.exitCode = 1; });
