// ── Legacy Matrix4-based solver ───────────────────────────────────────────────
export { solveMates, generateMateId, MATE_TYPE_LABELS } from './AssemblyMates';
export type { MateType, AssemblyMate, AssemblyPart } from './AssemblyMates';

// ── Gauss-Seidel iterative solver (position/rotation-based) ──────────────────
export { solveAssembly, calculateDOF } from './matesSolver';
export type {
  MateType as SolverMateType,
  MateSelectionType,
  MateSelection,
  Mate,
  AssemblyBody,
  AssemblyState,
  SolveResult,
} from './matesSolver';
export { useAssemblyState } from './useAssemblyState';
export { default as AssemblyMatesPanel } from './AssemblyMatesPanel';

// ── Interference detection ────────────────────────────────────────────────────
export { detectInterference } from './InterferenceDetection';
export type { InterferenceResult } from './InterferenceDetection';

// ── Exploded view ─────────────────────────────────────────────────────────────
export { computeExplodedPositions } from './ExplodedView';

// ── UI panels ─────────────────────────────────────────────────────────────────
export { default as AssemblyPanel } from './AssemblyPanel';
