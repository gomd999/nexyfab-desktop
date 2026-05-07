/**
 * NURBS Freeform Surface Feature
 *
 * Creates a freeform surface from a parametric control-point grid.
 * Uses replicad's loft() through interpolated wire profiles when OCCT is
 * available; falls back to a Catmull-Rom bicubic THREE.js surface otherwise.
 */

import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { ensureOcctReady, isOcctReady } from './occtEngine';

// ─── Fallback: Catmull-Rom bicubic parametric surface ─────────────────────────

// ─── Control point helpers ────────────────────────────────────────────────────

/** Encode a control point position key into params */
export function cpKey(i: number, j: number, axis: 0 | 1 | 2): string {
  return `cp_${i}_${j}_${axis}`;
}

/** Build the CP grid from params. Uses custom CPs if encoded, else default sinusoidal. */
export function buildCpGrid(
  params: Record<string, number>,
  uCount: number,
  vCount: number,
): [number, number, number][][] {
  const amplitude = params.amplitude ?? 20;
  const width = params.width ?? 100;
  const depth = params.depth ?? 100;
  const hasCustom = params[cpKey(0, 0, 0)] !== undefined;

  const cp: [number, number, number][][] = [];
  for (let i = 0; i < uCount; i++) {
    cp[i] = [];
    for (let j = 0; j < vCount; j++) {
      if (hasCustom) {
        cp[i][j] = [
          params[cpKey(i, j, 0)] ?? 0,
          params[cpKey(i, j, 1)] ?? 0,
          params[cpKey(i, j, 2)] ?? 0,
        ];
      } else {
        const u = i / (uCount - 1);
        const v = j / (vCount - 1);
        const h = Math.sin(u * Math.PI * 2) * Math.cos(v * Math.PI * 2) * amplitude;
        cp[i][j] = [(u - 0.5) * width, h, (v - 0.5) * depth];
      }
    }
  }
  return cp;
}

function buildFallbackSurface(params: Record<string, number>): THREE.BufferGeometry {
  const uCount = Math.max(2, Math.round(params.uCount ?? 5));
  const vCount = Math.max(2, Math.round(params.vCount ?? 5));
  const seg = Math.max(8, Math.round(params.tessellation ?? 32));

  const cp = buildCpGrid(params, uCount, vCount);

  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

  // Catmull-Rom 1D spline through 4 points at parameter t ∈ [0,1]
  const catmull = (p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number], t: number): [number, number, number] =>
    [0, 1, 2].map(k => {
      const a = -0.5 * p0[k] + 1.5 * p1[k] - 1.5 * p2[k] + 0.5 * p3[k];
      const b = p0[k] - 2.5 * p1[k] + 2 * p2[k] - 0.5 * p3[k];
      const c = -0.5 * p0[k] + 0.5 * p2[k];
      return a * t ** 3 + b * t ** 2 + c * t + p1[k];
    }) as [number, number, number];

  const evalSurface = (u: number, v: number): [number, number, number] => {
    const uf = u * (uCount - 1), vf = v * (vCount - 1);
    const ui = clamp(Math.floor(uf), 0, uCount - 2);
    const vi = clamp(Math.floor(vf), 0, vCount - 2);
    const ut = uf - ui, vt = vf - vi;
    const rows = [-1, 0, 1, 2].map(di => {
      const ri = clamp(ui + di, 0, uCount - 1);
      return catmull(
        cp[ri][clamp(vi - 1, 0, vCount - 1)], cp[ri][clamp(vi, 0, vCount - 1)],
        cp[ri][clamp(vi + 1, 0, vCount - 1)], cp[ri][clamp(vi + 2, 0, vCount - 1)],
        vt,
      );
    });
    return catmull(rows[0], rows[1], rows[2], rows[3], ut);
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const eps = 0.001;

  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= seg; j++) {
      const u = i / seg, v = j / seg;
      const [x, y, z] = evalSurface(u, v);
      positions.push(x, y, z);
      uvs.push(u, v);
      const [x1, y1, z1] = evalSurface(Math.min(u + eps, 1), v);
      const [x2, y2, z2] = evalSurface(u, Math.min(v + eps, 1));
      const n = new THREE.Vector3(x1 - x, y1 - y, z1 - z).cross(new THREE.Vector3(x2 - x, y2 - y, z2 - z)).normalize();
      normals.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, c = (i + 1) * (seg + 1) + j, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ─── OCCT-backed surface via replicad loft ────────────────────────────────────

async function buildOcctNurbs(params: Record<string, number>): Promise<THREE.BufferGeometry | null> {
  try {
    await ensureOcctReady();
    const replicad = await import('replicad') as any;

    const uCount = Math.max(3, Math.round(params.uCount ?? 5));
    const vCount = Math.max(3, Math.round(params.vCount ?? 5));
    void (params.thickness ?? 2); // thickness reserved for shell offset

    const cpGrid = buildCpGrid(params, uCount, vCount);

    // Build wire profiles (one per U slice) then loft through them
    const profiles: any[] = [];

    for (let i = 0; i < uCount; i++) {
      // Points along this profile (varying v)
      const pts: [number, number, number][] = [];
      for (let j = 0; j < vCount; j++) {
        pts.push(cpGrid[i][j]);
      }

      // drawPointsInterpolation creates a smooth spline wire through points
      const wire = replicad.drawPointsInterpolation(pts.map(([x, y, z]) => [x, z, y]));
      profiles.push(wire);
    }

    // Loft through the profiles to create the surface solid
    const solid = replicad.loft(profiles, { startCap: true, endCap: true });

    // Tessellate
    const mesh = solid.mesh({ tolerance: 0.3, angularTolerance: 5 });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3));
    if (mesh.normals) geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.triangles, 1));
    if (!mesh.normals) geo.computeVertexNormals();
    return geo;
  } catch (e) {
    console.warn('[NURBS] OCCT loft failed, using Catmull-Rom fallback:', e);
    return null;
  }
}

// ─── Feature definition ───────────────────────────────────────────────────────

export const nurbsSurfaceFeature: FeatureDefinition = {
  type: 'nurbsSurface',
  icon: '〜',
  params: [
    { key: 'width',        labelKey: 'paramNurbsWidth',        default: 100, min: 10,  max: 500, step: 5,   unit: 'mm' },
    { key: 'depth',        labelKey: 'paramNurbsDepth',        default: 100, min: 10,  max: 500, step: 5,   unit: 'mm' },
    { key: 'amplitude',    labelKey: 'paramNurbsAmplitude',    default: 20,  min: 0,   max: 100, step: 1,   unit: 'mm' },
    { key: 'uCount',       labelKey: 'paramNurbsUCount',       default: 5,   min: 3,   max: 12,  step: 1,   unit: '' },
    { key: 'vCount',       labelKey: 'paramNurbsVCount',       default: 5,   min: 3,   max: 12,  step: 1,   unit: '' },
    { key: 'tessellation', labelKey: 'paramNurbsTessellation', default: 32,  min: 8,   max: 128, step: 8,   unit: '' },
    { key: 'thickness',    labelKey: 'paramNurbsThickness',    default: 2,   min: 0,   max: 20,  step: 0.5, unit: 'mm' },
  ],

  apply(_geometry, params) {
    return buildFallbackSurface(params);
  },

  async applyAsync(_geometry, params) {
    if (!isOcctReady()) await ensureOcctReady();
    const occtResult = await buildOcctNurbs(params);
    return occtResult ?? buildFallbackSurface(params);
  },
};
