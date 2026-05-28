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
