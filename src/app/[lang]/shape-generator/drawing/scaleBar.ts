/**
 * scaleBar.ts — Generate a graphic scale bar for drawings (the
 * banded ruler at the bottom of architectural / mechanical plans).
 *
 * A scale bar shows the relationship between drawn units and real-
 * world units so a print can be measured against a physical ruler
 * if scale data is lost.
 *
 * Layout: a thick horizontal bar with alternating black/white major
 * divisions, tick marks at each subdivision, and labels at the ends
 * and middle.
 *
 * Module emits drawing primitives (rectangles + ticks + labels) the
 * renderer turns into SVG/Canvas.
 */

export interface Vec2 { x: number; y: number }

export type ScalePreset = '1:1' | '1:2' | '1:5' | '1:10' | '1:20' | '1:50' | '1:100' | '1:200' | '1:500';

export interface ScaleBarRect {
  /** Bottom-left corner. */
  origin: Vec2;
  widthMm: number;
  heightMm: number;
  fill: 'black' | 'white';
}

export interface ScaleBarLabel {
  position: Vec2;
  text: string;
  /** Anchor: where the label is positioned relative to text. */
  anchor: 'left' | 'center' | 'right';
}

export interface ScaleBarResult {
  bands: ScaleBarRect[];
  ticks: Array<{ x: number; y: number; lengthMm: number }>;
  labels: ScaleBarLabel[];
  totalLengthMm: number;
  realLengthMm: number;
}

export interface ScaleBarOptions {
  /** Drawing scale (e.g., 1:50 means 1 drawing mm = 50 real mm). */
  preset: ScalePreset;
  /** Origin (bottom-left of bar). */
  origin: Vec2;
  /** Total drawn length of the scale bar (mm). */
  drawnLengthMm: number;
  /** Bar height (mm). */
  heightMm: number;
  /** Number of major divisions. */
  majorDivisions: number;
  /** Number of subdivisions in the *leftmost* major (extension scale). */
  subdivisionsInExtension: number;
  /** Show end labels (0 and max). */
  showEndLabels: boolean;
}

export const DEFAULT_OPTIONS: ScaleBarOptions = {
  preset: '1:50',
  origin: { x: 0, y: 0 },
  drawnLengthMm: 100,
  heightMm: 4,
  majorDivisions: 5,
  subdivisionsInExtension: 5,
  showEndLabels: true,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildScaleBar(options: Partial<ScaleBarOptions> = {}): ScaleBarResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ratio = parseRatio(opts.preset);
  const realLength = opts.drawnLengthMm * ratio;
  const majorStep = opts.drawnLengthMm / opts.majorDivisions;
  const realStep = majorStep * ratio;

  const bands: ScaleBarRect[] = [];
  const ticks: Array<{ x: number; y: number; lengthMm: number }> = [];
  const labels: ScaleBarLabel[] = [];

  // Major bands alternating black/white.
  for (let i = 0; i < opts.majorDivisions; i++) {
    bands.push({
      origin: { x: opts.origin.x + i * majorStep, y: opts.origin.y },
      widthMm: majorStep,
      heightMm: opts.heightMm,
      fill: i % 2 === 0 ? 'black' : 'white',
    });
  }

  // Subdivision ticks in the extension (leftmost major) — go LEFT of origin.
  if (opts.subdivisionsInExtension > 0) {
    const subStep = majorStep / opts.subdivisionsInExtension;
    for (let s = 1; s <= opts.subdivisionsInExtension; s++) {
      const x = opts.origin.x - s * subStep;
      ticks.push({ x, y: opts.origin.y, lengthMm: opts.heightMm });
    }
    // Add an "extension" band to the left.
    bands.push({
      origin: { x: opts.origin.x - majorStep, y: opts.origin.y },
      widthMm: majorStep,
      heightMm: opts.heightMm,
      fill: 'white',
    });
  }

  // Tick marks between majors.
  for (let i = 0; i <= opts.majorDivisions; i++) {
    ticks.push({ x: opts.origin.x + i * majorStep, y: opts.origin.y - opts.heightMm * 0.3, lengthMm: opts.heightMm * 0.3 });
  }

  // Major labels.
  for (let i = 0; i <= opts.majorDivisions; i++) {
    const realValue = i * realStep;
    const label = formatRealLength(realValue);
    labels.push({
      position: { x: opts.origin.x + i * majorStep, y: opts.origin.y + opts.heightMm + 2 },
      text: label,
      anchor: i === 0 ? 'left' : i === opts.majorDivisions ? 'right' : 'center',
    });
  }
  if (opts.subdivisionsInExtension > 0) {
    labels.push({
      position: { x: opts.origin.x - majorStep, y: opts.origin.y + opts.heightMm + 2 },
      text: `-${formatRealLength(realStep)}`,
      anchor: 'left',
    });
  }
  if (opts.showEndLabels) {
    labels.push({
      position: { x: opts.origin.x + opts.drawnLengthMm + 5, y: opts.origin.y + opts.heightMm / 2 },
      text: opts.preset,
      anchor: 'left',
    });
  }

  return {
    bands,
    ticks,
    labels,
    totalLengthMm: opts.drawnLengthMm,
    realLengthMm: realLength,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function parseRatio(preset: ScalePreset): number {
  const m = preset.match(/^1:(\d+)$/);
  return m ? Number(m[1]) : 1;
}

function formatRealLength(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(1).replace(/\.0$/, '')}m`;
  if (mm >= 10) return `${Math.round(mm)}mm`;
  if (mm > 0) return `${mm.toFixed(1)}mm`;
  return '0';
}

// ── Summary ────────────────────────────────────────────────────

export interface ScaleBarSummary {
  bandCount: number;
  tickCount: number;
  labelCount: number;
  realLengthMm: number;
  scaleRatio: number;
}

export function summarize(result: ScaleBarResult, preset: ScalePreset): ScaleBarSummary {
  return {
    bandCount: result.bands.length,
    tickCount: result.ticks.length,
    labelCount: result.labels.length,
    realLengthMm: result.realLengthMm,
    scaleRatio: parseRatio(preset),
  };
}
