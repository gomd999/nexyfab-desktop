// Drawing auto-dimensioning.
// Given a projected edge set and the projection viewport, place horizontal
// and vertical extension dimensions on the bounding box + detect circular
// features (holes) and place a diameter dimension on each.

import * as THREE from 'three';

export interface AutoDim {
  kind: 'horizontal' | 'vertical' | 'diameter' | 'radius';
  /** Display value in mm. */
  value: number;
  /** Anchor in SVG coordinates (already projected by caller). */
  x: number;
  y: number;
  /** Length of the extension line. */
  length: number;
  /** Optional label override (e.g. "∅ 6.5"). */
  label?: string;
}

/**
 * Build dimension entries from a projected ortho view. Detects:
 * 1. Overall horizontal + vertical bounds.
 * 2. Circular features by clustering edges into rings.
 */
export function generateAutoDimensions(
  edges: THREE.EdgesGeometry,
  bbox: THREE.Box3,
  view: 'top' | 'front' | 'right' | 'iso',
  width: number,
  height: number,
): AutoDim[] {
  // For iso views we skip auto-dim (3D extension lines aren't meaningful).
  if (view === 'iso') return [];

  // Reproject corner extremes to find 2D bounds in the same coordinate
  // space as the SVG render. Caller renders edges with the same projection
  // so dimension placement matches visually.
  const project = (x: number, y: number, z: number): [number, number] => {
    switch (view) {
      case 'top':   return [x, -y];
      case 'front': return [x, -z];
      case 'right': return [y, -z];
    }
  };

  const corners = [
    [bbox.min.x, bbox.min.y, bbox.min.z], [bbox.max.x, bbox.min.y, bbox.min.z],
    [bbox.min.x, bbox.max.y, bbox.min.z], [bbox.max.x, bbox.max.y, bbox.min.z],
    [bbox.min.x, bbox.min.y, bbox.max.z], [bbox.max.x, bbox.min.y, bbox.max.z],
    [bbox.min.x, bbox.max.y, bbox.max.z], [bbox.max.x, bbox.max.y, bbox.max.z],
  ];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y, z] of corners) {
    const [u, v] = project(x, y, z);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const padding = 8;
  const sx = (width - padding * 2) / Math.max(1e-6, u1 - u0);
  const sy = (height - padding * 2) / Math.max(1e-6, v1 - v0);
  const s = Math.min(sx, sy);
  const ox = width / 2 - (u0 + (u1 - u0) / 2) * s;
  const oy = height / 2 - (v0 + (v1 - v0) / 2) * s;
  const toSvg = (u: number, v: number): [number, number] => [u * s + ox, v * s + oy];

  const dims: AutoDim[] = [];

  // ── Overall dimensions ─────────────────────────────────────────────────
  const widthMm = u1 - u0;
  const heightMm = v1 - v0;
  const [topL] = [toSvg(u0, v0)];
  const [, bottomR] = [toSvg(u0, v0), toSvg(u1, v1)];
  dims.push({
    kind: 'horizontal',
    value: widthMm,
    x: (toSvg(u0, v0)[0] + toSvg(u1, v0)[0]) / 2,
    y: toSvg(u0, v0)[1] - 6,
    length: bottomR[0] - topL[0],
  });
  dims.push({
    kind: 'vertical',
    value: heightMm,
    x: toSvg(u0, v0)[0] - 6,
    y: (toSvg(u0, v0)[1] + toSvg(u0, v1)[1]) / 2,
    length: toSvg(u0, v1)[1] - toSvg(u0, v0)[1],
  });

  // ── Hole detection ────────────────────────────────────────────────────
  // EdgesGeometry stores feature edges only. Circles in ortho become
  // ring-of-segments; we cluster them by midpoint and average to a
  // candidate (cx, cy, r). Threshold scaled to bbox so works for any size.
  const positions = edges.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (positions) {
    const candidates: { cx: number; cy: number; rSum: number; count: number }[] = [];
    const clusterDist = Math.min(widthMm, heightMm) * 0.02;
    for (let i = 0; i < positions.count; i += 2) {
      const ax = positions.getX(i), ay = positions.getY(i), az = positions.getZ(i);
      const bx = positions.getX(i + 1), by = positions.getY(i + 1), bz = positions.getZ(i + 1);
      const [au, av] = project(ax, ay, az);
      const [bu, bv] = project(bx, by, bz);
      const mu = (au + bu) / 2, mv = (av + bv) / 2;
      const segLen = Math.hypot(bu - au, bv - av);
      // Skip long segments — they're straight edges, not ring fragments.
      if (segLen > clusterDist * 1.5) continue;
      // Find a cluster within reach.
      let attached = false;
      for (const c of candidates) {
        if (Math.hypot(mu - c.cx, mv - c.cy) < clusterDist * 3) {
          // Recompute center as running average; radius is mean dist of
          // segment midpoint to current center.
          const r = Math.hypot(mu - c.cx, mv - c.cy);
          c.rSum += r;
          c.count += 1;
          c.cx = (c.cx * (c.count - 1) + mu) / c.count;
          c.cy = (c.cy * (c.count - 1) + mv) / c.count;
          attached = true;
          break;
        }
      }
      if (!attached) candidates.push({ cx: mu, cy: mv, rSum: 0, count: 1 });
    }
    // A ring should have >= 8 fragments; otherwise it's noise.
    for (const c of candidates) {
      if (c.count < 8) continue;
      const r = c.rSum / c.count;
      if (r < clusterDist) continue; // too tight — likely a single short edge cluster
      const [svgX, svgY] = toSvg(c.cx, c.cy);
      dims.push({
        kind: 'diameter',
        value: r * 2,
        x: svgX,
        y: svgY,
        length: r * s * 2,
        label: `∅ ${(r * 2).toFixed(2)}`,
      });
    }
  }

  return dims;
}
