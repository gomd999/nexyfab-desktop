/**
 * surfaceRoughness.ts — Surface roughness parameter computation.
 *
 * ISO 4287 / ASME B46.1 defines a family of roughness amplitude
 * parameters from a 1-D profile measurement (mm of vertical
 * displacement vs mm of traverse length). The most cited:
 *
 *   - **Ra** — arithmetic mean of |z| deviations from the mean line.
 *     The classic "surface roughness" number you see on prints.
 *   - **Rq (RMS)** — root-mean-square deviation. About 1.25 × Ra
 *     for typical surfaces; reported on aerospace prints.
 *   - **Rz** — mean of the 5 highest peak-to-valley distances over
 *     5 sub-sections. Closer to "what the eye sees" than Ra.
 *   - **Rt** — total peak-to-valley over the entire profile.
 *   - **Rp** — max peak height. **Rv** — max valley depth.
 *   - **Rsk (skewness)** — distribution shape (negative = lots of
 *     valleys, used for sealing surfaces).
 *   - **Rku (kurtosis)** — peakedness.
 *
 * Inputs are a sampled profile (uniform spacing), reported in mm or
 * μm — caller picks the unit. Output keeps the same unit.
 *
 * The math is straight ISO 4287: subtract the mean line, then apply
 * each parameter's formula. We don't apply a Gaussian filter (λc
 * cutoff) here — that belongs to a separate filtering step.
 */

export interface RoughnessProfile {
  /** Vertical displacement samples (mm or μm — caller's choice). */
  heights: number[];
  /** Horizontal sample spacing (same unit as `heights`). */
  spacing: number;
}

export interface RoughnessParams {
  /** Arithmetic-mean roughness. */
  ra: number;
  /** RMS roughness. */
  rq: number;
  /** 5-segment mean peak-to-valley. */
  rz: number;
  /** Total profile peak-to-valley. */
  rt: number;
  /** Max peak height (above mean line). */
  rp: number;
  /** Max valley depth (below mean line). */
  rv: number;
  /** Skewness (dimensionless). */
  rsk: number;
  /** Kurtosis (dimensionless). */
  rku: number;
  /** Number of zero-crossings in the centered profile (× 10 mm). */
  zeroCrossings: number;
  /** Total traverse length (same unit as spacing). */
  traverseLength: number;
}

function meanLine(profile: RoughnessProfile): number {
  const n = profile.heights.length;
  if (n === 0) return 0;
  return profile.heights.reduce((s, v) => s + v, 0) / n;
}

/** Compute the full set of ISO 4287 amplitude parameters from a profile. */
export function computeRoughness(profile: RoughnessProfile): RoughnessParams {
  const n = profile.heights.length;
  if (n === 0) {
    return {
      ra: 0, rq: 0, rz: 0, rt: 0, rp: 0, rv: 0, rsk: 0, rku: 0,
      zeroCrossings: 0, traverseLength: 0,
    };
  }
  const mean = meanLine(profile);
  const centered = profile.heights.map(z => z - mean);

  let absSum = 0;
  let sqSum = 0;
  let maxPeak = -Infinity;
  let maxValley = Infinity;
  let cube = 0;
  let quart = 0;
  for (const z of centered) {
    const a = Math.abs(z);
    absSum += a;
    sqSum += z * z;
    cube += z * z * z;
    quart += z * z * z * z;
    if (z > maxPeak) maxPeak = z;
    if (z < maxValley) maxValley = z;
  }

  const ra = absSum / n;
  const rq = Math.sqrt(sqSum / n);
  const rp = Math.max(0, maxPeak);
  const rv = Math.max(0, -maxValley);
  const rt = rp + rv;

  // Skewness / kurtosis — normalized by σ.
  const variance = sqSum / n;
  const sigma = Math.sqrt(variance);
  const rsk = sigma > 0 ? (cube / n) / Math.pow(sigma, 3) : 0;
  const rku = sigma > 0 ? (quart / n) / Math.pow(sigma, 4) : 0;

  // Rz — split profile into 5 segments, take peak-to-valley of each.
  const segCount = 5;
  const segLen = Math.floor(n / segCount);
  let pkValleySum = 0;
  for (let s = 0; s < segCount; s++) {
    const start = s * segLen;
    const end = s === segCount - 1 ? n : start + segLen;
    let pk = -Infinity, va = Infinity;
    for (let i = start; i < end; i++) {
      if (centered[i]! > pk) pk = centered[i]!;
      if (centered[i]! < va) va = centered[i]!;
    }
    pkValleySum += pk - va;
  }
  const rz = pkValleySum / segCount;

  // Zero crossings.
  let crossings = 0;
  for (let i = 1; i < centered.length; i++) {
    if ((centered[i - 1]! >= 0) !== (centered[i]! >= 0)) crossings++;
  }

  return {
    ra,
    rq,
    rz,
    rt,
    rp,
    rv,
    rsk,
    rku,
    zeroCrossings: crossings,
    traverseLength: (n - 1) * profile.spacing,
  };
}

