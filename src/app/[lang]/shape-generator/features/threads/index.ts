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

// ─── W6 (D6) — UI + update helper + viewport hint + i18n ──────────────────
export {
  updateThreadFeature,
  updateThreadFeatureOrThrow,
  type ThreadFeaturePatch,
  type ThreadFeatureUpdateResult,
  type ThreadFeatureUpdateErrorCode,
} from './threadFeatureUpdate';

export {
  default as HoleWizardThreadsSection,
  type HoleWizardThreadsSectionProps,
  type ThreadsSectionSpec,
  type SeriesGroup,
  SERIES_BY_GROUP,
  groupForSeries,
} from './HoleWizardThreadsSection';

export {
  default as StandaloneThreadModal,
  type StandaloneThreadModalProps,
} from './StandaloneThreadModal';

export {
  default as StandaloneAddThreadButton,
  type StandaloneAddThreadButtonProps,
} from './StandaloneAddThreadButton';

export {
  default as ThreadCosmeticIndicator,
  type ThreadCosmeticIndicatorProps,
  buildDashedCircleGeometry,
  makeDashedMaterial,
  makeLineForVisual,
  buildThreadCosmeticPolyline,
  THREAD_COSMETIC_COLOR,
  THREAD_COSMETIC_DASH_SIZE,
  THREAD_COSMETIC_GAP_SIZE,
  THREAD_COSMETIC_SEGMENTS,
} from './ThreadCosmeticIndicator';

export {
  pickThreadsDict,
  seriesLabel,
  type ThreadsLang,
  type ThreadsDict,
  THREADS_DICT_EN,
  THREADS_DICT_KO,
  THREADS_DICT_JA,
  THREADS_DICT_ZH,
  THREADS_DICT_ES,
  THREADS_DICT_AR,
} from './i18n';
