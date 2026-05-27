/**
 * materialOverride.ts — Temporary material swap for render.
 *
 * The viewport material lets the engineer work with the *real*
 * material assignments (aluminum / steel / ABS …). But for a
 * marketing hero render you often want to override everything
 * with a single material — "gold sample" for portfolio shots,
 * "clay" for shape studies, "wireframe" for debug visualisation.
 *
 * This module produces an override map that the renderer applies
 * just for the photo shot. The base material assignments stay
 * untouched.
 */

export type OverridePreset = 'gold' | 'silver' | 'copper' | 'chrome' | 'clay' | 'wireframe' | 'plastic-white' | 'plastic-red' | 'glass' | 'ceramic';

export interface PBRParams {
  baseColor: [number, number, number];
  metalness: number;
  roughness: number;
  ior?: number;
  transmission?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
}

export const OVERRIDE_PRESETS: Record<OverridePreset, PBRParams> = {
  gold:    { baseColor: [1.0, 0.84, 0.0], metalness: 1.0, roughness: 0.15 },
  silver:  { baseColor: [0.95, 0.93, 0.88], metalness: 1.0, roughness: 0.1 },
  copper:  { baseColor: [0.95, 0.64, 0.54], metalness: 1.0, roughness: 0.2 },
  chrome:  { baseColor: [0.55, 0.55, 0.55], metalness: 1.0, roughness: 0.0 },
  clay:    { baseColor: [0.84, 0.79, 0.70], metalness: 0.0, roughness: 0.85 },
  wireframe: { baseColor: [0.1, 0.1, 0.1], metalness: 0.0, roughness: 1.0 },
  'plastic-white': { baseColor: [0.95, 0.95, 0.95], metalness: 0.0, roughness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.3 },
  'plastic-red':   { baseColor: [0.9, 0.15, 0.15], metalness: 0.0, roughness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.3 },
  glass:   { baseColor: [1.0, 1.0, 1.0], metalness: 0.0, roughness: 0.05, ior: 1.5, transmission: 0.95 },
  ceramic: { baseColor: [0.95, 0.92, 0.88], metalness: 0.0, roughness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.1 },
};

export interface MaterialOverride {
  /** Apply preset to all bodies. */
  preset: OverridePreset;
  /** Optional per-body overrides — body id → custom PBR. */
  perBody?: Record<string, PBRParams>;
  /** Whether wireframe overlay is drawn on top. */
  wireframeOverlay?: boolean;
}

/** Resolve override for a given body. */
export function resolveBodyMaterial(
  override: MaterialOverride,
  bodyId: string,
): PBRParams {
  return override.perBody?.[bodyId] ?? OVERRIDE_PRESETS[override.preset];
}

/** Merge two PBR param sets — newer wins for defined fields. */
export function mergePbr(base: PBRParams, patch: Partial<PBRParams>): PBRParams {
  return {
    baseColor: patch.baseColor ?? base.baseColor,
    metalness: patch.metalness ?? base.metalness,
    roughness: patch.roughness ?? base.roughness,
    ior: patch.ior ?? base.ior,
    transmission: patch.transmission ?? base.transmission,
    clearcoat: patch.clearcoat ?? base.clearcoat,
    clearcoatRoughness: patch.clearcoatRoughness ?? base.clearcoatRoughness,
  };
}

/** Tweak existing material by adjusting roughness or metalness
 *  (used by sliders in the render dialog). */
export function adjust(
  base: PBRParams,
  adjustments: { roughnessDelta?: number; metalnessDelta?: number },
): PBRParams {
  return {
    ...base,
    roughness: Math.max(0, Math.min(1, base.roughness + (adjustments.roughnessDelta ?? 0))),
    metalness: Math.max(0, Math.min(1, base.metalness + (adjustments.metalnessDelta ?? 0))),
  };
}
