import type { GraphNode } from './graphTypes';
import type { ProofEdge } from './isarSteps';

// An explicit naming convention, not a semantic claim inferred from prose.
// Include the edge even before acceptance, so status changes never move tiles.
export function refutationGraph(nodes: GraphNode[], edges: ProofEdge[], fullyChecked: boolean) {
  const roots = nodes.filter(node => node.parent === null);
  const links = roots.flatMap(refutation => {
    if (!refutation.name.endsWith('_refuted')) return [];
    const name = refutation.name.slice(0, -'_refuted'.length);
    return roots.filter(node => node.name === name)
      .map(node => ({ from: refutation.id, to: node.id, kind: 'refutation' as const }));
  });
  const accepted = new Set(nodes.filter(node => node.status === 'proved').map(node => node.id));
  return {
    nodes: nodes.map(node => {
      if (links.some(edge => edge.to === node.id && accepted.has(edge.from))) return { ...node, status: 'refuted' as const };
      // A checked counter-lemma may be green while the original admission
      // keeps the whole file unfinished. Ordinary roots retain M12 semantics.
      if (!fullyChecked && !node.parent && node.status === 'proved' && !links.some(edge => edge.from === node.id)) {
        return { ...node, status: 'checking' as const };
      }
      return node;
    }),
    edges: [...edges, ...links],
  };
}
