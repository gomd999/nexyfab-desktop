import * as THREE from 'three';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type CurvatureMode =
  | 'gaussian'
  | 'mean'
  | 'max_principal'
  | 'min_principal'
  | 'zebra'
  | 'draft';

export interface CurvatureData {
  gaussian: Float32Array;
  mean: Float32Array;
  maxPrincipal: Float32Array;
  minPrincipal: Float32Array;
}

export interface SurfaceQualityStats {
  minGaussian: number;
  maxGaussian: number;
  avgGaussian: number;
  minMean: number;
  maxMean: number;
  avgMean: number;
  flatFacePercent: number;
  sharpEdgeCount: number;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/** Build adjacency: for every vertex, collect the face indices it belongs to */
function buildVertexFaceAdjacency(
  index: THREE.BufferAttribute | null,
  posCount: number,
  faceCount: number,
): number[][] {
  const adj: number[][] = Array.from({ length: posCount }, () => []);
  for (let f = 0; f < faceCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    adj[i0].push(f);
    adj[i1].push(f);
    adj[i2].push(f);
  }
  return adj;
}

/** Build adjacency: for every vertex, collect its 1-ring neighbor vertex indices */
function buildVertexNeighbors(
  index: THREE.BufferAttribute | null,
  posCount: number,
  faceCount: number,
): Set<number>[] {
  const neighbors: Set<number>[] = Array.from({ length: posCount }, () => new Set());
  for (let f = 0; f < faceCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    neighbors[i0].add(i1); neighbors[i0].add(i2);
    neighbors[i1].add(i0); neighbors[i1].add(i2);
    neighbors[i2].add(i0); neighbors[i2].add(i1);
  }
  return neighbors;
}

/** Compute face normals and cache them */
function computeFaceNormals(
  pos: THREE.BufferAttribute,
  index: THREE.BufferAttribute | null,
  faceCount: number,
): THREE.Vector3[] {
  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    normals.push(new THREE.Vector3().crossVectors(ab, ac).normalize());
  }
  return normals;
}

/** Cotangent of the angle at vertex C in triangle ABC */
function cotAngle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ca = new THREE.Vector3().subVectors(a, c);
  const cb = new THREE.Vector3().subVectors(b, c);
  const cross = new THREE.Vector3().crossVectors(ca, cb);
  const dot = ca.dot(cb);
  const sinVal = cross.length();
  return sinVal < 1e-12 ? 0 : dot / sinVal;
}

/* ─── Curvature Computation ──────────────────────────────────────────────── */

/**
 * Estimate per-vertex curvature using:
 * - Angle deficit method for Gaussian curvature
 * - Cotangent weights for mean curvature (Laplace-Beltrami)
 * - Principal curvatures derived from Gaussian and mean
 */
