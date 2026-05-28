/**
 * Threads module — Wave 2 Phase 2 (W5 catalog + cosmetic stub; geometric in W7).
 *
 * Barrel export for the three D5 modules. Keep the surface narrow so future
 * additions (helix wiring, drawing-callout pipeline) extend rather than fork.
 */

export {
  // Tables
  THREAD_CATALOG,
  ALL_THREAD_ROWS,
  ISO_M_COARSE_TABLE,
  ISO_M_FINE_TABLE,
  UNC_TABLE,
  UNF_TABLE,
  NPT_TABLE,
  BSP_PARALLEL_TABLE,
  BSP_TAPERED_TABLE,
  // Helpers
  findThreadRow,
  findThreadRowAnySeries,
  allRowsInSeries,
  pitchToTpi,
  tpiToPitch,
  defaultThreadClass,
  // Types
  type ThreadSeries,
  type ThreadStandardRow,
} from './threadCatalog';

export {
  makeThreadFeature,
  formatThreadCallout,
  type ThreadFeature,
  type ThreadMode,
  type ThreadDirection,
  type ThreadKind,
  type ThreadCatalogRef,
  type MakeThreadFeatureInput,
  type FormatCalloutOptions,
} from './threadFeature';

export {
  applyThreadCosmetic,
  type ApplyThreadCosmeticResult,
  type ApplyThreadCosmeticOptions,
} from './applyThreadCosmetic';
