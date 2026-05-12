/**
 * Z4 — Industrial standards library extension.
 *
 * The existing isoFasteners.ts covers ISO 261 metric coarse threads M3-M16.
 * This module adds:
 *   - ASME B1.1 imperial fasteners (UNC/UNF) — #4 to 1"
 *   - DIN 625 deep-groove ball bearings (most common dim series)
 *   - DIN 6885 keys / keyways
 *   - DIN 471 / DIN 472 retaining rings (external + internal)
 *   - JIS B 1180 — JIS metric is identical to ISO M-series, exposed for
 *     locale-clarity in BOM output
 *   - ASME standard drill sizes (number, letter, fractional)
 *
 * All catalogs are pure data — lookups return null for unknown sizes so
 * the agent can fall back to "specify exact dims" instead of fabricating.
 */

// ─── ASME B1.1 imperial fasteners (UNC / UNF) ──────────────────────────────

export interface ImperialFastener {
  /** Designation: e.g. "1/4-20" (UNC) or "1/4-28" (UNF). */
  designation: string;
  /** Nominal diameter in inches. */
  dInch: number;
  /** Threads per inch. */
  tpi: number;
  /** Series (Coarse/Fine/Extra-fine). */
  series: 'UNC' | 'UNF' | 'UNEF';
  /** Across-flats hex size in inches. */
  hexAcrossFlatsInch: number;
}

export const ASME_FASTENERS: Record<string, ImperialFastener> = {
  '#4-40':   { designation: '#4-40',   dInch: 0.112, tpi: 40, series: 'UNC', hexAcrossFlatsInch: 0.187 },
  '#6-32':   { designation: '#6-32',   dInch: 0.138, tpi: 32, series: 'UNC', hexAcrossFlatsInch: 0.250 },
  '#8-32':   { designation: '#8-32',   dInch: 0.164, tpi: 32, series: 'UNC', hexAcrossFlatsInch: 0.250 },
  '#10-24':  { designation: '#10-24',  dInch: 0.190, tpi: 24, series: 'UNC', hexAcrossFlatsInch: 0.312 },
  '1/4-20':  { designation: '1/4-20',  dInch: 0.250, tpi: 20, series: 'UNC', hexAcrossFlatsInch: 0.4375 },
  '1/4-28':  { designation: '1/4-28',  dInch: 0.250, tpi: 28, series: 'UNF', hexAcrossFlatsInch: 0.4375 },
  '5/16-18': { designation: '5/16-18', dInch: 0.3125, tpi: 18, series: 'UNC', hexAcrossFlatsInch: 0.500 },
  '3/8-16':  { designation: '3/8-16',  dInch: 0.375, tpi: 16, series: 'UNC', hexAcrossFlatsInch: 0.5625 },
  '1/2-13':  { designation: '1/2-13',  dInch: 0.500, tpi: 13, series: 'UNC', hexAcrossFlatsInch: 0.750 },
  '5/8-11':  { designation: '5/8-11',  dInch: 0.625, tpi: 11, series: 'UNC', hexAcrossFlatsInch: 0.9375 },
  '3/4-10':  { designation: '3/4-10',  dInch: 0.750, tpi: 10, series: 'UNC', hexAcrossFlatsInch: 1.125 },
  '1-8':     { designation: '1-8',     dInch: 1.000, tpi:  8, series: 'UNC', hexAcrossFlatsInch: 1.500 },
};

export function lookupImperial(designation: string): ImperialFastener | null {
  return ASME_FASTENERS[designation.toUpperCase().replace(/\s/g, '')] ?? null;
}

// ─── DIN 625 deep-groove ball bearings ─────────────────────────────────────

export interface BallBearing {
  /** Bearing series + bore designation, e.g. "6204". */
  designation: string;
  /** Bore (inner diameter) in mm. */
  boreMm: number;
  /** Outer diameter in mm. */
  odMm: number;
  /** Width in mm. */
  widthMm: number;
  /** Dynamic load rating in N (catalog spec). */
  dynamicLoadN: number;
  /** Static load rating in N. */
  staticLoadN: number;
  /** Limiting speed (rpm) for a grease-lubed bearing. */
  limitingRpm: number;
}

