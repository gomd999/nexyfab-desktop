/**
 * spcStage2.ts — Full Western Electric ruleset + CUSUM + EWMA charts.
 *
 * Stage 1 (`spc.ts`) covers X-bar R chart with two of the eight
 * Western Electric (WE) detection rules. Stage 2 adds:
 *
 *   - **All 8 WE rules** — including zone-A/B/C trend tests.
 *   - **Nelson rules** (alternate criterion, more common in modern
 *     statistical software).
 *   - **CUSUM** — Cumulative Sum chart for small shift detection.
 *     Far more sensitive than Shewhart for shifts ≤ 1.5σ.
 *   - **EWMA** — Exponentially-Weighted Moving Average. Smooth
 *     companion to CUSUM; tunable forgetfulness λ.
 *   - **MR (Moving Range)** chart for I-MR control (individuals).
 *
 * Notation:
 *   - μ = process mean / centerline
 *   - σ = process standard deviation
 *   - Zone A = 2σ to 3σ from μ
 *   - Zone B = 1σ to 2σ from μ
 *   - Zone C = within 1σ of μ
 */

export type WeRuleId = 'rule1' | 'rule2' | 'rule3' | 'rule4' | 'rule5' | 'rule6' | 'rule7' | 'rule8';

export interface WeViolation {
  rule: WeRuleId;
  pointIndices: number[];
  message: string;
}

export interface ZoneClassification {
  /** Distance from centerline in σ units. */
  zScore: number;
  /** A (2-3σ), B (1-2σ), C (within 1σ), outside (>3σ). */
  zone: 'A' | 'B' | 'C' | 'outside';
  /** +1 above CL, -1 below, 0 at CL. */
  side: 1 | -1 | 0;
}

export function classifyZone(value: number, centerLine: number, sigma: number): ZoneClassification {
  if (sigma === 0) return { zScore: 0, zone: 'C', side: 0 };
  const z = (value - centerLine) / sigma;
  const side = z > 0 ? 1 : z < 0 ? -1 : 0;
  const az = Math.abs(z);
  let zone: 'A' | 'B' | 'C' | 'outside';
  if (az > 3) zone = 'outside';
  else if (az > 2) zone = 'A';
  else if (az > 1) zone = 'B';
  else zone = 'C';
  return { zScore: z, zone, side };
}

/** Full 8-rule Western Electric application against a single data series. */
export function applyWesternElectricRules(
  values: number[],
  centerLine: number,
  sigma: number,
): WeViolation[] {
  if (values.length === 0 || sigma === 0) return [];
  const zones = values.map(v => classifyZone(v, centerLine, sigma));
  const out: WeViolation[] = [];

  // Rule 1 — any point > 3σ.
  for (let i = 0; i < zones.length; i++) {
    if (zones[i]!.zone === 'outside') {
      out.push({ rule: 'rule1', pointIndices: [i], message: 'Point beyond ±3σ' });
    }
  }

  // Rule 2 — 2 of 3 consecutive in Zone A on the same side.
  for (let i = 2; i < zones.length; i++) {
    const a = zones[i - 2]!, b = zones[i - 1]!, c = zones[i]!;
    const matches = [a, b, c].filter(z => z.zone === 'A' && z.side !== 0);
    if (matches.length >= 2) {
      const sides = new Set(matches.map(m => m.side));
      if (sides.size === 1) {
        out.push({ rule: 'rule2', pointIndices: [i - 2, i - 1, i], message: '2 of 3 in Zone A (same side)' });
      }
    }
  }

  // Rule 3 — 4 of 5 consecutive in Zone B or beyond on same side.
  for (let i = 4; i < zones.length; i++) {
    let count = 0; let signSeen = 0;
    for (let j = i - 4; j <= i; j++) {
      const z = zones[j]!;
      if ((z.zone === 'A' || z.zone === 'B' || z.zone === 'outside') && z.side !== 0) {
        if (signSeen === 0) signSeen = z.side;
        if (z.side === signSeen) count++;
      }
    }
    if (count >= 4) {
      out.push({ rule: 'rule3', pointIndices: [i - 4, i - 3, i - 2, i - 1, i], message: '4 of 5 beyond ±1σ (same side)' });
    }
  }

  // Rule 4 — 8 consecutive on same side.
  let streak = 0;
  let signSeen = 0;
  for (let i = 0; i < zones.length; i++) {
    const s = zones[i]!.side;
    if (s === signSeen && s !== 0) {
      streak++;
    } else {
      signSeen = s;
      streak = s === 0 ? 0 : 1;
    }
    if (streak >= 8) {
      out.push({ rule: 'rule4', pointIndices: Array.from({ length: 8 }, (_, k) => i - 7 + k), message: '8 consecutive same side of CL' });
    }
  }

  // Rule 5 — 6 in a row trending up or down.
  for (let i = 5; i < values.length; i++) {
    let asc = true, desc = true;
    for (let j = i - 5; j < i; j++) {
      if (values[j + 1]! <= values[j]!) asc = false;
      if (values[j + 1]! >= values[j]!) desc = false;
    }
    if (asc) out.push({ rule: 'rule5', pointIndices: [i - 5, i - 4, i - 3, i - 2, i - 1, i], message: '6 points trending up' });
    if (desc) out.push({ rule: 'rule5', pointIndices: [i - 5, i - 4, i - 3, i - 2, i - 1, i], message: '6 points trending down' });
  }

  // Rule 6 — 14 in a row alternating up & down.
  for (let i = 13; i < values.length; i++) {
    let alternating = true;
    for (let j = i - 12; j < i; j++) {
      const a = values[j]!, b = values[j + 1]!, c = values[j + 2];
      if (c == null) { alternating = false; break; }
      const dir1 = Math.sign(b - a);
      const dir2 = Math.sign(c - b);
      if (dir1 === 0 || dir2 === 0 || dir1 === dir2) { alternating = false; break; }
    }
    if (alternating) {
      out.push({ rule: 'rule6', pointIndices: Array.from({ length: 14 }, (_, k) => i - 13 + k), message: '14 alternating up/down' });
    }
  }

  // Rule 7 — 15 in a row in Zone C (low variability — stratification).
  for (let i = 14; i < zones.length; i++) {
    let allInC = true;
    for (let j = i - 14; j <= i; j++) {
      if (zones[j]!.zone !== 'C') { allInC = false; break; }
    }
    if (allInC) {
      out.push({ rule: 'rule7', pointIndices: Array.from({ length: 15 }, (_, k) => i - 14 + k), message: '15 consecutive in Zone C' });
    }
  }

  // Rule 8 — 8 in a row NOT in Zone C (mixture pattern).
  for (let i = 7; i < zones.length; i++) {
    let allOutOfC = true;
    for (let j = i - 7; j <= i; j++) {
      if (zones[j]!.zone === 'C') { allOutOfC = false; break; }
    }
    if (allOutOfC) {
      out.push({ rule: 'rule8', pointIndices: Array.from({ length: 8 }, (_, k) => i - 7 + k), message: '8 consecutive outside Zone C' });
    }
  }

  return out;
}

