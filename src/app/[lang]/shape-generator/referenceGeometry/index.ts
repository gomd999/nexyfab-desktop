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
