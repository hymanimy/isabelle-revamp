const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { proofStructure } = require('../out/isarSteps');
const { graphLayout } = require('../out/graphLayout');

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
edge('graph/nested/A', 'graph/nested/E'); edge('graph/nested/E', 'graph/nested/show');
edge('graph/nested/show', 'graph/nested'); edge('graph/nested', 'graph/F'); edge('graph/A', 'graph/F'); edge('graph/C', 'graph/F');
assert(!graph.edges.some(edge => edge.from === 'graph/nested/E' && edge.to === 'graph/G'));
assert(graph.nodes.some(node => node.id === 'cases/True/leaf' && node.parent === 'cases/True'));
assert(graph.nodes.filter(node => node.abandoned).map(node => node.id).includes('abandoned/broken'));
assert(!graph.nodes.some(node => node.name === 'fake'));
edge('witnesses/obtain', 'witnesses/used'); edge('graph', 'witnesses/used');
dag(graph);

const fixture = fs.readFileSync(path.resolve(__dirname, '../../examples/Cascade_solution.thy'), 'utf8');
const tree = proofStructure(fixture);
assert(tree.nodes.length >= 40, tree.nodes.length);
const byId = new Map(tree.nodes.map(node => [node.id, node]));
const depth = node => node.parent ? 1 + depth(byId.get(node.parent)) : 0;
assert(Math.max(...tree.nodes.map(depth)) >= 3);
const leaves = tree.nodes.filter(node => !tree.nodes.some(child => child.parent === node.id));
assert(leaves.length >= 25);
const skeleton = fs.readFileSync(path.resolve(__dirname, '../../examples/Cascade.thy'), 'utf8');
let filled = skeleton;
const openLeaves = proofStructure(skeleton).nodes.filter(node => leaves.some(leaf => leaf.id === node.id));
for (const node of openLeaves.reverse()) {
  const leaf = leaves.find(leaf => leaf.id === node.id);
  filled = filled.slice(0, node.finish.start) + fixture.slice(leaf.finish.start, leaf.end) + filled.slice(node.end);
}
assert.equal(filled.replace('theory Cascade\n', 'theory Cascade_solution\n'), fixture,
  'Each reference method must replace one sorry without changing its fact context');
dag(tree);
const state = { ...tree, total: tree.nodes.length, nodes: tree.nodes.map(node => ({ ...node, parent: node.parent ?? null })) };
const layout = graphLayout(state, new Set());
assert(layout.nodes.length === tree.nodes.length);
const boxes = new Map(layout.nodes.map(box => [box.id, box]));
for (const node of tree.nodes) if (node.parent) assert(boxes.get(node.id).y > boxes.get(node.parent).y);
for (const box of layout.nodes) assert([box.x, box.y, box.width, box.height].every(Number.isFinite));
assert(boxes.get('rational_square_root/denominator_one').y < boxes.get('rational_square_root/reduced_square').y,
  'Dependencies used inside a subtree must also order its container');
const hidden = new Set(tree.nodes.filter(node => node.parent).map(node => node.id));
assert.equal(graphLayout(state, hidden).nodes.length, 1);
const empty = graphLayout({ nodes: [], edges: [], total: 0 }, new Set());
assert.equal(empty.width, 0); assert.equal(empty.height, 0);
console.log(`PASS: scoped dependency forms, cases, oops, opaque prose, DAG, ${tree.nodes.length} fixture nodes/${leaves.length} leaves, nested Dagre layout and folded root`);
