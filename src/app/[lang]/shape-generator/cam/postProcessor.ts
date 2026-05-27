// CAM post-processor library — per-controller G-code dialects.
// Builds on cam/toolpath.ts: takes a `ToolpathResult` and emits machine-
// specific G-code respecting each controller's preamble, modal conventions,
// and end-of-program codes.

import type { ToolpathResult, ToolSpec } from './toolpath';

export type PostDialect = 'fanuc' | 'mach3' | 'haas' | 'linuxcnc' | 'siemens';

export interface PostOptions {
  dialect: PostDialect;
  programNumber?: number;
  comment?: string;
  /** Workpiece coordinate offset (G54..G59). */
  wcs?: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
  /** Optional probe-cycle preamble. */
  probe?: boolean;
}

export interface PostResult {
  gcode: string;
  /** Comment block listing detected issues (out-of-limits feeds, etc.). */
  warnings: string[];
}

// ─── Per-dialect preamble / postamble ──────────────────────────────────────

const PREAMBLES: Record<PostDialect, (opts: PostOptions, tool: ToolSpec) => string[]> = {
  fanuc: (o, t) => [
    `O${o.programNumber ?? 1000} (${o.comment ?? 'NEXYFAB POST'})`,
    'G17 G21 G40 G49 G80 G90',
    `${o.wcs ?? 'G54'}`,
    `M6 T1 (Tool Ø${t.diameterMm.toFixed(2)})`,
    `S${Math.round(t.rpm)} M3`,
    'G43 H1',
  ],
  mach3: (o, t) => [
    `(${o.comment ?? 'NEXYFAB POST — Mach3'})`,
    'G17 G21 G40 G49 G80 G90',
    `${o.wcs ?? 'G54'}`,
    `M6 T1`,
    `S${Math.round(t.rpm)} M3`,
  ],
  haas: (o, t) => [
    `%`,
    `O${o.programNumber ?? 1000} (${o.comment ?? 'NEXYFAB POST'})`,
    'G17 G20 G40 G49 G80 G90',
    `${o.wcs ?? 'G54'}`,
    `T1 M6`,
    `S${Math.round(t.rpm)} M3`,
    'G43 H1',
  ],
  linuxcnc: (o, t) => [
    `(${o.comment ?? 'NEXYFAB POST — LinuxCNC'})`,
    'G17 G21 G40 G49 G80 G90 G64 P0.01',
    `${o.wcs ?? 'G54'}`,
    `T1 M6 G43 H1`,
    `S${Math.round(t.rpm)} M3`,
  ],
  siemens: (o, t) => [
    `;(${o.comment ?? 'NEXYFAB POST — Sinumerik'})`,
    'G17 G54 G64 G90 G94 SOFT',
    `T="TOOL1" M6`,
    `S${Math.round(t.rpm)} M3`,
  ],
};

const POSTAMBLES: Record<PostDialect, string[]> = {
  fanuc: ['M9', 'G91 G28 Z0', 'G28 X0 Y0', 'M5', 'M30', '%'],
  mach3: ['M9', 'M5', 'M30'],
  haas: ['M9', 'G91 G28 Z0', 'G28 X0 Y0', 'M5', 'M30', '%'],
  linuxcnc: ['M9', 'M5', 'M2'],
  siemens: ['M9', 'M5', 'M30'],
};

// ─── Main entry ────────────────────────────────────────────────────────────

export function postProcess(
  path: ToolpathResult,
  tool: ToolSpec,
  opts: PostOptions,
): PostResult {
  const warnings: string[] = [];
  if (tool.feedRateMmPerMin > 5000) warnings.push(`Feed rate ${tool.feedRateMmPerMin} mm/min exceeds 5000 — verify machine capability`);
  if (tool.rpm > 24000) warnings.push(`Spindle ${tool.rpm} RPM exceeds 24000 — verify spindle rating`);
  if (path.estimatedTimeMin > 240) warnings.push(`Estimated time ${path.estimatedTimeMin.toFixed(1)} min > 4h — consider splitting`);

  const lines: string[] = [];
  lines.push(...PREAMBLES[opts.dialect](opts, tool));

  let lastEnd: [number, number, number] | null = null;
  for (const seg of path.segments) {
    if (!lastEnd || seg.start[0] !== lastEnd[0] || seg.start[1] !== lastEnd[1] || seg.start[2] !== lastEnd[2]) {
      lines.push(`G0 X${seg.start[0].toFixed(3)} Y${seg.start[1].toFixed(3)} Z${seg.start[2].toFixed(3)}`);
    }
    lines.push(`G1 X${seg.end[0].toFixed(3)} Y${seg.end[1].toFixed(3)} Z${seg.end[2].toFixed(3)} F${seg.feed.toFixed(0)}`);
    lastEnd = seg.end;
  }
  lines.push(...POSTAMBLES[opts.dialect]);
  return { gcode: lines.join('\n'), warnings };
}

// ─── Machine envelope simulation ──────────────────────────────────────────

export interface MachineEnvelope {
  /** X axis travel limits (mm). */
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface EnvelopeCheckResult {
  ok: boolean;
  violations: { axis: 'x' | 'y' | 'z'; min: number; max: number; segment: number }[];
}

/**
 * Verifies every toolpath segment stays inside the machine work envelope.
 * Fast pre-check before sending G-code; replaces "send and crash" with
 * a deterministic offline check.
 */
export function checkEnvelope(path: ToolpathResult, envelope: MachineEnvelope): EnvelopeCheckResult {
  const violations: EnvelopeCheckResult['violations'] = [];
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    const points = [seg.start, seg.end] as const;
    for (const p of points) {
      if (p[0] < envelope.x[0] || p[0] > envelope.x[1]) violations.push({ axis: 'x', min: envelope.x[0], max: envelope.x[1], segment: i });
      if (p[1] < envelope.y[0] || p[1] > envelope.y[1]) violations.push({ axis: 'y', min: envelope.y[0], max: envelope.y[1], segment: i });
      if (p[2] < envelope.z[0] || p[2] > envelope.z[1]) violations.push({ axis: 'z', min: envelope.z[0], max: envelope.z[1], segment: i });
    }
  }
  return { ok: violations.length === 0, violations };
}

// Common machine presets — saves callers from typing limits manually.
export const MACHINE_PRESETS: Record<string, MachineEnvelope> = {
  'haas-vf2': { x: [0, 762], y: [0, 406], z: [0, 508] },
  'tormach-pcnc-440': { x: [0, 254], y: [0, 178], z: [0, 254] },
  'shopbot-prsalpha': { x: [0, 1219], y: [0, 2438], z: [0, 152] },
  'sherline-5400': { x: [0, 220], y: [0, 130], z: [0, 165] },
  'custom-3018': { x: [0, 300], y: [0, 180], z: [0, 45] },
};
