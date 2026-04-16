import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrimitiveType = 'plane' | 'cylinder' | 'sphere' | 'cone' | 'torus';

export interface DetectedPrimitive {
  type: PrimitiveType;
  confidence: number;
  parameters: Record<string, number>;
  faceIndices: number[];
  geometry: THREE.BufferGeometry;
}

export interface ExtrusionFeature {
  profile: THREE.Vector2[];
  direction: THREE.Vector3;
  depth: number;
  geometry: THREE.BufferGeometry;
}

export interface RotationalFeature {
  axis: THREE.Vector3;
  center: THREE.Vector3;
  profile: THREE.Vector2[];
  angle: number;
  geometry: THREE.BufferGeometry;
}

export interface SurfacePatch {
  type: 'planar' | 'cylindrical' | 'spherical' | 'conical' | 'freeform';
  faceIndices: number[];
  geometry: THREE.BufferGeometry;
  error: number;
}

export interface CrossSection {
  plane: THREE.Plane;
  contours: THREE.Vector3[][];
  area: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface FaceData {
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
}

/** Extract indexed or non-indexed triangle data from a BufferGeometry. */
function extractFaces(geo: THREE.BufferGeometry): FaceData[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  if (!pos) return [];

  const index = geo.getIndex();
  const faceCount = index ? index.count / 3 : pos.count / 3;
  const faces: FaceData[] = [];

  for (let i = 0; i < faceCount; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

    const a = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const b = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const c = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    const edge1 = new THREE.Vector3().subVectors(b, a);
    const edge2 = new THREE.Vector3().subVectors(c, a);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

    const centroid = new THREE.Vector3()
      .addVectors(a, b)
      .add(c)
      .multiplyScalar(1 / 3);

    faces.push({ index: i, a, b, c, normal, centroid });
  }

  return faces;
}

/** Build an adjacency map: faceIndex -> set of neighbour face indices. */
function buildAdjacency(faces: FaceData[], geo: THREE.BufferGeometry): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < faces.length; i++) adj.set(i, new Set());

  // Map edge (sorted vertex key) -> face indices sharing that edge
  const edgeMap = new Map<string, number[]>();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.getIndex();

  for (let fi = 0; fi < faces.length; fi++) {
    const base = fi * 3;
    const verts = [
      index ? index.getX(base) : base,
      index ? index.getX(base + 1) : base + 1,
      index ? index.getX(base + 2) : base + 2,
    ];

    for (let e = 0; e < 3; e++) {
      const v0 = verts[e];
      const v1 = verts[(e + 1) % 3];
      // Use spatial key for non-indexed or welded lookup
      const p0 = new THREE.Vector3(pos.getX(v0), pos.getY(v0), pos.getZ(v0));
      const p1 = new THREE.Vector3(pos.getX(v1), pos.getY(v1), pos.getZ(v1));
      const key = edgeKey(p0, p1);

      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key)!.push(fi);
    }
  }

  for (const [, faceList] of edgeMap) {
    for (let i = 0; i < faceList.length; i++) {
      for (let j = i + 1; j < faceList.length; j++) {
        adj.get(faceList[i])!.add(faceList[j]);
        adj.get(faceList[j])!.add(faceList[i]);
      }
    }
  }

  return adj;
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const precision = 6;
  const sa = `${a.x.toFixed(precision)},${a.y.toFixed(precision)},${a.z.toFixed(precision)}`;
  const sb = `${b.x.toFixed(precision)},${b.y.toFixed(precision)},${b.z.toFixed(precision)}`;
  return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
}

/** Region growing: group faces whose normals are within angleDeg of each other. */
function regionGrow(
  faces: FaceData[],
  adj: Map<number, Set<number>>,
  angleDeg: number,
): number[][] {
  const threshold = Math.cos((angleDeg * Math.PI) / 180);
  const visited = new Set<number>();
  const regions: number[][] = [];

  for (let seed = 0; seed < faces.length; seed++) {
    if (visited.has(seed)) continue;
    const region: number[] = [];
    const stack = [seed];
    visited.add(seed);

    while (stack.length > 0) {
      const fi = stack.pop()!;
      region.push(fi);

      for (const ni of adj.get(fi) || []) {
        if (visited.has(ni)) continue;
        if (faces[fi].normal.dot(faces[ni].normal) >= threshold) {
          visited.add(ni);
          stack.push(ni);
        }
      }
    }
    if (region.length > 0) regions.push(region);
  }

  return regions;
}

/** Fit a plane to a set of points using centroid + covariance PCA. */
function fitPlane(points: THREE.Vector3[]): { origin: THREE.Vector3; normal: THREE.Vector3; error: number } {
  const n = points.length;
  const centroid = new THREE.Vector3();
  for (const p of points) centroid.add(p);
  centroid.divideScalar(n);

  // Covariance matrix
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }

  // Smallest eigenvector via analytic 3x3 symmetric → use power iteration on inverse
  // Simplified: use the cross-product trick for smallest eigenvector
  const normal = smallestEigenvector3x3(xx, xy, xz, yy, yz, zz);

  let error = 0;
  for (const p of points) {
    const d = new THREE.Vector3().subVectors(p, centroid).dot(normal);
    error += d * d;
  }
  error = Math.sqrt(error / n);

  return { origin: centroid, normal, error };
}

