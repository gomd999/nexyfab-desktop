/**
 * ssaoConfig.ts — Screen-Space Ambient Occlusion settings + helpers.
 *
 * SSAO darkens regions where ambient light should physically be
 * blocked by nearby geometry (the inside of a slot, the seam between
 * two surfaces). It runs as a post-process on the depth + normal G-
 * buffer, sampling N tap points in a hemisphere around each pixel and
 * counting how many are occluded.
 *
 * This module owns:
 *   - The parameter shape (radius, samples, bias, intensity, ...).
 *   - Per-quality preset defaults.
 *   - Hemisphere sample kernel generation (deterministic, so render
 *     results stay stable across renders for a given seed).
 *   - Validation + clamping.
 *
 * The actual shader plumbing lives in the renderer integration; this
 * file is pure data and unit-testable without WebGL.
 */

export interface SsaoSettings {
  /** Sample count per pixel. Higher = smoother + slower. */
  samples: number;
  /** Hemisphere radius in world units (mm). */
  radiusMm: number;
  /** Self-occlusion bias to avoid edge artefacts. */
  bias: number;
  /** Darkness intensity multiplier (0 = off, 1 = full). */
  intensity: number;
  /** Gaussian blur radius applied to the AO buffer. */
  blurRadiusPx: number;
  /** Deterministic RNG seed for kernel generation. */
  seed: number;
}

export const DEFAULT_SSAO: SsaoSettings = {
  samples: 16,
  radiusMm: 2.0,
  bias: 0.01,
  intensity: 1.0,
  blurRadiusPx: 4,
  seed: 12345,
};

export const SSAO_PRESETS: Record<'preview' | 'standard' | 'hiQuality', SsaoSettings> = {
  preview:   { samples: 8,  radiusMm: 2.0, bias: 0.015, intensity: 0.8, blurRadiusPx: 2, seed: 12345 },
  standard:  { samples: 16, radiusMm: 2.0, bias: 0.01,  intensity: 1.0, blurRadiusPx: 4, seed: 12345 },
  hiQuality: { samples: 64, radiusMm: 2.5, bias: 0.008, intensity: 1.2, blurRadiusPx: 6, seed: 12345 },
};

/** Clamp + sanity-check user-supplied settings. Returns a corrected
 *  copy without throwing — out-of-range values just get clipped. */
export function sanitiseSsao(input: Partial<SsaoSettings>): SsaoSettings {
  const merge = { ...DEFAULT_SSAO, ...input };
  return {
    samples: Math.max(1, Math.min(256, Math.round(merge.samples))),
    radiusMm: Math.max(0.01, Math.min(100, merge.radiusMm)),
    bias: Math.max(0, Math.min(1, merge.bias)),
    intensity: Math.max(0, Math.min(4, merge.intensity)),
    blurRadiusPx: Math.max(0, Math.min(16, Math.round(merge.blurRadiusPx))),
    seed: Math.floor(merge.seed),
  };
}

/** Deterministic 32-bit LCG. Produces uniform [0, 1) per `.next()`.
 *  Same seed → same sequence; tests rely on this. */
class Lcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1; // avoid zero-trap
  }
  next(): number {
    // Math.imul keeps the multiply exact in 32-bit space. The float form
    // (state * 1103515245) overflows 2^53 and collapses the LCG into a
    // ~10k cycle with heavy bin bias (see meshCompare.ts sampleIndices).
    this.state = (Math.imul(this.state, 1103515245) + 12345) & 0x7fffffff;
    return this.state / 0x80000000;
  }
}

/** Generate `N` sample points distributed in the unit hemisphere
 *  (above the surface tangent plane). Each sample is biased toward
 *  the centre — high-density near origin gives more weight to short-
 *  range occluders, which matches what humans perceive as "ambient
 *  shadow". */
export function generateHemisphereKernel(
  samples: number,
  seed: number,
): Array<[number, number, number]> {
  const rng = new Lcg(seed);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < samples; i++) {
    // Random direction in upper hemisphere (z ≥ 0).
    let x = rng.next() * 2 - 1;
    let y = rng.next() * 2 - 1;
    let z = rng.next();          // [0, 1) — keeps z ≥ 0
    let len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-6) {
      // Extremely rare — three near-zero rolls. Use canonical sample.
      x = 0; y = 0; z = 1; len = 1;
    }
    // Normalise to unit length.
    x /= len; y /= len; z /= len;
    // Bias scale toward the centre (Garland's accelerating distribution).
    let scale = i / samples;
    scale = 0.1 + scale * scale * 0.9;
    x *= scale; y *= scale; z *= scale;
    out.push([x, y, z]);
  }
  return out;
}
