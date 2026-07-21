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
export { buildInterferenceArtifact, interferenceGate, INTERFERENCE_CONTACT_TOL, type InterferenceArtifact } from './interferenceGate';
export { manufacturingGate } from './manufacturingGate';
export { buildDrawingArtifact, drawingGate, type DrawingArtifact, type PlannedMeasurement } from './drawingGate';
export { buildDesignPackage, buildVerificationReport, planBomRows, REPORT_LIMITATIONS } from './packager';