/** Approximate smallest eigenvector of a 3x3 symmetric matrix via inverse iteration. */
function smallestEigenvector3x3(
  xx: number, xy: number, xz: number,
  yy: number, yz: number, zz: number,
): THREE.Vector3 {
  // Characteristic equation approach — we use iterative method for robustness
  // Start with cross products of rows to find the normal with least variance

  const r0 = new THREE.Vector3(xx, xy, xz);
  const r1 = new THREE.Vector3(xy, yy, yz);
  const r2 = new THREE.Vector3(xz, yz, zz);

  const c01 = new THREE.Vector3().crossVectors(r0, r1);
  const c02 = new THREE.Vector3().crossVectors(r0, r2);
  const c12 = new THREE.Vector3().crossVectors(r1, r2);

  const d01 = c01.lengthSq();
  const d02 = c02.lengthSq();
  const d12 = c12.lengthSq();

  // Pick cross product with largest magnitude for numerical stability
  let best: THREE.Vector3;
  if (d01 >= d02 && d01 >= d12) best = c01;
  else if (d02 >= d01 && d02 >= d12) best = c02;
  else best = c12;

  if (best.lengthSq() < 1e-12) return new THREE.Vector3(0, 0, 1);

  // The eigenvector for the smallest eigenvalue is perpendicular to the two
  // largest-eigenvalue eigenvectors. The cross products above give the largest
  // eigenvector direction. We need the smallest.
  // Instead, use inverse power iteration.
  let v = new THREE.Vector3(1, 1, 1).normalize();
  // Add a small shift to make it invertible for the smallest eigenvalue
  const shift = (xx + yy + zz) * 0.01 + 1e-6;
  const m00 = xx + shift, m11 = yy + shift, m22 = zz + shift;

  for (let iter = 0; iter < 30; iter++) {
    // Solve (M + shift*I) * w = v  using Cramer's rule for 3x3
    const w = solve3x3(m00, xy, xz, xy, m11, yz, xz, yz, m22, v.x, v.y, v.z);
    if (!w) break;
    w.normalize();
    v = w;
  }

  return v.normalize();
}

/** Solve 3x3 linear system Ax=b via Cramer's rule. */
function solve3x3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number,
  b0: number, b1: number, b2: number,
): THREE.Vector3 | null {
  const det = a00 * (a11 * a22 - a12 * a21)
            - a01 * (a10 * a22 - a12 * a20)
            + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) < 1e-15) return null;
  const invDet = 1 / det;

  const x = (b0 * (a11 * a22 - a12 * a21)
           - a01 * (b1 * a22 - a12 * b2)
           + a02 * (b1 * a21 - a11 * b2)) * invDet;
  const y = (a00 * (b1 * a22 - a12 * b2)
           - b0 * (a10 * a22 - a12 * a20)
           + a02 * (a10 * b2 - b1 * a20)) * invDet;
  const z = (a00 * (a11 * b2 - b1 * a21)
           - a01 * (a10 * b2 - b1 * a20)
           + b0 * (a10 * a21 - a11 * a20)) * invDet;

  return new THREE.Vector3(x, y, z);
}

/** Fit a cylinder to points: estimate axis direction & radius. */
function fitCylinder(
  points: THREE.Vector3[],
  normals: THREE.Vector3[],
): { axis: THREE.Vector3; center: THREE.Vector3; radius: number; height: number; error: number } | null {
  if (points.length < 6) return null;

  // Estimate axis as the direction of least normal variance
  // Cylinder normals are perpendicular to the axis, so the axis is the
  // direction that normals have zero component along.
  const centroid = new THREE.Vector3();
  for (const p of points) centroid.add(p);
  centroid.divideScalar(points.length);

  // Covariance of normals — the axis is the smallest eigenvector
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const n of normals) {
    xx += n.x * n.x; xy += n.x * n.y; xz += n.x * n.z;
    yy += n.y * n.y; yz += n.y * n.z; zz += n.z * n.z;
  }

  const axis = smallestEigenvector3x3(xx, xy, xz, yy, yz, zz).normalize();

  // Project points onto plane perpendicular to axis, find center and radius
  const projected: THREE.Vector2[] = [];
  // Build a local 2D frame perpendicular to axis
  const u = new THREE.Vector3();
  if (Math.abs(axis.x) < 0.9) u.crossVectors(new THREE.Vector3(1, 0, 0), axis).normalize();
  else u.crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();

  for (const p of points) {
    const rel = new THREE.Vector3().subVectors(p, centroid);
    projected.push(new THREE.Vector2(rel.dot(u), rel.dot(v)));
  }

  // Fit circle in 2D: algebraic fit  x^2+y^2 + Dx + Ey + F = 0
  const circle = fitCircle2D(projected);
  if (!circle) return null;

  const center3D = centroid.clone()
    .addScaledVector(u, circle.cx)
    .addScaledVector(v, circle.cy);

  // Height: extent along axis
  let minT = Infinity, maxT = -Infinity;
  for (const p of points) {
    const t = new THREE.Vector3().subVectors(p, center3D).dot(axis);
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  // RMS error
  let error = 0;
  for (const p of points) {
    const rel = new THREE.Vector3().subVectors(p, center3D);
    const along = rel.dot(axis);
    const radial = Math.sqrt(rel.lengthSq() - along * along);
    error += (radial - circle.r) ** 2;
  }
  error = Math.sqrt(error / points.length);

  return { axis, center: center3D, radius: circle.r, height: maxT - minT, error };
}