export const DIN_BALL_BEARINGS: Record<string, BallBearing> = {
  '608':  { designation: '608',  boreMm:  8, odMm: 22, widthMm:  7, dynamicLoadN:  3450, staticLoadN:  1370, limitingRpm: 36000 },
  '6000': { designation: '6000', boreMm: 10, odMm: 26, widthMm:  8, dynamicLoadN:  4550, staticLoadN:  1960, limitingRpm: 30000 },
  '6001': { designation: '6001', boreMm: 12, odMm: 28, widthMm:  8, dynamicLoadN:  5100, staticLoadN:  2360, limitingRpm: 28000 },
  '6002': { designation: '6002', boreMm: 15, odMm: 32, widthMm:  9, dynamicLoadN:  5600, staticLoadN:  2850, limitingRpm: 24000 },
  '6003': { designation: '6003', boreMm: 17, odMm: 35, widthMm: 10, dynamicLoadN:  6050, staticLoadN:  3250, limitingRpm: 22000 },
  '6004': { designation: '6004', boreMm: 20, odMm: 42, widthMm: 12, dynamicLoadN:  9400, staticLoadN:  5000, limitingRpm: 19000 },
  '6005': { designation: '6005', boreMm: 25, odMm: 47, widthMm: 12, dynamicLoadN: 11900, staticLoadN:  6550, limitingRpm: 17000 },
  '6006': { designation: '6006', boreMm: 30, odMm: 55, widthMm: 13, dynamicLoadN: 13800, staticLoadN:  8300, limitingRpm: 14000 },
  '6204': { designation: '6204', boreMm: 20, odMm: 47, widthMm: 14, dynamicLoadN: 13500, staticLoadN:  6550, limitingRpm: 18000 },
  '6205': { designation: '6205', boreMm: 25, odMm: 52, widthMm: 15, dynamicLoadN: 14000, staticLoadN:  7800, limitingRpm: 16000 },
  '6206': { designation: '6206', boreMm: 30, odMm: 62, widthMm: 16, dynamicLoadN: 19500, staticLoadN: 11200, limitingRpm: 14000 },
};

export function lookupBearing(designation: string): BallBearing | null {
  return DIN_BALL_BEARINGS[designation.toUpperCase().replace(/\s/g, '')] ?? null;
}

/**
 * Pick a bearing by load + rpm requirement. Returns the smallest bearing
 * whose dynamic load ≥ required and limiting rpm ≥ required, or null when
 * nothing in the catalog suffices.
 */
export function selectBearing(
  requiredLoadN: number,
  requiredRpm: number,
  options?: { minBoreMm?: number },
): BallBearing | null {
  const candidates = Object.values(DIN_BALL_BEARINGS)
    .filter(b => b.dynamicLoadN >= requiredLoadN && b.limitingRpm >= requiredRpm)
    .filter(b => !options?.minBoreMm || b.boreMm >= options.minBoreMm)
    .sort((a, b) => a.boreMm - b.boreMm);
  return candidates[0] ?? null;
}

// ─── DIN 6885 parallel keys ─────────────────────────────────────────────────

export interface ParallelKey {
  /** Shaft diameter range this key fits (inclusive lower, exclusive upper). */
  shaftMin: number;
  shaftMax: number;
  /** Key cross-section (b × h). */
  bMm: number;
  hMm: number;
  /** Standard available lengths in mm (subset). */
  lengthsMm: number[];
}

export const DIN_6885_KEYS: ParallelKey[] = [
  { shaftMin:   8, shaftMax:  10, bMm: 3,  hMm: 3,  lengthsMm: [6, 8, 10, 12, 14, 16, 18, 20] },
  { shaftMin:  10, shaftMax:  12, bMm: 4,  hMm: 4,  lengthsMm: [8, 10, 12, 14, 16, 18, 20, 22, 25] },
  { shaftMin:  12, shaftMax:  17, bMm: 5,  hMm: 5,  lengthsMm: [10, 12, 14, 16, 18, 20, 22, 25, 28, 32] },
  { shaftMin:  17, shaftMax:  22, bMm: 6,  hMm: 6,  lengthsMm: [14, 16, 18, 20, 22, 25, 28, 32, 36, 40] },
  { shaftMin:  22, shaftMax:  30, bMm: 8,  hMm: 7,  lengthsMm: [18, 20, 22, 25, 28, 32, 36, 40, 45, 50] },
  { shaftMin:  30, shaftMax:  38, bMm: 10, hMm: 8,  lengthsMm: [22, 25, 28, 32, 36, 40, 45, 50, 56, 63] },
  { shaftMin:  38, shaftMax:  44, bMm: 12, hMm: 8,  lengthsMm: [28, 32, 36, 40, 45, 50, 56, 63, 70, 80] },
  { shaftMin:  44, shaftMax:  50, bMm: 14, hMm: 9,  lengthsMm: [36, 40, 45, 50, 56, 63, 70, 80, 90] },
  { shaftMin:  50, shaftMax:  58, bMm: 16, hMm: 10, lengthsMm: [45, 50, 56, 63, 70, 80, 90, 100] },
  { shaftMin:  58, shaftMax:  65, bMm: 18, hMm: 11, lengthsMm: [50, 56, 63, 70, 80, 90, 100, 110] },
];

