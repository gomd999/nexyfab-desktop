/**
 * stockProbeMacro.ts — Generate a probe macro that measures stock
 * dimensions before machining and reports actual size + WCS offset.
 *
 * Common stock-probing pattern:
 *
 *   1. Probe top face (Z) → set Z work offset.
 *   2. Probe side faces (X, Y) → set XY work offset.
 *   3. Probe diagonal corners to compute material thickness +
 *     squareness.
 *
 * Module emits Renishaw-style macros (G65 P98xx) and computes
 * derived offsets / square-error tolerance.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface StockEnvelope {
  approxLengthMm: number;
  approxWidthMm: number;
  approxHeightMm: number;
}

export interface ProbeOptions {
  /** Approach feed (mm/min). */
  approachFeed: number;
  /** Touch feed (mm/min). */
  touchFeed: number;
  /** WCS offset to update (G54..G59). */
  wcsOffset: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
  /** Whether to probe diagonal corners for squareness. */
  measureSquareness: boolean;
}

export const DEFAULT_OPTIONS: ProbeOptions = {
  approachFeed: 1000,
  touchFeed: 100,
  wcsOffset: 'G54',
  measureSquareness: false,
};

export interface ProbeMacroResult {
  gcode: string[];
  /** Expected variable names containing measured offsets. */
  resultVars: string[];
  estimatedTimeSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateStockProbe(stock: StockEnvelope, options: Partial<ProbeOptions> = {}): ProbeMacroResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];
  const vars: string[] = [];
  const warnings: string[] = [];

  if (stock.approxLengthMm <= 0 || stock.approxWidthMm <= 0 || stock.approxHeightMm <= 0) {
    warnings.push('Approx stock dims must be positive.');
    return { gcode: [], resultVars: [], estimatedTimeSec: 0, warnings };
  }

  // 1. Top face Z.
  lines.push('(PROBE TOP FACE Z)');
  lines.push(`G65 P9811 Z0 H0.5 F${opts.touchFeed}`);
  vars.push('#138', '#139');

  // 2. Side X.
  lines.push('(PROBE X SURFACE)');
  lines.push(`G65 P9811 X${(-stock.approxLengthMm / 2).toFixed(3)} H0.5 F${opts.touchFeed}`);
  vars.push('#136');

  // 3. Side Y.
  lines.push('(PROBE Y SURFACE)');
  lines.push(`G65 P9811 Y${(-stock.approxWidthMm / 2).toFixed(3)} H0.5 F${opts.touchFeed}`);
  vars.push('#137');

  // 4. Squareness diagonals.
  if (opts.measureSquareness) {
    lines.push('(PROBE DIAGONAL CORNERS)');
    lines.push(`G65 P9815 X${(stock.approxLengthMm / 2).toFixed(3)} Y${(stock.approxWidthMm / 2).toFixed(3)} F${opts.touchFeed}`);
    vars.push('#135');
  }

  // 5. WCS update wrapper.
  lines.push(`(UPDATE WCS ${opts.wcsOffset})`);
  lines.push(`G10 L20 P${wcsToP(opts.wcsOffset)} X#136 Y#137 Z#138`);

  // Time estimate: 4 probes × ~3 sec each + WCS update ~1 sec.
  const probeCount = opts.measureSquareness ? 4 : 3;
  const time = probeCount * 3 + 1;

  return { gcode: lines, resultVars: vars, estimatedTimeSec: time, warnings };
}

function wcsToP(wcs: ProbeOptions['wcsOffset']): number {
  return { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }[wcs];
}

// ── Derived calculations ─────────────────────────────────────

export interface MeasuredStock {
  measuredLengthMm: number;
  measuredWidthMm: number;
  measuredHeightMm: number;
  squarenessErrorMm?: number;
}

export interface DimensionDelta {
  /** Length delta from approx. */
  lengthDeltaMm: number;
  widthDeltaMm: number;
  heightDeltaMm: number;
  withinExpected: boolean;
}

export function compareStock(approx: StockEnvelope, measured: MeasuredStock, toleranceMm: number = 2): DimensionDelta {
  const dx = measured.measuredLengthMm - approx.approxLengthMm;
  const dy = measured.measuredWidthMm - approx.approxWidthMm;
  const dz = measured.measuredHeightMm - approx.approxHeightMm;
  const within = Math.abs(dx) <= toleranceMm && Math.abs(dy) <= toleranceMm && Math.abs(dz) <= toleranceMm;
  return { lengthDeltaMm: dx, widthDeltaMm: dy, heightDeltaMm: dz, withinExpected: within };
}

// ── Diagnostics ──────────────────────────────────────────────

export interface ProbeDiagnostic {
  lineCount: number;
  variableCount: number;
  measureSquareness: boolean;
  estimatedTimeSec: number;
}

export function diagnose(result: ProbeMacroResult, options: Partial<ProbeOptions> = {}): ProbeDiagnostic {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return {
    lineCount: result.gcode.length,
    variableCount: result.resultVars.length,
    measureSquareness: opts.measureSquareness,
    estimatedTimeSec: result.estimatedTimeSec,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ProbeSummary {
  lineCount: number;
  variableCount: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(result: ProbeMacroResult): ProbeSummary {
  return {
    lineCount: result.gcode.length,
    variableCount: result.resultVars.length,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