/** Fit a sphere to points. Returns center and radius. */
function fitSphere(
  points: THREE.Vector3[],
): { center: THREE.Vector3; radius: number; error: number } | null {
  if (points.length < 4) return null;

  // Algebraic sphere fit: minimize |p - c|^2 = r^2
  // Linearize: 2*cx*x + 2*cy*y + 2*cz*z + (r^2 - cx^2 - cy^2 - cz^2) = x^2 + y^2 + z^2
  // Let D = 2cx, E = 2cy, F = 2cz, G = r^2 - cx^2 - cy^2 - cz^2
  // Then: D*x + E*y + F*z + G = x^2 + y^2 + z^2

  const n = points.length;
  // Build normal equations for least-squares: A^T A x = A^T b
  // A = [x y z 1], b = [x^2+y^2+z^2]
  let ata = Array.from({ length: 16 }, () => 0);
  let atb = [0, 0, 0, 0];

  for (const p of points) {
    const row = [p.x, p.y, p.z, 1];
    const rhs = p.x * p.x + p.y * p.y + p.z * p.z;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ata[i * 4 + j] += row[i] * row[j];
      }
      atb[i] += row[i] * rhs;
    }
  }

  const sol = solve4x4(ata, atb);
  if (!sol) return null;

  const cx = sol[0] / 2;
  const cy = sol[1] / 2;
  const cz = sol[2] / 2;
  const r = Math.sqrt(sol[3] + cx * cx + cy * cy + cz * cz);
  const center = new THREE.Vector3(cx, cy, cz);

  let error = 0;
  for (const p of points) {
    const d = p.distanceTo(center) - r;
    error += d * d;
  }
  error = Math.sqrt(error / n);

  return { center, radius: r, error };
}

/** Solve 4x4 system via Gaussian elimination with partial pivoting. */
function solve4x4(A: number[], b: number[]): number[] | null {
  const m = A.map(v => v);
  const r = [...b];
  const n = 4;

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxVal = Math.abs(m[col * n + col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(m[row * n + col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal < 1e-12) return null;

    // Swap rows
    if (maxRow !== col) {
      for (let j = 0; j < n; j++) {
        [m[col * n + j], m[maxRow * n + j]] = [m[maxRow * n + j], m[col * n + j]];
      }
      [r[col], r[maxRow]] = [r[maxRow], r[col]];
    }

    // Eliminate
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col] / m[col * n + col];
      for (let j = col; j < n; j++) {
        m[row * n + j] -= factor * m[col * n + j];
      }
      r[row] -= factor * r[col];
    }
  }

  // Back-substitute
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = r[row];
    for (let j = row + 1; j < n; j++) {
      sum -= m[row * n + j] * x[j];
    }
    x[row] = sum / m[row * n + row];
  }

  return x;
}

/** Algebraic circle fit in 2D: returns center (cx, cy) and radius r. */
function fitCircle2D(
  points: THREE.Vector2[],
): { cx: number; cy: number; r: number } | null {
  const n = points.length;
  if (n < 3) return null;

  // x^2+y^2 + Dx + Ey + F = 0  =>  D*x + E*y + F = -(x^2+y^2)
  let ata = Array.from({ length: 9 }, () => 0);
  let atb = [0, 0, 0];

  for (const p of points) {
    const row = [p.x, p.y, 1];
    const rhs = -(p.x * p.x + p.y * p.y);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i * 3 + j] += row[i] * row[j];
      atb[i] += row[i] * rhs;
    }
  }

  const det = ata[0] * (ata[4] * ata[8] - ata[5] * ata[7])
            - ata[1] * (ata[3] * ata[8] - ata[5] * ata[6])
            + ata[2] * (ata[3] * ata[7] - ata[4] * ata[6]);
  if (Math.abs(det) < 1e-12) return null;

  const sol = solve3x3(
    ata[0], ata[1], ata[2],
    ata[3], ata[4], ata[5],
    ata[6], ata[7], ata[8],
    atb[0], atb[1], atb[2],
  );
  if (!sol) return null;

  const cx = -sol.x / 2;
  const cy = -sol.y / 2;
  const r = Math.sqrt(cx * cx + cy * cy - sol.z);

  return isNaN(r) ? null : { cx, cy, r };
}

/** Collect unique vertices from a set of faces. */
function collectVertices(faces: FaceData[], indices: number[]): THREE.Vector3[] {
  const verts: THREE.Vector3[] = [];
  const seen = new Set<string>();
  for (const fi of indices) {
    const f = faces[fi];
    for (const v of [f.a, f.b, f.c]) {
      const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
      if (!seen.has(key)) {
        seen.add(key);
        verts.push(v.clone());
      }
    }
  }
  return verts;
}

/** Collect face normals for a region. */
function collectNormals(faces: FaceData[], indices: number[]): THREE.Vector3[] {
  return indices.map(i => faces[i].normal.clone());
}

