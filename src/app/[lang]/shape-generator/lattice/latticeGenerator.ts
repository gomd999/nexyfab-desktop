/**
 * latticeGenerator.ts — Internal lattice / infill structures.
 *
 * For 3D printing + light-weight design, the part interior is
 * replaced with a periodic lattice instead of solid. Two families:
 *
 *   - **Strut lattice** (cubic, octet, FCC, BCC): explicit
 *     beam-and-node structure.
 *   - **TPMS** (gyroid, Schwarz, diamond): triply periodic minimal
 *     surfaces — smooth, no stress concentrations.
 *
 * For preview, the lattice is generated as a sampled signed-distance
 * field that the renderer marches into triangles.
 */

export type LatticeType =
  | 'cubic'
  | 'octet'
  | 'bcc'
  | 'fcc'
  | 'gyroid'
  | 'schwarz'
  | 'diamond'
  | 'honeycomb';

export interface LatticeParams {
  type: LatticeType;
  /** Cell size in mm. */
  cellMm: number;
  /** Solid fraction (0.0 = empty, 1.0 = fully solid). */
  density: number;
  /** Strut radius (mm) for strut lattices. */
  strutRadiusMm?: number;
  /** Bounding region (mm). */
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

/** Signed distance field (negative inside, positive outside). */
export function latticeDistance(
  params: LatticeParams,
  x: number, y: number, z: number,
): number {
  const c = params.cellMm;
  const ux = (x / c) * Math.PI * 2;
  const uy = (y / c) * Math.PI * 2;
  const uz = (z / c) * Math.PI * 2;

  switch (params.type) {
    case 'gyroid': {
      // f(x,y,z) = sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x)
      // Iso-surface at f = threshold (density control).
      const f = Math.sin(ux) * Math.cos(uy)
              + Math.sin(uy) * Math.cos(uz)
              + Math.sin(uz) * Math.cos(ux);
      // Map density 0.5 → threshold 0 (50% volume).
      const threshold = (params.density - 0.5) * 1.5;
      return f - threshold;
    }
    case 'schwarz': {
      // Primitive Schwarz: cos(x) + cos(y) + cos(z) = 0
      const f = Math.cos(ux) + Math.cos(uy) + Math.cos(uz);
      const threshold = (params.density - 0.5) * 3;
      return f - threshold;
    }
    case 'diamond': {
      // Diamond TPMS: sin(x)sin(y)sin(z) + sin(x)cos(y)cos(z) + ...
      const sx = Math.sin(ux), sy = Math.sin(uy), sz = Math.sin(uz);
      const cx = Math.cos(ux), cy = Math.cos(uy), cz = Math.cos(uz);
      const f = sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
      const threshold = (params.density - 0.5) * 1.0;
      return f - threshold;
    }
    case 'cubic': {
      // Distance to nearest cubic strut.
      const r = (params.strutRadiusMm ?? c * 0.1);
      const dx = Math.min(modAbs(x, c), modAbs(y, c));
      const dy = Math.min(modAbs(y, c), modAbs(z, c));
      const dz = Math.min(modAbs(z, c), modAbs(x, c));
      return Math.min(dx, dy, dz) - r;
    }
    case 'octet':
    case 'bcc':
    case 'fcc':
    case 'honeycomb': {
      // Phase-3 starter: same simple-cubic SDF until full impl.
      const r = (params.strutRadiusMm ?? c * 0.08);
      const dx = modAbs(x, c);
      const dy = modAbs(y, c);
      const dz = modAbs(z, c);
      return Math.min(dx, dy, dz) - r;
    }
  }
}

function modAbs(v: number, c: number): number {
  return Math.min(((v % c) + c) % c, c - (((v % c) + c) % c));
}

/** Sample the lattice into a 3D grid — caller marches into
 *  triangles using marching-cubes. */
export function sampleLatticeGrid(
  params: LatticeParams,
  resolution: number,
): { sdf: Float32Array; dims: [number, number, number]; origin: [number, number, number]; step: number } {
  const { min, max } = params.bbox;
  const stepX = (max[0] - min[0]) / resolution;
  const stepY = (max[1] - min[1]) / resolution;
  const stepZ = (max[2] - min[2]) / resolution;
  const step = Math.min(stepX, stepY, stepZ);
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const sdf = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = min[0] + i * step;
        const y = min[1] + j * step;
        const z = min[2] + k * step;
        sdf[k * ny * nx + j * nx + i] = latticeDistance(params, x, y, z);
      }
    }
  }
  return { sdf, dims: [nx, ny, nz], origin: min, step };
}

