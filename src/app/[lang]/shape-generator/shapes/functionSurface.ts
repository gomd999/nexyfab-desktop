import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

// ─── Safe client-side formula evaluator ────────────────────────────────────────
// Variables: x, y ∈ [-1, 1] (normalized position on the grid)
// Returns value clamped to finite

function evalFormula(formula: string, x: number, y: number): number {
  try {
     
    const fn = new Function(
      'x', 'y',
      'sin', 'cos', 'tan', 'sqrt', 'abs', 'pow', 'exp', 'log', 'sign',
      'PI', 'E', 'floor', 'ceil', 'round', 'max', 'min', 'hypot', 'atan2',
      '"use strict"; return Number(' + formula + ');',
    );
    const v = fn(
      x, y,
      Math.sin, Math.cos, Math.tan, Math.sqrt, Math.abs, Math.pow, Math.exp,
      Math.log, Math.sign,
      Math.PI, Math.E, Math.floor, Math.ceil, Math.round, Math.max, Math.min,
      Math.hypot, Math.atan2,
    ) as number;
    return isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// ─── Build closed solid from height field ─────────────────────────────────────

function buildHeightFieldSolid(
  N: number,
  sizeX: number,
  sizeZ: number,
  amplitude: number,
  zFn: (nx: number, ny: number) => number,
): THREE.BufferGeometry {
  const verts: number[] = [];
  const idxs: number[] = [];

  const totalVerts = (N + 1) * (N + 1);

  // ── Top surface vertices ──────────────────────────────────────────────────────
  const topZ: number[][] = [];
  for (let j = 0; j <= N; j++) {
    topZ.push([]);
    for (let i = 0; i <= N; i++) {
      const nx = -1 + 2 * i / N;
      const ny = -1 + 2 * j / N;
      const zv = zFn(nx, ny) * amplitude;
      verts.push(nx * sizeX / 2, zv, ny * sizeZ / 2);
      topZ[j].push(zv);
    }
  }

  // Minimum top Z → base height is that minus a 5 mm "skirt"
  let minZ = Infinity;
  for (const row of topZ) for (const v of row) if (v < minZ) minZ = v;
  const baseY = minZ - Math.max(5, amplitude * 0.1);

  // ── Bottom surface vertices ───────────────────────────────────────────────────
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const nx = -1 + 2 * i / N;
      const ny = -1 + 2 * j / N;
      verts.push(nx * sizeX / 2, baseY, ny * sizeZ / 2);
    }
  }

  const top = (i: number, j: number) => j * (N + 1) + i;
  const bot = (i: number, j: number) => totalVerts + j * (N + 1) + i;

  // ── Top face (CCW from above) ─────────────────────────────────────────────────
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = top(i, j), b = top(i + 1, j), c = top(i + 1, j + 1), d = top(i, j + 1);
      idxs.push(a, b, c,  a, c, d);
    }
  }

  // ── Bottom face (CW from below = CCW from outside) ────────────────────────────
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = bot(i, j), b = bot(i + 1, j), c = bot(i + 1, j + 1), d = bot(i, j + 1);
      idxs.push(a, c, b,  a, d, c);
    }
  }

  // ── Side walls ────────────────────────────────────────────────────────────────
  // South (j=0)
  for (let i = 0; i < N; i++) {
    idxs.push(top(i, 0), bot(i, 0), bot(i + 1, 0),  top(i, 0), bot(i + 1, 0), top(i + 1, 0));
  }
  // North (j=N)
  for (let i = 0; i < N; i++) {
    idxs.push(top(i + 1, N), bot(i + 1, N), bot(i, N),  top(i + 1, N), bot(i, N), top(i, N));
  }
  // West (i=0)
  for (let j = 0; j < N; j++) {
    idxs.push(top(0, j + 1), bot(0, j + 1), bot(0, j),  top(0, j + 1), bot(0, j), top(0, j));
  }
  // East (i=N)
  for (let j = 0; j < N; j++) {
    idxs.push(top(N, j), bot(N, j), bot(N, j + 1),  top(N, j), bot(N, j + 1), top(N, j + 1));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  return geo;
}

// ─── Shape config ─────────────────────────────────────────────────────────────

export const functionSurfaceShape: ShapeConfig = {
  id: 'functionSurface',
  tier: 2,
  icon: '∿',
  params: [
    { key: 'sizeX',     labelKey: 'paramSizeX',     default: 100, min: 10, max: 500, step: 5,  unit: 'mm' },
    { key: 'sizeY',     labelKey: 'paramSizeY',     default: 100, min: 10, max: 500, step: 5,  unit: 'mm' },
    { key: 'amplitude', labelKey: 'paramAmplitude', default: 20,  min: 1,  max: 200, step: 1,  unit: 'mm' },
    { key: 'segments',  labelKey: 'paramSegments',  default: 32,  min: 8,  max: 80,  step: 4,  unit: '' },
  ],
  formulaFields: [
    {
      key: 'zFormula',
      labelKey: 'formulaZ',
      default: 'sin(x * PI * 2) * cos(y * PI * 2)',
      placeholder: 'z = f(x, y)   예) sin(x*PI*2)*cos(y*PI*2)',
      hint: 'x, y ∈ [-1, 1] → 출력값 ∈ [-1, 1]  사용 가능: sin cos tan sqrt abs pow exp log PI E',
    },
  ],
  generate(p, formulas): ShapeResult {
    const sizeX = p.sizeX, sizeZ = p.sizeY, amplitude = p.amplitude;
    const N = Math.round(p.segments);
    const formula = formulas?.zFormula ?? 'sin(x*PI*2)*cos(y*PI*2)';

    const geo = buildHeightFieldSolid(N, sizeX, sizeZ, amplitude, (nx, ny) =>
      evalFormula(formula, nx, ny),
    );

    const volume_cm3 = meshVolume(geo) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geo) / 100;

    geo.computeBoundingBox();
    const sz = new THREE.Vector3();
    geo.boundingBox!.getSize(sz);
    const bbox = { w: Math.round(sz.x), h: Math.round(sz.y), d: Math.round(sz.z) };

    return { geometry: geo, edgeGeometry: makeEdges(geo, 25), volume_cm3, surface_area_cm2, bbox };
  },
};
