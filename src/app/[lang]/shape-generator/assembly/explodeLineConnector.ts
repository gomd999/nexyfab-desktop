/**
 * explodeLineConnector.ts — Connect exploded parts back to their
 * assembled positions with dashed trail lines.
 *
 * In an exploded view, each part has moved away from its assembled
 * position. To read the diagram, a *trail line* (a dashed straight
 * or polyline path) connects the exploded position back to where
 * the part used to sit. Multiple parts sharing the same path
 * direction can share a single trail.
 *
 * Module computes:
 *
 *   - Per-part trail polyline (from exploded centroid to assembled
 *     centroid).
 *   - Optional "common spine": parts moving along the same axis
 *     share a single trail with branches.
 *   - Trail style hints (dash pattern, weight).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface ExplodedPart {
  id: string;
  /** Centroid in assembled state. */
  assembledCentroid: Vec3;
  /** Centroid after explosion. */
  explodedCentroid: Vec3;
}

export interface TrailLine {
  partId: string;
  /** Polyline of points: exploded centroid → assembled centroid. */
  points: Vec3[];
  /** Style hint (caller maps to dash pattern). */
  style: 'dashed' | 'dash-dot' | 'phantom';
  /** Length, mm. */
  lengthMm: number;
  /** Optional id of the spine this trail attaches to. */
  spineId?: string;
}

export interface SpineBranch {
  /** Spine id (e.g., "X+", "Y-"). */
  id: string;
  /** Axis label. */
  axisLabel: string;
  /** Branched part ids. */
  partIds: string[];
  /** Spine endpoint along the axis. */
  endpoint: Vec3;
}

export interface ConnectorResult {
  trails: TrailLine[];
  spines: SpineBranch[];
}

export interface ConnectorOptions {
  /** Group parts sharing the same direction (within ε) onto one spine. */
  groupBySpine: boolean;
  /** Cosine threshold for spine grouping. */
  spineCosineThreshold: number;
  /** Line style preset. */
  style: TrailLine['style'];
}

export const DEFAULT_OPTIONS: ConnectorOptions = {
  groupBySpine: false,
  spineCosineThreshold: 0.97,
  style: 'phantom',
};

// ── Top-level entry ────────────────────────────────────────────

export function buildTrails(parts: ExplodedPart[], options: Partial<ConnectorOptions> = {}): ConnectorResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const trails: TrailLine[] = [];
  const spines: SpineBranch[] = [];

  // Always build per-part straight trails.
  for (const p of parts) {
    const len = distance(p.explodedCentroid, p.assembledCentroid);
    trails.push({
      partId: p.id,
      points: [p.explodedCentroid, p.assembledCentroid],
      style: opts.style,
      lengthMm: len,
    });
  }

  if (opts.groupBySpine) {
    const groups = groupParallelTrails(parts, opts.spineCosineThreshold);
    let sid = 0;
    for (const group of groups) {
      if (group.length < 2) continue;
      const dir = directionOf(group[0]!);
      const axisLabel = labelForDirection(dir);
      // Spine endpoint = farthest exploded centroid.
      const farthest = group.reduce((m, p) =>
        distance(p.explodedCentroid, p.assembledCentroid) >
        distance(m.explodedCentroid, m.assembledCentroid) ? p : m,
      group[0]!);
      const spineId = `spine-${sid++}`;
      spines.push({
        id: spineId,
        axisLabel,
        partIds: group.map(p => p.id),
        endpoint: farthest.explodedCentroid,
      });
      for (const p of group) {
        const trail = trails.find(t => t.partId === p.id)!;
        trail.spineId = spineId;
      }
    }
  }

  return { trails, spines };
}

// ── Grouping helpers ──────────────────────────────────────────

function groupParallelTrails(parts: ExplodedPart[], cosineThreshold: number): ExplodedPart[][] {
  const groups: ExplodedPart[][] = [];
  const used = new Set<number>();
  for (let i = 0; i < parts.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const group = [parts[i]!];
    const di = directionOf(parts[i]!);
    for (let j = i + 1; j < parts.length; j++) {
      if (used.has(j)) continue;
      const dj = directionOf(parts[j]!);
      if (Math.abs(dot(di, dj)) >= cosineThreshold) {
        group.push(parts[j]!);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

function directionOf(p: ExplodedPart): Vec3 {
  const dx = p.explodedCentroid.x - p.assembledCentroid.x;
  const dy = p.explodedCentroid.y - p.assembledCentroid.y;
  const dz = p.explodedCentroid.z - p.assembledCentroid.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: dx / len, y: dy / len, z: dz / len };
}

function labelForDirection(d: Vec3): string {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return d.x > 0 ? 'X+' : 'X-';
  if (ay >= az) return d.y > 0 ? 'Y+' : 'Y-';
  return d.z > 0 ? 'Z+' : 'Z-';
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Summary ────────────────────────────────────────────────────

export interface ConnectorSummary {
  trailCount: number;
  spineCount: number;
  averageTrailLengthMm: number;
  longestTrailMm: number;
}

export function summarize(result: ConnectorResult): ConnectorSummary {
  const lens = result.trails.map(t => t.lengthMm);
  const avg = lens.length > 0 ? lens.reduce((s, l) => s + l, 0) / lens.length : 0;
  const max = lens.length > 0 ? Math.max(...lens) : 0;
  return {
    trailCount: result.trails.length,
    spineCount: result.spines.length,
    averageTrailLengthMm: avg,
    longestTrailMm: max,
  };
}