// ── CUSUM ────────────────────────────────────────────────────────

export interface CusumResult {
  cuSumHi: number[];
  cuSumLo: number[];
  /** Decision interval H — typical 4 or 5 σ. */
  decisionInterval: number;
  /** Slack value K — typical 0.5 × shift to detect. */
  slack: number;
  /** Indices where a signal is detected. */
  signalsHi: number[];
  signalsLo: number[];
}

export function cusumChart(
  values: number[],
  target: number,
  sigma: number,
  shiftSigma: number = 1.0,
  decisionH: number = 4,
): CusumResult {
  const K = (shiftSigma / 2) * sigma;
  const H = decisionH * sigma;
  const cuHi: number[] = [0];
  const cuLo: number[] = [0];
  const sigHi: number[] = [];
  const sigLo: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i]!;
    const prevHi = cuHi[cuHi.length - 1]!;
    const prevLo = cuLo[cuLo.length - 1]!;
    const sHi = Math.max(0, prevHi + (x - target) - K);
    const sLo = Math.min(0, prevLo + (x - target) + K);
    cuHi.push(sHi);
    cuLo.push(sLo);
    if (sHi > H) sigHi.push(i);
    if (sLo < -H) sigLo.push(i);
  }
  return {
    cuSumHi: cuHi.slice(1),
    cuSumLo: cuLo.slice(1),
    decisionInterval: H,
    slack: K,
    signalsHi: sigHi,
    signalsLo: sigLo,
  };
}

// ── EWMA ────────────────────────────────────────────────────────

export interface EwmaResult {
  ewma: number[];
  ucl: number[];
  lcl: number[];
  signals: number[];
}

/** EWMA chart with smoothing constant λ and L·σ control limits. */
export function ewmaChart(
  values: number[],
  target: number,
  sigma: number,
  lambda: number = 0.2,
  L: number = 3,
): EwmaResult {
  const z: number[] = [];
  const ucl: number[] = [];
  const lcl: number[] = [];
  const signals: number[] = [];
  let prev = target;
  for (let i = 0; i < values.length; i++) {
    const zi = lambda * values[i]! + (1 - lambda) * prev;
    z.push(zi);
    const term = (lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * (i + 1)));
    const limit = L * sigma * Math.sqrt(term);
    ucl.push(target + limit);
    lcl.push(target - limit);
    if (zi > target + limit || zi < target - limit) signals.push(i);
    prev = zi;
  }
  return { ewma: z, ucl, lcl, signals };
}

// ── Individuals + Moving Range chart ────────────────────────────

export interface ImrResult {
  individualMean: number;
  movingRangeMean: number;
  individualUcl: number;
  individualLcl: number;
  rangeUcl: number;
  rangeLcl: number;
  /** Constants from Montgomery, for n=2 moving window. */
  d2: number;
  D3: number;
  D4: number;
}

const D2_N2 = 1.128;
const D3_N2 = 0;
const D4_N2 = 3.267;

export function imrChart(values: number[]): ImrResult {
  if (values.length < 2) {
    return {
      individualMean: values[0] ?? 0,
      movingRangeMean: 0,
      individualUcl: 0,
      individualLcl: 0,
      rangeUcl: 0,
      rangeLcl: 0,
      d2: D2_N2,
      D3: D3_N2,
      D4: D4_N2,
    };
  }
  const moves: number[] = [];
  for (let i = 1; i < values.length; i++) {
    moves.push(Math.abs(values[i]! - values[i - 1]!));
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const mrMean = moves.reduce((s, v) => s + v, 0) / moves.length;
  return {
    individualMean: mean,
    movingRangeMean: mrMean,
    individualUcl: mean + 3 * mrMean / D2_N2,
    individualLcl: mean - 3 * mrMean / D2_N2,
    rangeUcl: D4_N2 * mrMean,
    rangeLcl: D3_N2 * mrMean,
    d2: D2_N2,
    D3: D3_N2,
    D4: D4_N2,
  };
}