export function selectKey(shaftDiameterMm: number): ParallelKey | null {
  return DIN_6885_KEYS.find(k => shaftDiameterMm >= k.shaftMin && shaftDiameterMm < k.shaftMax) ?? null;
}

// ─── DIN 471 / 472 retaining rings ─────────────────────────────────────────

export interface RetainingRing {
  type: 'external' | 'internal';
  /** Shaft (DIN 471) or housing (DIN 472) nominal diameter mm. */
  nominalDiameterMm: number;
  /** Ring thickness s. */
  thicknessMm: number;
  /** Groove diameter d2 (external) or d2 (internal). */
  grooveDiameterMm: number;
  /** Groove width m. */
  grooveWidthMm: number;
}

export const DIN_RETAINING_RINGS: RetainingRing[] = [
  // External (DIN 471) — for shafts
  { type: 'external', nominalDiameterMm:  6, thicknessMm: 0.7, grooveDiameterMm:  5.7, grooveWidthMm: 0.8 },
  { type: 'external', nominalDiameterMm:  8, thicknessMm: 0.8, grooveDiameterMm:  7.6, grooveWidthMm: 0.9 },
  { type: 'external', nominalDiameterMm: 10, thicknessMm: 1.0, grooveDiameterMm:  9.6, grooveWidthMm: 1.1 },
  { type: 'external', nominalDiameterMm: 12, thicknessMm: 1.0, grooveDiameterMm: 11.5, grooveWidthMm: 1.1 },
  { type: 'external', nominalDiameterMm: 15, thicknessMm: 1.0, grooveDiameterMm: 14.3, grooveWidthMm: 1.1 },
  { type: 'external', nominalDiameterMm: 20, thicknessMm: 1.2, grooveDiameterMm: 19.0, grooveWidthMm: 1.3 },
  { type: 'external', nominalDiameterMm: 25, thicknessMm: 1.2, grooveDiameterMm: 23.9, grooveWidthMm: 1.3 },
  { type: 'external', nominalDiameterMm: 30, thicknessMm: 1.5, grooveDiameterMm: 28.6, grooveWidthMm: 1.6 },
  // Internal (DIN 472) — for housings
  { type: 'internal', nominalDiameterMm: 10, thicknessMm: 1.0, grooveDiameterMm: 10.4, grooveWidthMm: 1.1 },
  { type: 'internal', nominalDiameterMm: 15, thicknessMm: 1.0, grooveDiameterMm: 15.7, grooveWidthMm: 1.1 },
  { type: 'internal', nominalDiameterMm: 20, thicknessMm: 1.0, grooveDiameterMm: 21.0, grooveWidthMm: 1.1 },
  { type: 'internal', nominalDiameterMm: 25, thicknessMm: 1.2, grooveDiameterMm: 26.2, grooveWidthMm: 1.3 },
  { type: 'internal', nominalDiameterMm: 30, thicknessMm: 1.2, grooveDiameterMm: 31.4, grooveWidthMm: 1.3 },
];

export function selectRetainingRing(
  type: 'external' | 'internal',
  diameterMm: number,
): RetainingRing | null {
  return DIN_RETAINING_RINGS.find(r => r.type === type && r.nominalDiameterMm === diameterMm) ?? null;
}

// ─── ASME standard drill sizes ─────────────────────────────────────────────

export interface DrillSize {
  /** "#7" (number drill), "F" (letter drill), or "1/4" (fractional). */
  designation: string;
  diameterInch: number;
  diameterMm: number;
}

