/**
 * obb2d.mjs — 2D OBB(회전 직사각형) 분리축(SAT) 판정 (linear-drawing-plan §0.2).
 *
 * 회전 부품 간섭을 AABB(보수 과탐)로만 보면 "트림을 크게 잡아 회피"가 접합부 갭을
 * 낳는다. 여기서 XY 풋프린트를 SAT 로 정확 판정(z 는 구간 비교)해, 트림을 정확
 * 마이터 공식까지 줄이고도 겹침 0 을 수치로 보증한다.
 *
 * OBB = { c:[cx,cy], h:[hx,hy], deg } — 중심·반치수·회전각(도).
 */
import { EPS } from './geometry-tolerance.mjs';

/** SAT — 겹치면 { overlap:true, depthMm }(최소 관통축), 분리면 { overlap:false, gapMm }. */
export function obbOverlap(a, b) {
  const axes = [];
  for (const o of [a, b]) {
    const r = (o.deg * Math.PI) / 180;
    axes.push([Math.cos(r), Math.sin(r)], [-Math.sin(r), Math.cos(r)]);
  }
  const t = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  let depth = Infinity, gap = -Infinity;
  for (const ax of axes) {
    const ra = radiusOn(a, ax), rb = radiusOn(b, ax);
    const d = Math.abs(t[0] * ax[0] + t[1] * ax[1]);
    const ov = ra + rb - d;
    if (ov <= EPS) gap = Math.max(gap, -ov);
    depth = Math.min(depth, ov);
  }
  return depth <= EPS ? { overlap: false, gapMm: Math.max(0, gap) } : { overlap: true, depthMm: depth };
}
function radiusOn(o, ax) {
  const r = (o.deg * Math.PI) / 180;
  const ux = [Math.cos(r), Math.sin(r)], uy = [-Math.sin(r), Math.cos(r)];
  return o.h[0] * Math.abs(ux[0] * ax[0] + ux[1] * ax[1]) + o.h[1] * Math.abs(uy[0] * ax[0] + uy[1] * ax[1]);
}

/**
 * box 부품(rz 회전만) → { obb, z0, z1 }. rx/ry 회전·비박스는 null(호출측 AABB 폴백 — 보수 유지).
 * partAabb(box)=로컬 [0..w, 0..d, 0..h] 관례에 의존.
 */
export function obbFromBoxPart(part) {
  if (part.type !== 'box') return null;
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  if (rx || ry) return null;
  const p = part.params ?? {};
  const w = p.width, d = p.depth, h = p.height;
  if (!(w > 0 && d > 0 && h > 0)) return null;
  const r = (rz * Math.PI) / 180;
  // 로컬 중심 (w/2, d/2) 를 코너 회전(placedAabb 와 동일 규칙: 회전 후 평행이동)
  const cx = tx + (w / 2) * Math.cos(r) - (d / 2) * Math.sin(r);
  const cy = ty + (w / 2) * Math.sin(r) + (d / 2) * Math.cos(r);
  return { obb: { c: [cx, cy], h: [w / 2, d / 2], deg: rz }, z0: tz, z1: tz + h };
}

/**
 * 두 box 부품의 정밀 간섭 — XY SAT + z 구간. 둘 다 OBB 화 가능해야 하며,
 * 아니면 null(호출측이 AABB 보수 판정 유지).
 * @returns null | { overlap:false } | { overlap:true, depthMm }  (depth = min(xy, z))
 */
export function boxPartsInterference(pa, pb) {
  const A = obbFromBoxPart(pa), B = obbFromBoxPart(pb);
  if (!A || !B) return null;
  const oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
  if (oz <= EPS) return { overlap: false };
  const xy = obbOverlap(A.obb, B.obb);
  if (!xy.overlap) return { overlap: false };
  return { overlap: true, depthMm: Math.min(xy.depthMm, oz) };
}