export function computeVertexCurvature(geometry: THREE.BufferGeometry): CurvatureData {
  const geo = geometry.index ? geometry : geometry.toNonIndexed();
  // Ensure we have indexed geometry for adjacency; if not, create index
  if (!geo.index) {
    const posCount = geo.attributes.position.count;
    const indices = new Uint32Array(posCount);
    for (let i = 0; i < posCount; i++) indices[i] = i;
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index!;
  const vertCount = pos.count;
  const faceCount = idx.count / 3;

  const gaussian = new Float32Array(vertCount);
  const mean = new Float32Array(vertCount);
  const maxPrincipal = new Float32Array(vertCount);
  const minPrincipal = new Float32Array(vertCount);

  // Initialize Gaussian curvature with 2π (full angle for interior vertex)
  for (let i = 0; i < vertCount; i++) gaussian[i] = 2 * Math.PI;

  // Per-vertex mixed area (Voronoi region area)
  const mixedArea = new Float32Array(vertCount);

  // Accumulate mean curvature via cotangent Laplacian
  const laplacian: THREE.Vector3[] = Array.from({ length: vertCount }, () => new THREE.Vector3());

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();

  for (let f = 0; f < faceCount; f++) {
    const iA = idx.getX(f * 3);
    const iB = idx.getX(f * 3 + 1);
    const iC = idx.getX(f * 3 + 2);

    pA.fromBufferAttribute(pos, iA);
    pB.fromBufferAttribute(pos, iB);
    pC.fromBufferAttribute(pos, iC);

    // Edges
    const ab = new THREE.Vector3().subVectors(pB, pA);
    const ac = new THREE.Vector3().subVectors(pC, pA);
    const bc = new THREE.Vector3().subVectors(pC, pB);

    // Face area
    const crossVec = new THREE.Vector3().crossVectors(ab, ac);
    const area = crossVec.length() * 0.5;
    if (area < 1e-12) continue;

    // Angles at each vertex
    const angleA = ab.angleTo(ac);
    const angleB = new THREE.Vector3().subVectors(pA, pB).angleTo(bc);
    const angleC = Math.PI - angleA - angleB;

    // Subtract angles from 2π for Gaussian curvature (angle deficit)
    gaussian[iA] -= angleA;
    gaussian[iB] -= angleB;
    gaussian[iC] -= angleC;

    // Mixed area contribution (1/3 of triangle area per vertex — simplified Voronoi)
    const areaThird = area / 3;
    mixedArea[iA] += areaThird;
    mixedArea[iB] += areaThird;
    mixedArea[iC] += areaThird;

    // Cotangent weights for Laplace-Beltrami mean curvature
    const cotA = cotAngle(pB, pC, pA);
    const cotB = cotAngle(pA, pC, pB);
    const cotC = cotAngle(pA, pB, pC);

    // Accumulate: Σ (cotα + cotβ)(pj - pi) for each edge
    const edgeAB = new THREE.Vector3().subVectors(pB, pA);
    const edgeBA = new THREE.Vector3().subVectors(pA, pB);
    const edgeBC = new THREE.Vector3().subVectors(pC, pB);
    const edgeCB = new THREE.Vector3().subVectors(pB, pC);
    const edgeAC = new THREE.Vector3().subVectors(pC, pA);
    const edgeCA = new THREE.Vector3().subVectors(pA, pC);

    // Edge AB: opposite vertex C → weight cotC
    laplacian[iA].add(edgeAB.clone().multiplyScalar(cotC));
    laplacian[iB].add(edgeBA.clone().multiplyScalar(cotC));

    // Edge BC: opposite vertex A → weight cotA
    laplacian[iB].add(edgeBC.clone().multiplyScalar(cotA));
    laplacian[iC].add(edgeCB.clone().multiplyScalar(cotA));

    // Edge AC: opposite vertex B → weight cotB
    laplacian[iA].add(edgeAC.clone().multiplyScalar(cotB));
    laplacian[iC].add(edgeCA.clone().multiplyScalar(cotB));
  }

  // Normalize by area
  for (let i = 0; i < vertCount; i++) {
    const a = Math.max(mixedArea[i], 1e-12);
    gaussian[i] /= a;
    // Mean curvature = 0.5 * |Laplacian| / area
    mean[i] = 0.5 * laplacian[i].length() / (2 * a);

    // Principal curvatures from H and K:
    // H = (k1 + k2) / 2,  K = k1 * k2
    // k1 = H + sqrt(H² - K),  k2 = H - sqrt(H² - K)
    const H = mean[i];
    const K = gaussian[i];
    const disc = Math.max(H * H - K, 0);
    const sqrtDisc = Math.sqrt(disc);
    maxPrincipal[i] = H + sqrtDisc;
    minPrincipal[i] = H - sqrtDisc;
  }

  return { gaussian, mean, maxPrincipal, minPrincipal };
}

/* ─── Colormap Application ───────────────────────────────────────────────── */

/**
 * Apply blue → green → red colormap to vertex colors based on scalar values.
 * Values are normalized to [0, 1] range within the data.
 */
export function applyCurvatureColormap(
  geometry: THREE.BufferGeometry,
  values: Float32Array,
  _mode: string,
): void {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);

  // Find data range
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < vMin) vMin = values[i];
    if (values[i] > vMax) vMax = values[i];
  }
  const range = vMax - vMin || 1;

  for (let i = 0; i < count; i++) {
    const val = i < values.length ? values[i] : 0;
    const t = (val - vMin) / range; // 0..1

    // Blue (0,0,1) → Green (0,1,0) → Red (1,0,0)
    let r: number, g: number, b: number;
    if (t < 0.5) {
      const s = t * 2; // 0..1
      r = 0;
      g = s;
      b = 1 - s;
    } else {
      const s = (t - 0.5) * 2; // 0..1
      r = s;
      g = 1 - s;
      b = 0;
    }

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/* ─── Zebra Stripes ──────────────────────────────────────────────────────── */

/**
 * Apply zebra stripe pattern for surface continuity analysis.
 * Stripes are computed based on the reflection of an infinite environment
 * of alternating black/white bands on the surface normals.
 */
export function applyZebraStripes(
  geometry: THREE.BufferGeometry,
  stripeCount: number = 8,
): void {
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);

  // Use a fixed view direction for consistent results
  const viewDir = new THREE.Vector3(0, 0, 1).normalize();

  for (let i = 0; i < count; i++) {
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);

    // Reflection vector: R = 2(N·V)N - V
    const dot = nx * viewDir.x + ny * viewDir.y + nz * viewDir.z;
    const ry = 2 * dot * ny - viewDir.y;

    // Map reflected y to stripe pattern
    const stripe = Math.sin(ry * Math.PI * stripeCount);
    const brightness = stripe > 0 ? 0.95 : 0.15;

    colors[i * 3] = brightness;
    colors[i * 3 + 1] = brightness;
    colors[i * 3 + 2] = brightness;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/* ─── Draft Analysis ─────────────────────────────────────────────────────── */

/**
 * Color faces based on draft angle relative to a pull direction.
 * Green = good draft (angle > minAngle + margin)
 * Yellow = marginal (within margin of minAngle)
 * Red = undercut (angle < minAngle)
 */
export function applyDraftAnalysis(
  geometry: THREE.BufferGeometry,
  pullDirection: THREE.Vector3,
  minAngle: number = 3, // degrees
): void {
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);

  const pull = pullDirection.clone().normalize();
  const minRad = (minAngle * Math.PI) / 180;
  const marginRad = (2 * Math.PI) / 180; // 2° margin for yellow zone

  for (let i = 0; i < count; i++) {
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);

    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const dot = Math.abs(n.dot(pull));
    // Draft angle = 90° - angle between normal and pull direction
    const angle = Math.acos(Math.min(dot, 1));
    const draftAngle = Math.PI / 2 - angle;

    let r: number, g: number, b: number;
    if (draftAngle >= minRad + marginRad) {
      // Good draft — green
      r = 0.2; g = 0.85; b = 0.3;
    } else if (draftAngle >= minRad) {
      // Marginal — yellow
      r = 0.95; g = 0.85; b = 0.2;
    } else {
      // Undercut — red
      r = 0.95; g = 0.2; b = 0.2;
    }

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/* ─── Statistics ─────────────────────────────────────────────────────────── */

/**
 * Compute summary statistics from curvature arrays.
 */
export function getSurfaceQualityStats(
  gaussian: Float32Array,
  mean: Float32Array,
): SurfaceQualityStats {
  let minG = Infinity, maxG = -Infinity, sumG = 0;
  let minM = Infinity, maxM = -Infinity, sumM = 0;
  let flatCount = 0;
  const n = gaussian.length;

  const flatThreshold = 1e-4; // near-zero curvature → flat
  const sharpThreshold = 5.0; // high mean curvature → sharp edge

  let sharpEdgeCount = 0;

  for (let i = 0; i < n; i++) {
    const g = gaussian[i];
    const m = mean[i];

    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    sumG += g;

    if (m < minM) minM = m;
    if (m > maxM) maxM = m;
    sumM += m;

    if (Math.abs(g) < flatThreshold && Math.abs(m) < flatThreshold) {
      flatCount++;
    }
    if (Math.abs(m) > sharpThreshold) {
      sharpEdgeCount++;
    }
  }

  return {
    minGaussian: n > 0 ? minG : 0,
    maxGaussian: n > 0 ? maxG : 0,
    avgGaussian: n > 0 ? sumG / n : 0,
    minMean: n > 0 ? minM : 0,
    maxMean: n > 0 ? maxM : 0,
    avgMean: n > 0 ? sumM / n : 0,
    flatFacePercent: n > 0 ? (flatCount / n) * 100 : 0,
    sharpEdgeCount,
  };
}
