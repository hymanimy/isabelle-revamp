import type { ProofEdge } from './isarSteps';

export type GraphStatus = 'open' | 'checking' | 'proved' | 'error' | 'abandoned' | 'refuted';
export interface GraphNode {
  id: string; name: string; statement: string; command: string; status: GraphStatus;
  line: number; range: [number, number, number, number]; parent: string | null; agent?: string;
}
export interface GraphState {
  file: string; uri: string; version: number; theory: string; nodes: GraphNode[]; edges: ProofEdge[];
  focused?: string; complete: boolean; fully_checked: boolean; proved: number; total: number; elapsed: number;
}
export interface GraphFrame { at: number; state: GraphState }

export function graphSummary(state: GraphState): string {
  if (state.nodes.some(node => node.status === 'refuted')) return 'refuted · kernel ✓';
  const error = state.nodes.some(node => node.status === 'error' || node.status === 'abandoned');
  return `${state.theory} · ${state.proved}/${state.total} proved · ${Math.floor(state.elapsed / 1000)} s`
    + (error ? ' · error' : state.fully_checked ? ' · kernel ✓' : state.complete ? '' : ' · checking…');
}
