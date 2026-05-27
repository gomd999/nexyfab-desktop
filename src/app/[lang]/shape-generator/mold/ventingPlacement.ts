/**
 * ventingPlacement.ts — Place vents around the perimeter of an
 * injection mold cavity.
 *
 * Air trapped between flow fronts causes burn marks (diesel effect)
 * + short shots. Vents allow air to escape. Rules of thumb:
 *
 *   - Place vents at the last-fill points (weld lines / cavity ends).
 *   - Vent depth = 0.025-0.05 mm for unfilled polymers.
 *   - Vent width = 5-25 mm depending on size.
 *   - Total vent area ≥ 30% of projected cavity area.
 *
 * Module:
 *   - Accepts the parting-line polygon.
 *   - Accepts last-fill candidate points (from flow analysis).
 *   - Distributes vents at candidates first, then evenly along
 *     remaining perimeter to satisfy total area.
 *   - Picks per-vent depth based on material type.
 */

export interface Vec2 { x: number; y: number }

export type PolymerCategory = 'unfilled' | 'filled' | 'liquid-silicone' | 'transparent';

export interface VentOptions {
  polymer: PolymerCategory;
  /** Width of each vent (mm). */
  ventWidthMm: number;
  /** Minimum total vent area as fraction of cavity area. */
  minTotalAreaFraction: number;
}

export const DEFAULT_OPTIONS: VentOptions = {
  polymer: 'unfilled',
  ventWidthMm: 10,
  minTotalAreaFraction: 0.3,
};

export interface LastFillCandidate {
  point: Vec2;
  fillTimeMs: number;
  /** Whether this is at a weld line. */
  weldLine: boolean;
}

export interface PlacedVent {
  position: Vec2;
  widthMm: number;
  depthMm: number;
  reason: 'last-fill' | 'weld-line' | 'perimeter-fill';
}

export interface PlacementResult {
  vents: PlacedVent[];
  totalAreaMm2: number;
  cavityProjectedAreaMm2: number;
  meetsMinimum: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function placeVents(
  partingLine: Vec2[],
  candidates: LastFillCandidate[],
  options: Partial<VentOptions> = {},
): PlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const cavityArea = polygonArea(partingLine);
  if (cavityArea <= 0) {
    warnings.push('Parting line has zero/negative area.');
    return { vents: [], totalAreaMm2: 0, cavityProjectedAreaMm2: 0, meetsMinimum: false, warnings };
  }
  const depth = pickVentDepth(opts.polymer);

  const vents: PlacedVent[] = [];
  for (const cand of candidates) {
    vents.push({
      position: cand.point,
      widthMm: opts.ventWidthMm,
      depthMm: depth,
      reason: cand.weldLine ? 'weld-line' : 'last-fill',
    });
  }

  // Compute current vent area = vent width × depth × count? Actually area is
  // a projected slot opening: width × something. Use width × 1.0 mm length as a
  // proxy for vent throat area.
  const ventArea = (count: number) => count * opts.ventWidthMm * 1.0;
  const target = cavityArea * opts.minTotalAreaFraction;
  while (ventArea(vents.length) < target) {
    // Distribute additional vents evenly along perimeter.
    const perim = polygonPerimeter(partingLine);
    if (perim === 0) break;
    const idx = vents.length - candidates.length;
    const t = (idx + 0.5) / Math.max(1, Math.ceil(target / opts.ventWidthMm));
    const pos = pointOnPerimeter(partingLine, t * perim);
    if (!pos) break;
    vents.push({ position: pos, widthMm: opts.ventWidthMm, depthMm: depth, reason: 'perimeter-fill' });
    if (vents.length > 500) {
      warnings.push('Vent count exceeded 500 — check minTotalAreaFraction.');
      break;
    }
  }

  const total = ventArea(vents.length);
  return {
    vents,
    totalAreaMm2: total,
    cavityProjectedAreaMm2: cavityArea,
    meetsMinimum: total >= target,
    warnings,
  };
}

function pickVentDepth(polymer: PolymerCategory): number {
  switch (polymer) {
    case 'unfilled': return 0.04;
    case 'filled': return 0.05;
    case 'liquid-silicone': return 0.02;
    case 'transparent': return 0.025;
  }
}

// ── Geometry helpers ──────────────────────────────────────────

function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function polygonPerimeter(poly: Vec2[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

function pointOnPerimeter(poly: Vec2[], distance: number): Vec2 | null {
  let remaining = distance;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segLen) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= segLen;
  }
  return poly[0] ?? null;
}

// ── Diagnostics ──────────────────────────────────────────────

export function ventDensity(result: PlacementResult): number {
  if (result.cavityProjectedAreaMm2 <= 0) return 0;
  return result.totalAreaMm2 / result.cavityProjectedAreaMm2;
}

// ── Summary ────────────────────────────────────────────────────

export interface VentSummary {
  ventCount: number;
  totalAreaMm2: number;
  meetsMinimum: boolean;
  byReason: Record<PlacedVent['reason'], number>;
}

export function summarize(result: PlacementResult): VentSummary {
  const byReason: Record<PlacedVent['reason'], number> = { 'last-fill': 0, 'weld-line': 0, 'perimeter-fill': 0 };
  for (const v of result.vents) byReason[v.reason]++;
  return {
    ventCount: result.vents.length,
    totalAreaMm2: result.totalAreaMm2,
    meetsMinimum: result.meetsMinimum,
    byReason,
  };
}