/** Build a BufferGeometry from a subset of faces. */
function buildSubGeometry(faces: FaceData[], indices: number[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const fi of indices) {
    const f = faces[fi];
    positions.push(f.a.x, f.a.y, f.a.z);
    positions.push(f.b.x, f.b.y, f.b.z);
    positions.push(f.c.x, f.c.y, f.c.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** Classify a region as a primitive type based on normal distribution analysis. */
function classifyRegion(
  faces: FaceData[],
  regionIndices: number[],
): DetectedPrimitive | null {
  if (regionIndices.length < 3) return null;

  const verts = collectVertices(faces, regionIndices);
  const normals = collectNormals(faces, regionIndices);
  if (verts.length < 3) return null;

  // --- Try plane ---
  const planeResult = tryFitPlane(verts, normals, faces, regionIndices);
  // --- Try sphere ---
  const sphereResult = tryFitSphere(verts, normals, faces, regionIndices);
  // --- Try cylinder ---
  const cylinderResult = tryFitCylinder(verts, normals, faces, regionIndices);
  // --- Try cone ---
  const coneResult = tryFitCone(verts, normals, faces, regionIndices);

  // Pick the best fit by confidence
  const candidates = [planeResult, sphereResult, cylinderResult, coneResult].filter(
    (c): c is DetectedPrimitive => c !== null,
  );

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0];
}

function tryFitPlane(
  verts: THREE.Vector3[],
  normals: THREE.Vector3[],
  faces: FaceData[],
  regionIndices: number[],
): DetectedPrimitive | null {
  // Check normal consistency — all normals should be very similar
  const avgNormal = new THREE.Vector3();
  for (const n of normals) avgNormal.add(n);
  avgNormal.normalize();

  let normalVariance = 0;
  for (const n of normals) {
    normalVariance += 1 - Math.abs(n.dot(avgNormal));
  }
  normalVariance /= normals.length;

  if (normalVariance > 0.05) return null;

  const plane = fitPlane(verts);
  const confidence = Math.max(0, 1 - plane.error * 10 - normalVariance * 5);

  if (confidence < 0.3) return null;

  // Build a fitted plane geometry
  const centroid = plane.origin;
  const extent = computeExtent(verts, centroid);
  const planeGeo = new THREE.PlaneGeometry(extent * 2, extent * 2);
  alignGeometry(planeGeo, centroid, plane.normal);

  return {
    type: 'plane',
    confidence: Math.min(1, confidence),
    parameters: {
      nx: plane.normal.x,
      ny: plane.normal.y,
      nz: plane.normal.z,
      d: plane.normal.dot(centroid),
    },
    faceIndices: [...regionIndices],
    geometry: planeGeo,
  };
}

function tryFitSphere(
  verts: THREE.Vector3[],
  _normals: THREE.Vector3[],
  _faces: FaceData[],
  regionIndices: number[],
): DetectedPrimitive | null {
  const result = fitSphere(verts);
  if (!result || result.radius <= 0 || result.error > result.radius * 0.1) return null;

  const confidence = Math.max(0, 1 - result.error / result.radius * 5);
  if (confidence < 0.3) return null;

  const sphereGeo = new THREE.SphereGeometry(result.radius, 32, 32);
  sphereGeo.translate(result.center.x, result.center.y, result.center.z);

  return {
    type: 'sphere',
    confidence: Math.min(1, confidence),
    parameters: {
      cx: result.center.x,
      cy: result.center.y,
      cz: result.center.z,
      radius: result.radius,
    },
    faceIndices: [...regionIndices],
    geometry: sphereGeo,
  };
}

function tryFitCylinder(
  verts: THREE.Vector3[],
  normals: THREE.Vector3[],
  _faces: FaceData[],
  regionIndices: number[],
): DetectedPrimitive | null {
  const result = fitCylinder(verts, normals);
  if (!result || result.radius <= 0 || result.error > result.radius * 0.1) return null;

  const confidence = Math.max(0, 1 - result.error / result.radius * 5);
  if (confidence < 0.3) return null;

  const cylGeo = new THREE.CylinderGeometry(result.radius, result.radius, result.height, 32);
  alignGeometry(cylGeo, result.center, result.axis);

  return {
    type: 'cylinder',
    confidence: Math.min(1, confidence),
    parameters: {
      ax: result.axis.x,
      ay: result.axis.y,
      az: result.axis.z,
      cx: result.center.x,
      cy: result.center.y,
      cz: result.center.z,
      radius: result.radius,
      height: result.height,
    },
    faceIndices: [...regionIndices],
    geometry: cylGeo,
  };
}

function tryFitCone(
  verts: THREE.Vector3[],
  normals: THREE.Vector3[],
  _faces: FaceData[],
  regionIndices: number[],
): DetectedPrimitive | null {
  if (verts.length < 6) return null;

  // Estimate cone: normals converge toward the apex.
  // Use the normal-intersection approach: pairs of normals from the surface
  // should intersect at the apex.
  const centroid = new THREE.Vector3();
  for (const v of verts) centroid.add(v);
  centroid.divideScalar(verts.length);

  // Estimate axis from normal covariance (same as cylinder)
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const n of normals) {
    xx += n.x * n.x; xy += n.x * n.y; xz += n.x * n.z;
    yy += n.y * n.y; yz += n.y * n.z; zz += n.z * n.z;
  }
  const axis = smallestEigenvector3x3(xx, xy, xz, yy, yz, zz).normalize();

  // Project vertices along axis, compute radius at each height
  const projected: Array<{ t: number; r: number }> = [];
  for (const v of verts) {
    const rel = new THREE.Vector3().subVectors(v, centroid);
    const t = rel.dot(axis);
    const radial = Math.sqrt(rel.lengthSq() - t * t);
    projected.push({ t, r: radial });
  }

  // Linear regression r = a*t + b
  const n = projected.length;
  let sumT = 0, sumR = 0, sumTT = 0, sumTR = 0;
  for (const p of projected) {
    sumT += p.t;
    sumR += p.r;
    sumTT += p.t * p.t;
    sumTR += p.t * p.r;
  }
  const detLR = n * sumTT - sumT * sumT;
  if (Math.abs(detLR) < 1e-12) return null;

  const a = (n * sumTR - sumT * sumR) / detLR; // slope dr/dt
  const b = (sumR - a * sumT) / n;             // radius at t=0

  // If slope is nearly zero, it's a cylinder, not a cone
  if (Math.abs(a) < 0.01) return null;

  const halfAngle = Math.atan(Math.abs(a));
  const apexT = -b / a; // t at which radius = 0
  const apex = centroid.clone().addScaledVector(axis, apexT);

  // Compute error
  let error = 0;
  for (const p of projected) {
    const expectedR = a * p.t + b;
    error += (p.r - expectedR) ** 2;
  }
  error = Math.sqrt(error / n);

  const avgRadius = Math.abs(b);
  if (avgRadius <= 0) return null;
  const confidence = Math.max(0, 1 - error / avgRadius * 5);
  if (confidence < 0.3) return null;

  let minT = Infinity, maxT = -Infinity;
  for (const p of projected) {
    if (p.t < minT) minT = p.t;
    if (p.t > maxT) maxT = p.t;
  }
  const height = maxT - minT;
  const rTop = Math.max(0, a * minT + b);
  const rBottom = Math.max(0, a * maxT + b);

  const coneGeo = new THREE.CylinderGeometry(rTop, rBottom, height, 32);
  const coneCenter = centroid.clone().addScaledVector(axis, (minT + maxT) / 2);
  alignGeometry(coneGeo, coneCenter, axis);

  return {
    type: 'cone',
    confidence: Math.min(1, confidence),
    parameters: {
      ax: axis.x,
      ay: axis.y,
      az: axis.z,
      apexX: apex.x,
      apexY: apex.y,
      apexZ: apex.z,
      halfAngle: (halfAngle * 180) / Math.PI,
      height,
    },
    faceIndices: [...regionIndices],
    geometry: coneGeo,
  };
}

function computeExtent(verts: THREE.Vector3[], center: THREE.Vector3): number {
  let maxDist = 0;
  for (const v of verts) {
    const d = v.distanceTo(center);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

/** Align a geometry so its local Y axis points along `direction`, centered at `position`. */
function alignGeometry(
  geo: THREE.BufferGeometry,
  position: THREE.Vector3,
  direction: THREE.Vector3,
): void {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );
  geo.applyQuaternion(q);
  geo.translate(position.x, position.y, position.z);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect geometric primitives in a mesh using region growing and surface fitting.
 */
export function detectPrimitives(
  geo: THREE.BufferGeometry,
  angleThreshold = 10,
): DetectedPrimitive[] {
  const g = geo.index ? geo : geo.toNonIndexed();
  g.computeVertexNormals();

  const faces = extractFaces(g);
  if (faces.length === 0) return [];

  const adj = buildAdjacency(faces, g);
  const regions = regionGrow(faces, adj, angleThreshold);

  const primitives: DetectedPrimitive[] = [];
  for (const region of regions) {
    const detected = classifyRegion(faces, region);
    if (detected) primitives.push(detected);
  }

  // Sort by confidence descending
  primitives.sort((a, b) => b.confidence - a.confidence);
  return primitives;
}

/**
 * Detect extrusion features: find parallel face-pair groups with consistent cross-section.
 */
export function detectExtrusions(geo: THREE.BufferGeometry): ExtrusionFeature[] {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();

  const faces = extractFaces(g);
  if (faces.length === 0) return [];

  const adj = buildAdjacency(faces, g);
  const regions = regionGrow(faces, adj, 5);
  const features: ExtrusionFeature[] = [];

  // Find pairs of planar regions with opposing normals
  const planarRegions: Array<{
    indices: number[];
    normal: THREE.Vector3;
    centroid: THREE.Vector3;
    verts: THREE.Vector3[];
  }> = [];

  for (const region of regions) {
    const normals = collectNormals(faces, region);
    const avgNormal = new THREE.Vector3();
    for (const n of normals) avgNormal.add(n);
    avgNormal.normalize();

    // Check planarity
    let variance = 0;
    for (const n of normals) variance += 1 - Math.abs(n.dot(avgNormal));
    variance /= normals.length;
    if (variance > 0.02) continue;

    const verts = collectVertices(faces, region);
    const centroid = new THREE.Vector3();
    for (const v of verts) centroid.add(v);
    centroid.divideScalar(verts.length);

    planarRegions.push({ indices: region, normal: avgNormal, centroid, verts });
  }

  // Match opposing-normal pairs
  const used = new Set<number>();
  for (let i = 0; i < planarRegions.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < planarRegions.length; j++) {
      if (used.has(j)) continue;

      const dot = planarRegions[i].normal.dot(planarRegions[j].normal);
      if (dot > -0.95) continue; // Not opposing

      const direction = new THREE.Vector3()
        .subVectors(planarRegions[j].centroid, planarRegions[i].centroid);
      const depth = direction.length();
      if (depth < 1e-6) continue;
      direction.normalize();

      // Verify direction is aligned with the face normal
      if (Math.abs(direction.dot(planarRegions[i].normal)) < 0.9) continue;

      // Extract 2D profile from boundary of the first region
      const profile = extractBoundaryProfile(
        faces,
        planarRegions[i].indices,
        planarRegions[i].normal,
        planarRegions[i].centroid,
      );

      if (profile.length < 3) continue;

      // Build extrusion geometry
      const extGeo = buildExtrusionGeometry(profile, direction, depth, planarRegions[i].centroid, planarRegions[i].normal);

      features.push({ profile, direction, depth, geometry: extGeo });
      used.add(i);
      used.add(j);
      break;
    }
  }

  return features;
}

/** Extract boundary edges of a face region and project to 2D profile. */
function extractBoundaryProfile(
  faces: FaceData[],
  regionIndices: number[],
  normal: THREE.Vector3,
  centroid: THREE.Vector3,
): THREE.Vector2[] {
  // Collect edges; boundary edges appear only once
  const edgeCounts = new Map<string, { a: THREE.Vector3; b: THREE.Vector3 }>();
  const regionSet = new Set(regionIndices);

  for (const fi of regionIndices) {
    const f = faces[fi];
    const edges: [THREE.Vector3, THREE.Vector3][] = [
      [f.a, f.b], [f.b, f.c], [f.c, f.a],
    ];
    for (const [ea, eb] of edges) {
      const key = edgeKey(ea, eb);
      if (edgeCounts.has(key)) {
        edgeCounts.delete(key); // Internal edge — remove
      } else {
        edgeCounts.set(key, { a: ea.clone(), b: eb.clone() });
      }
    }
  }

  // Chain boundary edges into a loop
  const segments = Array.from(edgeCounts.values());
  if (segments.length === 0) return [];

  const loop = chainSegments(segments);

  // Project loop points to 2D
  const u = new THREE.Vector3();
  if (Math.abs(normal.x) < 0.9) u.crossVectors(new THREE.Vector3(1, 0, 0), normal).normalize();
  else u.crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  return loop.map(p => {
    const rel = new THREE.Vector3().subVectors(p, centroid);
    return new THREE.Vector2(rel.dot(u), rel.dot(v));
  });
}

/** Chain line segments into an ordered loop. */
function chainSegments(segments: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>): THREE.Vector3[] {
  if (segments.length === 0) return [];

  const eps = 1e-4;
  const remaining = segments.map((s, i) => ({ ...s, used: false, idx: i }));
  const loop: THREE.Vector3[] = [remaining[0].a.clone(), remaining[0].b.clone()];
  remaining[0].used = true;

  for (let iter = 0; iter < remaining.length; iter++) {
    const last = loop[loop.length - 1];
    let found = false;
    for (const seg of remaining) {
      if (seg.used) continue;
      if (seg.a.distanceTo(last) < eps) {
        loop.push(seg.b.clone());
        seg.used = true;
        found = true;
        break;
      } else if (seg.b.distanceTo(last) < eps) {
        loop.push(seg.a.clone());
        seg.used = true;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  return loop;
}

/** Build extrusion geometry by sweeping a 2D profile along a direction. */
function buildExtrusionGeometry(
  profile: THREE.Vector2[],
  direction: THREE.Vector3,
  depth: number,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.BufferGeometry {
  // Create a THREE.Shape from the profile
  const shape = new THREE.Shape();
  shape.moveTo(profile[0].x, profile[0].y);
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i].x, profile[i].y);
  }
  shape.closePath();

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth,
    bevelEnabled: false,
  };
  const extGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  // Align: the extrude geometry is along Z by default; rotate to match direction
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction.clone().normalize(),
  );
  extGeo.applyQuaternion(q);

  // Also rotate the profile plane: shape is on XY, needs to match the face normal plane
  const profileQ = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal.clone().normalize(),
  );
  // Combine rotations are already handled by direction alignment
  extGeo.translate(origin.x, origin.y, origin.z);

  return extGeo;
}

