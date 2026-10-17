const assert = require('node:assert/strict');
const { refutationGraph } = require('../out/refutations');
const { graphSummary } = require('../out/graphTypes');
const { preamble } = require('../out/ask');
const node = (name, status = 'open', parent = null) => ({ id: name, name, status, parent });
const original = node('sqrt4_irrational');
const counter = node('sqrt4_irrational_refuted', 'proved');
const result = refutationGraph([original, counter], [], false);
assert.deepEqual(result.nodes.map(n => n.status), ['refuted', 'proved']);
assert.deepEqual(result.edges, [{ from: counter.id, to: original.id, kind: 'refutation' }]);
assert.equal(graphSummary({ nodes: result.nodes }), 'refuted · kernel ✓');
assert.equal(original.status, 'open', 'Never mutate a cached state');
for (const status of ['open', 'checking', 'error', 'abandoned']) {
  const pending = refutationGraph([original, { ...counter, status }], [], false);
  assert.equal(pending.nodes[0].status, 'open', 'Only current accepted commands refute');
  assert.deepEqual(pending.edges, result.edges, 'Acceptance must not change layout');
}
for (const name of ['sqrt4_refuted', 'sqrt4_irrational_refuted_extra', 'SQRT4_irrational_refuted']) {
  const mismatch = refutationGraph([original, node(name, 'proved')], [], false);
  assert.equal(mismatch.nodes[0].status, 'open'); assert.equal(mismatch.edges.length, 0);
}
assert.equal(refutationGraph([original], [], false).nodes[0].status, 'open', 'Removing the counter-lemma retracts refuted');
assert.equal(refutationGraph([node('ordinary', 'proved')], [], false).nodes[0].status, 'checking');
assert.equal(refutationGraph([node('ordinary', 'proved')], [], true).nodes[0].status, 'proved');
assert.equal(refutationGraph([original, { ...counter, parent: original.id }], [], false).edges.length, 0, 'Only separate top-level declarations pair');
const prompt = preamble({ file: 'Sqrt4.thy', line: 5, openSteps: [{ name: 'sqrt4_irrational', line: 5 }] });
assert(prompt.includes('<theorem_name>_refuted') && prompt.includes('byte for byte') && prompt.includes('never use the admitted original theorem'));
assert(prompt.includes('fully_checked remains false') && !prompt.includes('do not write a proof'));
// The open-step count must not talk the agent out of the refutation it owes us.
assert(prompt.includes('Sqrt4.thy has 1 open (sorry) step: sqrt4_irrational (line 5)'), prompt);
assert(prompt.includes('unless a statement is false'), 'The red flash needs its carve-out from "close them all"');
console.log('PASS: exact refutation names, accepted/current state only, retraction, stable edges, ordinary root semantics and Ask guardrails');
