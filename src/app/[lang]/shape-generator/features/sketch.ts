import type { FeatureDefinition } from './types';

/**
 * Standalone sketch feature.
 *
 * Stores a 2D profile on a named plane so that downstream features (loft,
 * sweep) can reference it by ID via `sketchRefs`. The feature itself is a
 * pass-through — it does not modify the accumulated body geometry.
 *
 * When the pipeline builds the sketch map it reads `sketchData` from every
 * enabled 'sketch' (and 'sketchExtrude') instance so loft/sweep can retrieve
 * the profile with `getCurrentPipelineSketchMap().get(featureId)`.
 */
export const sketchFeature: FeatureDefinition = {
  type: 'sketch',
  icon: '✏️',
  params: [],
  apply: (geometry) => geometry,
};
