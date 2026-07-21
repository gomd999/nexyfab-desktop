/**
 * design-driver — Wave A WA-A public surface.
 *
 * `runDesignDriver(brief, { planner })` executes plan → build → verify
 * gate chain → package. See designDriver.ts for the contract.
 */

export * from './types';
export { PlannerError, staticPlanner, type DesignPlanner } from './planner';
export {
  fixturePlanner,
  lBracketPlan,
  steppedShaftPlan,
  pinBlockAssemblyPlan,
  circleLoop,
  tessellatedCylinderVolume,
  type FixtureKey,
} from './fixturePlanner';
export { runDesignDriver, type DriverDeps } from './designDriver';
export { polyhedronVolume, manifoldVolume, buildPartGeometry, geometryGate, type ManifoldVolumeResult, type PartGeometry, type BodyGeometry, type Aabb } from './geometryGate';
export { solvePlanAssembly, assemblyGate, ASSEMBLY_DEFAULT_TOL, type AssemblySolveArtifact } from './assemblyGate';
export {
  buildInterferenceArtifact,
  interferenceGate,
  INTERFERENCE_CONTACT_TOL,
  type InterferenceArtifact,
  type ConfirmedPair,
  type ClearedPair,
  type FallbackPair,
} from './interferenceGate';
export {
  preciseInterference,
  worldTriangles,
  trianglesIntersect,
  pointInMesh,
  type PreciseResult,
  type Tri,
} from './interferencePrecise';
export { manufacturingGate } from './manufacturingGate';
export { buildFlatPatternArtifact, flatPatternGate, type FlatPatternArtifact } from './flatPatternGate';
export { buildWeldmentArtifact, weldmentGate, type WeldmentArtifact } from './weldmentGate';
export { buildFastenerArtifact, fastenerGate, type FastenerArtifact } from './fastenerGate';
export { buildPatternArtifact, patternGate, type PatternArtifact } from './patternGate';
export { buildGdtArtifact, gdtGate, type GdtArtifact } from './gdtGate';
export { buildDrawingArtifact, drawingGate, type DrawingArtifact, type PlannedMeasurement } from './drawingGate';
export { buildDesignPackage, buildVerificationReport, planBomRows, REPORT_LIMITATIONS } from './packager';
