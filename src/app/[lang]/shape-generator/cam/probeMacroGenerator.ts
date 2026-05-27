/**
 * probeMacroGenerator.ts — Generate Renishaw / Heidenhain probe macro
 * sequences for in-process inspection.
 *
 * Typical macros:
 *   - Probe single surface (Z, X, or Y face) and update WCS offset.
 *   - Probe a hole bore center, compute center + radius.
 *   - Probe bore center via 3 internal touches; for chord measurement.
 *   - Probe a boss outside diameter via 3 external touches.
 *   - Probe rectangular pocket / boss → width + length + center.
 *
 * Module emits a sequence of Renishaw-style probe call macros
 * (O9XXX series) plus expected output variables for downstream
 * comparison.
 */

export type Dialect = 'renishaw' | 'heidenhain' | 'mazak';

export type ProbeCycle =
  | 'face-z'
  | 'face-x'
  | 'face-y'
  | 'bore-3point'
  | 'boss-3point'
  | 'pocket-4point'
  | 'corner-2point';

export interface FeatureSpec {
  cycle: ProbeCycle;
  /** Centre / surface point. */
  point: { x: number; y: number; z: number };
  /** Diameter or width (used by bore / boss / pocket). */
  sizeMm?: number;
  /** Tolerance window (mm). */
  toleranceMm: number;
  /** WCS offset to update (e.g., G54). */
  wcsOffset?: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
}

export interface GeneratorOptions {
  dialect: Dialect;
  /** Probe approach feed rate (mm/min). */
  approachFeed: number;
  /** Probe touch feed rate (mm/min). */
  touchFeed: number;
  /** Safety clearance (mm). */
  clearanceMm: number;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  dialect: 'renishaw',
  approachFeed: 1000,
  touchFeed: 100,
  clearanceMm: 3,
};

export interface MacroBlock {
  featureCycle: ProbeCycle;
  gcode: string[];
  /** Names of result variables the controller will populate. */
  resultVars: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateMacros(features: FeatureSpec[], options: Partial<GeneratorOptions> = {}): MacroBlock[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return features.map(f => generateOne(f, opts));
}

function generateOne(feature: FeatureSpec, opts: GeneratorOptions): MacroBlock {
  if (opts.dialect === 'renishaw') return renishawMacro(feature, opts);
  if (opts.dialect === 'heidenhain') return heidenhainMacro(feature, opts);
  return mazakMacro(feature, opts);
}

// ── Renishaw Inspection Plus (O9810..) ────────────────────────

function renishawMacro(f: FeatureSpec, opts: GeneratorOptions): MacroBlock {
  const lines: string[] = [];
  const tol = `H${f.toleranceMm.toFixed(3)}`;
  const fz = `F${opts.touchFeed}`;
  switch (f.cycle) {
    case 'face-z':
      lines.push(`G65 P9811 Z${f.point.z.toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#138', '#139'] };
    case 'face-x':
      lines.push(`G65 P9811 X${f.point.x.toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#136', '#137'] };
    case 'face-y':
      lines.push(`G65 P9811 Y${f.point.y.toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#136', '#137'] };
    case 'bore-3point':
      lines.push(`G65 P9814 D${(f.sizeMm ?? 0).toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#135', '#136', '#137'] };
    case 'boss-3point':
      lines.push(`G65 P9823 D${(f.sizeMm ?? 0).toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#135', '#136', '#137'] };
    case 'pocket-4point':
      lines.push(`G65 P9812 X${(f.sizeMm ?? 0).toFixed(3)} Y${(f.sizeMm ?? 0).toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#135', '#136', '#137', '#138'] };
    case 'corner-2point':
      lines.push(`G65 P9815 X${f.point.x.toFixed(3)} Y${f.point.y.toFixed(3)} ${tol} ${fz}`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['#135', '#136'] };
  }
}

// ── Heidenhain TNC (TCH PROBE 41x..) ──────────────────────────

function heidenhainMacro(f: FeatureSpec, opts: GeneratorOptions): MacroBlock {
  const lines: string[] = [];
  const _fz = opts.touchFeed; // referenced for parity
  void _fz;
  switch (f.cycle) {
    case 'face-z':
      lines.push(`TCH PROBE 412 DATUM IN Z`);
      lines.push(`  Q331=${f.point.z.toFixed(3)} ;NOMINAL POSITION`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q160'] };
    case 'face-x':
      lines.push(`TCH PROBE 410 DATUM RECT INSIDE`);
      lines.push(`  Q321=${f.point.x.toFixed(3)} ;CENTER 1ST AXIS`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q331'] };
    case 'face-y':
      lines.push(`TCH PROBE 410 DATUM RECT INSIDE`);
      lines.push(`  Q322=${f.point.y.toFixed(3)} ;CENTER 2ND AXIS`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q332'] };
    case 'bore-3point':
      lines.push(`TCH PROBE 421 MEAS HOLE`);
      lines.push(`  Q262=${(f.sizeMm ?? 0).toFixed(3)} ;NOMINAL DIAMETER`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q151', 'Q152', 'Q153'] };
    case 'boss-3point':
      lines.push(`TCH PROBE 422 MEAS CIRCLE OUTSIDE`);
      lines.push(`  Q262=${(f.sizeMm ?? 0).toFixed(3)} ;NOMINAL DIAMETER`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q151', 'Q152', 'Q153'] };
    case 'pocket-4point':
      lines.push(`TCH PROBE 423 MEAS RECT INSIDE`);
      lines.push(`  Q282=${(f.sizeMm ?? 0).toFixed(3)} ;NOMINAL LENGTH 1ST AXIS`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q154', 'Q155'] };
    case 'corner-2point':
      lines.push(`TCH PROBE 411 DATUM RECT OUTSIDE`);
      return { featureCycle: f.cycle, gcode: lines, resultVars: ['Q331', 'Q332'] };
  }
}

// ── Mazak (Mazatrol) ──────────────────────────────────────────

function mazakMacro(f: FeatureSpec, _opts: GeneratorOptions): MacroBlock {
  // Mazak shares Fanuc-ish macro syntax; emit a comment block + Renishaw-equivalent line.
  const lines: string[] = [`(MAZAK PROBE: ${f.cycle.toUpperCase()})`];
  const r = renishawMacro(f, _opts);
  lines.push(...r.gcode);
  return { featureCycle: f.cycle, gcode: lines, resultVars: r.resultVars };
}

// ── WCS update wrapper ────────────────────────────────────────

export function emitWcsUpdate(feature: FeatureSpec, axisVar: string): string[] {
  if (!feature.wcsOffset) return [];
  return [`G10 L2 P${wcsCode(feature.wcsOffset)} ${axisVar.startsWith('#') ? 'X' : ''}${axisVar}`];
}

function wcsCode(offset: NonNullable<FeatureSpec['wcsOffset']>): number {
  return { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }[offset];
}

// ── Summary ────────────────────────────────────────────────────

export interface MacroSummary {
  featureCount: number;
  totalLineCount: number;
  byCycle: Record<ProbeCycle, number>;
}

export function summarize(blocks: MacroBlock[]): MacroSummary {
  const byCycle: Record<ProbeCycle, number> = {
    'face-z': 0, 'face-x': 0, 'face-y': 0, 'bore-3point': 0, 'boss-3point': 0, 'pocket-4point': 0, 'corner-2point': 0,
  };
  let total = 0;
  for (const b of blocks) {
    byCycle[b.featureCycle]++;
    total += b.gcode.length;
  }
  return { featureCount: blocks.length, totalLineCount: total, byCycle };
}
