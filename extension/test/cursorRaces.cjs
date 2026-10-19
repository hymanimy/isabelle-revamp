const assert = require('node:assert/strict');
if (require.main === module) require('./vscodeStub.cjs');
const { Goals } = require('../out/goals');

// Inject protocol replies in the wrong order, which is hard to force on a fast
// prover. The live-host suite separately exercises the real editor and server.
exports.checkCursorRaces = async function () {
  const handlers = new Map();
  const replies = [];
  const exits = [];
  const client = {
    onNotification(method, handler) {
      handlers.set(method, handler);
      return { dispose() { handlers.delete(method); } };
    },
    async sendNotification(method, params) {
      if (method === 'PIDE/state_exit') exits.push(params.id);
    },
    sendRequest() { return new Promise(resolve => replies.push(resolve)); },
  };
  let state;
  const goals = new Goals(client, { update(value) { state = value; } });
  const uri = 'file:///fixture/Sqrt2.thy';
  const editor = (line, version = 1, character = 4) => ({
    document: { languageId: 'isabelle', uri: { scheme: 'file', fsPath: '/fixture/Sqrt2.thy', toString: () => uri }, version },
    selection: { active: { line, character } },
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const emit = (name, params) => handlers.get(name)(params);
  try {
    goals.ready(editor(4));
    await pause(180);
    goals.follow(editor(6));
    emit('PIDE/state_output', { id: -101, content: '<pre>OLD</pre>' });
    replies[0]({ state_id: -101 });
    await pause(180);
    assert.equal(state.phase, 'checking');
    assert.equal(state.text, '');
    assert(exits.includes(-101));

    // Caret output for the old caret can only arrive before the state_init response:
    // the server handles the caret move first, on the same ordered channel.
    emit('PIDE/dynamic_output', { content: '<pre>UNTAGGED OLD</pre>' });
    // The current state's notification can precede its init response.
    emit('PIDE/state_output', { id: -102, content: '<pre>CURRENT</pre>' });
    replies[1]({ state_id: -102 });
    await pause(0);
    assert.equal(state.phase, 'ready');
    assert.equal(state.text, 'CURRENT');
    emit('PIDE/state_output', { id: -101, content: '<pre>LATE OLD</pre>' });
    assert.equal(state.text, 'CURRENT');
    // Caret output adds the command's messages, such as try0's suggestion.
    emit('PIDE/dynamic_output', { content: '<pre>CURRENT<br><br>Try this: by simp</pre>' });
    assert.equal(state.text, 'CURRENT\n\nTry this: by simp');
    assert(state.html.includes('Try this'));

    const at = (line, character = 0) => ({ range: [line, character, line, character + 5] });
    emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [at(5)] }] });
    assert.equal(state.phase, 'checking');
    assert.equal(state.text, '');
    emit('PIDE/decoration', { uri, entries: [{ type: 'text_overview_error', content: [] }] });
    assert.equal(state.phase, 'checking'); // Omitted running entry is not cleared.
    emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [] }] });
    assert.equal(state.phase, 'ready');
    // Work and errors after the caret do not hide its goal: Isabelle may never check text out of view.
    emit('PIDE/decoration', { uri, entries: [{ type: 'background_unprocessed1', content: [at(40)] }] });
    assert.equal(state.phase, 'ready');
    emit('PIDE/decoration', { uri, entries: [{ type: 'text_overview_error', content: [at(30)] }] });
    goals.setDiagnostics(uri, [{ severity: 0, message: 'Failed elsewhere', range: { start: { line: 30, character: 0 }, end: { line: 30, character: 5 } } }]);
    assert.equal(state.phase, 'ready');
    assert.deepEqual(state.errors, []);
    goals.setDiagnostics(uri, [{ severity: 0, message: 'Failed here', range: { start: { line: 6, character: 2 }, end: { line: 6, character: 9 } } }]);
    assert.equal(state.phase, 'error');
    assert.deepEqual(state.errors, ['Failed here']);
    goals.setDiagnostics(uri, []);
    emit('PIDE/decoration', { uri, entries: [{ type: 'text_overview_error', content: [] }, { type: 'background_unprocessed1', content: [] }] });
    assert.equal(state.phase, 'ready');

    // The server sends unchanged caret output only once, so it must survive moves.
    goals.follow(editor(6, 1, 9));
    await pause(180);
    emit('PIDE/state_output', { id: -103, content: '<pre>CURRENT</pre>' });
    replies[2]({ state_id: -103 });
    await pause(0);
    assert.equal(state.text, 'CURRENT\n\nTry this: by simp');
    // Stale caret output from another state never leaks into this one.
    goals.follow(editor(8));
    await pause(180);
    emit('PIDE/state_output', { id: -104, content: '<pre>NEXT</pre>' });
    replies[3]({ state_id: -104 });
    await pause(0);
    assert.equal(state.text, 'NEXT');
    // try0 prints its messages without the proof state; show both.
    emit('PIDE/dynamic_output', { content: '<pre>Try this: by auto</pre>' });
    assert.equal(state.text, 'NEXT\n\nTry this: by auto');

    goals.follow(editor(8, 2)); // Same cursor, changed document version.
    emit('PIDE/state_output', { id: -104, content: '<pre>OLD VERSION</pre>' });
    assert.equal(state.phase, 'checking');
    assert.equal(state.text, '');
    // A long-running command stays "checking", however long it takes.
    const now = Date.now;
    try {
      Date.now = () => now() + 11000;
      emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [at(2)] }] });
      assert.equal(state.phase, 'checking');
    } finally {
      Date.now = now;
    }
    emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [] }] });

    // A command that closes a proof (by simp) has no proof state: once checked and
    // quiet, show its messages, as jEdit does, instead of waiting forever.
    goals.follow(editor(10));
    await pause(180);
    replies[4]({ state_id: -105 });
    emit('PIDE/dynamic_output', { content: '<pre>theorem foo: x = x</pre>' });
    await pause(200);
    assert.equal(state.phase, 'checking');
    await pause(800);
    assert.equal(state.phase, 'ready');
    assert.equal(state.stateless, true);
    assert.equal(state.text, 'theorem foo: x = x');
    // Moving within the same command: the server sends no new output at all, since
    // its output has not changed. The messages must still come back.
    goals.follow(editor(10, 1, 6));
    assert.equal(state.phase, 'checking');
    await pause(180);
    replies[5]({ state_id: -106 });
    await pause(600);
    assert.equal(state.phase, 'ready');
    assert.equal(state.text, 'theorem foo: x = x');
    // A state that turns up after the grace period still replaces the messages.
    emit('PIDE/state_output', { id: -106, content: '<pre>LATE STATE</pre>' });
    assert.equal(state.stateless, undefined);
    assert.equal(state.text, 'LATE STATE');
    goals.follow(undefined);
    assert.equal(state.phase, 'idle');
    console.log('PASS: stale replies, early replies, caret messages, version changes, decoration deltas, caret-scoped work and errors, and messages without a proof state');
  } finally {
    goals.dispose();
  }
};
if (require.main === module) exports.checkCursorRaces().catch(error => { console.error(error); process.exitCode = 1; });
