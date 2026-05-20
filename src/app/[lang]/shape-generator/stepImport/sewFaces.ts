/**
 * sewFaces.ts — Stitch B-Rep faces with tiny gaps along shared edges.
 *
 * Source meshes / imported STEP often have edges that "should" be
 * coincident but differ by float-precision (e.g. 1e-5 mm). Booleans /
 * fillets on the resulting B-Rep then fail with cryptic OCCT errors.
 * The fix is to merge edges whose endpoints fall within a tolerance.
 *
 * This module operates at the **mesh edge** level (we don't have a
 * full B-Rep representation in NexyFab outside replicad). The
 * algorithm:
 *
 *   1. Build a hash bucket on endpoint positions quantised to the
 *      tolerance.
 *   2. For each pair of edges that share a bucket on either endpoint,
 *      compare full positions within tolerance.
 *   3. Merge — replace one endpoint with the other's coordinates.
 *
 * The mesh-healing module (`features/meshHealing`) does vertex
 * welding already. `sewFaces` is a higher-level wrapper that produces
 * a stitched-edge report so the importer can warn the user "X gaps
 * were healed at tol=Y mm".
 */

export interface BrepEdge {
  /** Stable edge id (typically `face1-face2-localIdx`). */
  id: string;
  /** Edge endpoints in world coords (mm). */
  p0: [number, number, number];
  p1: [number, number, number];
}

export interface SewReport {
  /** Number of edges whose endpoints were snapped. */
  snappedEndpoints: number;
  /** Number of edges that merged with at least one peer. */
  mergedEdges: number;
  /** Tolerance actually used. */
  toleranceMm: number;
  /** Cluster count after merge. */
  clusterCount: number;
}

export interface SewOptions {
  /** Snap tolerance, mm. Default 1e-3 (1 micron). */
  toleranceMm?: number;
}

/** Identify the "cluster id" of a 3-D point — quantised cell index. */
function cellKey(p: [number, number, number], tol: number): string {
  const cx = Math.round(p[0] / tol);
  const cy = Math.round(p[1] / tol);
  const cz = Math.round(p[2] / tol);
  return `${cx}|${cy}|${cz}`;
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

interface BucketEntry { sum: [number, number, number]; count: number }

/** Search the 27 neighbour cells around `p` for an existing cluster
 *  whose centroid is within tolerance. Two points that straddle a
 *  cell boundary still merge — pure exact-cell lookup misses those. */
function findNearbyCluster(
  buckets: Map<string, BucketEntry>,
  p: [number, number, number],
  tol: number,
  tolSq: number,
): BucketEntry | null {
  const cx = Math.round(p[0] / tol);
  const cy = Math.round(p[1] / tol);
  const cz = Math.round(p[2] / tol);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx}|${cy + dy}|${cz + dz}`;
        const entry = buckets.get(key);
        if (!entry) continue;
        const ax = entry.sum[0] / entry.count;
        const ay = entry.sum[1] / entry.count;
        const az = entry.sum[2] / entry.count;
        if (dist2([ax, ay, az], p) <= tolSq) return entry;
      }
    }
  }
  return null;
}

/** Pass 1: cluster every endpoint by tolerance via the 27-neighbour
 *  search. Returns a per-cell centroid table. */
function clusterEndpoints(
  edges: BrepEdge[],
  tol: number,
): Map<string, [number, number, number]> {
  const buckets = new Map<string, BucketEntry>();
  const tolSq = tol * tol;
  for (const e of edges) {
    for (const p of [e.p0, e.p1]) {
      const found = findNearbyCluster(buckets, p, tol, tolSq);
      if (found) {
        found.sum[0] += p[0]; found.sum[1] += p[1]; found.sum[2] += p[2];
        found.count++;
      } else {
        buckets.set(cellKey(p, tol), { sum: [p[0], p[1], p[2]], count: 1 });
      }
    }
  }
  const reps = new Map<string, [number, number, number]>();
  for (const [k, v] of buckets) {
    reps.set(k, [v.sum[0] / v.count, v.sum[1] / v.count, v.sum[2] / v.count]);
  }
  return reps;
}

/** Lookup against the neighbour cells of `p` — symmetric to the
 *  clustering pass so the lookup hits the same cluster the point
 *  was assigned to. */
function lookupRep(
  reps: Map<string, [number, number, number]>,
  p: [number, number, number],
  tol: number,
): [number, number, number] | null {
  const tolSq = tol * tol;
  const cx = Math.round(p[0] / tol);
  const cy = Math.round(p[1] / tol);
  const cz = Math.round(p[2] / tol);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx}|${cy + dy}|${cz + dz}`;
        const rep = reps.get(key);
        if (rep && dist2(rep, p) <= tolSq) return rep;
      }
    }
  }
  return null;
}

/** Snap every edge endpoint to its cluster centroid + report stats. */
export function sewFaces(edges: BrepEdge[], opts: SewOptions = {}): {
  edges: BrepEdge[];
  report: SewReport;
} {
  const tol = opts.toleranceMm ?? 1e-3;
  const reps = clusterEndpoints(edges, tol);
  const out: BrepEdge[] = [];
  let snapped = 0;
  const mergedIds = new Set<string>();

  for (const e of edges) {
    const newP0 = lookupRep(reps, e.p0, tol) ?? e.p0;
    const newP1 = lookupRep(reps, e.p1, tol) ?? e.p1;
    if (dist2(newP0, e.p0) > 0) snapped++;
    if (dist2(newP1, e.p1) > 0) snapped++;
    out.push({ id: e.id, p0: newP0, p1: newP1 });
  }

  // Detect edges that became coincident with each other after snapping.
  const seen = new Map<string, string>();
  for (const e of out) {
    const ka = cellKey(e.p0, tol);
    const kb = cellKey(e.p1, tol);
    const sig = ka < kb ? `${ka}__${kb}` : `${kb}__${ka}`;
    if (seen.has(sig)) {
      mergedIds.add(e.id);
      mergedIds.add(seen.get(sig)!);
    } else {
      seen.set(sig, e.id);
    }
  }

  return {
    edges: out,
    report: {
      snappedEndpoints: snapped,
      mergedEdges: mergedIds.size,
      toleranceMm: tol,
      clusterCount: reps.size,
    },
  };
}

/** Convenience — combine `sewFaces` with a healing summary message
 *  the importer panel can show inline. */
export function sewFacesWithMessage(
  edges: BrepEdge[],
  opts: SewOptions = {},
): { edges: BrepEdge[]; report: SewReport; message: string } {
  const r = sewFaces(edges, opts);
  const msg = r.report.snappedEndpoints === 0
    ? 'No edge gaps detected — geometry is clean.'
    : `Healed ${r.report.snappedEndpoints} edge endpoint(s) at tolerance ${r.report.toleranceMm}mm; merged ${r.report.mergedEdges} duplicate edge(s).`;
  return { ...r, message: msg };
}
