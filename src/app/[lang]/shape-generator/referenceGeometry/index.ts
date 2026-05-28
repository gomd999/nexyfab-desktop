/**
 * referenceGeometry/index.ts — barrel export.
 *
 * Wave 2 Phase 2 Track D Week 1. Importers should pull from this barrel,
 * not the individual files, so we can reorganise internally without
 * breaking call-sites later (W2 UI, W3 sketch integration).
 */

export * from './types';
export * from './math';
export * from './depSolver';
export * from './store';
export * from './useReferenceNodesAdapter';
export * from './evaluator';
export * from './sketchPlaneAdapter';
export { default as ReferenceGeometryLayer } from './ReferenceGeometryLayer';
export type { ReferenceGeometryLayerProps } from './ReferenceGeometryLayer';
export {
  buildReferenceMeshes,
  hashColor,
  DEFAULT_SIZING,
  type VizSizing,
} from './viz';

// W4 — i18n + KS conventions + Phase 3 assembly-mate API surface.
export * from './i18n';
export * from './ksConventions';

// Wave 2 Phase 3 Week 4 (Z4) — CRDT-backed ref-geom (flag-gated).
// Hosts opt in via `useRefGeomStore` from `./useRefGeomStore`; the
// existing Zustand `useReferenceGeometryStore` stays the default.
export {
  RefGeomStore,
  migrateToYjs as migrateRefGeomToYjs,
  type RefGeomStore as IRefGeomStore,
  type AddNodeResult,
  type AddNodeFailure,
} from './RefGeomStore';
export {
  applyRefGeomOp,
  getRefGeomRoot,
  getRefGeomNodeYMap,
  readReferenceNode,
  readAllReferenceNodes,
  readAllReferenceNodesArray,
  populateRefGeomDoc,
  clearRefGeomDoc,
  syncDocs as syncRefGeomDocs,
  referenceNodesEqual,
  ORIGIN_LOCAL_UI as REFGEOM_ORIGIN_LOCAL_UI,
  ORIGIN_REMOTE_UPDATE as REFGEOM_ORIGIN_REMOTE_UPDATE,
  ORIGIN_IMPORT_NFAB as REFGEOM_ORIGIN_IMPORT_NFAB,
  ORIGIN_GC as REFGEOM_ORIGIN_GC,
  type RefGeomOp,
  type RefGeomOpOrigin,
  type ApplyOpResult as RefGeomApplyOpResult,
} from './refGeomYjs';
export {
  useRefGeomStore,
  useRefGeomCycleWarning,
  useRefGeomLwwCollisionToast,
  useRefGeomLwwTracker,
  _resetRefGeomStoreLocal,
  _resetRefGeomStoreFallback,
  _acquireRefGeomFallbackDoc,
  type UseRefGeomStoreOptions,
  type UseRefGeomStoreResult,
  type CycleWarning,
  type RefGeomLwwToast,
  type UseRefGeomLwwToastOptions,
} from './useRefGeomStore';