// ── Surface finish grade classification ──────────────────────────

/** ISO-grade roughness class (N1..N12 by Ra in μm). */
export const ISO_GRADE_TABLE: ReadonlyArray<{ class: string; raMaxUm: number }> = [
  { class: 'N1', raMaxUm: 0.025 },
  { class: 'N2', raMaxUm: 0.05 },
  { class: 'N3', raMaxUm: 0.1 },
  { class: 'N4', raMaxUm: 0.2 },
  { class: 'N5', raMaxUm: 0.4 },
  { class: 'N6', raMaxUm: 0.8 },
  { class: 'N7', raMaxUm: 1.6 },
  { class: 'N8', raMaxUm: 3.2 },
  { class: 'N9', raMaxUm: 6.3 },
  { class: 'N10', raMaxUm: 12.5 },
  { class: 'N11', raMaxUm: 25 },
  { class: 'N12', raMaxUm: 50 },
];

/** Map a Ra value (μm) to the strictest ISO grade it satisfies. */
export function isoGradeForRa(raUm: number): string {
  for (const g of ISO_GRADE_TABLE) {
    if (raUm <= g.raMaxUm) return g.class;
  }
  return 'beyond-N12';
}

// ── Typical roughness by process ─────────────────────────────────

/** Typical Ra ranges (μm) by manufacturing process. Used for DFM
 *  warnings — "you asked for Ra 0.2 but turning gets 0.4 best". */
export const PROCESS_RA_RANGE: Record<string, { min: number; max: number }> = {
  'lapping':         { min: 0.025, max: 0.1 },
  'polishing':       { min: 0.05,  max: 0.2 },
  'grinding-fine':   { min: 0.1,   max: 0.4 },
  'grinding-coarse': { min: 0.4,   max: 1.6 },
  'reaming':         { min: 0.4,   max: 1.6 },
  'turning-finish':  { min: 0.4,   max: 1.6 },
  'milling-finish':  { min: 0.4,   max: 3.2 },
  'turning-rough':   { min: 3.2,   max: 12.5 },
  'milling-rough':   { min: 1.6,   max: 6.3 },
  'edm-finish':      { min: 0.4,   max: 1.6 },
  'edm-rough':       { min: 3.2,   max: 12.5 },
  'sand-cast':       { min: 12.5,  max: 50 },
  'investment-cast': { min: 1.6,   max: 12.5 },
  'sheet-laser':     { min: 1.6,   max: 6.3 },
  'fdm-print':       { min: 12.5,  max: 50 },
  'sla-print':       { min: 1.6,   max: 6.3 },
};

/** Suggest the cheapest process(es) capable of meeting a Ra target. */
export function suggestProcessForRa(raTargetUm: number): string[] {
  return Object.entries(PROCESS_RA_RANGE)
    .filter(([, range]) => range.max <= raTargetUm * 1.05)
    .map(([process]) => process);
}

// ── Filter (low-pass cutoff) ─────────────────────────────────────

/** Simple moving-average filter — approximates the ISO 4288 short-
 *  wavelength cutoff (λc). Caller picks the window size in samples. */
export function movingAverageFilter(profile: RoughnessProfile, windowSamples: number): RoughnessProfile {
  if (windowSamples <= 1) return { heights: profile.heights.slice(), spacing: profile.spacing };
  const n = profile.heights.length;
  const filtered: number[] = new Array(n);
  const half = Math.floor(windowSamples / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += profile.heights[k]!;
    filtered[i] = sum / (hi - lo + 1);
  }
  return { heights: filtered, spacing: profile.spacing };
}

/** Compute the "roughness profile" — original minus the moving-average
 *  (waviness) component. Used as input to ISO 4287 parameters per the
 *  standard's recommended filtering. */
export function roughnessAfterFilter(profile: RoughnessProfile, lambdaCSamples: number): RoughnessProfile {
  const waviness = movingAverageFilter(profile, lambdaCSamples);
  return {
    heights: profile.heights.map((h, i) => h - waviness.heights[i]!),
    spacing: profile.spacing,
  };
}
