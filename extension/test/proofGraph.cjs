const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { proofStructure } = require('../out/isarSteps');
const { graphLayout, fitGraph } = require('../out/graphLayout');

function dag(graph) {
  const visiting = new Set(), finished = new Set();
  function visit(id) {
    assert(!visiting.has(id), 'dependency cycle at ' + id);
    if (finished.has(id)) return;
    visiting.add(id);
    for (const edge of graph.edges.filter(edge => edge.from === id)) visit(edge.to);
    visiting.delete(id); finished.add(id);
  }
  graph.nodes.forEach(node => visit(node.id));
}
const source = `theory Graph imports Main begin
lemma graph: True
proof -
  have A: True by simp
  have B: True using A by simp
  from B have C: True by (rule B)
  with A have D: True by (simp add: A B)
  have nested: True
  proof -
    have A: True by simp
    have E: True by (simp add: A)
    from E show ?thesis .
  qed
  then have F: True by (rule A[OF C])
  have G: True using E by simp
  also
  finally show ?thesis .
qed
lemma cases: True
proof (cases True)
  case True
  then have leaf: True sorry
  from leaf show ?thesis .
next
  case False
  then show ?thesis by simp
qed
lemma abandoned: True
proof -
  have broken: False
    oops
lemma witnesses: True
proof -
  obtain x where witness: "x = (0::nat)" by blast
  have used: True using witness graph by simp
  show ?thesis using used .
qed
text \\<open>have fake: \\<open>show sorry\\<close>\\<close>
(* have fake: True (* sorry *) *)
end`;
const graph = proofStructure(source);
function edge(from, to) { assert(graph.edges.some(edge => edge.from === from && edge.to === to), `${from} -> ${to}`); }
edge('graph/A', 'graph/B'); edge('graph/B', 'graph/C'); edge('graph/A', 'graph/D'); edge('graph/C', 'graph/D');
edge('graph/nested', 'graph/F'); edge('graph/A', 'graph/F'); edge('graph/C', 'graph/F');
assert(!graph.nodes.some(node => node.id.startsWith('graph/nested/')));
assert(!graph.edges.some(edge => edge.from === 'graph/nested/E' && edge.to === 'graph/G'));
assert(graph.nodes.some(node => node.id === 'cases/True/leaf' && node.parent === 'cases'));
assert(graph.nodes.filter(node => node.abandoned).map(node => node.id).includes('abandoned/broken'));
assert(!graph.nodes.some(node => node.name === 'fake' || ['also', 'finally', 'case'].includes(node.command)));
edge('witnesses/witness', 'witnesses/used'); edge('graph', 'witnesses/used');
assert.deepEqual(proofStructure(source), proofStructure(source), 'Parsing is deterministic');
const variation = source.replace('have E: True', 'have renamed_inside: True');
assert.deepEqual(proofStructure(variation).nodes.map(n => n.id), graph.nodes.map(n => n.id), 'Nested naming preserves the compact admission summary');
dag(graph);
for (const [file, count] of [['Swarm', 7], ['Sqrt2', 17]]) {
  const parsed = proofStructure(fs.readFileSync(path.resolve(__dirname, `../../examples/${file}.thy`), 'utf8'), true);
  assert.equal(parsed.nodes.length, count, file);
  const layout = graphLayout({ ...parsed, total: count, nodes: parsed.nodes.map(node => ({ ...node, parent: node.parent ?? null })) }, new Set());
  assert(layout.nodes.every(box => box.width >= 110 && box.height === 38));
  const fit = fitGraph(layout, 900, 370); // 400px panel minus the single 30px header.
  assert(fit.tx >= 7.999 && fit.ty >= 7.999 && fit.tx + layout.width * fit.scale <= 892.001
    && fit.ty + layout.height * fit.scale <= 362.001, file + ': 900x400 panel must need no scrolling');
  assert(fit.scale >= .92, 'Names must remain readable without truncation');
  assert(parsed.nodes.every(n => !n.parent || ['have', 'show', 'obtain'].includes(n.command)));
}
const named = proofStructure(source, true);
assert(named.nodes.some(node => node.id === 'graph/nested/E' && node.parent === 'graph/nested'));
assert(named.edges.some(edge => edge.from === 'graph/nested/A' && edge.to === 'graph/nested/E'));
assert(!named.edges.some(edge => edge.from === 'graph/nested/E' && edge.to === 'graph/G'), 'Nested names cannot leak into outer scope');
assert.deepEqual(proofStructure(source, true), named, 'Named nested graph is deterministic');
dag(named);
const partial = graphLayout({ ...named, nodes: named.nodes.map(node => ({ ...node, parent: node.parent ?? null, line: 1 })) }, new Set(['graph/nested/E']));
assert.deepEqual(partial.nodes.find(node => node.id === 'graph/nested').contained, ['E · L1']);
assert.deepEqual(partial.nodes.find(node => node.id === 'graph').contained, [], 'Folded names appear only in their nearest visible owner');
const typedWitness = proofStructure('lemma a: True proof - obtain x :: nat where witness: "x=0" by simp show ?thesis by simp qed');
assert.equal(typedWitness.nodes[1].name, 'witness', 'A typed variable is not a fact name');

const fixture = fs.readFileSync(path.resolve(__dirname, '../../examples/Cascade_solution.thy'), 'utf8');
const tree = proofStructure(fixture);
assert.equal(tree.nodes.length, 5, 'Compact admission summary retains four outer obligations');
const byId = new Map(tree.nodes.map(node => [node.id, node]));
const leaves = tree.nodes.filter(node => !tree.nodes.some(child => child.parent === node.id));
assert.equal(leaves.length, 4);
const skeleton = fs.readFileSync(path.resolve(__dirname, '../../examples/Cascade.thy'), 'utf8');
assert.deepEqual(proofStructure(skeleton).nodes.map(n => n.id), tree.nodes.map(n => n.id));
dag(tree);
const state = { ...tree, total: tree.nodes.length, nodes: tree.nodes.map(node => ({ ...node, parent: node.parent ?? null })) };
const layout = graphLayout(state, new Set());
assert(layout.nodes.length === tree.nodes.length);
const boxes = new Map(layout.nodes.map(box => [box.id, box]));
for (const node of tree.nodes) if (node.parent) assert(boxes.get(node.id).y > boxes.get(node.parent).y);
for (const box of layout.nodes) assert([box.x, box.y, box.width, box.height].every(Number.isFinite));
assert(boxes.get('rational_square_root/denominator_one').y <= boxes.get('rational_square_root/reduced_square').y,
  'Dependencies used inside a subtree must also order its container');
const hidden = new Set(tree.nodes.filter(node => node.parent).map(node => node.id));
assert.equal(graphLayout(state, hidden).nodes.length, 1);
const empty = graphLayout({ nodes: [], edges: [], total: 0 }, new Set());
assert.equal(empty.width, 0); assert.equal(empty.height, 0);
console.log(`PASS: scoped dependency forms, cases, oops, opaque prose, DAG, ${tree.nodes.length} fixture nodes/${leaves.length} leaves, nested Dagre layout and folded root`);
