/**
 * runnerGateLayout.ts — Injection-mold runner + gate layout planner.
 *
 * In injection molding, plastic flows from the sprue through a runner
 * system into one or more gates, then fills the cavity. The runner +
 * gate layout determines:
 *
 *   - **Balance** — pressure / flow front reach all cavities together?
 *   - **Pressure loss** — small runner → high loss → short shots.
 *   - **Material waste** — runner volume per shot.
 *   - **Cooling time** — thickest section dominates cycle.
 *
 * Module scope: take a set of cavity positions in the mold plate +
 * a runner topology (H-runner, X-runner, fishbone), and produce:
 *
 *   - Runner segment list (start, end, diameter).
 *   - Gate positions + type (edge / pin / sub / fan).
 *   - Per-cavity flow-length estimate.
 *   - Imbalance score (max - min flow length / average).
 *   - Runner volume per shot.
 */

export interface Vec2 { x: number; y: number }

export interface Cavity {
  id: string;
  /** Gate position on the cavity (relative to cavity origin, in mm). */
  gatePosition: Vec2;
  /** Cavity center for routing. */
  center: Vec2;
  /** Approximate part volume (cm³) — for pressure estimate. */
  volumeCm3: number;
}

export interface RunnerSegment {
  /** Optional name. */
  id: string;
  start: Vec2;
  end: Vec2;
  /** Diameter (mm). */
  diameterMm: number;
  /** Length, computed. */
  lengthMm: number;
  /** Volume (cm³). */
  volumeCm3: number;
}

export type GateType = 'edge' | 'pin' | 'sub' | 'fan' | 'tab';

export interface Gate {
  cavityId: string;
  position: Vec2;
  type: GateType;
  /** Land length, mm. */
  landMm: number;
  /** Gate diameter (edge/pin) or width (fan), mm. */
  sizeMm: number;
}

export interface FlowPath {
  cavityId: string;
  /** Total path length sprue → gate, mm. */
  lengthMm: number;
  /** Path waypoints (including sprue and gate). */
  waypoints: Vec2[];
}

export interface RunnerLayoutResult {
  runners: RunnerSegment[];
  gates: Gate[];
  flowPaths: FlowPath[];
  /** Total runner + cold slug volume per shot, cm³. */
  scrapVolumeCm3: number;
  /** Coefficient of variation of flow lengths (0 = perfectly balanced). */
  imbalanceScore: number;
  /** Longest flow length, mm. */
  maxFlowLengthMm: number;
}

export type Topology = 'H-runner' | 'fishbone' | 'star';

export interface LayoutOptions {
  topology: Topology;
  /** Main runner diameter, mm. */
  mainDiameterMm: number;
  /** Branch runner diameter, mm. */
  branchDiameterMm: number;
  /** Gate type. */
  gateType: GateType;
  /** Gate land length. */
  gateLandMm: number;
  /** Gate size. */
  gateSizeMm: number;
  /** Sprue location (mold-center reference), mm. */
  sprueLocation: Vec2;
}

export const DEFAULT_OPTIONS: LayoutOptions = {
  topology: 'H-runner',
  mainDiameterMm: 8,
  branchDiameterMm: 5,
  gateType: 'edge',
  gateLandMm: 1.0,
  gateSizeMm: 1.2,
  sprueLocation: { x: 0, y: 0 },
};

// ── Top-level entry ────────────────────────────────────────────

export function planLayout(cavities: Cavity[], options: Partial<LayoutOptions> = {}): RunnerLayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (cavities.length === 0) {
    return { runners: [], gates: [], flowPaths: [], scrapVolumeCm3: 0, imbalanceScore: 0, maxFlowLengthMm: 0 };
  }

  let runners: RunnerSegment[];
  let flowPaths: FlowPath[];
  switch (opts.topology) {
    case 'star':
      ({ runners, flowPaths } = buildStarLayout(cavities, opts));
      break;
    case 'fishbone':
      ({ runners, flowPaths } = buildFishboneLayout(cavities, opts));
      break;
    case 'H-runner':
    default:
      ({ runners, flowPaths } = buildHRunnerLayout(cavities, opts));
      break;
  }

  const gates: Gate[] = cavities.map(c => ({
    cavityId: c.id,
    position: c.gatePosition,
    type: opts.gateType,
    landMm: opts.gateLandMm,
    sizeMm: opts.gateSizeMm,
  }));

  const scrapVolumeCm3 = runners.reduce((s, r) => s + r.volumeCm3, 0);
  const lengths = flowPaths.map(fp => fp.lengthMm);
  const avg = lengths.reduce((s, l) => s + l, 0) / Math.max(1, lengths.length);
  const variance = lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / Math.max(1, lengths.length);
  const stdev = Math.sqrt(variance);
  const cv = avg > 0 ? stdev / avg : 0;
  const maxLen = lengths.reduce((m, l) => Math.max(m, l), 0);

  return { runners, gates, flowPaths, scrapVolumeCm3, imbalanceScore: cv, maxFlowLengthMm: maxLen };
}

// ── Topology builders ─────────────────────────────────────────