export const ASME_DRILL_SIZES: DrillSize[] = [
  // Number drills (1-60, abbreviated to common ones)
  { designation: '#1', diameterInch: 0.2280, diameterMm: 5.791 },
  { designation: '#7', diameterInch: 0.2010, diameterMm: 5.105 },
  { designation: '#10', diameterInch: 0.1935, diameterMm: 4.915 },
  { designation: '#21', diameterInch: 0.1590, diameterMm: 4.039 },
  { designation: '#29', diameterInch: 0.1360, diameterMm: 3.454 },
  { designation: '#36', diameterInch: 0.1065, diameterMm: 2.705 },
  { designation: '#42', diameterInch: 0.0935, diameterMm: 2.375 },
  { designation: '#50', diameterInch: 0.0700, diameterMm: 1.778 },
  { designation: '#60', diameterInch: 0.0400, diameterMm: 1.016 },
  // Letter drills
  { designation: 'F', diameterInch: 0.2570, diameterMm: 6.528 },
  { designation: 'O', diameterInch: 0.3160, diameterMm: 8.026 },
  { designation: 'T', diameterInch: 0.3580, diameterMm: 9.093 },
  { designation: 'Z', diameterInch: 0.4130, diameterMm: 10.490 },
  // Fractional (common)
  { designation: '1/16',  diameterInch: 0.0625, diameterMm: 1.5875 },
  { designation: '1/8',   diameterInch: 0.1250, diameterMm: 3.175 },
  { designation: '3/16',  diameterInch: 0.1875, diameterMm: 4.7625 },
  { designation: '1/4',   diameterInch: 0.2500, diameterMm: 6.350 },
  { designation: '5/16',  diameterInch: 0.3125, diameterMm: 7.9375 },
  { designation: '3/8',   diameterInch: 0.3750, diameterMm: 9.525 },
  { designation: '7/16',  diameterInch: 0.4375, diameterMm: 11.1125 },
  { designation: '1/2',   diameterInch: 0.5000, diameterMm: 12.700 },
];

/** Find the smallest drill ≥ requested mm. Returns null when nothing in the
 *  catalog is large enough. */
export function selectDrillForHole(diameterMm: number): DrillSize | null {
  const sorted = ASME_DRILL_SIZES.slice().sort((a, b) => a.diameterMm - b.diameterMm);
  return sorted.find(d => d.diameterMm >= diameterMm) ?? null;
}

// ─── A3 — ISO 4762 socket head cap screws (hex socket head) ────────────────

export interface SocketHeadCapScrew {
  /** Designation: M3, M4, M5, ... */
  designation: string;
  /** Nominal diameter mm. */
  d: number;
  /** Coarse-thread pitch mm. */
  pitch: number;
  /** Head diameter (max). */
  headDiameterMm: number;
  /** Head height. */
  headHeightMm: number;
  /** Hex socket size (across flats). */
  hexSocketAfMm: number;
  /** Standard available lengths in mm. */
  lengthsMm: number[];
}

/** ISO 4762 / DIN 912 — socket head cap screw (hex socket). */
export const ISO_4762_SCREWS: Record<string, SocketHeadCapScrew> = {
  M3:  { designation: 'M3',  d:  3, pitch: 0.5,  headDiameterMm:  5.5, headHeightMm:  3.0, hexSocketAfMm:  2.5, lengthsMm: [6, 8, 10, 12, 16, 20, 25, 30] },
  M4:  { designation: 'M4',  d:  4, pitch: 0.7,  headDiameterMm:  7.0, headHeightMm:  4.0, hexSocketAfMm:  3.0, lengthsMm: [8, 10, 12, 16, 20, 25, 30, 40] },
  M5:  { designation: 'M5',  d:  5, pitch: 0.8,  headDiameterMm:  8.5, headHeightMm:  5.0, hexSocketAfMm:  4.0, lengthsMm: [10, 12, 16, 20, 25, 30, 35, 40, 50] },
  M6:  { designation: 'M6',  d:  6, pitch: 1.0,  headDiameterMm: 10.0, headHeightMm:  6.0, hexSocketAfMm:  5.0, lengthsMm: [12, 16, 20, 25, 30, 35, 40, 50, 60] },
  M8:  { designation: 'M8',  d:  8, pitch: 1.25, headDiameterMm: 13.0, headHeightMm:  8.0, hexSocketAfMm:  6.0, lengthsMm: [16, 20, 25, 30, 35, 40, 50, 60, 70, 80] },
  M10: { designation: 'M10', d: 10, pitch: 1.5,  headDiameterMm: 16.0, headHeightMm: 10.0, hexSocketAfMm:  8.0, lengthsMm: [20, 25, 30, 35, 40, 50, 60, 70, 80, 100] },
  M12: { designation: 'M12', d: 12, pitch: 1.75, headDiameterMm: 18.0, headHeightMm: 12.0, hexSocketAfMm: 10.0, lengthsMm: [25, 30, 35, 40, 50, 60, 70, 80, 100, 120] },
  M16: { designation: 'M16', d: 16, pitch: 2.0,  headDiameterMm: 24.0, headHeightMm: 16.0, hexSocketAfMm: 14.0, lengthsMm: [30, 35, 40, 50, 60, 70, 80, 100, 120, 150] },
};

