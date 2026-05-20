/**
 * structuredLight.ts — Structured-light depth recovery.
 *
 * Structured-light scanners (Intel RealSense, Photoneo, the cheap
 * DLP+camera rigs) project a known pattern onto an object and infer
 * depth from how the pattern deforms in the camera view. Two
 * decoding families this module handles:
 *
 *   - **Gray code**: project N binary patterns, each pixel decodes
 *     to an N-bit projector column index. Robust + insensitive to
 *     reflectance; resolution = 2^N stripes.
 *   - **Phase shifting**: project sinusoidal fringes at three phases
 *     (0°, 120°, 240°). Pixel phase = arctan2 of intensity ratios.
 *     Sub-pixel resolution but ambiguous beyond one period.
 *
 * Output: per-pixel disparity (column index) + reliability mask.
 * Triangulation to 3D depth then uses camera+projector calibration —
 * out of scope for this module.
 */

export interface DepthMap {
  width: number;
  height: number;
  /** Per-pixel decoded projector column (float). */
  disparity: Float32Array;
  /** Reliability per pixel (0..1). */
  reliability: Float32Array;
}

// ── Gray code decoding ────────────────────────────────────────

export interface GrayCodeImages {
  /** Reference images: brightest + darkest projection. */
  brightestPixels: Float32Array;
  darkestPixels: Float32Array;
  /** N pattern images. */
  patternImages: Float32Array[];
  width: number;
  height: number;
}

export interface GrayCodeOptions {
  /** Min contrast between brightest/darkest to trust the pixel. */
  contrastThreshold: number;
}

export const DEFAULT_GRAY_OPTIONS: GrayCodeOptions = {
  contrastThreshold: 0.1,
};

export function decodeGrayCode(images: GrayCodeImages, options: Partial<GrayCodeOptions> = {}): DepthMap {
  const opts = { ...DEFAULT_GRAY_OPTIONS, ...options };
  const n = images.patternImages.length;
  const total = images.width * images.height;
  const disparity = new Float32Array(total);
  const reliability = new Float32Array(total);

  for (let p = 0; p < total; p++) {
    const bright = images.brightestPixels[p]!;
    const dark = images.darkestPixels[p]!;
    const contrast = bright - dark;
    if (contrast < opts.contrastThreshold) {
      disparity[p] = -1;
      reliability[p] = 0;
      continue;
    }
    const midpoint = (bright + dark) / 2;
    let grayCode = 0;
    for (let k = 0; k < n; k++) {
      if (images.patternImages[k]![p]! > midpoint) {
        grayCode |= (1 << (n - 1 - k));
      }
    }
    // Convert gray → binary.
    let binary = grayCode;
    let mask = grayCode >> 1;
    while (mask > 0) {
      binary ^= mask;
      mask >>= 1;
    }
    disparity[p] = binary;
    reliability[p] = Math.min(1, contrast);
  }
  return { width: images.width, height: images.height, disparity, reliability };
}

// ── Phase-shifting decoding ───────────────────────────────────

export interface PhaseShiftImages {
  /** Three phase images at 0°, 120°, 240°. */
  phase0: Float32Array;
  phase120: Float32Array;
  phase240: Float32Array;
  width: number;
  height: number;
}

export interface PhaseShiftOptions {
  /** Min modulation amplitude to trust. */
  modulationThreshold: number;
}

export const DEFAULT_PHASE_OPTIONS: PhaseShiftOptions = {
  modulationThreshold: 0.05,
};

export function decodePhaseShift(images: PhaseShiftImages, options: Partial<PhaseShiftOptions> = {}): DepthMap {
  const opts = { ...DEFAULT_PHASE_OPTIONS, ...options };
  const total = images.width * images.height;
  const disparity = new Float32Array(total);
  const reliability = new Float32Array(total);

  for (let p = 0; p < total; p++) {
    const i0 = images.phase0[p]!;
    const i1 = images.phase120[p]!;
    const i2 = images.phase240[p]!;
    // Three-step phase formula.
    const num = Math.sqrt(3) * (i1 - i2);
    const den = 2 * i0 - i1 - i2;
    const phase = Math.atan2(num, den);
    // Modulation amplitude.
    const mod = (2 / 3) * Math.sqrt(3 * (i1 - i2) ** 2 + (2 * i0 - i1 - i2) ** 2);
    if (mod < opts.modulationThreshold) {
      disparity[p] = -1;
      reliability[p] = 0;
      continue;
    }
    // Wrap phase to [0, 2π].
    disparity[p] = ((phase + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    reliability[p] = Math.min(1, mod);
  }
  return { width: images.width, height: images.height, disparity, reliability };
}

// ── Phase unwrapping (1D scanline) ────────────────────────────

/** Itoh's row-by-row phase unwrapping: track integer wrap count
 *  by checking neighbour phase differences. */
export function unwrapPhase1D(phaseRow: Float32Array): Float32Array {
  const out = new Float32Array(phaseRow.length);
  out[0] = phaseRow[0]!;
  for (let i = 1; i < phaseRow.length; i++) {
    let d = phaseRow[i]! - phaseRow[i - 1]!;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    out[i] = out[i - 1]! + d;
  }
  return out;
}

// ── Disparity → depth (simple parallel projection) ────────────

export interface ProjectorCalibration {
  /** Distance between camera and projector (mm). */
  baselineMm: number;
  /** Camera focal length in pixels. */
  focalPx: number;
  /** Projector total columns. */
  projectorColumns: number;
}

/** Compute depth (mm) from disparity using a triangulation
 *  approximation (parallel camera/projector axes). Wrong for general
 *  rigs but works for the demo case. */
export function disparityToDepth(map: DepthMap, calibration: ProjectorCalibration): Float32Array {
  const depth = new Float32Array(map.width * map.height);
  for (let p = 0; p < depth.length; p++) {
    if (map.disparity[p]! < 0) {
      depth[p] = 0;
      continue;
    }
    const camCol = p % map.width;
    const projCol = map.disparity[p]! * (calibration.projectorColumns / map.width);
    const disparity = camCol - projCol;
    if (Math.abs(disparity) < 1e-6) {
      depth[p] = 0;
      continue;
    }
    depth[p] = (calibration.baselineMm * calibration.focalPx) / disparity;
  }
  return depth;
}

// ── Diagnostics ───────────────────────────────────────────────

export interface DecodeStats {
  totalPixels: number;
  validPixels: number;
  validFraction: number;
  averageReliability: number;
}

export function summarizeDecoding(map: DepthMap): DecodeStats {
  let valid = 0;
  let relSum = 0;
  for (let i = 0; i < map.disparity.length; i++) {
    if (map.disparity[i]! >= 0) {
      valid++;
      relSum += map.reliability[i]!;
    }
  }
  return {
    totalPixels: map.disparity.length,
    validPixels: valid,
    validFraction: map.disparity.length > 0 ? valid / map.disparity.length : 0,
    averageReliability: valid > 0 ? relSum / valid : 0,
  };
}

// ── Pattern generation (for synthetic testing) ────────────────

/** Generate the N binary gray-code patterns for a given image width. */
export function generateGrayCodePatterns(columns: number, bits: number): Uint8Array[] {
  const patterns: Uint8Array[] = [];
  for (let k = 0; k < bits; k++) {
    const pattern = new Uint8Array(columns);
    for (let c = 0; c < columns; c++) {
      const grayCode = c ^ (c >> 1);
      const bit = (grayCode >> (bits - 1 - k)) & 1;
      pattern[c] = bit ? 255 : 0;
    }
    patterns.push(pattern);
  }
  return patterns;
}
