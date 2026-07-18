/**
 * layout-plan.mjs — 2D 배치 계획층 (260718, "2D 우선 + 3D 게이트 유지" 방법론).
 *
 * 존(구역)·풋프린트 선언에서 3D 좌표를 결정론적으로 유도한다:
 *  ① 존: 평면 사각 구역 + 높이 대역(zMin~zMax) — 겹침 검사
 *  ② 아이템: 존 안에 풋프린트(w×d) 순차 패킹(행 우선 그리디, margin 간격) — 2D 겹침 0 보장
 *  ③ 명시 배치(at)도 허용 — 존 경계·기존 배치와 2D 검사만 수행
 *  ④ 산출: {id→{tx,ty,tz}} + 배치계획도 SVG(평면 — 검토·패키지 동봉용)
 *
 * 3D 간섭·지지 게이트를 대체하지 않는다(높이·회전·배관은 3D 검증) — 시행착오를
 * 줄이는 전단계다. 실패(존 초과·겹침)는 정직 오류로 반환, 좌표를 지어내지 않는다.
 */

/** @param spec {
 *   area:{w,d},
 *   zones:[{id, rect:[x,y,w,d], zMin?, zMax?}],
 *   items:[{id, zone, footprint:[w,d], margin?, at?:[x,y], z?, rotate90?:boolean}]
 * } */