export function lookupSocketHeadCap(size: string): SocketHeadCapScrew | null {
  return ISO_4762_SCREWS[size.toUpperCase()] ?? null;
}

// ─── A3 — ISO 10642 countersunk (flat head) screws ─────────────────────────

export interface CountersunkScrew {
  designation: string;
  d: number;
  pitch: number;
  /** Head diameter (max, before chamfer). */
  headDiameterMm: number;
  /** Head height (sunk depth ≈ head height). */
  headHeightMm: number;
  /** Head angle — 90° per ISO 10642. */
  headAngleDeg: 90;
  /** Hex socket size for socket-drive variant. */
  hexSocketAfMm: number;
}

export const ISO_10642_SCREWS: Record<string, CountersunkScrew> = {
  M3:  { designation: 'M3',  d:  3, pitch: 0.5,  headDiameterMm:  6.72, headHeightMm: 1.86, headAngleDeg: 90, hexSocketAfMm: 2.0 },
  M4:  { designation: 'M4',  d:  4, pitch: 0.7,  headDiameterMm:  8.96, headHeightMm: 2.48, headAngleDeg: 90, hexSocketAfMm: 2.5 },
  M5:  { designation: 'M5',  d:  5, pitch: 0.8,  headDiameterMm: 11.20, headHeightMm: 3.10, headAngleDeg: 90, hexSocketAfMm: 3.0 },
  M6:  { designation: 'M6',  d:  6, pitch: 1.0,  headDiameterMm: 13.44, headHeightMm: 3.72, headAngleDeg: 90, hexSocketAfMm: 4.0 },
  M8:  { designation: 'M8',  d:  8, pitch: 1.25, headDiameterMm: 17.92, headHeightMm: 4.96, headAngleDeg: 90, hexSocketAfMm: 5.0 },
  M10: { designation: 'M10', d: 10, pitch: 1.5,  headDiameterMm: 22.40, headHeightMm: 6.20, headAngleDeg: 90, hexSocketAfMm: 6.0 },
  M12: { designation: 'M12', d: 12, pitch: 1.75, headDiameterMm: 26.88, headHeightMm: 7.44, headAngleDeg: 90, hexSocketAfMm: 8.0 },
};

export function lookupCountersunk(size: string): CountersunkScrew | null {
  return ISO_10642_SCREWS[size.toUpperCase()] ?? null;
}

// ─── A3 — DIN 7 / ISO 8734 cylindrical dowel pins ──────────────────────────

export interface DowelPin {
  /** Nominal diameter (m6 fit) mm. */
  diameterMm: number;
  /** Standard lengths mm. */
  lengthsMm: number[];
  /** Tolerance class — m6 standard, h8 / h6 variants exist. */
  toleranceClass: 'm6' | 'h8' | 'h6';
}

/** DIN 7 / ISO 2338 cylindrical pin (m6 fit, hardened). */
export const DIN_7_DOWEL_PINS: DowelPin[] = [
  { diameterMm:  2,   lengthsMm: [6, 8, 10, 12, 16, 20], toleranceClass: 'm6' },
  { diameterMm:  3,   lengthsMm: [8, 10, 12, 14, 16, 20, 25], toleranceClass: 'm6' },
  { diameterMm:  4,   lengthsMm: [10, 12, 14, 16, 20, 25, 30], toleranceClass: 'm6' },
  { diameterMm:  5,   lengthsMm: [12, 14, 16, 20, 25, 30, 40], toleranceClass: 'm6' },
  { diameterMm:  6,   lengthsMm: [14, 16, 20, 25, 30, 40, 50], toleranceClass: 'm6' },
  { diameterMm:  8,   lengthsMm: [16, 20, 25, 30, 40, 50, 60], toleranceClass: 'm6' },
  { diameterMm: 10,   lengthsMm: [20, 25, 30, 40, 50, 60, 80], toleranceClass: 'm6' },
  { diameterMm: 12,   lengthsMm: [25, 30, 40, 50, 60, 80, 100], toleranceClass: 'm6' },
];