// ── Marching cubes ───────────────────────────────────────────────────

export interface LatticeMesh {
  positions: number[];
  indices: number[];
  triangleCount: number;
}

/** Convert a sampled SDF grid into a triangle mesh via the surface-nets
 *  variant of marching cubes. We use surface-nets (one quad per cell
 *  with a sign change) rather than the 256-case lookup-table classic
 *  marching cubes because:
 *    - lattice SDFs are smooth, so dual-contouring quality is fine
 *    - no 4kb lookup table to compile in
 *    - quads → triangulated as two tris each
 *
 *  Each cell with mixed signs at its 8 corners contributes one vertex
 *  placed at the centroid of the sign-change edge midpoints. */
export function latticeToMesh(params: LatticeParams, resolution: number = 32): LatticeMesh {
  const grid = sampleLatticeGrid(params, resolution);
  const [nx, ny, nz] = grid.dims;
  const { sdf, origin, step } = grid;

  const idx = (i: number, j: number, k: number): number => k * ny * nx + j * nx + i;
  const positions: number[] = [];
  const indices: number[] = [];
  // Cell vertex id per (i,j,k) — -1 if no vertex.
  const cellVid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1));
  cellVid.fill(-1);
  const cellIdx = (i: number, j: number, k: number): number => k * (ny - 1) * (nx - 1) + j * (nx - 1) + i;

  // Cell corner offsets (8 corners of a unit cube).
  const corners: ReadonlyArray<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  // 12 edges of a cube, each as a pair of corner indices.
  const edges: ReadonlyArray<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  // Pass 1: emit one vertex per cell whose corners have mixed signs.
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const cornerVals: number[] = corners.map(([di, dj, dk]) => sdf[idx(i + di, j + dj, k + dk)]!);
        let neg = 0, pos = 0;
        for (const v of cornerVals) { if (v < 0) neg++; else pos++; }
        if (neg === 0 || pos === 0) continue;
        // Vertex position = centroid of sign-changing edge intersections.
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
          const va = cornerVals[a]!, vb = cornerVals[b]!;
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const ca = corners[a]!, cb = corners[b]!;
          sx += ca[0] + (cb[0] - ca[0]) * t;
          sy += ca[1] + (cb[1] - ca[1]) * t;
          sz += ca[2] + (cb[2] - ca[2]) * t;
          n++;
        }
        sx /= n; sy /= n; sz /= n;
        const px = origin[0] + (i + sx) * step;
        const py = origin[1] + (j + sy) * step;
        const pz = origin[2] + (k + sz) * step;
        cellVid[cellIdx(i, j, k)] = positions.length / 3;
        positions.push(px, py, pz);
      }
    }
  }

  // Pass 2: emit a quad for each edge along which the sign changes.
  // For each grid edge (between 2 corners), the 4 cells sharing that
  // edge contribute a quad. We only emit the 3 axis-aligned edges per
  // node (X, Y, Z) to avoid duplication.
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v0 = sdf[idx(i, j, k)]!;
        // Edge along +X.
        if (i + 1 < nx) {
          const v1 = sdf[idx(i + 1, j, k)]!;
          if ((v0 < 0) !== (v1 < 0) && j > 0 && k > 0) {
            const a = cellVid[cellIdx(i, j - 1, k - 1)];
            const b = cellVid[cellIdx(i, j, k - 1)];
            const c = cellVid[cellIdx(i, j, k)];
            const d = cellVid[cellIdx(i, j - 1, k)];
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (v0 < 0) indices.push(a, b, c, a, c, d);
              else indices.push(a, d, c, a, c, b);
            }
          }
        }
        // Edge along +Y.
        if (j + 1 < ny) {
          const v1 = sdf[idx(i, j + 1, k)]!;
          if ((v0 < 0) !== (v1 < 0) && i > 0 && k > 0) {
            const a = cellVid[cellIdx(i - 1, j, k - 1)];
            const b = cellVid[cellIdx(i, j, k - 1)];
            const c = cellVid[cellIdx(i, j, k)];
            const d = cellVid[cellIdx(i - 1, j, k)];
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (v0 < 0) indices.push(a, d, c, a, c, b);
              else indices.push(a, b, c, a, c, d);
            }
          }
        }
        // Edge along +Z.
        if (k + 1 < nz) {
          const v1 = sdf[idx(i, j, k + 1)]!;
          if ((v0 < 0) !== (v1 < 0) && i > 0 && j > 0) {
            const a = cellVid[cellIdx(i - 1, j - 1, k)];
            const b = cellVid[cellIdx(i, j - 1, k)];
            const c = cellVid[cellIdx(i, j, k)];
            const d = cellVid[cellIdx(i - 1, j, k)];
            if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
              if (v0 < 0) indices.push(a, b, c, a, c, d);
              else indices.push(a, d, c, a, c, b);
            }
          }
        }
      }
    }
  }

  return { positions, indices, triangleCount: indices.length / 3 };
}

