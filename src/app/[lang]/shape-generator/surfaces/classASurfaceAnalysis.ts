/**
 * classASurfaceAnalysis.ts — Class-A surface inspection: zebra
 * stripe, curvature comb, Gaussian / mean / principal curvature,
 * reflection map.
 *
 * Class-A surfaces are used in automotive exteriors, product styling,
 * and aerospace — anywhere the surface itself is the design.
 * Designers check them with optical tools that detect the slightest
 * inflection:
 *
 *   - **Zebra stripe** — render alternating stripes from a distant
 *     virtual light. Discontinuities show up as broken zebra lines.
 *   - **Curvature comb** — at sample points along a curve, draw a
 *     perpendicular line proportional to curvature. C2-continuous
 *     curves have a smooth comb; C1 (tangent-only) shows kinks.
 *   - **Gaussian curvature** K = κ₁·κ₂ — positive (dome) / negative
 *     (saddle) / zero (developable).
 *   - **Mean curvature** H = (κ₁+κ₂)/2 — used for soap-film design.
 *   - **Principal curvatures** κ₁, κ₂ — max + min normal curvatures.
 *   - **Reflection map** — sample a virtual chrome HDR environment,
 *     showing how reflections would distort across the surface.
 *
 * Output is per-vertex scalar arrays the renderer maps to color or
 * geometry overlays.
 */

export interface SurfaceMesh {
  positions: number[];
  indices: number[];
  normals?: number[];
}

// ── Vector helpers ─────────────────────────────────────────────────

function dot(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return ax * bx + ay * by + az * bz;
}

