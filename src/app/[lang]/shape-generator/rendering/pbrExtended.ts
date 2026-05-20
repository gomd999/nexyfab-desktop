/**
 * pbrExtended.ts — Extended PBR material parameters beyond the basic
 * roughness + metalness preset library in `materials.ts`.
 *
 * Adds the four high-impact "advanced" BRDF lobes that mid-tier and
 * Class-A automotive rendering rely on:
 *
 *   - **clearcoat**: a thin glossy layer over the base material.
 *     Used on automotive paint, lacquered wood, polished plastics.
 *     Reflects a separate specular highlight.
 *
 *   - **anisotropy**: directional micro-grooves (brushed aluminium,
 *     spun metal, hair). The specular highlight stretches along the
 *     grain direction instead of being a round dot.
 *
 *   - **sheen**: cloth / felt response at grazing angles. Important
 *     for soft furnishings, packaging, gaskets.
 *
 *   - **iridescence**: thin-film interference colours. Anodised
 *     aluminium, soap films, fuel sheens.
 *
 * The shape of each lobe follows the GLTF 2.0 PBR extension model so
 * exports / imports interop with any GLB-aware renderer.
 *
 * This module only ships the data + lookup helpers. The actual shader
 * code lives in the renderer (three.js MeshPhysicalMaterial covers
 * clearcoat / iridescence natively; sheen and anisotropy ship via
 * MaterialX extensions or custom shader chunks).
 */

import type { MaterialPreset } from '../materials';

export interface PbrExtended {
  /** Strength of the clearcoat layer, 0..1. 0 = none. */
  clearcoat?: number;
  /** Roughness of the clearcoat. 0 = mirror, 1 = matte. */
  clearcoatRoughness?: number;
  /** Anisotropy magnitude, -1..1. Sign = direction (perpendicular vs parallel to tangent). */
  anisotropy?: number;
  /** Anisotropy rotation angle in radians. */
  anisotropyRotation?: number;
  /** Sheen intensity, 0..1. */
  sheen?: number;
  /** Sheen colour (typically white or tinted). */
  sheenColor?: string;
  /** Sheen roughness, 0..1. */
  sheenRoughness?: number;
  /** Iridescence intensity, 0..1. */
  iridescence?: number;
  /** Thin-film thickness, nanometres. Drives the iridescent colour band. */
  iridescenceThicknessNm?: number;
  /** IOR of the thin film. */
  iridescenceIOR?: number;
}

export type ExtendedMaterialPreset = MaterialPreset & PbrExtended;

/** Built-in extended presets layered on top of the base library. These
 *  are intended as "starting point" looks for the picker — the user
 *  tweaks values via the panel sliders.
 *
 *  Note: many of these inherit `id` from a base preset and overlay
 *  the extended fields. Callers merge with the base by id. */
export const EXTENDED_PRESETS: Record<string, PbrExtended> = {
  // Automotive clearcoat-over-paint look.
  automotive_paint: {
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  },
  // Brushed aluminium for hi-fi enclosures and laptops.
  brushed_aluminum: {
    anisotropy: 0.8,
    anisotropyRotation: 0,
  },
  // Velvet / felt / suede.
  velvet: {
    sheen: 1.0,
    sheenColor: '#ffffff',
    sheenRoughness: 0.3,
  },
  // Soap-bubble / anodised aluminium look.
  iridescent: {
    iridescence: 1.0,
    iridescenceThicknessNm: 400,
    iridescenceIOR: 1.3,
  },
  // Wet road / glossy plastic packaging.
  wet_plastic: {
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  },
  // Polished hardwood with lacquer.
  lacquered_wood: {
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
  },
};

/** Merge an extended preset overlay onto a base MaterialPreset. */
export function applyExtendedOverlay(
  base: MaterialPreset,
  overlayKey: keyof typeof EXTENDED_PRESETS,
): ExtendedMaterialPreset {
  const overlay = EXTENDED_PRESETS[overlayKey] ?? {};
  return { ...base, ...overlay };
}

/** Validate a PbrExtended payload — clamp out-of-range, drop bad
 *  types. Returns a sanitised copy. */
export function sanitiseExtended(input: Partial<PbrExtended>): PbrExtended {
  const clamp01 = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(0, Math.min(1, v))
      : undefined;
  const clampSigned1 = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(-1, Math.min(1, v))
      : undefined;
  return {
    clearcoat: clamp01(input.clearcoat),
    clearcoatRoughness: clamp01(input.clearcoatRoughness),
    anisotropy: clampSigned1(input.anisotropy),
    anisotropyRotation: typeof input.anisotropyRotation === 'number' && Number.isFinite(input.anisotropyRotation)
      ? input.anisotropyRotation
      : undefined,
    sheen: clamp01(input.sheen),
    sheenColor: typeof input.sheenColor === 'string' ? input.sheenColor : undefined,
    sheenRoughness: clamp01(input.sheenRoughness),
    iridescence: clamp01(input.iridescence),
    iridescenceThicknessNm: typeof input.iridescenceThicknessNm === 'number' && input.iridescenceThicknessNm > 0
      ? input.iridescenceThicknessNm
      : undefined,
    iridescenceIOR: typeof input.iridescenceIOR === 'number' && input.iridescenceIOR >= 1
      ? input.iridescenceIOR
      : undefined,
  };
}

/** Strip undefined fields so the result serialises cleanly. */
export function stripUndefined(input: PbrExtended): PbrExtended {
  const out: PbrExtended = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
