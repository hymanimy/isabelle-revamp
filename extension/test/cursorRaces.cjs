const assert = require('node:assert/strict');
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
  const editor = (line, version = 1) => ({
    document: { languageId: 'isabelle', uri: { scheme: 'file', fsPath: '/fixture/Sqrt2.thy', toString: () => uri }, version },
    selection: { active: { line, character: 4 } },
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

    // The current state's notification can precede its init response.
    emit('PIDE/state_output', { id: -102, content: '<pre>CURRENT</pre>' });
    replies[1]({ state_id: -102 });
    await pause(0);
    assert.equal(state.phase, 'ready');
    assert.equal(state.text, 'CURRENT');
    emit('PIDE/state_output', { id: -101, content: '<pre>LATE OLD</pre>' });
    emit('PIDE/dynamic_output', { content: '<pre>UNTAGGED OLD</pre>' });
    assert.equal(state.text, 'CURRENT');

    emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [{}] }] });
    assert.equal(state.phase, 'checking');
    assert.equal(state.text, '');
    emit('PIDE/decoration', { uri, entries: [{ type: 'text_overview_error', content: [] }] });
    assert.equal(state.phase, 'checking'); // Omitted running entry is not cleared.
    emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [] }] });
    assert.equal(state.phase, 'ready');

    goals.follow(editor(6, 2)); // Same cursor, changed document version.
    emit('PIDE/state_output', { id: -102, content: '<pre>OLD VERSION</pre>' });
    assert.equal(state.phase, 'checking');
    assert.equal(state.text, '');
    // A long-running command must not become "unavailable" at the wait deadline.
    const now = Date.now;
    try {
      Date.now = () => now() + 11000;
      emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [{}] }] });
      assert.equal(state.phase, 'checking');
      emit('PIDE/decoration', { uri, entries: [{ type: 'background_running1', content: [] }] });
      assert.equal(state.phase, 'unavailable');
    } finally {
      Date.now = now;
    }
    goals.follow(undefined);
    assert.equal(state.phase, 'idle');
    console.log('PASS: stale replies, early replies, version changes, and decoration deltas');
  } finally {
    goals.dispose();
  }
};
