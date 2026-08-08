/**
 * hlr-drawing — K5 심화 (260808): HLR 실투영 + 해석 치수선.
 *
 * hlr-spike(OCCT HLRBRep visible/hidden 실투영)에 치수를 얹는다. 치수 숫자는
 * **픽셀에서 재지 않는다** — 부품 파라미터·배치(placedAabb·plate holes)의
 * 해석값을 투영 좌표계로 사상해 그린다(날조 불가 원칙: 값의 출처는 항상 모델).
 *
 * 투영 좌표 사상(260808 실측 — hlr-spike drawProjection):
 *   front: (mx, mz) → (x, −z) · top: (mx, my) → (x, y)
 *
 * v1 구멍 콜아웃: `plate_with_holes` 어휘의 holes[{x,y,d}] (top 뷰). 고유
 * x/y 좌표별 위치 치수(각 축 4개 상한 — K5 v1 규약과 동일) + ⌀ 그룹.
 */
import { hlrProject } from './hlr-spike.mjs';
import { placedAabb } from './assembly.mjs';

const fmt = (n) => String(+n.toFixed(2));

function dimH(x0, x1, y, label) {
  return `<line x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<line x1="${fmt(x0)}" y1="${fmt(y - 1.5)}" x2="${fmt(x0)}" y2="${fmt(y + 1.5)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<line x1="${fmt(x1)}" y1="${fmt(y - 1.5)}" x2="${fmt(x1)}" y2="${fmt(y + 1.5)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<text x="${fmt((x0 + x1) / 2)}" y="${fmt(y - 1.2)}" fill="#2563eb" font-size="4" text-anchor="middle" font-family="ui-monospace,monospace">${label}</text>`;
}
function dimV(x, y0, y1, label) {
  return `<line x1="${fmt(x)}" y1="${fmt(y0)}" x2="${fmt(x)}" y2="${fmt(y1)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<line x1="${fmt(x - 1.5)}" y1="${fmt(y0)}" x2="${fmt(x + 1.5)}" y2="${fmt(y0)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<line x1="${fmt(x - 1.5)}" y1="${fmt(y1)}" x2="${fmt(x + 1.5)}" y2="${fmt(y1)}" stroke="#2563eb" stroke-width="0.35"/>`
    + `<text x="${fmt(x - 1.2)}" y="${fmt((y0 + y1) / 2)}" fill="#2563eb" font-size="4" text-anchor="end" dominant-baseline="middle" font-family="ui-monospace,monospace">${label}</text>`;
}

/** 어셈블리 전 부품의 월드 AABB(해석 — placedAabb 합성). */
function overallExtents(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const b = placedAabb(part);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** plate_with_holes 어휘의 구멍(월드 XY) 수집 — v1 콜아웃 소스. */
function collectPlateHoles(parts) {
  const out = [];
  for (const part of parts) {
    if (part.type !== 'plate_with_holes') continue;
    const { tx = 0, ty = 0 } = part.at ?? {};
    for (const h of part.params?.holes ?? []) out.push({ x: h.x + tx, y: h.y + ty, d: h.d });
  }
  return out;
}

/**
 * HLR 실투영 + 치수 오버레이.
 * @returns { ok, views: {front?, top?}, dims: {overall, holes} , entities, dropped }
 */
export async function hlrDrawingWithDims(asm, { views = ['front', 'top'] } = {}) {
  const projected = await hlrProject(asm, { views });
  if (!projected.ok) return projected;
  const ext = overallExtents(asm.parts ?? []);
  const holes = collectPlateHoles(asm.parts ?? []);
  const [W, D, H] = ext.size;
  const out = {};

  for (const [view, svg] of Object.entries(projected.views)) {
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100').split(' ').map(Number);
    let [vx, vy, vw, vh] = vb;
    const overlay = [];
    if (view === 'front') {
      // front: x = mx, y = −mz — 하부에 전폭 W, 좌측에 전고 H
      overlay.push(dimH(ext.min[0], ext.max[0], -ext.min[2] + 8, fmt(W)));
      overlay.push(dimV(ext.min[0] - 8, -ext.max[2], -ext.min[2], fmt(H)));
      vx = Math.min(vx, ext.min[0] - 16); vy = Math.min(vy, -ext.max[2] - 4);
      vw = Math.max(vw, W + 32); vh = Math.max(vh, H + 24);
    }
    if (view === 'top') {
      // top: x = mx, y = my — 상부에 전폭 W, 좌측에 깊이 D + 구멍 콜아웃
      overlay.push(dimH(ext.min[0], ext.max[0], ext.min[1] - 8, fmt(W)));
      overlay.push(dimV(ext.min[0] - 8, ext.min[1], ext.max[1], fmt(D)));
      const uniq = (vals) => [...new Set(vals.map(v => +v.toFixed(2)))].sort((a, b) => a - b).slice(0, 4);
      const hxs = uniq(holes.map(h => h.x)), hys = uniq(holes.map(h => h.y));
      hxs.forEach((hx, i) => overlay.push(dimH(ext.min[0], hx, ext.max[1] + 6 + i * 6, fmt(hx - ext.min[0]))));
      hys.forEach((hy, i) => overlay.push(dimV(ext.max[0] + 6 + i * 6, ext.min[1], hy, fmt(hy - ext.min[1]))));
      const groups = [...holes.reduce((m, h) => m.set(h.d, (m.get(h.d) ?? 0) + 1), new Map()).entries()];
      groups.forEach(([d, n], i) => overlay.push(
        `<text x="${fmt(ext.max[0] + 4)}" y="${fmt(ext.min[1] - 4 - i * 5)}" fill="#2563eb" font-size="4" font-family="ui-monospace,monospace">⌀${d}×${n}</text>`,
      ));
      vx = Math.min(vx, ext.min[0] - 16); vy = Math.min(vy, ext.min[1] - 14 - groups.length * 5);
      vw = Math.max(vw, W + 32 + hys.length * 6); vh = Math.max(vh, D + 28 + hxs.length * 6);
    }
    out[view] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}">${inner}${overlay.join('')}</svg>`;
  }

  return {
    ok: true, views: out,
    dims: { overall: { W: +fmt(W), D: +fmt(D), H: +fmt(H) }, holes },
    entities: projected.entities, dropped: projected.dropped,
  };
}
