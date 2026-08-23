/**
 * std-snap.mjs — 시판 규격 스냅(G1, 260718). 실시도서의 발주 가능 치수 강제.
 *
 * 임의 치수 → 가장 가까운 시판 규격으로 스냅 + 편차 보고. 규격 외(편차 초과)는
 * 정직 경고(발주 불가 치수임을 목록화 — 좌표·형상을 조용히 바꾸지 않는다:
 * 스냅 적용 여부는 호출측 선택, 기본은 보고만).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonAsset } from './runtime-assets.mjs';

const moduleDir = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
export const STD = readJsonAsset('std-catalog.json', join(moduleDir, 'std-catalog.json'));

/** 외경(또는 호칭경) → 배관 규격. dn 직접 지정 시 정확 일치만. */
export function snapPipe(diaOrDn, { asDn = false, tolPct = 12 } = {}) {
  const rows = STD.pipe.dn;
  if (asDn) {
    const hit = rows.find((r) => r.dn === diaOrDn);
    return hit
      ? { ok: true, ...hit, label: `PIPE ${hit.dn}A SCH40 (OD${hit.od}×t${hit.sch40})`, spec: 'KS D 3507/3562' }
      : { ok: false, warning: `호칭경 ${diaOrDn}A 는 표준 목록 외` };
  }
  let best = rows[0];
  for (const r of rows) if (Math.abs(r.od - diaOrDn) < Math.abs(best.od - diaOrDn)) best = r;
  const devPct = Math.abs(best.od - diaOrDn) / best.od * 100;
  if (devPct > tolPct) return { ok: false, warning: `Ø${diaOrDn} 는 시판 배관 규격 외(최근접 ${best.dn}A OD${best.od}, 편차 ${devPct.toFixed(0)}%)` };
  return { ok: true, ...best, devPct: +devPct.toFixed(1), label: `PIPE ${best.dn}A SCH40 (OD${best.od}×t${best.sch40})`, spec: 'KS D 3507/3562' };
}

/** 호칭경 → 10K 플랜지 규격. */
export function snapFlange10k(dn) {
  const hit = STD.flange10k.dn.find((r) => r.dn === dn);
  return hit
    ? { ok: true, ...hit, label: `FLANGE ${dn}A 10K SOP (OD${hit.od}·PCD${hit.pcd}·${hit.nBolt}-⌀${hit.boltHole}·t${hit.thk})`, spec: 'KS B 1503' }
    : { ok: false, warning: `플랜지 ${dn}A 10K 표준 목록 외(다른 클래스는 미수록 — 정직 경고)` };
}

/** 변 길이 → 각형강관 규격(두께 후보 포함). */
export function snapSquareTube(side, { tolPct = 15 } = {}) {
  let best = STD.squareTube.sizes[0];
  for (const r of STD.squareTube.sizes) if (Math.abs(r.side - side) < Math.abs(best.side - side)) best = r;
  const devPct = Math.abs(best.side - side) / best.side * 100;
  if (devPct > tolPct) return { ok: false, warning: `□${side} 각관은 규격 외(최근접 □${best.side})` };
  return { ok: true, side: best.side, thkOptions: best.thk, devPct: +devPct.toFixed(1), label: `SQ TUBE ${best.side}×${best.side}`, spec: 'KS D 3568' };
}

/** 단면 w×h → 알루미늄 T슬롯 프로파일(R2-⑪). 방향 무관(작은변·큰변 정렬 후 대조). */
export function snapTslot(w, h = w, { tolPct = 10 } = {}) {
  const a = Math.min(w, h), b = Math.max(w, h);
  let best = null, bestDev = Infinity;
  for (const r of STD.tslot.sizes) {
    const dev = Math.abs(r.w - a) / r.w + Math.abs(r.h - b) / r.h;
    if (dev < bestDev) { bestDev = dev; best = r; }
  }
  const devPct = bestDev / 2 * 100;
  if (devPct > tolPct) return { ok: false, warning: `${a}×${b} 단면은 T슬롯 표준 시리즈 외(최근접 ${best.series})` };
  return { ok: true, ...best, devPct: +devPct.toFixed(1), label: `AL T-SLOT ${best.series} (슬롯${best.slot})`, spec: 'AL6063-T5 압출' };
}

/** 축경(내경) → 깊은홈 볼베어링(R2-⑪). 내경=정확 일치만(베어링은 근사 스냅 금지 — 정직).
 *  od 지정 시 외경 최근접 시리즈 선택, 미지정 시 경량(60xx) 우선. */
export function snapBearing(bore, { od } = {}) {
  const cands = STD.ballBearing.rows.filter((r) => r.d === bore);
  if (!cands.length) {
    let near = STD.ballBearing.rows[0];
    for (const r of STD.ballBearing.rows) if (Math.abs(r.d - bore) < Math.abs(near.d - bore)) near = r;
    return { ok: false, warning: `내경 ⌀${bore} 표준 베어링 없음(최근접 ${near.code} d${near.d} — 축경 변경 검토)` };
  }
  let hit = cands[0];
  if (od != null) for (const r of cands) if (Math.abs(r.D - od) < Math.abs(hit.D - od)) hit = r;
  return { ok: true, ...hit, label: `BEARING ${hit.code} (d${hit.d}×D${hit.D}×B${hit.B})`, spec: 'KS B 2023/ISO 15' };
}

