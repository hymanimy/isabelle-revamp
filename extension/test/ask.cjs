const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Ask, AskStream, helpLine, openSteps, preamble, registrationCommand } = require('../out/ask');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.checkAsk = async function () {
  const root = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(root, '.dev-host'), { recursive: true });
  const logDir = path.join(root, '.dev-host/ask-log');
  fs.rmSync(logDir, { recursive: true, force: true });
  const steps = openSteps(fs.readFileSync(path.join(root, 'examples/Demo.thy'), 'utf8'));
  const context = { file: path.join(root, 'examples/Demo.thy'), line: 12, cwd: root, portFile: path.join(root, '.dev-host/m8-port'), openSteps: steps };
  const capture = path.join(root, '.dev-host/m8-spawn.json');
  const pidFile = path.join(root, '.dev-host/m8-child-pid');
  function runner(mode, options = {}, changed = () => {}) {
    return new Ask(root, changed, { executable: path.join(__dirname, 'fakeClaude.cjs'), logDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', M8_SCENARIO: mode, M8_CAPTURE: capture, M8_PID_FILE: pidFile }, ...options });
  }

  // Open obligations come from the buffer, not from PIDE, so an unchecked file
  // never reports itself finished. Each fixture is a distinct shape.
  assert.deepEqual(steps.map(step => step.name), ['expand', 'factor', 'result']);
  assert.deepEqual(steps.map(step => step.line), [11, 13, 15]);
  const swarm = openSteps(fs.readFileSync(path.join(root, 'examples/Swarm.thy'), 'utf8'));
  assert.deepEqual(swarm.map(step => step.name),
    ['base', 'next_sum', 'next_square', 'induction_step', 'all_n', 'result'],
    'The committed Swarm skeleton must still hold its six admissions');
  // A theorem with no named steps is itself the open obligation.
  assert.deepEqual(openSteps(fs.readFileSync(path.join(root, 'examples/card/Sqrt4.thy'), 'utf8')),
    [{ name: 'sqrt4_irrational', line: 5 }]);
  assert.deepEqual(openSteps(fs.readFileSync(path.join(root, 'examples/Sqrt2.thy'), 'utf8')), [],
    'A complete proof has no open steps');
  assert.equal(openSteps('theory T begin theorem a: "P" by (simp add: sorry_lemma) end').length, 0,
    'Only a real sorry command counts');
  const long = preamble({ ...context, openSteps: Array.from({ length: 20 }, (_, i) => ({ name: 's' + i, line: i })) });
  assert(long.includes('has 20 open (sorry) steps') && long.includes('and 8 more'), 'Long lists stay short');
  assert(preamble({ ...context, openSteps: [] }).includes('has no open (sorry) steps'));
  assert(preamble(context).includes('Demo.thy has 3 open (sorry) steps: expand (line 11), factor (line 13), result (line 15)'));
  assert(preamble(context).includes("'prove this' means close them all, one per edit"));
  const observed = [];
  const ask = runner('stream', {}, state => observed.push(state));
  const first = ask.send(context, 'prove this `literal` $(also literal)');
  assert.equal(await ask.send(context, 'second concurrent request'), false);
  await first;
  assert(observed.some(state => state.active && state.entries.some(entry => entry.text === 'Checking ')), 'Partial text must arrive before completion');
  assert.equal(ask.snapshot().active, false);
  assert.equal(ask.snapshot().entries.filter(e => e.text === 'Checking √2.').length, 1);
  assert.equal(ask.snapshot().entries.filter(e => e.text === 'Fully checked.').length, 1);
  assert(ask.snapshot().entries.some(e => e.text === 'edit Demo.thy 7:4–9:10'));
  assert(ask.snapshot().entries.some(e => e.text === 'goals_at 12:6'));
  let invocation = JSON.parse(fs.readFileSync(capture));
  for (const flag of ['-p', '--verbose', '--include-partial-messages', '--strict-mcp-config', '--disable-slash-commands']) assert(invocation.args.includes(flag));
  assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], '');
  assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(invocation.args[invocation.args.indexOf('--effort') + 1], 'low');
  assert(!invocation.args.includes('--dangerously-skip-permissions'));
  assert(invocation.args.at(-1).includes('cursor at line 12'));
  assert(invocation.prompt.includes('$(also literal)'));
  assert(invocation.args.at(-1).includes('Demo.thy has 3 open (sorry) steps'), 'The system prompt must state what is open');
  assert(!invocation.prompt.includes('Earlier requests'), 'A first request carries no history');

  // A second request about the same file replays only earlier requests. Replaying
  // the model's own "Fully checked." told the next run its work was already done.
  await ask.send(context, 'why?');
  invocation = JSON.parse(fs.readFileSync(capture));
  assert(invocation.prompt.includes('Earlier requests about this same file'));
  assert(invocation.prompt.includes('- prove this `literal` $(also literal)'), invocation.prompt);
  assert(!invocation.prompt.includes('Fully checked.'), 'The model\'s own output must never return in a prompt');
  assert(!invocation.prompt.includes('assistant:'), 'No assistant turns in the prompt');
  assert.equal(ask.snapshot().entries.filter(e => e.kind === 'user').length, 2);

  // Switching theory starts a fresh history and says so in the transcript.
  const other = { ...context, file: path.join(root, 'examples/Swarm.thy'), openSteps: swarm };
  await ask.send(other, 'prove this');
  invocation = JSON.parse(fs.readFileSync(capture));
  assert(!invocation.prompt.includes('Earlier requests'), 'Another theory inherits no history');
  assert(!invocation.prompt.includes('why?'), 'Requests must not cross theory files');
  assert(invocation.args.at(-1).includes('Swarm.thy has 6 open (sorry) steps: base (line 9)'));
  assert(ask.snapshot().entries.some(e => e.kind === 'notice' && e.text.includes('Now asking about Swarm.thy')));
  // Returning to the first theory still remembers only its own requests.
  await ask.send(context, 'again');
  invocation = JSON.parse(fs.readFileSync(capture));
  assert(invocation.prompt.includes('- why?') && !invocation.prompt.includes('- prove this\n'), invocation.prompt);

  // Each run leaves one reviewable receipt.
  const logs = fs.readdirSync(logDir).sort();
  assert.equal(logs.length, 4, logs.join(' '));
  const receipt = fs.readFileSync(path.join(logDir, logs[2]), 'utf8');
  assert(receipt.includes('examples/Swarm.thy') && receipt.includes('base (line 9)'));
  assert(receipt.includes('## Request') && receipt.includes('## Prompt sent') && receipt.includes('## Transcript'));
  assert(logs.every(name => /^\d{4}-\d{2}-\d{2}T[\d-]+Z(-\d+)?\.md$/.test(name)), logs.join(' '));

  // Clear drops the transcript and every remembered request.
  ask.clear();
  assert.deepEqual(ask.snapshot().entries, []);
  await ask.send(context, 'prove this');
  invocation = JSON.parse(fs.readFileSync(capture));
  assert(!invocation.prompt.includes('Earlier requests'), 'Clear must forget the per-file history');
  const missing = runner('stream', { executable: path.join(root, '.dev-host/no-such-claude') });
  await missing.send(context, 'prove this');
  assert.equal(missing.snapshot().entries.at(-1).text, helpLine('claude', root));
  const noMcp = runner('missing'); await noMcp.send(context, 'prove this');
  assert.equal(noMcp.snapshot().entries.at(-1).text, helpLine('MCP', root));
  assert(registrationCommand(root).includes(path.join(root, 'mcp/launch.py')));
  assert(!registrationCommand(root).includes('$PWD'));
  assert(!helpLine('claude', root).includes('\n') && !helpLine('MCP', root).includes('\n'));
  for (const mode of ['bad-json', 'exit-error']) {
    const failure = runner(mode); await failure.send(context, 'prove this');
    assert(failure.snapshot().entries.some(e => e.kind === 'notice'));
    assert.equal(failure.snapshot().active, false);
  }
  fs.rmSync(pidFile, { force: true });
  const stopped = runner('hold'); const running = stopped.send(context, 'prove this');
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) await pause(20);
  assert(fs.existsSync(pidFile)); const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  stopped.stop(); stopped.stop();
  assert.equal(await stopped.send(context, 'too soon'), false);
  await running;
  await pause(50);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal(stopped.snapshot().entries.filter(e => e.kind === 'notice').length, 1);
  assert.equal(stopped.snapshot().active, false);
  const timeout = runner('preflight-stop', { timeoutMs: 150 });
  await timeout.send(context, 'prove this');
  assert(timeout.snapshot().entries.at(-1).text.includes('10-minute time limit'));
  assert.equal(timeout.snapshot().active, false);
  const entries = [];
  const stream = new AskStream((kind, text) => { const entry = { kind, text }; entries.push(entry); return entry; });
  stream.accept({ type: 'result', is_error: true, errors: ['Actual model error'], permission_denials: [{}] });
  assert(entries.some(e => e.text === 'Actual model error'));
  assert(entries.some(e => e.text.includes('denied')));
  console.log('PASS: Ask spawn, flags, UTF-8 streaming, tool summaries, transcript, Stop/process tree, timeout, failures, and exact help lines');
};
if (require.main === module) exports.checkAsk().catch(error => { console.error(error); process.exitCode = 1; });
