/**
 * revisionCloudGenerator.ts — Auto-generate revision clouds around
 * changed regions on a 2D drawing.
 *
 * Revision clouds are the bumpy oval / cloud-shaped annotations
 * that surround changed dimensions or geometry on a drawing.
 * They draw the reviewer's eye to "this is what's new in Rev B".
 *
 * Input: a list of changed regions as bboxes (where dimensions or
 * geometry shifted between two drawing revisions).
 *
 * Output: a list of *cloud paths* — closed polyline arrays that
 * the renderer turns into SVG paths. The cloud is built from
 * sequential arcs of a fixed *bump radius* placed along the
 * rectangle outline.
 */

export interface Vec2 { x: number; y: number }

export interface BBox {
  min: Vec2;
  max: Vec2;
}

export interface RevisionRegion {
  /** Region id (e.g. revision number). */
  id: string;
  /** Bounding box of the change. */
  bbox: BBox;
  /** Optional label (e.g. "Δ12.5 → 13"). */
  label?: string;
}

export interface CloudPath {
  /** Points sampled along the cloud outline. */
  points: Vec2[];
  /** Centroid for label placement. */
  centroid: Vec2;
  /** Revision id this cloud refers to. */
  revisionId: string;
  /** Optional label. */
  label?: string;
}

export interface CloudOptions {
  /** Radius of each bump along the outline (mm). */
  bumpRadiusMm: number;
  /** Margin added around the bbox before bumps (mm). */
  marginMm: number;
  /** Points per arc (visual smoothness). */
  arcSamples: number;
  /** Direction of bumps. Default outward. */
  bumpDirection: 'outward' | 'inward';
}

export const DEFAULT_OPTIONS: CloudOptions = {
  bumpRadiusMm: 3.0,
  marginMm: 2.0,
  arcSamples: 8,
  bumpDirection: 'outward',
};

// ── Top-level entry ────────────────────────────────────────────

export function generateClouds(regions: RevisionRegion[], options: Partial<CloudOptions> = {}): CloudPath[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const out: CloudPath[] = [];
  for (const region of regions) {
    out.push(buildCloud(region, opts));
  }
  return out;
}

// ── Single-cloud builder ──────────────────────────────────────

function buildCloud(region: RevisionRegion, opts: CloudOptions): CloudPath {
  const padded: BBox = {
    min: { x: region.bbox.min.x - opts.marginMm, y: region.bbox.min.y - opts.marginMm },
    max: { x: region.bbox.max.x + opts.marginMm, y: region.bbox.max.y + opts.marginMm },
  };
  const width = padded.max.x - padded.min.x;
  const height = padded.max.y - padded.min.y;
  const r = opts.bumpRadiusMm;

  // Walk the perimeter in 4 segments, placing bumps along the way.
  const points: Vec2[] = [];
  const perimeter = 2 * (width + height);
  const bumpStep = 2 * r;
  const bumpCount = Math.max(8, Math.ceil(perimeter / bumpStep));
  const stepLen = perimeter / bumpCount;

  for (let i = 0; i < bumpCount; i++) {
    const t = i * stepLen;
    const { point, tangent } = positionOnRect(t, padded);
    // Bump direction = perpendicular to tangent (outward or inward).
    const normal: Vec2 = opts.bumpDirection === 'outward'
      ? { x: tangent.y, y: -tangent.x }
      : { x: -tangent.y, y: tangent.x };
    const center: Vec2 = { x: point.x + normal.x * r, y: point.y + normal.y * r };
    // Arc from current point to next (~tangent.x ⋅ 2r ahead) along the bump.
    const next = positionOnRect((t + stepLen) % perimeter, padded);
    const dotN = (next.point.x - point.x) * tangent.x + (next.point.y - point.y) * tangent.y;
    const arcLen = Math.max(1, dotN);
    void arcLen;
    for (let k = 0; k < opts.arcSamples; k++) {
      const theta = (Math.PI * k) / (opts.arcSamples - 1);
      // Arc from start to end, sweeping outward.
      const sweepDir = { x: tangent.x, y: tangent.y };
      const startDir = { x: -sweepDir.x, y: -sweepDir.y };
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const dir = { x: startDir.x * c + normal.x * s, y: startDir.y * c + normal.y * s };
      points.push({ x: center.x + dir.x * r, y: center.y + dir.y * r });
    }
  }

  // Centroid for label placement (just the bbox center).
  const centroid: Vec2 = {
    x: (region.bbox.min.x + region.bbox.max.x) / 2,
    y: (region.bbox.min.y + region.bbox.max.y) / 2,
  };

  const cp: CloudPath = { points, centroid, revisionId: region.id };
  if (region.label !== undefined) cp.label = region.label;
  return cp;
}

// ── Perimeter parameterization ─────────────────────────────────

function positionOnRect(t: number, bbox: BBox): { point: Vec2; tangent: Vec2 } {
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const perimeter = 2 * (width + height);
  let s = ((t % perimeter) + perimeter) % perimeter;
  if (s < width) {
    return { point: { x: bbox.min.x + s, y: bbox.min.y }, tangent: { x: 1, y: 0 } };
  }
  s -= width;
  if (s < height) {
    return { point: { x: bbox.max.x, y: bbox.min.y + s }, tangent: { x: 0, y: 1 } };
  }
  s -= height;
  if (s < width) {
    return { point: { x: bbox.max.x - s, y: bbox.max.y }, tangent: { x: -1, y: 0 } };
  }
  s -= width;
  return { point: { x: bbox.min.x, y: bbox.max.y - s }, tangent: { x: 0, y: -1 } };
}

// ── Region merging ────────────────────────────────────────────

/** Merge regions whose bboxes overlap (after the margin is applied). */
export function mergeOverlappingRegions(regions: RevisionRegion[], marginMm: number = 0): RevisionRegion[] {
  if (regions.length === 0) return [];
  const sorted = [...regions];
  const merged: RevisionRegion[] = [];
  const used = new Array(sorted.length).fill(false);

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let cur = expand(sorted[i]!.bbox, marginMm);
    const ids: string[] = [sorted[i]!.id];
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        const other = expand(sorted[j]!.bbox, marginMm);
        if (bboxesOverlap(cur, other)) {
          cur = unionBBox(cur, other);
          ids.push(sorted[j]!.id);
          used[j] = true;
          changed = true;
        }
      }
    }
    merged.push({ id: ids.join('+'), bbox: cur });
  }
  return merged;
}

function expand(bbox: BBox, margin: number): BBox {
  return {
    min: { x: bbox.min.x - margin, y: bbox.min.y - margin },
    max: { x: bbox.max.x + margin, y: bbox.max.y + margin },
  };
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

function unionBBox(a: BBox, b: BBox): BBox {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CloudSummary {
  cloudCount: number;
  totalPointCount: number;
  averageBumpCount: number;
}

export function summarize(clouds: CloudPath[], opts: Partial<CloudOptions> = {}): CloudSummary {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const totalPoints = clouds.reduce((s, c) => s + c.points.length, 0);
  const avgBumps = clouds.length > 0 ? totalPoints / clouds.length / o.arcSamples : 0;
  return {
    cloudCount: clouds.length,
    totalPointCount: totalPoints,
    averageBumpCount: avgBumps,
  };
}