/** Radical inverse in `base` — the building block of the Halton sequence. */
function radicalInverse(i: number, base: number): number {
  let f = 1 / base;
  let r = 0;
  let n = i;
  while (n > 0) {
    r += (n % base) * f;
    n = Math.floor(n / base);
    f /= base;
  }
  return r;
}

/**
 * Estimate lattice volume fraction (relative density) by quasi-Monte-Carlo sampling.
 *
 * ⚠ 260729: 이 함수는 `Math.random()` 몬테카를로였고, 그 비결정성이 자기 테스트를
 * **플레이크**로 만들었다(3회 중 1회 실패 — 참값 0.2794 인데 경계 0.3 이 2.0σ 거리).
 * 상대밀도는 라티스 설계의 지배 파라미터라 소비자에 붙는 순간 판정이 되는데,
 * 「판정에 비결정성을 넣지 말 것」이 이 세션에서 세운 불변식이다.
 *
 * 그래서 시드를 붙이는 대신 **할톤 저불일치 수열**(base 2·3·5)로 바꿨다 — 시드 상태가
 * 없어 결정론이고, 오차도 O(1/√N) 대신 대략 O(logᵈN / N) 라 같은 N 에서 훨씬 정확하다.
 * 격자 정렬 샘플링은 라티스 주기와 **에일리어싱**을 일으키므로 쓰지 않는다.
 *
 * 반환값은 여전히 추정치다(경계 셀의 부분 점유는 세지 않는다). 정확한 체적이 필요하면
 * 메시를 발산정리로 적분할 것.
 */
export function estimateVolumeFraction(
  params: LatticeParams,
  sampleCount: number = 10000,
): number {
  let solidCount = 0;
  const { min, max } = params.bbox;
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  for (let i = 1; i <= sampleCount; i++) {
    const x = min[0] + radicalInverse(i, 2) * dx;
    const y = min[1] + radicalInverse(i, 3) * dy;
    const z = min[2] + radicalInverse(i, 5) * dz;
    if (latticeDistance(params, x, y, z) < 0) solidCount++;
  }
  return solidCount / sampleCount;
}
