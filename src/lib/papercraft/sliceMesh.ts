/**
 * Mesh slicing → stacked-layer (foam board / 우드락) papercraft.
 *
 * Cross-sections an arbitrary triangle mesh with N horizontal planes and emits
 * each slice's contour as CUT segments, laid out in a grid so all slabs cut from
 * one sheet. Unlike folding (unfoldMesh), this works for ANY density and for
 * curved/organic shapes — you cut N flat outlines and stack them to thickness.
 *
 * Layer count comes from material thickness (N = z-range / thickness) so the
 * stacked slabs physically add up to the model's height, or from an explicit
 * `layers` count. Each contour is sampled at the MIDDLE of its slab.
 */
import type { Seg } from './netDxf';

type V2 = [number, number];

export interface SliceResult {
  segs: Seg[];
  layerCount: number;
  /** z (model height) sampled per layer, in model units. */
  zSamples: number[];
  ok: boolean;
  reason?: string;
}

export function sliceMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  opts: { layers?: number; thickness?: number; cols?: number; gap?: number } = {},
): SliceResult {
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  if (triCount === 0) return { segs: [], layerCount: 0, zSamples: [], ok: false, reason: 'empty mesh' };

  // Axis-aligned bounds (slice along Z).
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const np = positions.length;
  for (let i = 0; i + 2 < np; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const zRange = maxZ - minZ;
  if (!(zRange > 1e-6)) return { segs: [], layerCount: 0, zSamples: [], ok: false, reason: 'flat model (no height to slice)' };

  const thickness = typeof opts.thickness === 'number' && opts.thickness > 0 ? Math.min(Math.max(0.3, opts.thickness), 50) : 0;
  const N = thickness > 0
    ? Math.min(Math.max(2, Math.round(zRange / thickness)), 120)
    : Math.min(Math.max(2, Math.round(opts.layers ?? 8)), 120);

  const tri = (t: number, k: 0 | 1 | 2): number => indices ? indices[t * 3 + k] : t * 3 + k;
  const px = (vi: number) => positions[vi * 3], py = (vi: number) => positions[vi * 3 + 1], pz = (vi: number) => positions[vi * 3 + 2];

  // For each layer, gather the cross-section segments (in model XY).
  const layerSegs: Array<Array<[V2, V2]>> = [];
  const zSamples: number[] = [];
  for (let li = 0; li < N; li++) {
    const z0 = minZ + ((li + 0.5) * zRange) / N;
    zSamples.push(Math.round(z0 * 100) / 100);
    const segs: Array<[V2, V2]> = [];
    for (let t = 0; t < triCount; t++) {
      const a = tri(t, 0), b = tri(t, 1), c = tri(t, 2);
      const za = pz(a), zb = pz(b), zc = pz(c);
      // Plane z=z0 crosses an edge when its endpoints straddle z0.
      const pts: V2[] = [];
      const edge = (i: number, j: number, zi: number, zj: number) => {
        if ((zi < z0 && zj >= z0) || (zj < z0 && zi >= z0)) {
          const tt = (z0 - zi) / (zj - zi);
          pts.push([px(i) + (px(j) - px(i)) * tt, py(i) + (py(j) - py(i)) * tt]);
        }
      };
      edge(a, b, za, zb); edge(b, c, zb, zc); edge(c, a, zc, za);
      if (pts.length === 2) segs.push([pts[0], pts[1]]);
    }
    layerSegs.push(segs);
  }

  // Grid layout: place each layer's contour in a cell, packed left→right / wrap.
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(N)));
  const cellW = (maxX - minX);
  const cellH = (maxY - minY);
  const gap = typeof opts.gap === 'number' ? opts.gap : Math.max(6, Math.min(cellW, cellH) * 0.15);
  const out: Seg[] = [];
  for (let li = 0; li < N; li++) {
    const col = li % cols, row = Math.floor(li / cols);
    const ox = col * (cellW + gap) - minX;
    const oy = row * (cellH + gap) - minY;
    for (const [p, q] of layerSegs[li]) {
      out.push({ a: [p[0] + ox, p[1] + oy], b: [q[0] + ox, q[1] + oy], layer: 'CUT' });
    }
  }

  return { segs: out, layerCount: N, zSamples, ok: true };
}
