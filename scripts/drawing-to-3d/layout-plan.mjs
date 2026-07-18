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

  // ④ 배치계획도 SVG — 코퍼스 도면 관례 반영(260718 실측: DIM 전용 레이어·해칭·심볼
  //   블록 다용·격자): 격자 250 · 전체 치수선 · 장비 심볼(kind: P&ID 관례) · 범례 · 제목란.
  const S = 0.25;
  const M = 46;                       // 여백(치수선 공간)
  const W2 = area.w * S + M * 2;
  const H2 = area.d * S + M * 2 + 34; // 제목란
  const X = (x) => M + x * S;
  const Y = (y, d = 0) => M + (area.d - y - d) * S;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}" font-family="sans-serif">`,
    `<rect x="0" y="0" width="${W2}" height="${H2}" fill="#fff"/>`,
  ];
  // 격자(250mm — 옅은 회색, 레이어 GRID 관례)
  for (let gx = 0; gx <= area.w; gx += 250) svg.push(`<line x1="${X(gx)}" y1="${Y(0)}" x2="${X(gx)}" y2="${Y(area.d)}" stroke="#eef1f4"/>`);
  for (let gy = 0; gy <= area.d; gy += 250) svg.push(`<line x1="${X(0)}" y1="${Y(gy)}" x2="${X(area.w)}" y2="${Y(gy)}" stroke="#eef1f4"/>`);
  // 외곽(VISIBLE 굵은 실선 관례)
  svg.push(`<rect x="${X(0)}" y="${Y(area.d)}" width="${area.w * S}" height="${area.d * S}" fill="none" stroke="#1f2937" stroke-width="1.8"/>`);
  // 전체 치수선(DIM 레이어 관례 — 하단 W·좌측 D, 화살표+값)
  const dim = (x1, y1, x2, y2, label, vert = false) => {
    svg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b91c1c" stroke-width="0.8"/>`);
    for (const [ax, ay, dx, dy] of [[x1, y1, 1, 0], [x2, y2, -1, 0]]) {
      const vx = vert ? 0 : dx, vy = vert ? (ay === y1 && vert ? 1 : -1) : 0;
      void vx; void vy;
    }
    svg.push(`<text x="${(x1 + x2) / 2}" y="${vert ? (y1 + y2) / 2 : y1 - 3}" font-size="9" fill="#b91c1c" text-anchor="middle"${vert ? ` transform="rotate(-90 ${(x1 + x2) / 2} ${(y1 + y2) / 2})"` : ''}>${label}</text>`);
    const tick = (tx, ty) => svg.push(`<line x1="${tx - 3}" y1="${ty + 3}" x2="${tx + 3}" y2="${ty - 3}" stroke="#b91c1c" stroke-width="0.9"/>`);
    tick(x1, y1); tick(x2, y2);
  };
  dim(X(0), Y(0) + 18, X(area.w), Y(0) + 18, `${area.w}`);
  dim(X(0) - 18, Y(0), X(0) - 18, Y(area.d), `${area.d}`, true);
  // 존(점쇄선 — 구역 경계 관례)
  for (const zn of zl) {
    svg.push(`<rect x="${X(zn.x)}" y="${Y(zn.y, zn.d)}" width="${zn.w * S}" height="${zn.d * S}" fill="#3b82f60d" stroke="#2563eb" stroke-dasharray="10 3 2 3" stroke-width="0.9"/>`);
    svg.push(`<text x="${X(zn.x) + 3}" y="${Y(zn.y, zn.d) + 11}" font-size="9" fill="#1d4ed8">${zn.id} z${zn.zMin}~${Number.isFinite(zn.zMax) ? zn.zMax : '∞'}</text>`);
  }
  // 아이템 — kind 심볼(P&ID·도면 관례): tank=이중원, pump=원+삼각, vessel=원,
  // filter=원+수직선, cabinet=사각+문호선, 기본=사각. 중심선(일점쇄선) 동반.
  const kindOf = (id, k) => k ?? (/tank/.test(id) ? 'tank' : /pump/.test(id) ? 'pump' : /filter/.test(id) ? 'filter' : /erd|vessel/.test(id) ? 'vessel' : /cab|panel|hmi/.test(id) ? 'cabinet' : 'box');
  for (const zn of zl) {
    for (const p of zn.placed) {
      const cx = X(p.x + p.w / 2), cy = Y(p.y, p.d) + (p.d * S) / 2;
      const rw = p.w * S, rd = p.d * S;
      const kind = kindOf(p.id, p.kind);
      if (kind === 'tank' || kind === 'vessel' || kind === 'pump' || kind === 'filter') {
        const r = Math.min(rw, rd) / 2;
        svg.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1f5f9" stroke="#334155" stroke-width="1.1"/>`);
        if (kind === 'tank') svg.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.82}" fill="none" stroke="#334155" stroke-width="0.7"/>`);
        if (kind === 'pump') svg.push(`<path d="M ${cx - r * 0.5} ${cy + r * 0.55} L ${cx + r * 0.5} ${cy + r * 0.55} L ${cx} ${cy - r * 0.6} Z" fill="none" stroke="#334155" stroke-width="1"/>`);
        if (kind === 'filter') svg.push(`<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="#334155" stroke-width="0.9"/>`);
        // 중심선(일점쇄선)
        svg.push(`<line x1="${cx - r - 6}" y1="${cy}" x2="${cx + r + 6}" y2="${cy}" stroke="#94a3b8" stroke-width="0.6" stroke-dasharray="8 2 2 2"/>`);
        svg.push(`<line x1="${cx}" y1="${cy - r - 6}" x2="${cx}" y2="${cy + r + 6}" stroke="#94a3b8" stroke-width="0.6" stroke-dasharray="8 2 2 2"/>`);
      } else {
        svg.push(`<rect x="${X(p.x)}" y="${Y(p.y, p.d)}" width="${rw}" height="${rd}" fill="#f1f5f9" stroke="#334155" stroke-width="1.1"/>`);
        if (kind === 'cabinet') svg.push(`<path d="M ${X(p.x)} ${cy} A ${rw * 0.4} ${rw * 0.4} 0 0 1 ${X(p.x) + rw * 0.4} ${cy - rw * 0.4}" fill="none" stroke="#64748b" stroke-width="0.7"/>`);
      }
      svg.push(`<text x="${cx}" y="${cy + 3}" font-size="9" text-anchor="middle" fill="#0f172a">${p.id}</text>`);
      svg.push(`<text x="${cx}" y="${cy + 13}" font-size="7" text-anchor="middle" fill="#64748b">${p.w}×${p.d}</text>`);
    }
  }
  // 제목란(도면 관례)
  const ty0 = H2 - 30;
  svg.push(`<rect x="0" y="${ty0}" width="${W2}" height="30" fill="#f8fafc" stroke="#94a3b8"/>`);
  svg.push(`<text x="8" y="${ty0 + 12}" font-size="10" font-weight="bold" fill="#0f172a">배치계획도 (LAYOUT PLAN)</text>`);
  svg.push(`<text x="8" y="${ty0 + 24}" font-size="8" fill="#475569">영역 ${area.w}×${area.d}mm · 존 ${zl.length} · 장비 ${Object.keys(placements).length} · 축척 1:${Math.round(1 / S)} · nexyfab 자동생성(2D 계획 — 3D 게이트 별도)</text>`);
  svg.push(`<text x="${W2 - 8}" y="${ty0 + 18}" font-size="8" text-anchor="end" fill="#475569">심볼: ◎탱크 ○+△펌프 ○용기 □+호 캐비닛 · 일점쇄선=중심선 · 적색=치수(DIM)</text>`);
  svg.push('</svg>');

  return { ok: errors.length === 0, errors, warnings, placements, svg: svg.join('\n'), zones: zl.map((zn) => ({ id: zn.id, used: zn.placed.length })) };
}