export function planLayout(spec) {
  const errors = [];
  const warnings = [];
  const area = spec?.area;
  if (!area || !(area.w > 0) || !(area.d > 0)) return { ok: false, errors: ['area{w,d} 필요'], warnings, placements: {} };
  const zones = Array.isArray(spec.zones) ? spec.zones : [];
  const items = Array.isArray(spec.items) ? spec.items : [];

  // ① 존 검증: 영역 내부 + 존 상호 평면 겹침(같은 높이 대역일 때만 결함)
  const zById = new Map();
  for (const z of zones) {
    const [x, y, w, d] = z.rect ?? [];
    if (!(w > 0) || !(d > 0) || x < 0 || y < 0 || x + w > area.w + 1e-9 || y + d > area.d + 1e-9) {
      errors.push(`존 ${z.id}: rect 가 영역(${area.w}×${area.d}) 밖`);
      continue;
    }
    zById.set(z.id, { ...z, x, y, w, d, zMin: z.zMin ?? 0, zMax: z.zMax ?? Infinity, cursor: { x: 0, y: 0, rowH: 0 }, placed: [] });
  }
  const zl = [...zById.values()];
  for (let i = 0; i < zl.length; i++) {
    for (let j = i + 1; j < zl.length; j++) {
      const a = zl[i], b = zl[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) {
        const zOverlap = Math.min(a.zMax, b.zMax) - Math.max(a.zMin, b.zMin);
        if (zOverlap > 0) errors.push(`존 ${a.id}×${b.id}: 평면·높이 대역 동시 겹침(${ox.toFixed(0)}×${oy.toFixed(0)}, z ${zOverlap === Infinity ? '∞' : zOverlap.toFixed(0)})`);
        else warnings.push(`존 ${a.id}×${b.id}: 평면 겹침(높이 대역 분리로 허용)`);
      }
    }
  }

  const rectsOverlap = (r1, r2) =>
    Math.min(r1.x + r1.w, r2.x + r2.w) - Math.max(r1.x, r2.x) > 1e-9 &&
    Math.min(r1.y + r1.d, r2.y + r2.d) - Math.max(r1.y, r2.y) > 1e-9;

  // ② 아이템 배치
  const placements = {};
  for (const it of items) {
    const zone = zById.get(it.zone);
    if (!zone) { errors.push(`${it.id}: 존 ${it.zone} 없음`); continue; }
    let [fw, fd] = it.footprint ?? [];
    if (!(fw > 0) || !(fd > 0)) { errors.push(`${it.id}: footprint[w,d] 필요`); continue; }
    if (it.rotate90) [fw, fd] = [fd, fw];
    const m = it.margin ?? 40;
    const z = it.z ?? zone.zMin;
    if (z < zone.zMin - 1e-9 || (Number.isFinite(zone.zMax) && z > zone.zMax + 1e-9)) {
      errors.push(`${it.id}: z=${z} 가 존 ${zone.id} 높이 대역(${zone.zMin}~${zone.zMax}) 밖`);
      continue;
    }
    if (Array.isArray(it.at)) {
      // 명시 배치 — 존 경계·기배치 2D 검사
      const r = { x: it.at[0], y: it.at[1], w: fw, d: fd };
      if (r.x < zone.x - 1e-9 || r.y < zone.y - 1e-9 || r.x + fw > zone.x + zone.w + 1e-9 || r.y + fd > zone.y + zone.d + 1e-9) {
        errors.push(`${it.id}: 명시 배치가 존 ${zone.id} 밖`);
        continue;
      }
      const hit = zone.placed.find((q) => rectsOverlap(r, q));
      if (hit) { errors.push(`${it.id}: 명시 배치가 ${hit.id} 와 평면 겹침`); continue; }
      zone.placed.push({ ...r, id: it.id });
      placements[it.id] = { tx: r.x, ty: r.y, tz: z };
      continue;
    }
    // bottom-left 패킹(margin 간격) — 후보 = (0,0) ∪ 기배치 우측/상측, y→x 최소 우선. 결정론.
    const cands = [[0, 0]];
    for (const q of zone.placed) {
      cands.push([q.x - zone.x + q.w + m, q.y - zone.y]);
      cands.push([q.x - zone.x, q.y - zone.y + q.d + m]);
    }
    cands.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let placedRect = null;
    for (const [px, py] of cands) {
      if (px < 0 || py < 0 || px + fw > zone.w + 1e-9 || py + fd > zone.d + 1e-9) continue;
      const r = { x: zone.x + px, y: zone.y + py, w: fw + m, d: fd + m }; // margin 포함 충돌 검사
      if (zone.placed.some((q) => rectsOverlap(r, { x: q.x, y: q.y, w: q.w + m, d: q.d + m }))) continue;
      placedRect = { x: zone.x + px, y: zone.y + py, w: fw, d: fd };
      break;
    }
    if (!placedRect) { errors.push(`${it.id}: 존 ${zone.id} 용량 초과(패킹 실패 ${fw}×${fd})`); continue; }
    zone.placed.push({ ...placedRect, id: it.id });
    placements[it.id] = { tx: placedRect.x, ty: placedRect.y, tz: z };
  }

  // ④ 배치계획도 SVG(평면 — 존=옅은 사각, 아이템=라벨 사각)
  const S = 0.25;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${area.w * S + 40}" height="${area.d * S + 40}" font-family="sans-serif">`,
    `<rect x="20" y="20" width="${area.w * S}" height="${area.d * S}" fill="#fff" stroke="#334155" stroke-width="1.5"/>`,
  ];
  const Y = (y, d) => 20 + (area.d - y - d) * S; // 도면 관례: +y=위
  for (const zn of zl) {
    svg.push(`<rect x="${20 + zn.x * S}" y="${Y(zn.y, zn.d)}" width="${zn.w * S}" height="${zn.d * S}" fill="#3b82f61a" stroke="#3b82f6" stroke-dasharray="6 3"/>`);
    svg.push(`<text x="${22 + zn.x * S}" y="${Y(zn.y, zn.d) + 12}" font-size="10" fill="#1d4ed8">${zn.id} (z${zn.zMin}~${Number.isFinite(zn.zMax) ? zn.zMax : '∞'})</text>`);
    for (const p of zn.placed) {
      svg.push(`<rect x="${20 + p.x * S}" y="${Y(p.y, p.d)}" width="${p.w * S}" height="${p.d * S}" fill="#e2e8f0" stroke="#475569"/>`);
      svg.push(`<text x="${20 + (p.x + p.w / 2) * S}" y="${Y(p.y, p.d) + p.d * S / 2 + 3}" font-size="9" text-anchor="middle" fill="#0f172a">${p.id}</text>`);
    }
  }
  svg.push('</svg>');

  return { ok: errors.length === 0, errors, warnings, placements, svg: svg.join('\n'), zones: zl.map((zn) => ({ id: zn.id, used: zn.placed.length })) };
}
