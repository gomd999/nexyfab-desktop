/**
 * strainGaugePlacement.ts — Recommend strain gauge placement from FEA
 * results.
 *
 * For experimental validation of a FEA simulation, physical strain
 * gauges are bonded to the part. The locations + orientations of
 * those gauges matter:
 *
 *   - Pick high-strain hotspots (validate critical regions).
 *   - Pick representative low-strain regions (sanity baseline).
 *   - Orient gauge along principal strain direction.
 *   - Avoid stress concentrators (fillet radii) where mesh accuracy
 *     is suspect.
 *   - Maintain min spacing between gauges (~ 3× gauge length).
 *
 * Module:
 *   - Accepts FEA node strain results.
 *   - Picks top-N gauges balancing hotspot coverage + spread.
 *   - Computes recommended orientation per gauge.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface StrainNode {
  id: string;
  position: Vec3;
  /** Principal strain magnitudes (sorted descending). */
  principalStrains: [number, number, number];
  /** Principal strain directions (unit vectors). */
  principalDirections: [Vec3, Vec3, Vec3];
  /** True if node is on a high-curvature region (fillet). */
  onFillet: boolean;
}

export interface PlacementOptions {
  /** Number of gauges desired. */
  gaugeCount: number;
  /** Gauge active length (mm). */
  gaugeLengthMm: number;
  /** Minimum spacing between gauges as multiple of length. */
  minSpacingFactor: number;
  /** Fraction of selections from hotspots (rest are baseline). */
  hotspotFraction: number;
}

export const DEFAULT_OPTIONS: PlacementOptions = {
  gaugeCount: 6,
  gaugeLengthMm: 5,
  minSpacingFactor: 3,
  hotspotFraction: 0.7,
};

export interface PlacedGauge {
  nodeId: string;
  position: Vec3;
  orientation: Vec3;
  principalStrain: number;
  category: 'hotspot' | 'baseline';
  warnings: string[];
}

export interface PlacementResult {
  gauges: PlacedGauge[];
  rejectedDueToSpacing: number;
  rejectedDueToFillet: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function placeGauges(nodes: StrainNode[], options: Partial<PlacementOptions> = {}): PlacementResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (nodes.length === 0) {
    return { gauges: [], rejectedDueToSpacing: 0, rejectedDueToFillet: 0 };
  }
  const minSpacing = opts.gaugeLengthMm * opts.minSpacingFactor;
  const placed: PlacedGauge[] = [];
  let rejectedSpacing = 0;
  let rejectedFillet = 0;

  // Hotspot selection: highest principal strain first.
  const hotspotTarget = Math.ceil(opts.gaugeCount * opts.hotspotFraction);
  const sorted = nodes.slice().sort((a, b) => Math.abs(b.principalStrains[0]) - Math.abs(a.principalStrains[0]));
  for (const n of sorted) {
    if (placed.length >= hotspotTarget) break;
    if (n.onFillet) { rejectedFillet++; continue; }
    if (placed.some(p => distance(p.position, n.position) < minSpacing)) {
      rejectedSpacing++;
      continue;
    }
    placed.push(buildGauge(n, 'hotspot'));
  }

  // Baseline selection: medium principal strain, evenly spread.
  const remainingTarget = opts.gaugeCount - placed.length;
  if (remainingTarget > 0) {
    const baselineCandidates = sorted
      .filter(n => !placed.some(p => p.nodeId === n.id))
      .slice(Math.floor(sorted.length * 0.3), Math.floor(sorted.length * 0.7));
    for (const n of baselineCandidates) {
      if (placed.length >= opts.gaugeCount) break;
      if (n.onFillet) { rejectedFillet++; continue; }
      if (placed.some(p => distance(p.position, n.position) < minSpacing)) {
        rejectedSpacing++;
        continue;
      }
      placed.push(buildGauge(n, 'baseline'));
    }
  }

  return { gauges: placed, rejectedDueToSpacing: rejectedSpacing, rejectedDueToFillet: rejectedFillet };
}

function buildGauge(node: StrainNode, category: 'hotspot' | 'baseline'): PlacedGauge {
  const warnings: string[] = [];
  if (Math.abs(node.principalStrains[0]) < 1e-6) {
    warnings.push('Principal strain near zero — gauge resolution may be insufficient.');
  }
  return {
    nodeId: node.id,
    position: node.position,
    orientation: node.principalDirections[0],
    principalStrain: node.principalStrains[0],
    category,
    warnings,
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Compute strain-direction coverage ────────────────────────

export interface CoverageReport {
  coveredAxes: number;
  totalSpread: number;
}

export function coverageReport(gauges: PlacedGauge[]): CoverageReport {
  if (gauges.length === 0) return { coveredAxes: 0, totalSpread: 0 };
  // Bin orientations by axis-bucket (X/Y/Z).
  const buckets = new Set<string>();
  for (const g of gauges) {
    const o = g.orientation;
    const ax = Math.abs(o.x), ay = Math.abs(o.y), az = Math.abs(o.z);
    if (ax >= ay && ax >= az) buckets.add('X');
    else if (ay >= ax && ay >= az) buckets.add('Y');
    else buckets.add('Z');
  }
  // Position spread = bounding-box diagonal.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const g of gauges) {
    if (g.position.x < minX) minX = g.position.x;
    if (g.position.y < minY) minY = g.position.y;
    if (g.position.z < minZ) minZ = g.position.z;
    if (g.position.x > maxX) maxX = g.position.x;
    if (g.position.y > maxY) maxY = g.position.y;
    if (g.position.z > maxZ) maxZ = g.position.z;
  }
  const spread = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return { coveredAxes: buckets.size, totalSpread: spread };
}

// ── Summary ────────────────────────────────────────────────────

export interface GaugeSummary {
  gaugeCount: number;
  hotspotCount: number;
  baselineCount: number;
  rejectedSpacing: number;
  rejectedFillet: number;
}

export function summarize(result: PlacementResult): GaugeSummary {
  const hot = result.gauges.filter(g => g.category === 'hotspot').length;
  return {
    gaugeCount: result.gauges.length,
    hotspotCount: hot,
    baselineCount: result.gauges.length - hot,
    rejectedSpacing: result.rejectedDueToSpacing,
    rejectedFillet: result.rejectedDueToFillet,
  };
}
