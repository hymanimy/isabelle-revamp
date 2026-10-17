import type * as Dagre from '@dagrejs/dagre' with { 'resolution-mode': 'import' };
// Dagre 3 ships a CommonJS runtime but ESM declarations. Use its declared
// import types with the require export, also understood by the browser bundler.
const { graphlib, layout }: typeof Dagre = require('@dagrejs/dagre');
import type { GraphNode, GraphState } from './graphTypes';

export interface Box { id: string; x: number; y: number; width: number; height: number; contained?: string[]; nameLines?: string[] }
export interface GraphLayout { nodes: Box[]; containers: Box[]; width: number; height: number }

// Lay out sibling subtrees with Dagre, then place their parent above them.
// Each nested proof has a real bounding box: no overlapping compound endpoints.
export function graphLayout(state: GraphState, hidden: Set<string>, availableWidth = 884): GraphLayout {
  const visible = state.nodes.filter(node => !hidden.has(node.id));
  const byId = new Map(state.nodes.map(node => [node.id, node]));
  const children = new Map<string | null, GraphNode[]>();
  for (const node of visible) {
    const parent = node.parent && byId.has(node.parent) ? node.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const compact = availableWidth < 750;
  const height = compact ? 32 : 38, gap = compact ? 12 : 24, padding = compact ? 5 : 8;
  // Wrap long identifiers without deleting characters. Tooltip/click identity
  // remains the exact Isar name; compact columns must not truncate labels.
  const nameLines = (name: string): string[] => compact ? name.match(/.{1,14}/g) ?? [''] : [name];
  const widthOf = (name: string) => Math.max(110, name.length * 7.2 + 20);
  function containedNames(id: string): string[] {
    return state.nodes.filter(node => {
      if (!hidden.has(node.id)) return false;
      let parent = node.parent;
      while (parent && hidden.has(parent)) parent = byId.get(parent)?.parent ?? null;
      return parent === id;
    }).map(node => `${node.name} · L${node.line}`);
  }
  function subtree(node: GraphNode): GraphLayout {
    const descendants = children.get(node.id) ?? [];
    const contained = containedNames(node.id), lines = nameLines(node.name);
    const width = Math.max(compact ? 114 : widthOf(node.name), ...contained.map(widthOf));
    const tileHeight = height + (lines.length - 1) * 13 + contained.length * 16;
    if (!descendants.length) {
      return { nodes: [{ id: node.id, x: 0, y: 0, width, height: tileHeight, contained, nameLines: lines }], containers: [], width, height: tileHeight };
    }
    const inside = siblings(descendants);
    const boxWidth = Math.max(width, inside.width + padding * 2), boxHeight = tileHeight + gap + inside.height + padding;
    const dx = (boxWidth - inside.width) / 2, dy = tileHeight + gap;
    return { width: boxWidth, height: boxHeight,
      nodes: [{ id: node.id, x: (boxWidth - width) / 2, y: 0, width, height: tileHeight, contained, nameLines: lines },
        ...inside.nodes.map(box => ({ ...box, x: box.x + dx, y: box.y + dy }))],
      containers: [{ id: node.id, x: 0, y: height / 2, width: boxWidth, height: boxHeight - height / 2 },
        ...inside.containers.map(box => ({ ...box, x: box.x + dx, y: box.y + dy }))] };
  }
  function siblings(nodes: GraphNode[]): GraphLayout {
    if (!nodes.length) return { nodes: [], containers: [], width: 0, height: 0 };
    const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 12, ranksep: 24, marginx: 0, marginy: 0 });
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
    // Wrap Dagre's ordered subtrees into readable rows. A long dependency
    // chain must not reduce every label to a few pixels when Fit is applied.
    // Nesting stays intact; arrows retain their direction across row breaks.
    const ordered = [...pieces].sort(([a], [b]) => graph.node(a).y - graph.node(b).y || graph.node(a).x - graph.node(b).x);
    const result: GraphLayout = { nodes: [], containers: [], width: 0, height: 0 };
    let x = 0, y = 0, rowHeight = 0;
    const rowWidth = Math.max(compact && visible.length > 10 ? 660 : 240, availableWidth - padding * 4);
    for (const [, piece] of ordered) {
      if (x && x + piece.width > rowWidth) { x = 0; y += rowHeight + gap; rowHeight = 0; }
      result.nodes.push(...piece.nodes.map(box => ({ ...box, x: box.x + x, y: box.y + y })));
      result.containers.push(...piece.containers.map(box => ({ ...box, x: box.x + x, y: box.y + y })));
      result.width = Math.max(result.width, x + piece.width);
      rowHeight = Math.max(rowHeight, piece.height); x += piece.width + 12;
    }
    result.height = y + rowHeight;
    return result;
  }
  return siblings(children.get(null) ?? []);
}

export function edgePath(from: Box, to: Box): string {
  if (from.y === to.y) {
    const channel = from.y - 6; // Keep root-to-root edges inside Fit's 8 px margin.
    return `M${from.x + from.width / 2},${from.y} V${channel} H${to.x + to.width / 2} V${to.y}`;
  }
  const upward = from.y > to.y;
  const x1 = from.x + from.width / 2, x2 = to.x + to.width / 2;
  const y1 = from.y + (upward ? 0 : from.height), y2 = to.y + (upward ? to.height : 0);
  const middle = (y1 + y2) / 2;
  return `M${x1},${y1} V${middle} H${x2} V${y2}`;
}

export function fitGraph(layout: Pick<GraphLayout, 'width' | 'height'>, width: number, height: number) {
  const scale = Math.max(.001, Math.min(1, (width - 16) / Math.max(layout.width, 1), (height - 16) / Math.max(layout.height, 1)));
  return { scale, tx: (width - layout.width * scale) / 2, ty: (height - layout.height * scale) / 2 };
}
