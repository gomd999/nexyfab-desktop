/**
 * toneMapping.ts — HDR → LDR mapping operators.
 *
 * Physically-based rendering produces radiance values in linear HDR
 * (typically 0..tens for sunlit metal). Monitors display LDR
 * sRGB (0..1). The mapping function decides how to compress that
 * range — different operators trade off contrast vs highlight
 * preservation:
 *
 *   - **Linear**: clamp to [0, 1] after exposure. Honest but burns
 *     out highlights. Useful for technical / scientific imagery.
 *   - **Reinhard (extended)**: smooth roll-off, never clips.
 *     Reinhard 2002. Good general-purpose default.
 *   - **ACES Filmic**: industry-standard cinematic look (Hollywood VFX,
 *     Unreal/Unity default). Compresses both shadows and highlights
 *     with a slight S-curve. Best for photoreal product shots.
 *
 * Each operator is exposed as a per-pixel function returning a
 * tone-mapped colour, plus a small palette of named defaults. The
 * renderer plugs the chosen operator into a fragment shader; the
 * functions here also let us unit-test colour-pipeline correctness
 * end-to-end without a GPU.
 */

export type ToneMappingOp = 'linear' | 'reinhardExtended' | 'acesFilmic';

export interface ToneMappingSettings {
  op: ToneMappingOp;
  /** Exposure offset in EV stops (positive = brighter). Applied
   *  before the operator. */
  exposureEv: number;
  /** White point used by Reinhard Extended (clamp above this). */
  whitePoint?: number;
}

export const DEFAULT_TONE_MAPPING: ToneMappingSettings = {
  op: 'acesFilmic',
  exposureEv: 0,
  whitePoint: 4.0,
};

/** Convert EV stops to a linear exposure multiplier. 2^ev. */
export function exposureMultiplier(ev: number): number {
  return Math.pow(2, ev);
}

/** Linear tone-map: just clamp. */
export function linear(c: number): number {
  return Math.max(0, Math.min(1, c));
}

/** Reinhard Extended (2002):  L_out = L_in (1 + L_in / Lw²) / (1 + L_in)
 *  where Lw is the white point — values above Lw are clipped, but
 *  smoothly. */
export function reinhardExtended(c: number, whitePoint: number): number {
  if (c <= 0) return 0;
  const wp2 = whitePoint * whitePoint;
  const out = (c * (1 + c / wp2)) / (1 + c);
  return Math.max(0, Math.min(1, out));
}

/** ACES Filmic approximation (Krzysztof Narkowicz 2015):
 *    (x · (a·x + b)) / (x · (c·x + d) + e)
 *  Coefficients chosen to fit the official ACES RRT+ODT for typical
 *  display targets. Returns a value in [0, 1]. */
export function acesFilmic(c: number): number {
  if (c <= 0) return 0;
  const a = 2.51, b = 0.03, c2 = 2.43, d = 0.59, e = 0.14;
  const out = (c * (a * c + b)) / (c * (c2 * c + d) + e);
  return Math.max(0, Math.min(1, out));
}

/** Top-level dispatcher — apply settings (exposure + operator) to a
 *  single linear-radiance value. */
export function applyToneMapping(linearValue: number, settings: ToneMappingSettings): number {
  const exposed = linearValue * exposureMultiplier(settings.exposureEv);
  switch (settings.op) {
    case 'linear': return linear(exposed);
    case 'reinhardExtended': return reinhardExtended(exposed, settings.whitePoint ?? 4.0);
    case 'acesFilmic': return acesFilmic(exposed);
  }
}

/** Apply tone mapping to an [r,g,b] triple. Same operator on each
 *  channel — channel-correlated operators (Hable, etc.) are out of
 *  scope; ACES Filmic on a per-channel basis is the common compromise. */
export function applyToneMappingRGB(
  rgb: [number, number, number],
  settings: ToneMappingSettings,
): [number, number, number] {
  return [
    applyToneMapping(rgb[0], settings),
    applyToneMapping(rgb[1], settings),
    applyToneMapping(rgb[2], settings),
  ];
}
