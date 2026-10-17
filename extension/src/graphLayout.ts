import type * as Dagre from '@dagrejs/dagre' with { 'resolution-mode': 'import' };
// Dagre 3 ships a CommonJS runtime but ESM declarations. Use its declared
// import types with the require export, also understood by the browser bundler.
const { graphlib, layout }: typeof Dagre = require('@dagrejs/dagre');
import type { GraphNode, GraphState } from './graphTypes';

export interface Box { id: string; x: number; y: number; width: number; height: number }
export interface GraphLayout { nodes: Box[]; containers: Box[]; width: number; height: number }

// Lay out sibling subtrees with Dagre, then place their parent above them.
// Each nested proof has a real bounding box: no overlapping compound endpoints.
export function graphLayout(state: GraphState, hidden: Set<string>): GraphLayout {
  const visible = state.nodes.filter(node => !hidden.has(node.id));
  const byId = new Map(visible.map(node => [node.id, node]));
  const children = new Map<string | null, GraphNode[]>();
  for (const node of visible) {
    const parent = node.parent && byId.has(node.parent) ? node.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const compact = state.total > 60, width = compact ? 108 : 150, height = compact ? 36 : 48;
  const gap = compact ? 20 : 30, padding = 18;
  function subtree(node: GraphNode): GraphLayout {
    const descendants = children.get(node.id) ?? [];
    if (!descendants.length) {
      const w = !node.parent && state.fully_checked ? 480 : width;
      const h = !node.parent && state.fully_checked ? 84 : height;
      return { nodes: [{ id: node.id, x: 0, y: 0, width: w, height: h }], containers: [], width: w, height: h };
    }
    const inside = siblings(descendants);
    const boxWidth = Math.max(width, inside.width + padding * 2), boxHeight = height + gap + inside.height + padding;
    const dx = (boxWidth - inside.width) / 2, dy = height + gap;
    return { width: boxWidth, height: boxHeight,
      nodes: [{ id: node.id, x: (boxWidth - width) / 2, y: 0, width, height },
        ...inside.nodes.map(box => ({ ...box, x: box.x + dx, y: box.y + dy }))],
      containers: [{ id: node.id, x: 0, y: height / 2, width: boxWidth, height: boxHeight - height / 2 },
        ...inside.containers.map(box => ({ ...box, x: box.x + dx, y: box.y + dy }))] };
  }
  function siblings(nodes: GraphNode[]): GraphLayout {
    if (!nodes.length) return { nodes: [], containers: [], width: 0, height: 0 };
    const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: gap, ranksep: gap, marginx: 0, marginy: 0 });
    graph.setDefaultEdgeLabel(() => ({}));
    const pieces = new Map(nodes.map(node => [node.id, subtree(node)]));
    for (const [id, piece] of pieces) graph.setNode(id, { width: piece.width, height: piece.height });
    const sibling = (id: string): string | undefined => {
      while (!pieces.has(id)) {
        const parent = byId.get(id)?.parent;
        if (!parent) return;
        id = parent;
      }
      return id;
    };
    // Consumers above their prerequisites; arrows themselves point A -> B.
    // A fact used deep inside another subtree also constrains the containers.
    for (const edge of state.edges) if (edge.kind !== 'nesting') {
      const from = sibling(edge.from), to = sibling(edge.to);
      if (from && to && from !== to) graph.setEdge(to, from);
    }
    layout(graph);
    const result: GraphLayout = { nodes: [], containers: [], width: graph.graph().width ?? 0, height: graph.graph().height ?? 0 };
    for (const [id, piece] of pieces) {
      const position = graph.node(id), dx = position.x - piece.width / 2, dy = position.y - piece.height / 2;
      result.nodes.push(...piece.nodes.map(box => ({ ...box, x: box.x + dx, y: box.y + dy })));
      result.containers.push(...piece.containers.map(box => ({ ...box, x: box.x + dx, y: box.y + dy })));
    }
    return result;
  }
  return siblings(children.get(null) ?? []);
}

export function edgePath(from: Box, to: Box): string {
  const upward = from.y > to.y;
  const x1 = from.x + from.width / 2, x2 = to.x + to.width / 2;
  const y1 = from.y + (upward ? 0 : from.height), y2 = to.y + (upward ? to.height : 0);
  const middle = (y1 + y2) / 2;
  return `M${x1},${y1} V${middle} H${x2} V${y2}`;
}
