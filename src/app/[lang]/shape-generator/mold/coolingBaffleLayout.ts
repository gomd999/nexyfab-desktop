/**
 * coolingBaffleLayout.ts — Lay out baffles / bubblers to reach cooling
 * into deep cores where a straight drilled channel can't go (bosses,
 * tall ribs, core pins).
 *
 * A baffle is a drilled hole with a blade splitting it into supply +
 * return halves; a bubbler is a tube inside a blind hole (water rises
 * through the tube and overflows down the annulus). Both bring coolant
 * to within ~1.5–3× wall of the hot core surface.
 *
 * Design rules:
 *   - hole depth ≤ 5× hole diameter (deeper → poor flow, use bubbler)
 *   - baffle blade splits flow → keep cross-section balanced (each half
 *     ≈ equal area to the feed channel)
 *   - pitch between baffles ≈ 2–3× hole diameter for even cooling
 *
 * Given the core region (a set of hot points + their depth), we place
 * the minimum number of baffles/bubblers on a pitch grid that keeps
 * every hot point within reach.
 */

export interface HotPoint {
  id: string;
  position: { x: number; y: number };
  depthMm: number; // how deep into the core this point sits
}

export type CoolerType = 'baffle' | 'bubbler';

export interface BaffleLayoutInput {
  hotPoints: HotPoint[];
  holeDiameterMm: number;
  reachMm: number;      // lateral cooling reach of one cooler
  maxDepthFactor?: number; // baffle limit, default 5 (×diameter)
}

export interface PlacedCooler {
  position: { x: number; y: number };
  type: CoolerType;
  depthMm: number;
  servesPointIds: string[];
}

export interface BaffleLayoutResult {
  coolers: PlacedCooler[];
  baffleCount: number;
  bubblerCount: number;
  uncoveredPointIds: string[];
  warnings: string[];
}

export function layout(input: BaffleLayoutInput): BaffleLayoutResult {
  const warnings: string[] = [];
  if (input.hotPoints.length === 0) warnings.push('No hot points provided.');
  if (input.holeDiameterMm <= 0) warnings.push('Hole diameter must be positive.');
  if (input.reachMm <= 0) warnings.push('Reach must be positive.');

  const maxDepthFactor = input.maxDepthFactor ?? 5;
  const baffleDepthLimit = maxDepthFactor * input.holeDiameterMm;

  // Greedy set cover: place a cooler at the deepest uncovered point, claim
  // all points within reach, repeat.
  const remaining = [...input.hotPoints].sort((a, b) => b.depthMm - a.depthMm);
  const coolers: PlacedCooler[] = [];
  const covered = new Set<string>();

  for (const seed of remaining) {
    if (covered.has(seed.id)) continue;
    const served: string[] = [];
    let maxDepth = 0;
    for (const p of input.hotPoints) {
      if (covered.has(p.id)) continue;
      const d = Math.hypot(p.position.x - seed.position.x, p.position.y - seed.position.y);
      if (d <= input.reachMm) {
        served.push(p.id);
        maxDepth = Math.max(maxDepth, p.depthMm);
      }
    }
    served.forEach(id => covered.add(id));
    const type: CoolerType = maxDepth > baffleDepthLimit ? 'bubbler' : 'baffle';
    coolers.push({ position: seed.position, type, depthMm: maxDepth, servesPointIds: served });
  }

  const uncovered = input.hotPoints.filter(p => !covered.has(p.id)).map(p => p.id);
  const baffleCount = coolers.filter(c => c.type === 'baffle').length;
  const bubblerCount = coolers.filter(c => c.type === 'bubbler').length;

  return { coolers, baffleCount, bubblerCount, uncoveredPointIds: uncovered, warnings };
}

/** Baffle blade split: each half cross-section area for balanced flow. */
export function baffleHalfAreaMm2(holeDiameterMm: number): number {
  const fullArea = Math.PI * holeDiameterMm * holeDiameterMm / 4;
  return fullArea / 2;
}

/** Recommended bubbler tube ID so annulus area = tube area (balanced flow). */
export function bubblerTubeIdMm(holeDiameterMm: number): number {
  // tube area = annulus area → tube_r² = hole_r² − tube_r² → tube_r = hole_r/√2
  return holeDiameterMm / Math.SQRT2;
}

export function summarize(r: BaffleLayoutResult): { coolerCount: number; baffleCount: number; bubblerCount: number; uncovered: number } {
  return { coolerCount: r.coolers.length, baffleCount: r.baffleCount, bubblerCount: r.bubblerCount, uncovered: r.uncoveredPointIds.length };
}
