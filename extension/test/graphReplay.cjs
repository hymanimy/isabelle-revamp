const assert = require('node:assert/strict');
const { replayTimeline, replaySpeed } = require('../out/graphReplay');
const { graphSummary } = require('../out/graphTypes');
const nodes = ['theorem', 'first', 'second'].map((id, i) => ({ id, name: id, parent: i ? 'theorem' : null, line: i + 1, status: 'open' }));
const state = { nodes, edges: [], total: 3, proved: 0, fully_checked: false, theory: 'Test', elapsed: 0 };
const states = [state,
  { ...state, nodes: nodes.map(n => n.id === 'second' ? { ...n, status: 'proved' } : n), elapsed: 10 },
  { ...state, nodes: nodes.map(n => ({ ...n, status: 'proved' })), fully_checked: true, elapsed: 20 }];
const frames = replayTimeline(states.map((state, i) => ({ at: i * 10, state })));
const seen = new Set(), green = [];
for (const { at, state } of frames) for (const node of state.nodes) if (node.status === 'proved' && !seen.has(node.id)) {
  seen.add(node.id); green.push({ id: node.id, at });
}
assert.deepEqual(green.map(n => n.id), ['second', 'first', 'theorem'], 'Keep recorded order; parent last within a batch');
assert(green.slice(1).every((item, i) => item.at - green[i].at >= 400));
assert(frames.slice(0, -1).every(frame => !frame.state.fully_checked));
assert.equal(frames.at(-1).state.fully_checked, true);
assert.equal(replaySpeed(undefined), 2);
assert.equal(replaySpeed(0), 2);
for (const speed of [1, 2, 4, 8]) assert.equal(replaySpeed(speed), speed);
assert(graphSummary({ ...states[2], elapsed: 3500 }).includes('proved · 3 steps · kernel ✓ · 3 s'));
assert.equal(replayTimeline([]).length, 0);
const reopened = replayTimeline([{ at: 0, state: states[2] }, { at: 50, state }, { at: 60, state: states[2] }]);
assert(reopened.some(frame => frame.state.nodes.every(node => node.status === 'open')));
assert.equal(reopened.at(-1).state.fully_checked, true);
console.log('PASS: recorded acceptance order, parent-last ties, minimum 400ms steps, four speeds, reopening and completion header');
