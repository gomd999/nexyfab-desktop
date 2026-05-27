/**
 * meshValidation.ts — Pre-/post-OCCT mesh integrity gate.
 *
 * Every OCCT operation in NexyFab (boolean, fillet, chamfer, shell,
 * draft, sheet metal) consumes a `THREE.BufferGeometry` and emits one
 * back. When the input is malformed (degenerate triangles, isolated
 * vertices, non-manifold edges) the OCCT side typically throws a
 * cryptic exception inside WASM that surfaces as a generic
 * "operation failed" — useless for diagnosis.
 *
 * This module runs cheap O(n) checks on the geometry buffer BEFORE the
 * OCCT call and AFTER it, producing a structured diagnostic the UI can
 * show inline ("Boolean failed — input has 12 zero-area triangles, run
 * Heal first") instead of a generic toast.
 *
 * Checks are tiered:
 *   - **structural** (always run): position attribute present, index
 *     buffer well-formed, triangle count > 0.
 *   - **topology** (opt-in, O(n) extra hash): non-manifold edges,
 *     isolated vertices.
 *   - **degeneracy** (opt-in): zero-area triangles, sliver detection
 *     by triangle aspect ratio.
 *
 * Cost: each tier roughly 100k tri/ms in V8. Topology is the slowest
 * because it builds an edge map. Default is structural-only so the
 * pipeline doesn't pay for what most callers don't read.
 */

import * as THREE from 'three';

export type MeshIssueCode =
  | 'no-position'           // Attribute missing entirely
  | 'no-triangles'          // Empty geometry
  | 'index-out-of-range'    // Index buffer points past position count
  | 'degenerate-triangle'   // Zero or near-zero area
  | 'sliver-triangle'       // Aspect ratio worse than threshold
  | 'non-manifold-edge'     // Shared by >2 faces
  | 'isolated-vertex'       // Position not referenced by any index
  | 'non-finite-position';  // NaN/Infinity in position attribute

export type MeshIssueSeverity = 'error' | 'warning' | 'info';

export interface MeshIssue {
  code: MeshIssueCode;
  severity: MeshIssueSeverity;
  /** Number of occurrences (e.g. 12 degenerate triangles). */
  count: number;
  /** First few offending indices for debug; capped at 10 to bound size. */
  sampleIndices?: number[];
  /** Human-readable message. */
  message: string;
}

export interface MeshValidationResult {
  ok: boolean;
  issues: MeshIssue[];
  /** Summary counts for telemetry. */
  triangleCount: number;
  vertexCount: number;
}

export interface MeshValidationOptions {
  /** Run topology checks (non-manifold edges, isolated vertices). Off by
   *  default — costs an extra O(n) edge-map pass. */
  topology?: boolean;
  /** Run degeneracy checks. On by default — it's the most common cause
   *  of OCCT failures and is cheap. */
  degeneracy?: boolean;
  /** Area threshold below which a triangle is considered degenerate, mm². */
  minTriangleArea?: number;
  /** Aspect ratio (longest edge / shortest altitude) above which a
   *  triangle is flagged as a sliver. */
  maxSliverAspectRatio?: number;
}

const DEFAULT_MIN_AREA = 1e-6;
const DEFAULT_SLIVER_AR = 1000;
const SAMPLE_CAP = 10;

/** Compute triangle area given three vertex coordinates. Uses cross
 *  product magnitude / 2. */
function triangleArea(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) * 0.5;
}

/** Triangle aspect ratio — longest edge divided by altitude to opposite
 *  vertex. A regular triangle ≈ 1.15, slivers tend toward thousands. */
function triangleAspectRatio(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const ab = Math.hypot(bx - ax, by - ay, bz - az);
  const bc = Math.hypot(cx - bx, cy - by, cz - bz);
  const ca = Math.hypot(ax - cx, ay - cy, az - cz);
  const longest = Math.max(ab, bc, ca);
  const area = triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
  if (area < 1e-12) return Infinity;
  const altitude = (2 * area) / longest;
  return longest / Math.max(altitude, 1e-12);
}

function makeIssue(
  code: MeshIssueCode,
  severity: MeshIssueSeverity,
  count: number,
  message: string,
  sampleIndices?: number[],
): MeshIssue {
  return { code, severity, count, message, sampleIndices };
}

/**
 * Validate a mesh against the integrity gates relevant for OCCT
 * operations. The result is "ok" when no `error`-severity issues
 * are present — warnings (slivers, isolated vertices) don't fail.
 */