/**
 * Detect rotational (revolution) features.
 */
export function detectRotational(geo: THREE.BufferGeometry): RotationalFeature[] {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();

  const faces = extractFaces(g);
  if (faces.length === 0) return [];

  const features: RotationalFeature[] = [];

  // Collect all vertices
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const allVerts: THREE.Vector3[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    if (!seen.has(key)) { seen.add(key); allVerts.push(v); }
  }

  if (allVerts.length < 10) return features;

  // Test candidate axes: principal axes + covariance eigenvectors
  const centroid = new THREE.Vector3();
  for (const v of allVerts) centroid.add(v);
  centroid.divideScalar(allVerts.length);

  const candidateAxes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];

  for (const axis of candidateAxes) {
    const result = testRevolutionAxis(allVerts, centroid, axis);
    if (!result) continue;

    // Build the profile in the axis-radial plane
    const profile = extractRevolutionProfile(allVerts, centroid, axis);
    if (profile.length < 3) continue;

    // Build revolution geometry
    const revGeo = buildRevolutionGeometry(profile, centroid, axis, result.angle);

    features.push({
      axis: axis.clone(),
      center: centroid.clone(),
      profile,
      angle: result.angle,
      geometry: revGeo,
    });
  }

  return features;
}

/** Test whether vertices form a body of revolution around an axis. */
function testRevolutionAxis(
  verts: THREE.Vector3[],
  center: THREE.Vector3,
  axis: THREE.Vector3,
): { angle: number } | null {
  // For each vertex, compute (distance_along_axis, radial_distance)
  // Group by distance_along_axis; each group should have similar radial distance
  const bucketSize = 0.01;
  const buckets = new Map<number, number[]>();

  for (const v of verts) {
    const rel = new THREE.Vector3().subVectors(v, center);
    const along = rel.dot(axis);
    const radial = Math.sqrt(rel.lengthSq() - along * along);
    const key = Math.round(along / bucketSize);

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(radial);
  }

  // Check consistency: each bucket should have low variance in radial distance
  let totalVariance = 0;
  let totalBuckets = 0;

  for (const [, radials] of buckets) {
    if (radials.length < 3) continue;
    const mean = radials.reduce((s, r) => s + r, 0) / radials.length;
    if (mean < 1e-6) continue; // on-axis points
    let variance = 0;
    for (const r of radials) variance += ((r - mean) / mean) ** 2;
    variance /= radials.length;
    totalVariance += variance;
    totalBuckets++;
  }

  if (totalBuckets < 3) return null;
  totalVariance /= totalBuckets;

  if (totalVariance > 0.01) return null;

  // Estimate angle coverage
  const u = new THREE.Vector3();
  if (Math.abs(axis.x) < 0.9) u.crossVectors(new THREE.Vector3(1, 0, 0), axis).normalize();
  else u.crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();

  let minAngle = Infinity, maxAngle = -Infinity;
  for (const vert of verts) {
    const rel = new THREE.Vector3().subVectors(vert, center);
    const pu = rel.dot(u);
    const pv = rel.dot(v);
    if (Math.abs(pu) < 1e-6 && Math.abs(pv) < 1e-6) continue;
    const angle = Math.atan2(pv, pu);
    if (angle < minAngle) minAngle = angle;
    if (angle > maxAngle) maxAngle = angle;
  }

  const coverage = maxAngle - minAngle;
  // If coverage is close to 2*PI, it's a full revolution
  const angleDeg = coverage > Math.PI * 1.8 ? 360 : (coverage * 180) / Math.PI;

  return { angle: angleDeg };
}

