/**
 * postProcess.ts — Bloom + Depth-of-Field configuration.
 *
 * **Bloom** brightens regions above a luminance threshold and adds a
 * blurred halo. Sells material polish (chrome edges, screen glow) on
 * photoreal renders. Implemented as a multi-iteration downsample /
 * upsample chain (Kawase / dual-filter) at the renderer level; this
 * module owns the parameters.
 *
 * **Depth-of-field** simulates camera lens defocus. Pixels at the
 * focus plane stay sharp; pixels away from it are blurred by a
 * circle-of-confusion (CoC) radius proportional to their depth
 * distance. We expose the optical parameters (focal length,
 * aperture f-stop, focus distance) so the picker can show
 * realistic "50mm at f/2.8 focused at 200mm" presets.
 *
 * Both effects are unit-test friendly: the math runs without WebGL.
 */

export interface BloomSettings {
  /** Luminance above which pixels contribute to bloom. */
  threshold: number;
  /** Strength of the bloom add-back (0 = off). */
  intensity: number;
  /** Soft knee for the threshold (0 = hard cutoff, 1 = smoothstep). */
  softKnee: number;
  /** Blur iterations (more = wider halo, slower). */
  iterations: number;
}

export const DEFAULT_BLOOM: BloomSettings = {
  threshold: 1.0,
  intensity: 0.4,
  softKnee: 0.5,
  iterations: 5,
};

export interface DofSettings {
  /** Distance from camera to the focus plane (mm). */
  focusDistanceMm: number;
  /** Camera focal length (mm). 50mm = "normal lens", 25mm = wide. */
  focalLengthMm: number;
  /** f-number (lens aperture). Smaller = more blur (shallower DoF). */
  fStop: number;
  /** Maximum CoC radius in pixels — clamps blur on very far / near
   *  pixels so the kernel stays affordable. */
  maxCocPx: number;
}

export const DEFAULT_DOF: DofSettings = {
  focusDistanceMm: 300,
  focalLengthMm: 50,
  fStop: 2.8,
  maxCocPx: 16,
};

/** Apply soft-knee to luminance for bloom threshold. Returns the
 *  contribution scaling factor in [0, 1]. */
export function bloomContribution(luminance: number, b: BloomSettings): number {
  const knee = b.threshold * b.softKnee;
  if (luminance <= b.threshold - knee) return 0;
  if (luminance >= b.threshold + knee) return 1;
  // smoothstep between (T - knee) and (T + knee)
  const t = (luminance - (b.threshold - knee)) / (2 * knee);
  return t * t * (3 - 2 * t);
}

/** Compute the circle-of-confusion radius (in mm at the sensor) for
 *  a pixel at `distanceMm` from the camera. The renderer converts
 *  this to pixels using the sensor-pixel pitch.
 *
 *  Formula (thin-lens approximation):
 *    CoC = |A · f · (d - D)| / (d · (D - f))
 *  where A = aperture diameter = f / N (N = f-stop), f = focal length,
 *        d = pixel distance, D = focus distance. */
export function circleOfConfusionMm(
  distanceMm: number,
  d: DofSettings,
): number {
  const f = d.focalLengthMm;
  const D = d.focusDistanceMm;
  const A = f / d.fStop;
  if (distanceMm <= f) return 0;     // closer than focal length — pinhole region
  if (Math.abs(distanceMm - D) < 1e-9) return 0; // at focus → sharp
  const denom = distanceMm * (D - f);
  if (Math.abs(denom) < 1e-9) return 0;
  return Math.abs((A * f * (distanceMm - D)) / denom);
}

/** Convenience — total CoC radius in pixels at a given depth, with
 *  the renderer-side mm-to-px conversion baked in via `mmPerPx`. */
export function cocRadiusPx(
  distanceMm: number,
  mmPerPx: number,
  d: DofSettings,
): number {
  const cocMm = circleOfConfusionMm(distanceMm, d);
  const px = cocMm / Math.max(mmPerPx, 1e-9);
  return Math.min(px, d.maxCocPx);
}

/** Clamp + sanity-check a Bloom payload. */
export function sanitiseBloom(input: Partial<BloomSettings>): BloomSettings {
  const merge = { ...DEFAULT_BLOOM, ...input };
  return {
    threshold: Math.max(0, merge.threshold),
    intensity: Math.max(0, Math.min(4, merge.intensity)),
    softKnee: Math.max(0, Math.min(1, merge.softKnee)),
    iterations: Math.max(0, Math.min(8, Math.round(merge.iterations))),
  };
}

/** Clamp + sanity-check a DoF payload. */
export function sanitiseDof(input: Partial<DofSettings>): DofSettings {
  const merge = { ...DEFAULT_DOF, ...input };
  return {
    focusDistanceMm: Math.max(1, merge.focusDistanceMm),
    focalLengthMm: Math.max(1, Math.min(500, merge.focalLengthMm)),
    fStop: Math.max(1.0, Math.min(32, merge.fStop)),
    maxCocPx: Math.max(0, Math.min(64, Math.round(merge.maxCocPx))),
  };
}
