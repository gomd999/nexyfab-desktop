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

/** 부품의 단일 회전축('x'|'y'|'z') — 무회전='none', 다축 회전=null(AABB 보수 유지). */
function singleRotAxis(at = {}) {
  const rots = [];
  if (Number(at.rx)) rots.push('x');
  if (Number(at.ry)) rots.push('y');
  if (Number(at.rz)) rots.push('z');
  if (rots.length === 0) return 'none';
  if (rots.length === 1) return rots[0];
  return null;
}

/**
 * box 부품 → 지정 평면(plane=회전축) 기준 { obb, a0, a1 }.
 * plane 'z': (x,y) 평면 + z 구간(기존 rz 경로) · 'x': (y,z)+x 구간 · 'y': (z,x)+y 구간
 *   (Ry 표준: x'=x·c+z·s, z'=−x·s+z·c → (z,x) 순서가 CCW(θ) — placedAabb 규약과 정합).
 * 해당 축 외 회전이 있으면 null. partAabb(box)=로컬 [0..w,0..d,0..h] 관례.
 */
export function obbFromBoxPart(part, plane = 'z') {
  if (part.type !== 'box') return null;
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  const ax = singleRotAxis(part.at);
  if (ax === null) return null;
  if (ax !== 'none' && ax !== plane) return null;
  const p = part.params ?? {};
  const w = p.width, d = p.depth, h = p.height;
  if (!(w > 0 && d > 0 && h > 0)) return null;
  if (plane === 'z') {
    const r = (rz * Math.PI) / 180;
    const cx = tx + (w / 2) * Math.cos(r) - (d / 2) * Math.sin(r);
    const cy = ty + (w / 2) * Math.sin(r) + (d / 2) * Math.cos(r);
    return { obb: { c: [cx, cy], h: [w / 2, d / 2], deg: rz }, a0: tz, a1: tz + h };
  }
  if (plane === 'x') { // Rx 표준: y'=y·c−z·s, z'=y·s+z·c → (y,z) CCW(θ)
    const r = (rx * Math.PI) / 180;
    const cy = ty + (d / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
    const cz = tz + (d / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
    return { obb: { c: [cy, cz], h: [d / 2, h / 2], deg: rx }, a0: tx, a1: tx + w };
  }
  // plane === 'y'
  const r = (ry * Math.PI) / 180;
  const cz = tz + (h / 2) * Math.cos(r) - (w / 2) * Math.sin(r);
  const cx = tx + (h / 2) * Math.sin(r) + (w / 2) * Math.cos(r);
  return { obb: { c: [cz, cx], h: [h / 2, w / 2], deg: ry }, a0: ty, a1: ty + d };
}

/**
 * 두 box 부품의 정밀 간섭 — 단일축 회전 일반화(260717 캐노피·아치교의 rx/ry 과탐 해소):
 * 회전축이 같은 단일축(또는 한쪽/양쪽 무회전)이면 그 평면 SAT + 축 구간.
 * 그 외(다축·상이축·비박스)는 null → 호출측 AABB 보수 유지.
 * @returns null | { overlap:false } | { overlap:true, depthMm }  (depth = min(평면, 축))
 */
export function boxPartsInterference(pa, pb) {
  const axA = singleRotAxis(pa.at);
  const axB = singleRotAxis(pb.at);
  if (axA === null || axB === null) return null;
  let plane;
  if (axA === 'none' && axB === 'none') plane = 'z';
  else if (axA === 'none') plane = axB;
  else if (axB === 'none') plane = axA;
  else if (axA === axB) plane = axA;
  else return null; // 상이축 회전 쌍 — 평면 SAT 불가(보수 유지)
  const A = obbFromBoxPart(pa, plane), B = obbFromBoxPart(pb, plane);
  if (!A || !B) return null;
  const oz = Math.min(A.a1, B.a1) - Math.max(A.a0, B.a0);
  if (oz <= EPS) return { overlap: false };
  const xy = obbOverlap(A.obb, B.obb);
  if (!xy.overlap) return { overlap: false };
  return { overlap: true, depthMm: Math.min(xy.depthMm, oz) };
}