/** Extract the 2D revolution profile (along-axis vs radial distance). */
function extractRevolutionProfile(
  verts: THREE.Vector3[],
  center: THREE.Vector3,
  axis: THREE.Vector3,
): THREE.Vector2[] {
  const points: Array<{ t: number; r: number }> = [];

  for (const v of verts) {
    const rel = new THREE.Vector3().subVectors(v, center);
    const t = rel.dot(axis);
    const r = Math.sqrt(rel.lengthSq() - t * t);
    points.push({ t, r });
  }

  // Sort by t and deduplicate
  points.sort((a, b) => a.t - b.t);

  // Bin by t and average r
  const binSize = 0.005;
  const profile: THREE.Vector2[] = [];
  let i = 0;
  while (i < points.length) {
    const tStart = points[i].t;
    let sumT = 0, sumR = 0, count = 0;
    while (i < points.length && points[i].t - tStart < binSize) {
      sumT += points[i].t;
      sumR += points[i].r;
      count++;
      i++;
    }
    profile.push(new THREE.Vector2(sumT / count, sumR / count));
  }

  return profile;
}

/** Build revolution geometry from a profile using LatheGeometry. */
function buildRevolutionGeometry(
  profile: THREE.Vector2[],
  center: THREE.Vector3,
  axis: THREE.Vector3,
  angleDeg: number,
): THREE.BufferGeometry {
  // LatheGeometry revolves around Y axis, so profile is (r, y) = (x, y) in Vector2
  // Profile: Vector2(radius, height)
  const lathePoints = profile.map(p => new THREE.Vector2(p.y, p.x)); // (r, along_axis)

  const segments = 64;
  const phiLength = (angleDeg * Math.PI) / 180;
  const latheGeo = new THREE.LatheGeometry(lathePoints, segments, 0, phiLength);

  // Align so that the lathe Y axis maps to our revolution axis
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    axis.clone().normalize(),
  );
  latheGeo.applyQuaternion(q);
  latheGeo.translate(center.x, center.y, center.z);

  return latheGeo;
}