/** Find a dowel pin by diameter; returns the spec or null. */
export function lookupDowelPin(diameterMm: number): DowelPin | null {
  return DIN_7_DOWEL_PINS.find(p => p.diameterMm === diameterMm) ?? null;
}

// ─── A3 — DIN 720 / ISO 355 tapered roller bearings ────────────────────────

export interface TaperedRollerBearing {
  /** Designation: 30202, 32004, ... */
  designation: string;
  boreMm: number;
  /** Outer diameter mm. */
  odMm: number;
  /** Total bearing width T (cone + cup overhang). */
  widthMm: number;
  /** Cone/race contact angle (degrees). */
  contactAngleDeg: number;
  /** Dynamic load rating C (N). */
  dynamicLoadN: number;
  /** Static load rating C0 (N). */
  staticLoadN: number;
}

/** DIN 720 / ISO 355 — tapered roller bearings (single row). Common metric series. */
export const DIN_720_TAPERED_BEARINGS: Record<string, TaperedRollerBearing> = {
  // 302/303 series — standard, low capacity
  '30202': { designation: '30202', boreMm: 15, odMm: 35, widthMm: 11.75, contactAngleDeg: 12.5, dynamicLoadN: 19500, staticLoadN: 18500 },
  '30203': { designation: '30203', boreMm: 17, odMm: 40, widthMm: 13.25, contactAngleDeg: 12.5, dynamicLoadN: 26500, staticLoadN: 25000 },
  '30204': { designation: '30204', boreMm: 20, odMm: 47, widthMm: 15.25, contactAngleDeg: 12.5, dynamicLoadN: 34500, staticLoadN: 33500 },
  '30205': { designation: '30205', boreMm: 25, odMm: 52, widthMm: 16.25, contactAngleDeg: 12.5, dynamicLoadN: 39000, staticLoadN: 39000 },
  '30206': { designation: '30206', boreMm: 30, odMm: 62, widthMm: 17.25, contactAngleDeg: 12.5, dynamicLoadN: 51000, staticLoadN: 51500 },
  '30207': { designation: '30207', boreMm: 35, odMm: 72, widthMm: 18.25, contactAngleDeg: 12.5, dynamicLoadN: 65500, staticLoadN: 70500 },
  '30208': { designation: '30208', boreMm: 40, odMm: 80, widthMm: 19.75, contactAngleDeg: 12.5, dynamicLoadN: 76500, staticLoadN: 84500 },
  // 322/323 series — wider, higher capacity
  '32204': { designation: '32204', boreMm: 20, odMm: 47, widthMm: 19.25, contactAngleDeg: 14, dynamicLoadN: 41000, staticLoadN: 41500 },
  '32205': { designation: '32205', boreMm: 25, odMm: 52, widthMm: 19.25, contactAngleDeg: 14, dynamicLoadN: 49000, staticLoadN: 49000 },
  '32206': { designation: '32206', boreMm: 30, odMm: 62, widthMm: 21.25, contactAngleDeg: 14, dynamicLoadN: 64000, staticLoadN: 70500 },
};

export function lookupTaperedBearing(designation: string): TaperedRollerBearing | null {
  return DIN_720_TAPERED_BEARINGS[designation.toUpperCase().replace(/\s/g, '')] ?? null;
}

/** Pick the smallest tapered bearing meeting load + bore requirements. */
export function selectTaperedBearing(
  requiredLoadN: number,
  options?: { minBoreMm?: number },
): TaperedRollerBearing | null {
  const candidates = Object.values(DIN_720_TAPERED_BEARINGS)
    .filter(b => b.dynamicLoadN >= requiredLoadN)
    .filter(b => !options?.minBoreMm || b.boreMm >= options.minBoreMm)
    .sort((a, b) => a.boreMm - b.boreMm);
  return candidates[0] ?? null;
}
