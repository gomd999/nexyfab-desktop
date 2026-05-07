// ── Mesh / face-index solver (nfab 저장·배치 파이프) ──────────────────────────
// `applyGeometryMatesToPlaced` → `solveMates`. See M3_ASSEMBLY.md §1 P1.
export { solveMates, generateMateId, MATE_TYPE_LABELS } from './AssemblyMates';
export type { MateType, AssemblyMate, AssemblyPart } from './AssemblyMates';

// ── Selection-based Gauss-Seidel (AssemblyMatesPanel / 뷰포트 UI) ─────────────
// 다른 데이터 모델(`Mate` + `MateSelection`). 합치려면 selection↔face 매핑 선행.
export { solveAssembly, calculateDOF } from './matesSolver';
// ── AssemblyMate ↔ MateSelection (M3 매핑 레이어) ─────────────────────────────
export {
  placedPartWorldMatrix,
  faceCentroidLocal,
  faceNormalLocal,
  mateSelectionFromPlacedFace,
  assemblyMateToSolverMate,
  assemblyMateToSolverMateForBom,
  placedPartsAndAssemblyMatesToSolverState,
  bomPartResultsAndAssemblyMatesToSolverState,
  classifyPlacedAssemblyMateMappingFailure,
  classifyBomAssemblyMateMappingFailure,
  reportPlacedAssemblyMateMapping,
  reportBomAssemblyMateMapping,
} from './mateSelectionMapping';
export type {
  PlacedToSolverStateOptions,
  MateMappingFailure,
  PlacedMateMappingReport,
  BomMateMappingReport,
} from './mateSelectionMapping';
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
export { detectInterference, detectInterferenceCooperative } from './InterferenceDetection';
export type {
  InterferenceResult,
  PartInput as InterferencePartInput,
  DetectInterferenceCooperativeOptions,
} from './InterferenceDetection';
export { bomPartWorldMatrixFromBom } from './bomPartWorldMatrix';

// ── Exploded view ─────────────────────────────────────────────────────────────
export { computeExplodedPositions } from './ExplodedView';
export { computeAssemblyWorldBounds } from './assemblyWorldBounds';

// ── UI panels ─────────────────────────────────────────────────────────────────
export { default as AssemblyPanel } from './AssemblyPanel';