/**
 * Auto-surface fitting: segment the mesh and fit analytic surfaces where possible.
 */
export function autoSurface(
  geo: THREE.BufferGeometry,
  tolerance = 0.01,
): SurfacePatch[] {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();

  const faces = extractFaces(g);
  if (faces.length === 0) return [];

  const adj = buildAdjacency(faces, g);
  const regions = regionGrow(faces, adj, 15);
  const patches: SurfacePatch[] = [];

  for (const region of regions) {
    const verts = collectVertices(faces, region);
    const normals = collectNormals(faces, region);
    if (verts.length < 3) continue;

    const subGeo = buildSubGeometry(faces, region);

    // Try planar fit
    const planeRes = fitPlane(verts);
    if (planeRes.error < tolerance) {
      patches.push({
        type: 'planar',
        faceIndices: [...region],
        geometry: subGeo,
        error: planeRes.error,
      });
      continue;
    }

    // Try sphere fit
    const sphereRes = fitSphere(verts);
    if (sphereRes && sphereRes.error < tolerance) {
      patches.push({
        type: 'spherical',
        faceIndices: [...region],
        geometry: subGeo,
        error: sphereRes.error,
      });
      continue;
    }

    // Try cylinder fit
    const cylRes = fitCylinder(verts, normals);
    if (cylRes && cylRes.error < tolerance) {
      patches.push({
        type: 'cylindrical',
        faceIndices: [...region],
        geometry: subGeo,
        error: cylRes.error,
      });
      continue;
    }

    // Try cone fit (reuse cylinder axis fitting with radius variation check)
    if (verts.length >= 6) {
      const coneCandidate = tryFitCone(verts, normals, faces, region);
      if (coneCandidate && coneCandidate.confidence > 0.5) {
        // Re-estimate error for cone
        const centroid = new THREE.Vector3();
        for (const v of verts) centroid.add(v);
        centroid.divideScalar(verts.length);

        let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
        for (const n of normals) {
          xx += n.x * n.x; xy += n.x * n.y; xz += n.x * n.z;
          yy += n.y * n.y; yz += n.y * n.z; zz += n.z * n.z;
        }
        const axis = smallestEigenvector3x3(xx, xy, xz, yy, yz, zz).normalize();

        const projected: Array<{ t: number; r: number }> = [];
        for (const v of verts) {
          const rel = new THREE.Vector3().subVectors(v, centroid);
          const t = rel.dot(axis);
          const radial = Math.sqrt(rel.lengthSq() - t * t);
          projected.push({ t, r: radial });
        }

        const n = projected.length;
        let sumT = 0, sumR = 0, sumTT = 0, sumTR = 0;
        for (const p of projected) {
          sumT += p.t; sumR += p.r; sumTT += p.t * p.t; sumTR += p.t * p.r;
        }
        const detLR = n * sumTT - sumT * sumT;
        if (Math.abs(detLR) > 1e-12) {
          const a = (n * sumTR - sumT * sumR) / detLR;
          const b = (sumR - a * sumT) / n;

          let coneError = 0;
          for (const p of projected) {
            const expectedR = a * p.t + b;
            coneError += (p.r - expectedR) ** 2;
          }
          coneError = Math.sqrt(coneError / n);

          if (coneError < tolerance) {
            patches.push({
              type: 'conical',
              faceIndices: [...region],
              geometry: subGeo,
              error: coneError,
            });
            continue;
          }
        }
      }
    }

    // Fallback: freeform
    patches.push({
      type: 'freeform',
      faceIndices: [...region],
      geometry: subGeo,
      error: planeRes.error, // best analytic error as reference
    });
  }

  return patches;
}

