/**
 * featureGuards.ts — Defensive checks for known edge cases that
 * crash or silently misbehave in feature implementations.
 *
 * These guards run *before* the feature's `apply()` so users see a
 * meaningful error message ("필렛 반경이 0보다 커야 합니다") instead
 * of an OCCT crash buried in the console. They're cheap (no
 * geometry traversal) and fail fast.
 *
 * One guard per feature kind. Failure returns a structured
 * `FeatureGuardError` with a translation key so the UI can render
 * the right locale.
 */

import type { FeatureInstance } from './types';

export type FeatureGuardCode =
  | 'EMPTY_PIPELINE'
  | 'NEGATIVE_PARAM'
  | 'ZERO_PARAM'
  | 'PARAM_OUT_OF_RANGE'
  | 'MISSING_SKETCH_DATA'
  | 'EMPTY_SKETCH_PROFILE'
  | 'DEGENERATE_SKETCH_PROFILE'
  | 'UNSUPPORTED_FEATURE_TYPE'
  | 'EXTRUDE_DEPTH_ZERO'
  | 'FILLET_RADIUS_INVALID'
  | 'SHELL_THICKNESS_INVALID'
  | 'HOLE_DIAMETER_INVALID'
  | 'PATTERN_COUNT_INVALID';

export interface FeatureGuardError {
  code: FeatureGuardCode;
  featureId?: string;
  featureType: string;
  /** Translation key — full localized string lookup at UI layer. */
  i18nKey: string;
  /** Best-effort English fallback. */
  fallbackMessage: string;
  /** When the offending param is known, surface it for auto-fix. */
  offendingParam?: string;
  suggestedFix?: number;
}

const PARAM_BOUNDS: Record<string, { min: number; max: number }> = {
  // Feature param sanity bounds. Conservative — features can still
  // override per-instance, but anything outside this range likely
  // signals a typo.
  radius:    { min: 0.01,    max: 1000 },
  distance:  { min: 0.01,    max: 1000 },
  thickness: { min: 0.05,    max: 100 },
  diameter:  { min: 0.1,     max: 500 },
  depth:     { min: 0.01,    max: 5000 },
  count:     { min: 1,       max: 200 },
  angle:     { min: -180,    max: 180 },
  segments:  { min: 1,       max: 64 },
};

function checkBounds(param: string, value: number): FeatureGuardCode | null {
  const b = PARAM_BOUNDS[param];
  if (!b) return null;
  if (value < b.min || value > b.max) return 'PARAM_OUT_OF_RANGE';
  return null;
}

export function guardFeature(feat: FeatureInstance): FeatureGuardError | null {
  // Pass 1: finite + sign checks. Bounds check moved to Pass 3 so
  // that feature-specific zero guards (FILLET_RADIUS_INVALID etc.)
  // win over the generic PARAM_OUT_OF_RANGE for radius=0 / count=0.
  for (const [k, v] of Object.entries(feat.params)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        code: 'NEGATIVE_PARAM',
        featureId: feat.id,
        featureType: feat.type,
        i18nKey: 'guard.paramNotFinite',
        fallbackMessage: `Param "${k}" must be a finite number (got ${v}).`,
        offendingParam: k,
      };
    }
    if (k !== 'angle' && v < 0) {
      return {
        code: 'NEGATIVE_PARAM',
        featureId: feat.id,
        featureType: feat.type,
        i18nKey: 'guard.paramNegative',
        fallbackMessage: `Param "${k}" must be non-negative (got ${v}).`,
        offendingParam: k,
        suggestedFix: Math.abs(v),
      };
    }
  }

  // Pass 2: feature-specific deep checks (zero / required params).
  switch (feat.type) {
    case 'fillet':
    case 'variableFillet': {
      const r = feat.params.radius;
      if (r === undefined || r === 0) {
        return {
          code: 'FILLET_RADIUS_INVALID',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.filletRadiusZero',
          fallbackMessage: 'Fillet radius must be greater than 0.',
          offendingParam: 'radius',
          suggestedFix: 1,
        };
      }
      break;
    }
    case 'shell':
    case 'variableShell': {
      const t = feat.params.thickness;
      if (t === undefined || t === 0) {
        return {
          code: 'SHELL_THICKNESS_INVALID',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.shellThicknessZero',
          fallbackMessage: 'Shell thickness must be greater than 0.',
          offendingParam: 'thickness',
          suggestedFix: 1,
        };
      }
      break;
    }
    case 'hole': {
      const d = feat.params.diameter;
      if (d === undefined || d === 0) {
        return {
          code: 'HOLE_DIAMETER_INVALID',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.holeDiameterZero',
          fallbackMessage: 'Hole diameter must be greater than 0.',
          offendingParam: 'diameter',
          suggestedFix: 3,
        };
      }
      break;
    }
    case 'linearPattern':
    case 'circularPattern': {
      const c = feat.params.count;
      if (c === undefined || c < 1) {
        return {
          code: 'PATTERN_COUNT_INVALID',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.patternCountInvalid',
          fallbackMessage: 'Pattern count must be at least 1.',
          offendingParam: 'count',
          suggestedFix: 3,
        };
      }
      break;
    }
    case 'sketchExtrude': {
      if (!feat.sketchData) {
        return {
          code: 'MISSING_SKETCH_DATA',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.sketchDataMissing',
          fallbackMessage: 'Sketch-extrude feature is missing sketch data.',
        };
      }
      if (feat.sketchData.profile.segments.length === 0) {
        return {
          code: 'EMPTY_SKETCH_PROFILE',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.sketchProfileEmpty',
          fallbackMessage: 'Sketch profile has no segments.',
        };
      }
      if (feat.sketchData.config.depth <= 0 && feat.sketchData.config.mode === 'extrude') {
        return {
          code: 'EXTRUDE_DEPTH_ZERO',
          featureId: feat.id, featureType: feat.type,
          i18nKey: 'guard.extrudeDepthZero',
          fallbackMessage: 'Extrude depth must be greater than 0.',
          offendingParam: 'depth',
          suggestedFix: 10,
        };
      }
      break;
    }
    default:
      // All other feature types fall through to generic param guards.
      break;
  }

  // Pass 3: generic param bounds (after feature-specific zero guards).
  for (const [k, v] of Object.entries(feat.params)) {
    if (typeof v !== 'number') continue;
    const boundsErr = checkBounds(k, v);
    if (boundsErr) {
      return {
        code: boundsErr,
        featureId: feat.id,
        featureType: feat.type,
        i18nKey: `guard.${k}OutOfRange`,
        fallbackMessage: `Param "${k}" = ${v} is outside the allowed range.`,
        offendingParam: k,
      };
    }
  }

  return null;
}

export function guardPipeline(features: FeatureInstance[]): FeatureGuardError | null {
  if (features.length === 0) {
    return {
      code: 'EMPTY_PIPELINE',
      featureType: 'pipeline',
      i18nKey: 'guard.pipelineEmpty',
      fallbackMessage: 'Pipeline has no features.',
    };
  }
  for (const f of features) {
    if (!f.enabled) continue;
    const err = guardFeature(f);
    if (err) return err;
  }
  return null;
}
