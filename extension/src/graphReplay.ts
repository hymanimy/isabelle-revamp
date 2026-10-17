import type { GraphFrame, GraphNode, GraphState } from './graphTypes';

export const replaySpeeds = [1, 2, 4, 8] as const;
export type ReplaySpeed = typeof replaySpeeds[number];
export function replaySpeed(value: unknown): ReplaySpeed {
  return replaySpeeds.includes(value as ReplaySpeed) ? value as ReplaySpeed : 2;
}

// PIDE can accept several nodes in one notification. Expand that batch into
// deterministic individual transitions; parent acceptance follows its children.
// Times here are at x1. The player applies the selected speed once.
export function replayTimeline(frames: GraphFrame[]): GraphFrame[] {
  const result: GraphFrame[] = [];
  let previous: GraphState | undefined, at = 0, lastGreen = -400;
  const first = frames[0]?.at ?? 0;
  for (const frame of frames) {
    const target = frame.state;
    const old = new Map(previous?.nodes.map(node => [node.id, node]) ?? []);
    const byId = new Map(target.nodes.map(node => [node.id, node]));
    const depth = (node: GraphNode): number => node.parent && byId.has(node.parent) ? 1 + depth(byId.get(node.parent)!) : 0;
    const accepted = target.nodes.filter(node => node.status === 'proved' && old.get(node.id)?.status !== 'proved')
      .sort((a, b) => depth(b) - depth(a) || a.line - b.line);
    const pending = new Set(accepted.map(node => node.id));
    let nodes = target.nodes.map(node => pending.has(node.id)
      ? { ...node, status: old.get(node.id)?.status ?? 'checking' as const }
      : node.status === 'refuted' && accepted.length ? { ...node, status: old.get(node.id)?.status ?? 'open' as const } : node);
    at = Math.max(at, frame.at - first);
    if (accepted.length) {
      result.push({ at, state: { ...target, nodes, fully_checked: false, proved: nodes.filter(node => node.status === 'proved').length } });
      for (const node of accepted) {
        at = Math.max(at, lastGreen + 400); lastGreen = at; pending.delete(node.id);
        nodes = nodes.map(item => item.id === node.id ? node : item);
        if (!pending.size) nodes = target.nodes;
        result.push({ at, state: { ...target, nodes, fully_checked: !pending.size && target.fully_checked,
          proved: nodes.filter(item => item.status === 'proved').length } });
      }
    } else result.push({ at, state: target });
    previous = target;
  }
  return result;
}