/**
 * Compute a cross-section of a mesh by intersecting all triangles with a plane.
 */
export function computeCrossSection(
  geo: THREE.BufferGeometry,
  plane: THREE.Plane,
): CrossSection {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const faces = extractFaces(g);

  // Intersect each triangle with the plane, collecting line segments
  const segments: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];

  for (const face of faces) {
    const triVerts = [face.a, face.b, face.c];
    const dists = triVerts.map(v => plane.distanceToPoint(v));

    // Collect intersection points where the plane crosses triangle edges
    const intersections: THREE.Vector3[] = [];

    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const di = dists[i];
      const dj = dists[j];

      // If the edge crosses the plane (signs differ) or one endpoint is on the plane
      if (di * dj < 0) {
        // Edge crosses the plane
        const t = di / (di - dj);
        const p = new THREE.Vector3().lerpVectors(triVerts[i], triVerts[j], t);
        intersections.push(p);
      } else if (Math.abs(di) < 1e-8) {
        // Vertex i is on the plane
        intersections.push(triVerts[i].clone());
      }
    }

    // Also check if vertex 2 is on the plane (loop above only checks vertex 0 and 1 as 'i')
    // Actually, vertex 2 is checked when i=2, j=0 — but its di check is at index 2
    // The loop covers i=0,1,2 so all vertices' on-plane cases are handled.

    // Deduplicate very close points
    const unique: THREE.Vector3[] = [];
    for (const p of intersections) {
      let dup = false;
      for (const u of unique) {
        if (p.distanceTo(u) < 1e-8) { dup = true; break; }
      }
      if (!dup) unique.push(p);
    }

    if (unique.length === 2) {
      segments.push({ a: unique[0], b: unique[1] });
    }
  }

  // Chain segments into contours
  const contours = chainAllSegments(segments);

  // Compute area for each contour
  let totalArea = 0;
  for (const contour of contours) {
    totalArea += computePolygonArea3D(contour, plane.normal);
  }

  return { plane: plane.clone(), contours, area: totalArea };
}

/** Chain all segments into multiple contour loops. */
function chainAllSegments(
  segments: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>,
): THREE.Vector3[][] {
  const contours: THREE.Vector3[][] = [];
  const used = new Array(segments.length).fill(false);
  const eps = 1e-4;

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;

    const loop: THREE.Vector3[] = [segments[start].a.clone(), segments[start].b.clone()];

    let changed = true;
    while (changed) {
      changed = false;
      const last = loop[loop.length - 1];

      // Check if loop is closed
      if (loop.length > 2 && last.distanceTo(loop[0]) < eps) {
        break;
      }

      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        if (segments[i].a.distanceTo(last) < eps) {
          loop.push(segments[i].b.clone());
          used[i] = true;
          changed = true;
          break;
        } else if (segments[i].b.distanceTo(last) < eps) {
          loop.push(segments[i].a.clone());
          used[i] = true;
          changed = true;
          break;
        }
      }
    }

    if (loop.length >= 3) contours.push(loop);
  }

  return contours;
}

/** Compute the area of a 3D polygon using the shoelace formula projected along the normal. */
function computePolygonArea3D(points: THREE.Vector3[], normal: THREE.Vector3): number {
  if (points.length < 3) return 0;

  // Use the cross product method for 3D polygon area
  const total = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const cross = new THREE.Vector3().crossVectors(points[i], points[j]);
    total.add(cross);
  }

  return Math.abs(total.dot(normal.clone().normalize())) / 2;
}
