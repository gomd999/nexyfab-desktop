/**
 * qualityPresets.ts — Bundled rendering quality tiers.
 *
 * The renderer has independent knobs (resolution, MSAA, SSAO samples,
 * bloom iterations, shadow map size, PMREM levels, frame budget). For
 * 95% of users we want one slider — `preview / standard / hi-quality`
 * — that swaps a coherent bundle of values.
 *
 * This module owns the bundles and exposes a single resolve function
 * the renderer calls per frame. Each sub-system (ssaoConfig,
 * postProcess, hdrEnvironment) ships its OWN tier defaults; this
 * module composes them into a single QualityBundle.
 */

import { SSAO_PRESETS, type SsaoSettings } from './ssaoConfig';
import { DEFAULT_BLOOM, DEFAULT_DOF, type BloomSettings, type DofSettings } from './postProcess';
import { pmremConfigFor, type PmremConfig } from './hdrEnvironment';

export type QualityTier = 'preview' | 'standard' | 'hiQuality';

export interface QualityBundle {
  tier: QualityTier;
  /** Internal renderer pixel ratio multiplier. */
  pixelRatio: number;
  /** MSAA sample count (0 = off, 4 = standard, 8 = hi). */
  msaa: number;
  /** Shadow map resolution (square texture). */
  shadowMapSize: number;
  /** Maximum frame budget in ms — used by frame-pacing. */
  frameBudgetMs: number;
  /** Whether SSAO is enabled in this tier. */
  ssaoEnabled: boolean;
  ssao: SsaoSettings;
  /** Whether bloom is enabled. */
  bloomEnabled: boolean;
  bloom: BloomSettings;
  /** Whether DoF is enabled. */
  dofEnabled: boolean;
  dof: DofSettings;
  /** PMREM (IBL prefiltering) config. */
  pmrem: PmremConfig;
}

const COMMON_BLOOM_DISABLED: BloomSettings = { ...DEFAULT_BLOOM, intensity: 0 };
const COMMON_DOF_DISABLED: DofSettings = { ...DEFAULT_DOF, maxCocPx: 0 };

export const QUALITY_BUNDLES: Record<QualityTier, QualityBundle> = {
  preview: {
    tier: 'preview',
    pixelRatio: 1.0,
    msaa: 0,
    shadowMapSize: 512,
    frameBudgetMs: 8,
    ssaoEnabled: false,
    ssao: SSAO_PRESETS.preview,
    bloomEnabled: false,
    bloom: COMMON_BLOOM_DISABLED,
    dofEnabled: false,
    dof: COMMON_DOF_DISABLED,
    pmrem: pmremConfigFor('preview'),
  },
  standard: {
    tier: 'standard',
    pixelRatio: 1.5,
    msaa: 4,
    shadowMapSize: 1024,
    frameBudgetMs: 16,
    ssaoEnabled: true,
    ssao: SSAO_PRESETS.standard,
    bloomEnabled: true,
    bloom: DEFAULT_BLOOM,
    dofEnabled: false,
    dof: COMMON_DOF_DISABLED,
    pmrem: pmremConfigFor('standard'),
  },
  hiQuality: {
    tier: 'hiQuality',
    pixelRatio: 2.0,
    msaa: 8,
    shadowMapSize: 2048,
    frameBudgetMs: 33,
    ssaoEnabled: true,
    ssao: SSAO_PRESETS.hiQuality,
    bloomEnabled: true,
    bloom: { ...DEFAULT_BLOOM, iterations: 7, intensity: 0.5 },
    dofEnabled: true,
    dof: DEFAULT_DOF,
    pmrem: pmremConfigFor('hiQuality'),
  },
};

/** Resolve a tier name to its bundle, with `standard` as the fallback
 *  for unknown strings. */
export function resolveQualityBundle(tier: string): QualityBundle {
  if (tier === 'preview' || tier === 'standard' || tier === 'hiQuality') {
    return QUALITY_BUNDLES[tier];
  }
  return QUALITY_BUNDLES.standard;
}

/** Apply per-feature overrides on top of a tier bundle. Useful for
 *  the "I want standard but with bloom off" case. */
export function overrideQualityBundle(
  base: QualityBundle,
  overrides: Partial<QualityBundle>,
): QualityBundle {
  return {
    ...base,
    ...overrides,
    ssao: { ...base.ssao, ...(overrides.ssao ?? {}) },
    bloom: { ...base.bloom, ...(overrides.bloom ?? {}) },
    dof: { ...base.dof, ...(overrides.dof ?? {}) },
    pmrem: { ...base.pmrem, ...(overrides.pmrem ?? {}) },
  };
}