function getVert(mesh: SurfaceMesh, i: number): [number, number, number] {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

// ── Vertex normals (when not supplied) ──────────────────────────

export function computeVertexNormals(mesh: SurfaceMesh): number[] {
  const vCount = mesh.positions.length / 3;
  const out = new Array(vCount * 3).fill(0);
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const [ax, ay, az] = getVert(mesh, i0);
    const [bx, by, bz] = getVert(mesh, i1);
    const [cx, cy, cz] = getVert(mesh, i2);
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = cx - ax, fy = cy - ay, fz = cz - az;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    for (const idx of [i0, i1, i2]) {
      out[idx * 3]     += nx;
      out[idx * 3 + 1] += ny;
      out[idx * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < vCount; i++) {
    const nx = out[i * 3]!;
    const ny = out[i * 3 + 1]!;
    const nz = out[i * 3 + 2]!;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[i * 3]     = nx / len;
    out[i * 3 + 1] = ny / len;
    out[i * 3 + 2] = nz / len;
  }
  return out;
}

// ── Curvature (Gaussian + mean + principal) ─────────────────────

export interface CurvatureResult {
  /** Per-vertex Gaussian curvature K = κ₁·κ₂. */
  gaussian: number[];
  /** Per-vertex mean curvature H = (κ₁+κ₂)/2. */
  mean: number[];
  /** Per-vertex max principal curvature κ₁. */
  k1: number[];
  /** Per-vertex min principal curvature κ₂. */
  k2: number[];
}

/** Compute per-vertex Gaussian curvature via angle defect + mean
 *  curvature via Laplace-Beltrami. Returns principal curvatures
 *  from solving κ² − 2Hκ + K = 0. */
export function computeCurvature(mesh: SurfaceMesh): CurvatureResult {
  const vCount = mesh.positions.length / 3;
  const angleSum = new Array(vCount).fill(0);
  const areaSum = new Array(vCount).fill(0);
  const laplaceX = new Array(vCount).fill(0);
  const laplaceY = new Array(vCount).fill(0);
  const laplaceZ = new Array(vCount).fill(0);
  const normals = mesh.normals ?? computeVertexNormals(mesh);

  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const i0 = mesh.indices[t * 3]!;
    const i1 = mesh.indices[t * 3 + 1]!;
    const i2 = mesh.indices[t * 3 + 2]!;
    const [ax, ay, az] = getVert(mesh, i0);
    const [bx, by, bz] = getVert(mesh, i1);
    const [cx, cy, cz] = getVert(mesh, i2);
    // Edge lengths.
    const lab = Math.hypot(bx - ax, by - ay, bz - az);
    const lbc = Math.hypot(cx - bx, cy - by, cz - bz);
    const lca = Math.hypot(ax - cx, ay - cy, az - cz);
    if (lab === 0 || lbc === 0 || lca === 0) continue;
    // Triangle angles by law of cosines.
    const cosA = Math.max(-1, Math.min(1, (lab * lab + lca * lca - lbc * lbc) / (2 * lab * lca)));
    const cosB = Math.max(-1, Math.min(1, (lab * lab + lbc * lbc - lca * lca) / (2 * lab * lbc)));
    const cosC = Math.max(-1, Math.min(1, (lbc * lbc + lca * lca - lab * lab) / (2 * lbc * lca)));
    angleSum[i0] += Math.acos(cosA);
    angleSum[i1] += Math.acos(cosB);
    angleSum[i2] += Math.acos(cosC);
    // Triangle area.
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area = Math.hypot(nx, ny, nz) / 2;
    areaSum[i0] += area / 3;
    areaSum[i1] += area / 3;
    areaSum[i2] += area / 3;
    // Cotangent weights for Laplace-Beltrami.
    const cotA = cosA / Math.sin(Math.acos(cosA));
    const cotB = cosB / Math.sin(Math.acos(cosB));
    const cotC = cosC / Math.sin(Math.acos(cosC));
    // For edge bc (opposite i0): weight = cotA / 2.
    // L · p_i0 += w · (p_neighbour - p_i0).
    const wBC = cotA / 2;
    laplaceX[i1] += wBC * (cx - bx);
    laplaceY[i1] += wBC * (cy - by);
    laplaceZ[i1] += wBC * (cz - bz);
    laplaceX[i2] += wBC * (bx - cx);
    laplaceY[i2] += wBC * (by - cy);
    laplaceZ[i2] += wBC * (bz - cz);
    const wCA = cotB / 2;
    laplaceX[i2] += wCA * (ax - cx);
    laplaceY[i2] += wCA * (ay - cy);
    laplaceZ[i2] += wCA * (az - cz);
    laplaceX[i0] += wCA * (cx - ax);
    laplaceY[i0] += wCA * (cy - ay);
    laplaceZ[i0] += wCA * (cz - az);
    const wAB = cotC / 2;
    laplaceX[i0] += wAB * (bx - ax);
    laplaceY[i0] += wAB * (by - ay);
    laplaceZ[i0] += wAB * (bz - az);
    laplaceX[i1] += wAB * (ax - bx);
    laplaceY[i1] += wAB * (ay - by);
    laplaceZ[i1] += wAB * (az - bz);
  }

  const gaussian = new Array(vCount).fill(0);
  const mean = new Array(vCount).fill(0);
  const k1 = new Array(vCount).fill(0);
  const k2 = new Array(vCount).fill(0);
  for (let i = 0; i < vCount; i++) {
    const A = areaSum[i]!;
    // Degenerate vertex (isolated / pole-duplicate / seam): area collapses, so
    // the 1/A curvature would blow up. Curvature is undefined there → report 0
    // rather than a spurious ~1/ε spike.
    if (!(A > 1e-12)) { gaussian[i] = 0; mean[i] = 0; k1[i] = 0; k2[i] = 0; continue; }
    gaussian[i] = (2 * Math.PI - angleSum[i]) / A;
    // Discrete mean-curvature normal (Meyer 2003):
    //   K⃗ = (1/2A) Σ(cotα+cotβ)(x_i−x_j) = 2·H·n̂ ⇒ H = ½|K⃗|.
    // The cotangent sum accumulated in laplace[] already carries the inner ½
    // (cot/2 per triangle), so laplace = Σ((cotα+cotβ)/2)(x_j−x_i) and
    // |laplace|/(2A) = H directly — no extra ÷2 (that was halving H).
    const lx = laplaceX[i]! / (2 * A);
    const ly = laplaceY[i]! / (2 * A);
    const lz = laplaceZ[i]! / (2 * A);
    const sign = Math.sign(dot(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!, lx, ly, lz));
    mean[i] = (sign || 1) * Math.hypot(lx, ly, lz);
    // Principal curvatures from κ² - 2Hκ + K = 0.
    const disc = Math.max(0, mean[i] ** 2 - gaussian[i]);
    const sqrtDisc = Math.sqrt(disc);
    k1[i] = mean[i] + sqrtDisc;
    k2[i] = mean[i] - sqrtDisc;
  }
  return { gaussian, mean, k1, k2 };
}

// ── Zebra stripe analysis ───────────────────────────────────────

export interface ZebraOptions {
  /** Number of stripe bands. Higher = denser zebra. */
  bandCount: number;
  /** Light direction (unit vector). */
  lightDirection: [number, number, number];
}

/** Per-vertex stripe value 0 or 1 — interleaving alternating bands
 *  based on the dot of vertex normal with a virtual horizon. */
export function zebraStripes(mesh: SurfaceMesh, options: ZebraOptions): Uint8Array {
  const vCount = mesh.positions.length / 3;
  const normals = mesh.normals ?? computeVertexNormals(mesh);
  const out = new Uint8Array(vCount);
  const ld = options.lightDirection;
  for (let i = 0; i < vCount; i++) {
    const d = dot(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!, ld[0], ld[1], ld[2]);
    // Map d ∈ [-1, 1] → angle ∈ [0, π] → stripe index.
    const stripeIdx = Math.floor((Math.acos(d) / Math.PI) * options.bandCount);
    out[i] = stripeIdx % 2;
  }
  return out;
}

// ── Curvature comb ──────────────────────────────────────────────

export interface CurvaturePoint {
  /** Sample point on the curve. */
  position: [number, number, number];
  /** Tangent (unit). */
  tangent: [number, number, number];
  /** Normal (unit, perpendicular to tangent in the curve's normal plane). */
  normal: [number, number, number];
  /** Curvature value (1/mm). */
  curvature: number;
}

export interface CurvatureCombResult {
  /** Per-point comb endpoint: position + normal × scaledCurvature. */
  combEndpoints: Array<[number, number, number]>;
  /** Per-point scaled curvature (for color). */
  scaledValues: number[];
  /** Max curvature observed (for scaling). */
  maxCurvature: number;
}

/** Build the curvature comb from a sampled curve. The comb's spike
 *  length is curvature × `scale`, with all spikes pointing along the
 *  curve normal. */
export function curvatureComb(curve: CurvaturePoint[], scale: number = 50): CurvatureCombResult {
  const ends: CurvatureCombResult['combEndpoints'] = [];
  const vals: number[] = [];
  let maxK = 0;
  for (const p of curve) {
    const k = Math.abs(p.curvature);
    if (k > maxK) maxK = k;
    const ext = k * scale;
    ends.push([
      p.position[0] + p.normal[0] * ext,
      p.position[1] + p.normal[1] * ext,
      p.position[2] + p.normal[2] * ext,
    ]);
    vals.push(k);
  }
  return { combEndpoints: ends, scaledValues: vals, maxCurvature: maxK };
}

// ── Reflection map ──────────────────────────────────────────────

export interface ReflectionMapOptions {
  /** Camera position (the viewer). */
  cameraPosition: [number, number, number];
  /** Number of latitude/longitude bins in the spherical env map. */
  resolutionU: number;
  resolutionV: number;
}

/** Per-vertex (u, v) coordinate in the spherical env map computed by
 *  reflecting the view direction about the surface normal. */
export interface ReflectionMapResult {
  /** Flat array of (u, v) pairs — length = 2 × vertexCount. */
  uv: number[];
}

export function reflectionMap(mesh: SurfaceMesh, options: ReflectionMapOptions): ReflectionMapResult {
  const vCount = mesh.positions.length / 3;
  const normals = mesh.normals ?? computeVertexNormals(mesh);
  const uv: number[] = new Array(vCount * 2);
  const cam = options.cameraPosition;
  for (let i = 0; i < vCount; i++) {
    const [px, py, pz] = getVert(mesh, i);
    const nx = normals[i * 3]!, ny = normals[i * 3 + 1]!, nz = normals[i * 3 + 2]!;
    // View direction from vertex to camera.
    const vx = cam[0] - px, vy = cam[1] - py, vz = cam[2] - pz;
    const vLen = Math.hypot(vx, vy, vz) || 1;
    const vxN = vx / vLen, vyN = vy / vLen, vzN = vz / vLen;
    // Reflect view about normal: R = 2·(N·V)·N - V.
    const d = 2 * (nx * vxN + ny * vyN + nz * vzN);
    const rx = d * nx - vxN;
    const ry = d * ny - vyN;
    const rz = d * nz - vzN;
    // Map reflection vector → (u, v) on environment sphere.
    const phi = Math.atan2(ry, rx); // -π..π
    const theta = Math.acos(Math.max(-1, Math.min(1, rz))); // 0..π
    uv[i * 2]     = (phi + Math.PI) / (Math.PI * 2);
    uv[i * 2 + 1] = theta / Math.PI;
    void options.resolutionU; void options.resolutionV;
  }
  return { uv };
}

// ── Isoparametric curves (NURBS) ────────────────────────────────

export interface IsoCurveSample {
  position: [number, number, number];
  /** u or v parameter. */
  parameter: number;
}

/** Sample an isoparametric curve at fixed u (varying v) or fixed v
 *  (varying u). Caller supplies an evaluator for the surface. */
export function sampleIsoCurve(
  isoDirection: 'u' | 'v',
  fixedParam: number,
  evaluator: (u: number, v: number) => [number, number, number],
  samples: number = 32,
): IsoCurveSample[] {
  const out: IsoCurveSample[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const position = isoDirection === 'u'
      ? evaluator(fixedParam, t)
      : evaluator(t, fixedParam);
    out.push({ position, parameter: t });
  }
  return out;
}