/** 축경 → 필로우 블록 유닛 UCP(R2-⑪). 보어 정확 일치만. */
export function snapBearingUnit(bore) {
  const hit = STD.bearingUnit.rows.find((r) => r.bore === bore);
  if (!hit) {
    let near = STD.bearingUnit.rows[0];
    for (const r of STD.bearingUnit.rows) if (Math.abs(r.bore - bore) < Math.abs(near.bore - bore)) near = r;
    return { ok: false, warning: `축경 ⌀${bore} 표준 유닛 없음(최근접 ${near.code} bore${near.bore} — 축경 변경 검토)` };
  }
  return { ok: true, ...hit, label: `PILLOW BLOCK ${hit.code} (bore⌀${hit.bore}·H${hit.H}·J${hit.J}·M${hit.boltM})`, spec: 'JIS B 1559' };
}

/** 볼트 지름 → M 호칭. */
export function snapBolt(d) {
  let best = STD.bolt.sizes[0];
  for (const s of STD.bolt.sizes) if (Math.abs(s - d) < Math.abs(best - d)) best = s;
  return { ok: Math.abs(best - d) / best <= 0.3, m: best, label: `M${best}`, spec: 'KS B 1002' };
}

/**
 * 어셈블리 규격 감사(보고 전용 — 형상 무변경): 배관 d·플랜지·각관 부재를 규격 대조.
 * @returns { items:[{id,kind,input,snap}], warnings:[] }
 */
export function auditAssemblyStd(asm) {
  // 260728 정직 신호: 종전에는 `parts` 가 배열이 아니어도(예: 문자열) for-of 가 조용히
  // 글자를 훑고 `{items:[], warnings:[]}` 를 돌려줬다 — **쓰레기 감사가 깨끗한 감사와
  // 똑같이 읽혔다.** 감사할 수 없으면 그 사실을 warnings 에 실어 소비자까지 도달시킨다.
  if (!asm || typeof asm !== 'object') {
    return { ok: false, error: 'assembly 객체가 아니다', items: [], warnings: ['규격 감사 불가: assembly 가 객체가 아니다 — "규격 위반 없음"이 아니라 감사하지 못했다는 뜻이다'] };
  }
  const badParts = asm.parts != null && !Array.isArray(asm.parts);
  const badPipes = asm.pipes != null && !Array.isArray(asm.pipes);
  if (badParts || badPipes) {
    const which = [badParts && 'parts', badPipes && 'pipes'].filter(Boolean).join('·');
    return { ok: false, error: `${which} 가 배열이 아니다`, items: [], warnings: [`규격 감사 불가: ${which} 가 배열이 아니다 — 감사하지 못했다(위반 없음과 구별)`] };
  }
  const items = [];
  const warnings = [];
  for (const pp of asm.pipes ?? []) {
    if (typeof pp.d === 'number') {
      const s = snapPipe(pp.d);
      items.push({ id: pp.id, kind: 'pipe', input: pp.d, snap: s });
      if (!s.ok) warnings.push(`${pp.id}: ${s.warning}`);
      else if (s.devPct > 0.5) warnings.push(`${pp.id}: Ø${pp.d} → ${s.label} 스냅 권고(편차 ${s.devPct}%)`);
    }
  }
  for (const p of asm.parts ?? []) {
    if (p.type === 'box' && (p.role === 'column' || p.role === 'beam')) {
      // 알루미늄 프레임=T슬롯 표, 강재 정사각=각형강관 표(R2-⑪ 재질 분기)
      if (/alu/i.test(String(p.material ?? ''))) {
        const s = snapTslot(p.params.width, p.params.depth);
        items.push({ id: p.id, kind: 'tslot', input: [p.params.width, p.params.depth], snap: s });
        if (!s.ok) warnings.push(`${p.id}: ${s.warning}`);
      } else if (p.params?.width === p.params?.depth) {
        const s = snapSquareTube(p.params.width);
        items.push({ id: p.id, kind: 'squareTube', input: p.params.width, snap: s });
        if (!s.ok) warnings.push(`${p.id}: ${s.warning}`);
      }
    }
    if (p.type === 'pillow_block' && p.params?.boreDia != null) {
      const s = snapBearingUnit(p.params.boreDia);
      items.push({ id: p.id, kind: 'bearingUnit', input: p.params.boreDia, snap: s });
      if (!s.ok) warnings.push(`${p.id}: ${s.warning}`);
    }
    if (p.role === 'pipe' && p.type === 'cylinder') {
      const s = snapPipe(p.params.diameter);
      items.push({ id: p.id, kind: 'pipe', input: p.params.diameter, snap: s });
      if (!s.ok) warnings.push(`${p.id}: ${s.warning}`);
      else if (s.devPct > 0.5) warnings.push(`${p.id}: Ø${p.params.diameter} → ${s.label} 스냅 권고(편차 ${s.devPct}%)`);
    }
  }
  return { ok: true, items, warnings };
}
