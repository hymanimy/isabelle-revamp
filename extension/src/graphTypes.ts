import type { ProofEdge } from './isarSteps';

export type GraphStatus = 'open' | 'checking' | 'proved' | 'error' | 'abandoned';
export interface GraphNode {
  id: string; name: string; statement: string; command: string; status: GraphStatus;
  range: [number, number, number, number]; parent: string | null; agent?: string;
}
export interface GraphState {
  file: string; uri: string; version: number; theory: string; nodes: GraphNode[]; edges: ProofEdge[];
  complete: boolean; fully_checked: boolean; proved: number; total: number; elapsed: number;
}
export interface GraphFrame { at: number; state: GraphState }