export function validateMesh(
  geometry: THREE.BufferGeometry,
  opts: MeshValidationOptions = {},
): MeshValidationResult {
  const issues: MeshIssue[] = [];
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) {
    issues.push(makeIssue('no-position', 'error', 1, 'Geometry has no position attribute'));
    return { ok: false, issues, triangleCount: 0, vertexCount: 0 };
  }
  const idx = geometry.index;
  const vertexCount = pos.count;
  const triangleCount = idx ? idx.count / 3 : pos.count / 3;

  if (triangleCount === 0) {
    issues.push(makeIssue('no-triangles', 'error', 1, 'Geometry has zero triangles'));
    return { ok: false, issues, triangleCount, vertexCount };
  }

  // Non-finite check on positions — single linear scan.
  let nonFiniteCount = 0;
  const nonFiniteSamples: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      nonFiniteCount++;
      if (nonFiniteSamples.length < SAMPLE_CAP) nonFiniteSamples.push(i);
    }
  }
  if (nonFiniteCount > 0) {
    issues.push(makeIssue('non-finite-position', 'error', nonFiniteCount,
      `${nonFiniteCount} vertex position(s) are NaN or Infinity`, nonFiniteSamples));
  }

  // Index range check.
  if (idx) {
    let oob = 0;
    const oobSamples: number[] = [];
    for (let i = 0; i < idx.count; i++) {
      const v = idx.getX(i);
      if (v < 0 || v >= vertexCount) {
        oob++;
        if (oobSamples.length < SAMPLE_CAP) oobSamples.push(i);
      }
    }
    if (oob > 0) {
      issues.push(makeIssue('index-out-of-range', 'error', oob,
        `${oob} index buffer entries point outside the vertex array`, oobSamples));
    }
  }

  // Degeneracy + sliver checks — opt-in but on by default.
  if (opts.degeneracy !== false) {
    const minArea = opts.minTriangleArea ?? DEFAULT_MIN_AREA;
    const maxAR = opts.maxSliverAspectRatio ?? DEFAULT_SLIVER_AR;
    let degenerate = 0;
    let sliver = 0;
    const degSamples: number[] = [];
    const sliverSamples: number[] = [];
    for (let t = 0; t < triangleCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
      const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
      const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
      const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
      const area = triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (area < minArea) {
        degenerate++;
        if (degSamples.length < SAMPLE_CAP) degSamples.push(t);
        continue; // sliver check pointless for zero-area
      }
      const ar = triangleAspectRatio(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (ar > maxAR) {
        sliver++;
        if (sliverSamples.length < SAMPLE_CAP) sliverSamples.push(t);
      }
    }
    if (degenerate > 0) {
      issues.push(makeIssue('degenerate-triangle', 'error', degenerate,
        `${degenerate} triangle(s) below minimum area ${minArea}mm²`, degSamples));
    }
    if (sliver > 0) {
      issues.push(makeIssue('sliver-triangle', 'warning', sliver,
        `${sliver} triangle(s) exceed aspect ratio ${maxAR}`, sliverSamples));
    }
  }

  // Topology checks — opt-in.
  if (opts.topology) {
    const edgeFaceCount = new Map<string, number>();
    const referencedVerts = new Set<number>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    for (let t = 0; t < triangleCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      referencedVerts.add(i0);
      referencedVerts.add(i1);
      referencedVerts.add(i2);
      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const k = edgeKey(a, b);
        edgeFaceCount.set(k, (edgeFaceCount.get(k) ?? 0) + 1);
      }
    }
    let nonManifold = 0;
    for (const [, count] of edgeFaceCount) {
      if (count > 2) nonManifold++;
    }
    if (nonManifold > 0) {
      issues.push(makeIssue('non-manifold-edge', 'error', nonManifold,
        `${nonManifold} edge(s) are shared by more than 2 faces (non-manifold)`));
    }
    const isolated = vertexCount - referencedVerts.size;
    if (isolated > 0) {
      issues.push(makeIssue('isolated-vertex', 'warning', isolated,
        `${isolated} vertex(es) are not referenced by any triangle`));
    }
  }

  const ok = issues.every(i => i.severity !== 'error');
  return { ok, issues, triangleCount, vertexCount };
}

/** Convenience: throw if validation reports any errors. Useful inside
 *  OCCT call sites that want to fail fast with a structured message. */
export function assertMeshValid(
  geometry: THREE.BufferGeometry,
  opts?: MeshValidationOptions,
  context = 'mesh',
): void {
  const r = validateMesh(geometry, opts);
  if (!r.ok) {
    const errors = r.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ');
    throw new Error(`${context} validation failed: ${errors}`);
  }
}