function buildStarLayout(cavities: Cavity[], opts: LayoutOptions): { runners: RunnerSegment[]; flowPaths: FlowPath[] } {
  const runners: RunnerSegment[] = [];
  const flowPaths: FlowPath[] = [];
  for (let i = 0; i < cavities.length; i++) {
    const c = cavities[i]!;
    const len = distance(opts.sprueLocation, c.gatePosition);
    runners.push(makeSegment(`R${i}`, opts.sprueLocation, c.gatePosition, opts.branchDiameterMm));
    flowPaths.push({ cavityId: c.id, lengthMm: len, waypoints: [opts.sprueLocation, c.gatePosition] });
  }
  return { runners, flowPaths };
}

function buildHRunnerLayout(cavities: Cavity[], opts: LayoutOptions): { runners: RunnerSegment[]; flowPaths: FlowPath[] } {
  if (cavities.length <= 1) return buildStarLayout(cavities, opts);
  const runners: RunnerSegment[] = [];
  const flowPaths: FlowPath[] = [];
  // Split into 2 halves by x coordinate, then pair within each half.
  const sorted = [...cavities].sort((a, b) => a.gatePosition.x - b.gatePosition.x);
  const half = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, half);
  const right = sorted.slice(half);

  const leftMid: Vec2 = { x: avgX(left), y: avgY(left) };
  const rightMid: Vec2 = { x: avgX(right), y: avgY(right) };
  runners.push(makeSegment('main-left', opts.sprueLocation, leftMid, opts.mainDiameterMm));
  runners.push(makeSegment('main-right', opts.sprueLocation, rightMid, opts.mainDiameterMm));

  function attach(group: Cavity[], hub: Vec2): void {
    for (let i = 0; i < group.length; i++) {
      const c = group[i]!;
      const segLen = distance(hub, c.gatePosition);
      const id = `branch-${c.id}`;
      runners.push(makeSegment(id, hub, c.gatePosition, opts.branchDiameterMm));
      const mainLen = distance(opts.sprueLocation, hub);
      flowPaths.push({
        cavityId: c.id,
        lengthMm: mainLen + segLen,
        waypoints: [opts.sprueLocation, hub, c.gatePosition],
      });
    }
  }
  attach(left, leftMid);
  attach(right, rightMid);
  return { runners, flowPaths };
}

function buildFishboneLayout(cavities: Cavity[], opts: LayoutOptions): { runners: RunnerSegment[]; flowPaths: FlowPath[] } {
  const runners: RunnerSegment[] = [];
  const flowPaths: FlowPath[] = [];
  // Spine runs along X from sprue to right side.
  const maxX = cavities.reduce((m, c) => Math.max(m, c.gatePosition.x), opts.sprueLocation.x);
  const spineEnd: Vec2 = { x: maxX, y: opts.sprueLocation.y };
  runners.push(makeSegment('spine', opts.sprueLocation, spineEnd, opts.mainDiameterMm));
  for (let i = 0; i < cavities.length; i++) {
    const c = cavities[i]!;
    const branchStart: Vec2 = { x: c.gatePosition.x, y: opts.sprueLocation.y };
    const segLen = distance(branchStart, c.gatePosition);
    runners.push(makeSegment(`branch-${c.id}`, branchStart, c.gatePosition, opts.branchDiameterMm));
    const spineLen = distance(opts.sprueLocation, branchStart);
    flowPaths.push({
      cavityId: c.id,
      lengthMm: spineLen + segLen,
      waypoints: [opts.sprueLocation, branchStart, c.gatePosition],
    });
  }
  return { runners, flowPaths };
}

// ── Helpers ────────────────────────────────────────────────────

function makeSegment(id: string, start: Vec2, end: Vec2, diameterMm: number): RunnerSegment {
  const length = distance(start, end);
  const radiusCm = diameterMm / 20;
  const volume = Math.PI * radiusCm * radiusCm * (length / 10);
  return { id, start, end, diameterMm, lengthMm: length, volumeCm3: volume };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function avgX(cs: Cavity[]): number {
  return cs.reduce((s, c) => s + c.gatePosition.x, 0) / Math.max(1, cs.length);
}

function avgY(cs: Cavity[]): number {
  return cs.reduce((s, c) => s + c.gatePosition.y, 0) / Math.max(1, cs.length);
}

// ── Summary ────────────────────────────────────────────────────

export interface LayoutSummary {
  cavityCount: number;
  runnerCount: number;
  totalRunnerLengthMm: number;
  scrapPercent: number;
  /** True if imbalance ≤ 0.1 (10%). */
  isBalanced: boolean;
  /** Longest flow / shortest flow ratio. */
  flowLengthRatio: number;
}

export function summarize(cavities: Cavity[], result: RunnerLayoutResult): LayoutSummary {
  const partVolume = cavities.reduce((s, c) => s + c.volumeCm3, 0);
  const totalShot = partVolume + result.scrapVolumeCm3;
  const minLen = result.flowPaths.length > 0 ? Math.min(...result.flowPaths.map(p => p.lengthMm)) : 0;
  const maxLen = result.maxFlowLengthMm;
  return {
    cavityCount: cavities.length,
    runnerCount: result.runners.length,
    totalRunnerLengthMm: result.runners.reduce((s, r) => s + r.lengthMm, 0),
    scrapPercent: totalShot > 0 ? (result.scrapVolumeCm3 / totalShot) * 100 : 0,
    isBalanced: result.imbalanceScore <= 0.1,
    flowLengthRatio: minLen > 0 ? maxLen / minLen : 0,
  };
}
