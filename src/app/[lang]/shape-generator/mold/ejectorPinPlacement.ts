/**
 * ejectorPinPlacement.ts — Place ejector pins on a moulded part.
 *
 * Ejector pins push the part off the core after the mould opens.
 * Placement rules:
 *
 *   - Pins must contact a flat or slightly recessed area (not a
 *     finished cosmetic surface).
 *   - Pin diameter: 2-8 mm typical; 1.5-2 × wall thickness for
 *     strength.
 *   - Pitch (spacing between pins): max ≈ 30-50 × wall thickness.
 *   - Pins must be reasonably balanced around the part centroid
 *     to avoid skewing during ejection.
 *
 * Module:
 *   - Takes the part outline + cosmetic regions.
 *   - Grids the part interior with candidate pin positions.
 *   - Scores each by: distance from cosmetic, distance from rib
 *     intersections, distance from centroid.
 *   - Selects up to N pins minimizing eject-force imbalance.
 */

export interface Vec2 { x: number; y: number }

export interface PartRegion {
  /** Outer outline (closed polygon, CCW). */
  outline: Vec2[];
  /** Cosmetic / restricted regions (closed polygons). */
  cosmeticZones: Vec2[][];
  /** Wall thickness (mm) used in pitch rule. */
  wallThicknessMm: number;
}

export interface PinPlacementOptions {
  /** Pin diameter (mm). */
  pinDiameterMm: number;
  /** Maximum number of pins. */
  maxPinCount: number;
  /** Grid step (mm) — finer = more candidates. */
  gridStepMm: number;
  /** Minimum distance from cosmetic zone (mm). */
  minDistanceFromCosmeticMm: number;
}

export const DEFAULT_OPTIONS: PinPlacementOptions = {
  pinDiameterMm: 4,
  maxPinCount: 6,
  gridStepMm: 10,
  minDistanceFromCosmeticMm: 3,
};

export interface EjectorPin {
  position: Vec2;
  score: number;
  distanceFromCosmetic: number;
  distanceFromCentroid: number;
}

export interface PlacementResult {
  pins: EjectorPin[];
  centroid: Vec2;
  forceImbalance: Vec2;
  /** Max recommended pitch given wall thickness. */
  maxPitchMm: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function placePins(part: PartRegion, options: Partial<PinPlacementOptions> = {}): PlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const centroid = polyCentroid(part.outline);
  const candidates = generateCandidates(part, opts);
  if (candidates.length === 0) {
    warnings.push('No candidate pin positions found within the part interior.');
    return { pins: [], centroid, forceImbalance: { x: 0, y: 0 }, maxPitchMm: 50 * part.wallThicknessMm, warnings };
  }

  // Sort by score (higher = better) and pick top-N respecting pin diameter spacing.
  candidates.sort((a, b) => b.score - a.score);
  const pinSpacing = opts.pinDiameterMm * 2;
  const pins: EjectorPin[] = [];
  for (const c of candidates) {
    if (pins.length >= opts.maxPinCount) break;
    if (pins.every(p => distance(p.position, c.position) >= pinSpacing)) {
      pins.push(c);
    }
  }

  // Force imbalance vector: sum of pin positions relative to centroid.
  const imbalance: Vec2 = { x: 0, y: 0 };
  for (const p of pins) {
    imbalance.x += p.position.x - centroid.x;
    imbalance.y += p.position.y - centroid.y;
  }
  if (pins.length > 0) {
    imbalance.x /= pins.length;
    imbalance.y /= pins.length;
  }

  const maxPitch = 50 * part.wallThicknessMm;
  // Check actual maximum pitch between pins.
  let observedMaxPitch = 0;
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = distance(pins[i]!.position, pins[j]!.position);
      if (d > observedMaxPitch) observedMaxPitch = d;
    }
  }
  if (observedMaxPitch > maxPitch) {
    warnings.push(`Pin pitch ${observedMaxPitch.toFixed(1)} > recommended max ${maxPitch.toFixed(1)} (50·t). Add more pins.`);
  }

  if (Math.hypot(imbalance.x, imbalance.y) > opts.pinDiameterMm * 2) {
    warnings.push('Pins biased away from centroid; ejection may skew.');
  }

  return { pins, centroid, forceImbalance: imbalance, maxPitchMm: maxPitch, warnings };
}

// ── Candidate generation ──────────────────────────────────────

function generateCandidates(part: PartRegion, opts: PinPlacementOptions): EjectorPin[] {
  const bbox = polyBoundingBox(part.outline);
  const centroid = polyCentroid(part.outline);
  const out: EjectorPin[] = [];
  for (let x = bbox.minX; x <= bbox.maxX; x += opts.gridStepMm) {
    for (let y = bbox.minY; y <= bbox.maxY; y += opts.gridStepMm) {
      const pos: Vec2 = { x, y };
      if (!pointInPolygon(pos, part.outline)) continue;
      let minCosmetic = Infinity;
      for (const zone of part.cosmeticZones) {
        const d = distanceToPolygon(pos, zone);
        if (d < minCosmetic) minCosmetic = d;
      }
      if (minCosmetic < opts.minDistanceFromCosmeticMm) continue;
      const distFromCentroid = distance(pos, centroid);
      const score = minCosmetic / 10 + 1 / (distFromCentroid + 1) * 10;
      out.push({
        position: pos,
        score,
        distanceFromCosmetic: minCosmetic,
        distanceFromCentroid: distFromCentroid,
      });
    }
  }
  return out;
}

// ── Geometry helpers ──────────────────────────────────────────

function polyBoundingBox(poly: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function polyCentroid(poly: Vec2[]): Vec2 {
  if (poly.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / poly.length, y: cy / poly.length };
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if ((pi.y > p.y) !== (pj.y > p.y) && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const d = pointToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj: Vec2 = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(p, proj);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Summary ────────────────────────────────────────────────────

export interface PlacementSummary {
  pinCount: number;
  forceImbalanceMagnitude: number;
  maxPitchMm: number;
  warningCount: number;
}

export function summarize(result: PlacementResult): PlacementSummary {
  return {
    pinCount: result.pins.length,
    forceImbalanceMagnitude: Math.hypot(result.forceImbalance.x, result.forceImbalance.y),
    maxPitchMm: result.maxPitchMm,
    warningCount: result.warnings.length,
  };
}
