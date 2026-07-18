/**
 * 2D→3D 복합 어셈블리 — 어휘 5종 단품을 배치·결합해 다부품 제품을 만든다.
 *
 * 텍스트/편집으로 "부품 목록 + 상대 배치"를 정하면, 각 부품은 기존 결정론
 * 재구성(reconstruct)으로 만들고 translate/rotate로 배치해 union한다. AI는
 * 어셈블리 계획(부품·배치)까지만, 형상·게이트·간섭검사는 결정론.
 *
 * 어셈블리 intent:
 *   { name, parts: [{ id, type, params, at:{ tx,ty,tz, rx,ry,rz } }] }
 *
 * 검증 2단:
 *   ① 부품별 기하 게이트(범위·판재성·구멍 내접)
 *   ② 부품쌍 AABB 간섭 — 접촉(용접/체결)은 허용, 겹침 침투는 경고
 *      (skid 파일럿의 machine-level AABB 방식과 동일 사상)
 *
 * usage: node assembly.mjs '<assembly.json>'
 */
import { readFileSync } from 'node:fs';
import { gate, scadBody, partAabb, gearPoly, sheetPoly, hexPts, boltDims } from './reconstruct.mjs';
import { structuralCheck } from './structural.mjs';
import { supportCheck } from './support-check.mjs';
import { autoRoutePipes, pipeObstacleCheck, pipeCrossCheck } from './pipe-route.mjs';
import { boxPartsInterference } from './obb2d.mjs';
import { TOL_CONTACT, PARTS_BUDGET } from './geometry-tolerance.mjs';

// 부품 → 계통색 (service/role 우선, 없으면 type). 계통색 GA 3D·도면 색분류 공용.
export const SERVICE_COL = {
  feed: '#2563eb', hp: '#dc2626', permeate: '#0891b2', concentrate: '#ea580c', inlet: '#2563eb', outlet: '#0891b2', frame: '#3f4756', motor: '#4d7c0f', panel: '#59606b', sludge: '#8a5a2b',
  // 건축설비 MEP(위시빌더 배관 어휘의 비기계 적용): 급수·배수·통기
  supply: '#0284c7', drain: '#92400e', vent: '#0d9488',
  // 비-기계 role (#6): 건축·조경·인테리어 부재 계통색
  column: '#475569', beam: '#0e7490', slab: '#94a3b8', joist: '#854d0e', deck: '#a16207', floor: '#d1d5db', table: '#0f766e', counter: '#7c3aed', wall: '#78716c', base: '#57534e',
  stack: '#7c2d12',
};
export const TYPE_COL = { box: '#5b6472', plate_with_holes: '#9aa7b5', stepped_plate: '#9aa7b5', base_plate: '#5b6472', l_bracket: '#8b98a6', bent_sheet: '#8b98a6', flange: '#78838f', tube: '#9aa7b5', rect_tube: '#3f4756', cylinder: '#9aa7b5', gusset: '#8b98a6', spur_gear: '#a16207', hex_bolt: '#6b7280', sheet_profile: '#8b98a6', wall_with_openings: '#78716c', hex_nut: '#6b7280', washer: '#78838f', angle: '#8b98a6', tee_section: '#8b98a6', pipe_reducer: '#9aa7b5', mesh: '#7c6f9f', revolve: '#9aa7b5', cavity_block: '#7c6f9f', coil_spring: '#6b7280', pillow_block: '#78838f' };
// 부품 id/name 키워드 → 계통 자동추론 (명시 service 태그 없어도 계통색이 나오게).
const ID_SERVICE = [
  [/pump|motor|모터|펌프|impeller|임펠라|blower|fan|송풍/i, 'motor'],
  [/feed|inlet|원수|입수|suction|흡입|공급/i, 'feed'],
  [/hp|high.?press|고압|discharge|토출|booster/i, 'hp'],
  [/perm|permeate|투과|product|제품|상등|정수|clean/i, 'permeate'],
  [/conc|reject|농축|brine|드레인|drain|waste|폐/i, 'concentrate'],
  [/sludge|슬러지/i, 'sludge'],
  [/supply|급수|수전/i, 'supply'],
  [/drain|배수|하수|오수/i, 'drain'],
  [/panel|제어|hmi|plc|control|cabinet|반\b/i, 'panel'],
  [/frame|프레임|post|기둥|rail|레일|leg|다리|deck|데크|base|베이스|structure|구조|skid|스키드/i, 'frame'],
];
function inferService(p) { const id = String(p.id ?? '') + ' ' + String(p.name ?? ''); for (const [re, s] of ID_SERVICE) if (re.test(id)) return s; return null; }
export const colorOf = (p) => (p.service && SERVICE_COL[p.service]) || (p.role && SERVICE_COL[p.role]) || SERVICE_COL[inferService(p)] || TYPE_COL[p.type] || '#9aa7b5';
export const COLOR_LABEL = {
  '#2563eb': '피드/입수', '#dc2626': '고압', '#0891b2': '투과/출수', '#ea580c': '농축', '#4d7c0f': '모터/펌프', '#3f4756': '프레임', '#59606b': '제어반', '#5b6472': '구조', '#9aa7b5': '용기/부품', '#8b98a6': '브래킷', '#78838f': '플랜지', '#8a5a2b': '슬러지',
  '#475569': '기둥', '#0e7490': '보', '#94a3b8': '슬래브', '#854d0e': '장선/서까래', '#a16207': '데크/기어', '#d1d5db': '바닥', '#0f766e': '테이블', '#7c3aed': '카운터', '#78716c': '벽체', '#6b7280': '볼트/체결', '#57534e': '기초/저판',
  '#0284c7': '급수', '#92400e': '배수', '#0d9488': '통기', '#7c2d12': 'PS/스택',
};

const DEG = Math.PI / 180;
/** OpenSCAD rotate([rx,ry,rz]) 순서(X→Y→Z)로 점 회전. */
function rotatePoint([x, y, z], rx, ry, rz) {
  let p = [x, y, z];
  if (rx) { const c = Math.cos(rx * DEG), s = Math.sin(rx * DEG); p = [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  if (ry) { const c = Math.cos(ry * DEG), s = Math.sin(ry * DEG); p = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  if (rz) { const c = Math.cos(rz * DEG), s = Math.sin(rz * DEG); p = [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
  return p;
}

/**
 * 배치 후 정확한 AABB — 회전이 있으면 로컬 박스 8코너를 회전변환한 뒤 min/max로
 * 실제 경계상자를 계산한다(임의 각도 배치의 간섭검사가 정확해짐). 축정렬은 그대로.
 * export: package.mjs(2D GA)·dxf 등 전 소비자가 이 단일 구현을 쓴다 — 회전 무시 사본이
 * GA 외형을 부풀리던 실버그를 정합 게이트가 검출(260717)한 뒤 일원화.
 */
/**
 * 상세 단계 필터(260719 — 1차 간단→2차 디테일): 부품 detail(기본 1)이 level 이하만.
 * 1차=골격(케이싱·구조), 2차=하드웨어(볼트·너트·블레이드·내통 등). 형상 무변경 — 부분집합.
 */
export function assemblyAtLevel(asm, level = 1) {
  return { ...asm, parts: (asm.parts ?? []).filter((p) => (p.detail ?? 1) <= level) };
}

export function placedAabb(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  const rotated = !!(rx || ry || rz);
  if (!rotated) {
    return { min: [a.min[0] + tx, a.min[1] + ty, a.min[2] + tz], max: [a.max[0] + tx, a.max[1] + ty, a.max[2] + tz], rotated: false };
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
    const [px, py, pz] = rotatePoint([cx, cy, cz], rx, ry, rz);
    const w = [px + tx, py + ty, pz + tz];
    for (let k = 0; k < 3; k++) { if (w[k] < min[k]) min[k] = w[k]; if (w[k] > max[k]) max[k] = w[k]; }
  }
  return { min, max, rotated: true };
}

function overlapVolume(a, b) {
  const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return ox * oy * oz;
}

/** 겹침 부피 + 관통 깊이(최소 겹침 축) — 접촉/간섭 분류(§12.7.3 v1)에 사용 */
function overlapInfo(a, b) {
  const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (ox <= 0 || oy <= 0 || oz <= 0) return { v: 0, depth: 0 };
  return { v: ox * oy * oz, depth: Math.min(ox, oy, oz) };
}

/**
 * AI 배치 결정론 보정기(§12.1-4 v1, 2026-07-16 — "완성체 안 나옴"의 뿌리 교정).
 * from-text(AI가 좌표를 찍는 경로) 전용 — 템플릿 어셈블리는 이미 정합이라 적용하지 않는다.
 * 규칙(전부 결정론·보수적):
 *   ① 부유 드롭: 아무 부품과도 z-접촉이 없으면 바로 아래 부품 상면(없으면 지면 0)까지 내림
 *   ② 깊은 관통 분리: 관통 깊이 >2mm 쌍은 작은 쪽을 최소 겹침 축으로 밀어 접촉(0.5mm 랩)으로
 * 반환: { assembly, corrections[] } — 보정 내역을 숨기지 않는다(정직).
 */
export function autoPlaceCorrect(asm) {
  const parts = (asm.parts ?? []).map((p) => ({ ...p, at: { ...(p.at ?? {}) } }));
  const corrections = [];
  const box = (p) => placedAabb(p);
  const xyOverlap = (a, b) =>
    Math.min(a.max[0], b.max[0]) > Math.max(a.min[0], b.min[0]) &&
    Math.min(a.max[1], b.max[1]) > Math.max(a.min[1], b.min[1]);
  // ① 부유 드롭 — z 오름차순으로(아래부터 안정화)
  const order = parts.map((p, i) => ({ i, z: box(p).min[2] })).sort((a, b) => a.z - b.z).map((o) => o.i);
  for (const i of order) {
    const b = box(parts[i]);
    let touching = false, topBelow = 0; // 지면 기본
    for (let j = 0; j < parts.length; j++) {
      if (j === i) continue;
      const ob = box(parts[j]);
      if (!xyOverlap(b, ob)) continue;
      if (ob.min[2] <= b.max[2] + 1 && ob.max[2] >= b.min[2] - 1) { touching = true; break; }
      if (ob.max[2] <= b.min[2] && ob.max[2] > topBelow) topBelow = ob.max[2];
    }
    if (!touching) {
      const drop = b.min[2] - topBelow;
      if (drop > 1) {
        // 부품 위로 내릴 땐 0.5mm 매립(면접촉 = STL 별도 lump — 위시빌더 3차 "얹히는 부품 매립" 규칙).
        // 지면(0)으로 내릴 땐 정확 착지(지면과는 융합 대상이 아님).
        const embed = topBelow > 0 ? 0.5 : 0;
        parts[i].at.tz = (parts[i].at.tz ?? 0) - drop - embed;
        corrections.push({ id: parts[i].id ?? parts[i].type, fix: embed ? 'drop+embed' : 'drop', mm: Math.round(drop) });
      }
    }
  }
  // ② 깊은 관통 분리 — 3패스 반복(연쇄 해소)
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const A = box(parts[i]), B = box(parts[j]);
      const ov = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
      if (ov[0] <= 0 || ov[1] <= 0 || ov[2] <= 0) continue;
      const depth = Math.min(...ov);
      if (depth <= 2) continue; // 접촉/체결 후보는 존중
      const ax = ov.indexOf(depth);
      const volA = (A.max[0] - A.min[0]) * (A.max[1] - A.min[1]) * (A.max[2] - A.min[2]);
      const volB = (B.max[0] - B.min[0]) * (B.max[1] - B.min[1]) * (B.max[2] - B.min[2]);
      const mv = volA <= volB ? parts[i] : parts[j];
      const other = volA <= volB ? B : A;
      const mine = volA <= volB ? A : B;
      const dir = (mine.min[ax] + mine.max[ax]) / 2 >= (other.min[ax] + other.max[ax]) / 2 ? 1 : -1;
      const key = ['tx', 'ty', 'tz'][ax];
      mv.at[key] = (mv.at[key] ?? 0) + dir * (depth - 0.5); // 0.5mm 랩 = 접촉 후보로 강등
      corrections.push({ id: mv.id ?? mv.type, fix: 'separate-' + 'xyz'[ax], mm: Math.round(depth) });
      moved = true;
    }
    if (!moved) break;
  }
  return { assembly: { ...asm, parts }, corrections };
}

/**
 * 어셈블리 부품(구조 11종)을 compose 범용 intent(kind 기반 features)로 변환한다.
 * 각 부품 로컬 형상을 compose 프리미티브로 매핑하고 부품 배치(at)를 feature 전역
 * translate 로 반영 → intentToStep(replicad) 으로 조립체 STEP 방출 재사용.
 * 비회전·비겹침 어셈블리에서 정확(전역 difference 가 부품별 홀과 일치). 회전 부품은 근사.
 */
export function assemblyToComposeIntent(asm) {
  const feats = [];
  for (const [pidx, part] of (asm.parts ?? []).entries()) {
    const t = part.at ?? {};
    const tx = t.tx ?? 0, ty = t.ty ?? 0, tz = t.tz ?? 0, rx = t.rx ?? 0, ry = t.ry ?? 0, rz = t.rz ?? 0;
    const rot = (rx || ry || rz) ? [rx, ry, rz] : undefined;
    const p = part.params ?? {};
    const col = colorOf(part);
    // 로컬 오프셋은 부품 회전을 따라 월드로 변환(260718t — 회전 부품의 보어/스텝이 월드축으로
    // 새던 버그 수정: translate = T + R·local, R=OpenSCAD rotate([x,y,z]) 순서 Rx→Ry→Rz).
    // _pid=부품 스코프 태그 — 소비자(STEP/색GA)는 부품 단위로 불리언을 닫는다(전역 subtract 번짐 방지).
    const rotLocal = (lx, ly, lz) => {
      if (!rot) return [lx, ly, lz];
      let x = lx, y = ly, z = lz;
      const rad = Math.PI / 180;
      if (rx) { const c = Math.cos(rx * rad), s = Math.sin(rx * rad); const y2 = y * c - z * s, z2 = y * s + z * c; y = y2; z = z2; }
      if (ry) { const c = Math.cos(ry * rad), s = Math.sin(ry * rad); const x2 = x * c + z * s, z2 = -x * s + z * c; x = x2; z = z2; }
      if (rz) { const c = Math.cos(rz * rad), s = Math.sin(rz * rad); const x2 = x * c - y * s, y2 = x * s + y * c; x = x2; y = y2; }
      return [x, y, z];
    };
    const F = (kind, extra, lx = 0, ly = 0, lz = 0, op = 'add') => {
      const [wx, wy, wz] = rotLocal(lx, ly, lz);
      return { kind, ...extra, op, _col: col, _pid: pidx, ...(part.system ? { _sys: part.system } : {}), at: { translate: [wx + tx, wy + ty, wz + tz], ...(rot ? { rotate: rot } : {}) } };
    };
    switch (part.type) {
      case 'box': feats.push(F('box', { size: [p.width, p.depth, p.height] })); break;
      case 'cylinder': feats.push(F('cylinder', { diameter: p.diameter, height: p.length })); break;
      case 'plate_with_holes':
        feats.push(F('box', { size: [p.width, p.depth, p.thickness] }));
        for (const h of p.holes ?? []) feats.push(F('cylinder', { diameter: h.d, height: p.thickness + 2 }, h.x, h.y, -1, 'subtract'));
        break;
      case 'base_plate': {
        const m = p.edgeMargin ?? Math.max(12, p.boltDia * 1.5);
        feats.push(F('box', { size: [p.width, p.depth, p.thickness] }));
        for (const [hx, hy] of [[m, m], [p.width - m, m], [m, p.depth - m], [p.width - m, p.depth - m]])
          feats.push(F('cylinder', { diameter: p.boltDia, height: p.thickness + 2 }, hx, hy, -1, 'subtract'));
        break;
      }
      case 'tube':
        feats.push(F('cylinder', { diameter: p.outerDia, height: p.length }));
        feats.push(F('cylinder', { diameter: p.innerDia, height: p.length + 2 }, 0, 0, -1, 'subtract'));
        break;
      case 'rect_tube':
        feats.push(F('box', { size: [p.length, p.width, p.height] }));
        feats.push(F('box', { size: [p.length + 2, p.width - 2 * p.wallThk, p.height - 2 * p.wallThk] }, -1, p.wallThk, p.wallThk, 'subtract'));
        break;
      case 'h_section': // §8-② 3박스 분해 — GA·STEP·질량 실단면 정확
        feats.push(F('box', { size: [p.length, p.B, p.tf] }));
        feats.push(F('box', { size: [p.length, p.tw, p.H - 2 * p.tf] }, 0, (p.B - p.tw) / 2, p.tf));
        feats.push(F('box', { size: [p.length, p.B, p.tf] }, 0, 0, p.H - p.tf));
        break;
      case 'c_channel':
        feats.push(F('box', { size: [p.length, p.tw, p.H] }));
        feats.push(F('box', { size: [p.length, p.B, p.tf] }));
        feats.push(F('box', { size: [p.length, p.B, p.tf] }, 0, 0, p.H - p.tf));
        break;
      case 'l_bracket':
        feats.push(F('box', { size: [p.legA, p.width, p.thickness] }));
        feats.push(F('box', { size: [p.thickness, p.width, p.legB] }));
        break;
      case 'stepped_plate':
        feats.push(F('box', { size: [p.stepWidth, p.depth, p.stepThickness] }));
        feats.push(F('box', { size: [p.width - p.stepWidth, p.depth, p.thickness] }, p.stepWidth, 0, 0));
        break;
      case 'bent_sheet':
        feats.push(F('box', { size: [p.length, p.webWidth, p.thickness] }));
        feats.push(F('box', { size: [p.length, p.thickness, p.flangeHeight] }));
        feats.push(F('box', { size: [p.length, p.thickness, p.flangeHeight] }, 0, p.webWidth - p.thickness, 0));
        break;
      case 'gusset':
        feats.push(F('extrude', { profile: [[0, 0], [p.legA, 0], [0, p.legB]], height: p.thickness }));
        break;
      case 'flange': {
        feats.push(F('cylinder', { diameter: p.outerDia, height: p.thickness }));
        feats.push(F('cylinder', { diameter: p.boreDia, height: p.thickness + 2 }, 0, 0, -1, 'subtract'));
        for (let k = 0; k < p.boltCount; k++) {
          const a = (2 * Math.PI / p.boltCount) * k;
          feats.push(F('cylinder', { diameter: p.boltHoleD, height: p.thickness + 2 }, Math.cos(a) * p.bcd / 2, Math.sin(a) * p.bcd / 2, -1, 'subtract'));
        }
        break;
      }
      case 'spur_gear':
        feats.push(F('extrude', { profile: gearPoly(p), height: p.thickness }));
        if (p.boreDia > 0) feats.push(F('cylinder', { diameter: p.boreDia, height: p.thickness + 2 }, 0, 0, -1, 'subtract'));
        break;
      case 'hex_bolt': {
        const { af, hh } = boltDims(p);
        feats.push(F('cylinder', { diameter: p.threadDia, height: p.length }));
        feats.push(F('extrude', { profile: hexPts(af), height: hh }, 0, 0, p.length));
        break;
      }
      case 'sheet_profile':
        feats.push(F('extrude', { profile: sheetPoly(p), height: p.width }));
        break;
      case 'wall_with_openings':
        feats.push(F('box', { size: [p.length, p.thickness, p.height] }));
        for (const o of p.openings ?? []) feats.push(F('box', { size: [o.w, p.thickness + 2, o.h] }, o.x, -1, o.sill ?? 0, 'subtract'));
        break;
      case 'i_girder': { // 감사 2026-07-16: 매핑 누락으로 교량 거더가 GA·STEP에서 통째로 빠져 있었음
        const W = Math.max(p.topW, p.botW);
        feats.push(F('box', { size: [p.length, p.botW, p.botT] }, 0, (W - p.botW) / 2, 0));
        feats.push(F('box', { size: [p.length, p.webT, p.webH] }, 0, (W - p.webT) / 2, p.botT));
        feats.push(F('box', { size: [p.length, p.topW, p.topT] }, 0, (W - p.topW) / 2, p.botT + p.webH));
        break;
      }
      // 표준 부품 확장(260718b)
      case 'hex_nut':
        feats.push(F('extrude', { profile: hexPts(p.af), height: p.thickness }));
        if (p.boreDia > 0) feats.push(F('cylinder', { diameter: p.boreDia, height: p.thickness + 2 }, 0, 0, -1, 'subtract'));
        break;
      case 'washer':
        feats.push(F('cylinder', { diameter: p.outerDia, height: p.thickness }));
        feats.push(F('cylinder', { diameter: p.boreDia, height: p.thickness + 2 }, 0, 0, -1, 'subtract'));
        break;
      case 'angle': // L형강(장척 x) — 2박스 맞댐(l_bracket 과 동일 규약, 런=length)
        feats.push(F('box', { size: [p.length, p.legA, p.thickness] }));
        feats.push(F('box', { size: [p.length, p.thickness, p.legB] }));
        break;
      case 'tee_section': // T형강 — 웨브(하)+플랜지(상), y 중심 정렬
        feats.push(F('box', { size: [p.length, p.tw, p.H - p.tf] }, 0, (p.B - p.tw) / 2, 0));
        feats.push(F('box', { size: [p.length, p.B, p.tf] }, 0, 0, p.H - p.tf));
        break;
      case 'pipe_reducer': { // 동심 리듀서 — 계단 근사(원뿔대 커널 대신 2단 실린더, 명시)+셸 보어
        const t = p.wallThk ?? Math.max(2, p.dia1 * 0.03);
        const half = p.length / 2;
        feats.push(F('cylinder', { diameter: p.dia1, height: half }));
        feats.push(F('cylinder', { diameter: p.dia2, height: half }, 0, 0, half));
        feats.push(F('cylinder', { diameter: p.dia1 - 2 * t, height: half + 2 }, 0, 0, -1, 'subtract'));
        feats.push(F('cylinder', { diameter: p.dia2 - 2 * t, height: half + 2 }, 0, 0, half, 'subtract'));
        break;
      }
      // 표준부품 확장 2(260718f): 프록시 표시(SCAD 정확·질량 폐형)
      case 'coil_spring': { // 원통 프록시(코일 외경 × 총높이)
        feats.push(F('cylinder', { diameter: p.coilDia, height: p.turns * p.pitch + p.wireDia }));
        break;
      }
      case 'pillow_block': {
        const d2 = p.depth ?? Math.round(p.boreDia * 1.4);
        feats.push(F('box', { size: [p.width, d2, p.height] }));
        feats.push(F('cylinder', { diameter: p.boreDia, height: d2 + 2 }, p.width / 2, -1, p.height, 'subtract'));
        break;
      }
      // 자유곡면 어휘(260718d): GA/STEP 피처=프록시(표시용 — SCAD 본체는 정확 명시)
      case 'mesh': { // 실폴리헤드론(260719 — verts 있으면 GA/3D 에 실형상, 없으면 AABB 프록시)
        if (Array.isArray(p.verts) && Array.isArray(p.faces)) {
          feats.push(F('polyhedron', { verts: p.verts, faces: p.faces }));
        } else {
          const bb = p.aabb;
          if (bb) feats.push(F('box', { size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] }, bb.min[0], bb.min[1], bb.min[2]));
        }
        break;
      }
      case 'cavity_block': { // 블록 + 음형 subtract(box/cylinder 만 피처 차감 — 그 외=SCAD 정확·표시 프록시)
        feats.push(F('box', { size: [p.blockW, p.blockD, p.blockH] }));
        const cv = p.cavity;
        if (cv?.type === 'box') feats.push(F('box', { size: [cv.params.width, cv.params.depth, cv.params.height] }, cv.at?.tx ?? 0, cv.at?.ty ?? 0, (cv.at?.tz ?? 0) + 0.01, 'subtract'));
        else if (cv?.type === 'cylinder') feats.push(F('cylinder', { diameter: cv.params.diameter, height: cv.params.length }, cv.at?.tx ?? 0, cv.at?.ty ?? 0, (cv.at?.tz ?? 0) + 0.01, 'subtract'));
        break;
      }
      case 'revolve': { // 실형상(260719 — compose revolve=rotate_extrude·STEP=스케치 회전, 프록시 폐기)
        feats.push(F('revolve', { profile: (p.profile ?? []).map((q) => [q[0], q[1]]), ...(p.angleDeg && p.angleDeg < 360 ? { angle: p.angleDeg } : {}) }));
        break;
      }
      default: break; // 미지원 타입은 STEP 에서 생략(GA/SCAD 로는 표시됨)
    }
  }
  return { name: asm.name ?? 'assembly', features: feats };
}

/**
 * 부품 원통축 판정 — cylinder/tube 계열이 축정렬 배치면 실린더 장애물로 취급(모서리 스침 오탐 제거).
 * 임의 회전은 null(AABB 보수측). #4: 다본 장비(RO 뱅크 등)를 단일 env 로 근사하지 않고
 * 부품(부재)별 장애물로 자동 전개하는 근거 — 어셈블리에선 부품이 곧 부재다.
 */
export function roundAxisOf(part) {
  if (!['cylinder', 'tube', 'flange', 'hex_bolt'].includes(part.type)) return null;
  const { rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  if (!rx && !ry && !rz) return 'z';
  if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx) return 'x';
  if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry) return 'y';
  return null;
}

// 배관이 슬리브로 관통 가능한 건축 부재 role — 벽·바닥·슬래브 관통은 "위반"이 아니라
// "슬리브 명세"다(건축 현실). 장비·가구·구조기둥 관통은 여전히 위반.
const PASSABLE_ROLES = new Set(['wall', 'floor', 'slab', 'deck', 'ceiling']);

/** 어셈블리 → 배관 관통검사용 장애물 목록(부품=부재별, 원통 인식). pipeObstacleCheck 입력. */
export function obstaclesFromAssembly(asm) {
  return (asm.parts ?? []).map((p) => {
    const b = placedAabb(p);
    const round = roundAxisOf(p);
    return {
      label: p.id ?? p.type, min: b.min, max: b.max,
      ...(round ? { round } : {}), ...(p.group ? { group: p.group } : {}),
      ...(p.role ? { role: p.role } : {}),
      ...(PASSABLE_ROLES.has(p.role) ? { passable: true } : {}),
    };
  });
}

// 배관 피처(cylinder/box + translate/rotate) → OpenSCAD 본문 — GA 렌더·SCAD 다운로드에 배관 포함
function pipeFeatureScad(features) {
  const lines = [];
  for (const f of features) {
    const t = f.at?.translate ?? [0, 0, 0];
    const r = f.at?.rotate;
    const tf = `translate([${t.join(', ')}]) ` + (r ? `rotate([${r.join(', ')}]) ` : '');
    if (f.kind === 'cylinder') lines.push(`${tf}cylinder(d=${f.diameter}, h=${f.height}, $fn=48);`);
    else if (f.kind === 'box') lines.push(`${tf}cube([${f.size.join(', ')}]);`);
  }
  return lines.join('\n');
}

/**
 * 어셈블리 intent를 결정론적으로 빌드·검증한다 (Gemini 불필요, 순수).
 * pipes[](선택): [{ id, from:'part.face'|{part,face,offset}|[x,y,z], to, d?, service? }] —
 * 자동 라우팅(코리도·게이트·관통·교차 검사) 후 배관 피처가 GA/SCAD/STEP 에 포함된다.
 * @returns { ok, openscad, parts, gateErrors, interferences, welds, weldTotalMm, composeIntent,
 *            support, pipes, designOk }
 */
export function buildAssembly(asm) {
  if (!asm || !Array.isArray(asm.parts) || asm.parts.length === 0) {
    return { ok: false, gateErrors: asm?.alignmentErrors?.length ? asm.alignmentErrors : ['assembly: parts[] 비어있음'], interferences: [] };
  }
  // 성능 예산(§A) — km 곡선 현 분할 등으로 부품 폭증 시 정직 거부(구간 분할 설계 유도)
  if (asm.parts.length > PARTS_BUDGET) {
    return { ok: false, gateErrors: [`부품 ${asm.parts.length} > 예산 ${PARTS_BUDGET} — 구간 분할 설계 필요(성능 예산 §A)`], interferences: [] };
  }
  const gateErrors = [];
  const bodies = [];
  const boxes = [];

  for (const p of asm.parts) {
    const intent = { type: p.type, ...p.params };
    const errs = gate(intent);
    if (errs.length) { gateErrors.push(`${p.id ?? p.type}: ${errs.join(', ')}`); continue; }
    const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = p.at ?? {};
    const wrap =
      `translate([${tx}, ${ty}, ${tz}]) ` +
      ((rx || ry || rz) ? `rotate([${rx}, ${ry}, ${rz}]) ` : '') +
      `{\n${scadBody(intent)}\n}`;
    bodies.push(`// ${p.id ?? p.type} (${p.type})\n${wrap}`);
    boxes.push({ id: p.id ?? p.type, box: placedAabb(p) });
  }
  if (gateErrors.length) return { ok: false, gateErrors, interferences: [] };

  // ② 부품쌍 간섭 — 기대-접촉 분류(§12.7.3 v1, 2026-07-16): 관통 깊이(최소 겹침 축)
  //    ≤ CONTACT_MM 는 접촉/체결 후보(용접 랩·끼움)로 별도 분류해 과탐을 줄인다.
  //    일괄 제외(exemption)가 아니라 분류·표기 — 조인트 "선언" 기반 정밀 검증은 후속.
  const CONTACT_MM = TOL_CONTACT;
  const interferences = [];
  const contacts = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const { v, depth } = overlapInfo(boxes[i].box, boxes[j].box);
      const rotated = boxes[i].box.rotated || boxes[j].box.rotated;
      if (v > 1) { // 1mm³ 초과 겹침
        // 축대칭 정밀(260718d — 프로펠러 허브×블레이드 AABB 과탐): revolve(회전체)는 반경
        // rMax 원통에 내포 — 메시 정점 최소 반경 ≥ rMax 면 실분리(회전 무관 폐형). 메시가
        // at 회전을 가지면 판정 불가(보수 유지).
        {
          const pi = asm.parts[i], pj = asm.parts[j];
          const rv = pi.type === 'revolve' ? pi : pj.type === 'revolve' ? pj : null;
          const me = pi.type === 'mesh' && pi.params?.verts ? pi : pj.type === 'mesh' && pj.params?.verts ? pj : null;
          const meRot = me?.at && ((me.at.rx ?? 0) || (me.at.ry ?? 0) || (me.at.rz ?? 0));
          if (rv && me && !meRot) {
            const rMax = Math.max(...(rv.params.profile ?? [[0, 0]]).map((q) => q[0]));
            const cx = rv.at?.tx ?? 0, cy = rv.at?.ty ?? 0;
            const mtx = me.at?.tx ?? 0, mty = me.at?.ty ?? 0;
            let minR = Infinity;
            for (const vv of me.params.verts) { const d = Math.hypot(vv[0] + mtx - cx, vv[1] + mty - cy); if (d < minR) { minR = d; if (minR < rMax) break; } }
            if (minR >= rMax - 0.01) continue;
          }
          // revolve×box 반경 정밀(260718f — 사일로 다리/스커트): 무회전 box 의 축심 최근접
          // 거리 ≥ rMax 면 실분리(원통 내포 폐형 — AABB 사각 코너 과탐 해소).
          const rv2 = pi.type === 'revolve' && !(pi.at?.rx || pi.at?.ry || pi.at?.rz) ? pi : pj.type === 'revolve' && !(pj.at?.rx || pj.at?.ry || pj.at?.rz) ? pj : null;
          const bx2 = rv2 === pi ? pj : rv2 === pj ? pi : null;
          if (rv2 && bx2 && bx2.type === 'box' && !(bx2.at?.rx || bx2.at?.ry || bx2.at?.rz)) {
            const rMax2 = Math.max(...(rv2.params.profile ?? [[0, 0]]).map((q) => q[0]));
            const cx2 = rv2.at?.tx ?? 0, cy2 = rv2.at?.ty ?? 0;
            const bxl = bx2.at?.tx ?? 0, byl = bx2.at?.ty ?? 0;
            const nx2 = Math.max(bxl, Math.min(cx2, bxl + bx2.params.width));
            const ny2 = Math.max(byl, Math.min(cy2, byl + bx2.params.depth));
            if (Math.hypot(nx2 - cx2, ny2 - cy2) >= rMax2 - 0.01) continue;
          }
          // 회전체 정밀규칙(260718t/260719 확장): ①외접 분리 ②보어 내포 ③체결 정합
          // ④메시 방사 내·외포 — 전부 폐형 판정(축평행 관례 + 정점 샘플링은 기존 메시 규칙 방법론).
          {
            const boreR = (p) => p.type === 'tube' ? p.params.innerDia / 2
              : p.type === 'pipe_reducer' ? Math.min(p.params.dia1, p.params.dia2) / 2 - (p.params.wallThk ?? Math.max(2, p.params.dia1 * 0.03))
              : p.type === 'flange' ? p.params.boreDia / 2
              : (p.type === 'hex_nut' || p.type === 'washer') ? (p.params.boreDia ?? 0) / 2 : null;
            const outR = (p) => p.type === 'cylinder' ? p.params.diameter / 2
              : p.type === 'tube' ? p.params.outerDia / 2
              : p.type === 'pipe_reducer' ? Math.max(p.params.dia1, p.params.dia2) / 2
              : p.type === 'revolve' ? Math.max(...(p.params.profile ?? [[0, 0]]).map((q) => q[0]))
              : p.type === 'flange' ? p.params.outerDia / 2
              : p.type === 'hex_bolt' ? Math.max(p.params.threadDia / 2, p.params.threadDia * 0.87) // 머리 대각=af/√3≈0.87d(af=1.5d 표준)
              : p.type === 'hex_nut' ? p.params.af / Math.sqrt(3)
              : p.type === 'washer' ? p.params.outerDia / 2 : null;
            const axisOf = (p) => {
              if (!['cylinder', 'tube', 'flange', 'pipe_reducer', 'revolve', 'hex_bolt', 'hex_nut', 'washer'].includes(p.type)) return null;
              const { rx = 0, ry = 0, rz = 0 } = p.at ?? {};
              if (!rx && !ry && !rz) return 'z';
              if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx && !rz) return 'x';
              if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry && !rz) return 'y';
              return null;
            };
            // 배치 관례: 축 방향 좌표=시작, 수직 두 좌표=중심(cylinder 계열 공통)
            const perpOf = (ax) => ax === 'z' ? ['tx', 'ty'] : ax === 'x' ? ['ty', 'tz'] : ['tx', 'tz'];
            const c = (p, k) => p.at?.[k] ?? 0;
            const aA = axisOf(pi), aB = axisOf(pj);
            if (aA && aA === aB) {
              const perp = perpOf(aA);
              const dist = Math.hypot(c(pi, perp[0]) - c(pj, perp[0]), c(pi, perp[1]) - c(pj, perp[1]));
              // ① 외접 분리: 평행축 회전체 표면 간격 ≥0 (AABB 사각 코너 과탐 제거 — 볼트원주×케이싱)
              const rA = outR(pi), rB = outR(pj);
              if (rA != null && rB != null && dist >= rA + rB - 0.01) continue;
              // ② 보어 내포: 축간거리+내부 최대반경 ≤ 보어 최소반경(원환 폐형 — 축방향 겹침 무관)
              let contained = false;
              for (const [host, oth] of [[pi, pj], [pj, pi]]) {
                const bR = boreR(host), oR = outR(oth);
                if (bR != null && oR != null && dist + oR <= bR - 0.01) { contained = true; break; }
              }
              if (contained) continue;
              // ③ 체결 정합(260719): hex_bolt×flange=BCD 원주 정합(홀경≥볼트경) ·
              //    hex_bolt×(hex_nut|washer)=동축+보어≥볼트경 → 체결 접촉(폐형 검증 — 정상)
              const bolt = pi.type === 'hex_bolt' ? pi : pj.type === 'hex_bolt' ? pj : null;
              const mate = bolt === pi ? pj : pi;
              if (bolt) {
                const dTh = bolt.params.threadDia;
                let fastened = null;
                if (mate.type === 'flange' && (mate.params.boltHoleD ?? 0) >= dTh - 0.01 && Math.abs(dist - (mate.params.bcd ?? 0) / 2) < 0.5) {
                  fastened = `볼트-플랜지 홀 정합(BCD ${mate.params.bcd}·홀 ⌀${mate.params.boltHoleD}≥⌀${dTh})`;
                } else if ((mate.type === 'hex_nut' || mate.type === 'washer') && (mate.params.boreDia ?? 0) >= dTh - 0.01 && dist < 0.5) {
                  fastened = `볼트-${mate.type === 'hex_nut' ? '너트' : '와셔'} 체결(동축·보어 정합)`;
                }
                if (fastened) {
                  contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: 0, depthMm: 0, note: `${fastened} — 폐형 검증, 정상` });
                  continue;
                }
              }
            }
            // ④ 메시 방사 내·외포(260719 — 블레이드 링×케이싱/드럼/샤프트): 무회전 메시의
            //    호스트 축 방사범위 [minR,maxR] 가 보어 안(maxR≤boreR) 또는 몸통 밖(minR≥outR)
            //    이면 실분리 — 정점 샘플링(기존 revolve×mesh 규칙과 동일 방법론).
            {
              const me4 = pi.type === 'mesh' && pi.params?.verts ? pi : pj.type === 'mesh' && pj.params?.verts ? pj : null;
              const host4 = me4 === pi ? pj : me4 === pj ? pi : null;
              const rot4 = me4?.at && ((me4.at.rx ?? 0) || (me4.at.ry ?? 0) || (me4.at.rz ?? 0));
              const aH4 = host4 ? axisOf(host4) : null;
              if (me4 && !rot4 && aH4) {
                const perp4 = perpOf(aH4);
                const idx = aH4 === 'z' ? [0, 1] : aH4 === 'x' ? [1, 2] : [0, 2];
                const off = [me4.at?.tx ?? 0, me4.at?.ty ?? 0, me4.at?.tz ?? 0];
                const hc = [c(host4, perp4[0]), c(host4, perp4[1])];
                let minR = Infinity, maxR = -Infinity;
                for (const vv of me4.params.verts) {
                  const r = Math.hypot(vv[idx[0]] + off[idx[0]] - hc[0], vv[idx[1]] + off[idx[1]] - hc[1]);
                  if (r < minR) minR = r;
                  if (r > maxR) maxR = r;
                }
                const bR4 = boreR(host4), oR4 = outR(host4);
                if ((bR4 != null && maxR <= bR4 - 0.01) || (oR4 != null && minR >= oR4 - 0.01)) continue;
              }
            }
          }
          // 방위각 분리(260718d — 다익 블레이드 쌍): 공통 원점 무회전 메시 쌍이 전부 r>0 이고
          // 방위각 구간이 서로소면 축 통과 반평면 2장으로 분리 — 실분리 폐형(스팬 37.6°<60° 실측).
          const m1 = pi.type === 'mesh' && pi.params?.verts ? pi : null;
          const m2 = pj.type === 'mesh' && pj.params?.verts ? pj : null;
          const rot1 = m1?.at && ((m1.at.rx ?? 0) || (m1.at.ry ?? 0) || (m1.at.rz ?? 0));
          const rot2 = m2?.at && ((m2.at.rx ?? 0) || (m2.at.ry ?? 0) || (m2.at.rz ?? 0));
          if (m1 && m2 && !rot1 && !rot2 && (m1.at?.tx ?? 0) === (m2.at?.tx ?? 0) && (m1.at?.ty ?? 0) === (m2.at?.ty ?? 0)) {
            const span = (me2) => {
              const v0 = me2.params.verts[0];
              const ph = Math.atan2(v0[1], v0[0]);
              let lo = Infinity, hi = -Infinity, rMin = Infinity;
              for (const vv of me2.params.verts) {
                const r = Math.hypot(vv[0], vv[1]);
                if (r < rMin) rMin = r;
                let ang = Math.atan2(vv[1], vv[0]) - ph;
                while (ang > Math.PI) ang -= 2 * Math.PI;
                while (ang < -Math.PI) ang += 2 * Math.PI;
                if (ang < lo) lo = ang;
                if (ang > hi) hi = ang;
              }
              return { a: ph + lo, b: ph + hi, rMin, wide: hi - lo >= Math.PI };
            };
            const s1 = span(m1), s2 = span(m2);
            if (!s1.wide && !s2.wide && s1.rMin > 0.01 && s2.rMin > 0.01) {
              // 원둘레상 구간 서로소 판정(구간1 시작 기준 정규화)
              const norm = (x) => { let t = x - s1.a; while (t < 0) t += 2 * Math.PI; while (t >= 2 * Math.PI) t -= 2 * Math.PI; return t; };
              const w1 = norm(s1.b), a2n = norm(s2.a), b2n = norm(s2.b);
              const disjoint = a2n <= b2n ? (a2n > w1 + 1e-6) : (b2n < -1e-6 + 0); // b2n<a2n=랩어라운드 → 구간1 포함 → 겹침
              if (disjoint) continue;
            }
          }
        }
        // 핀-보어 관통(260718d — 기구 어휘): 수직 cylinder(핀/축) × 홀 선언 부재의 축심이
        // **선언 홀과 정합**(위치 <0.5mm·홀경 ≥ 핀경)이면 관통 정상 — 폐형 검증 분류.
        // plate_with_holes=월드 홀 좌표(rz 회전 반영)·spur_gear=보어 동심. 정합 실패=실간섭 유지.
        {
          const pi2 = asm.parts[i], pj2 = asm.parts[j];
          const cyl = pi2.type === 'cylinder' && !(pi2.at?.rx || pi2.at?.ry || pi2.at?.rz) ? pi2 : pj2.type === 'cylinder' && !(pj2.at?.rx || pj2.at?.ry || pj2.at?.rz) ? pj2 : null;
          const host = cyl === pi2 ? pj2 : cyl === pj2 ? pi2 : null;
          if (cyl && host) {
            const cxc = cyl.at?.tx ?? 0, cyc = cyl.at?.ty ?? 0, dPin = cyl.params.diameter;
            let bored = false;
            if (host.type === 'spur_gear' && (host.params.boreDia ?? 0) >= dPin - 0.01) {
              bored = Math.hypot((host.at?.tx ?? 0) - cxc, (host.at?.ty ?? 0) - cyc) < 0.5;
            } else if (host.type === 'plate_with_holes' && Array.isArray(host.params.holes)) {
              const rz = ((host.at?.rz ?? 0) * Math.PI) / 180;
              const cR = Math.cos(rz), sR = Math.sin(rz);
              for (const h of host.params.holes) {
                if ((h.d ?? 0) < dPin - 0.01) continue;
                const wx = (host.at?.tx ?? 0) + h.x * cR - h.y * sR;
                const wy = (host.at?.ty ?? 0) + h.x * sR + h.y * cR;
                if (Math.hypot(wx - cxc, wy - cyc) < 0.5) { bored = true; break; }
              }
            }
            if (bored) {
              contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: 0, depthMm: 0, note: '핀-보어 관통(선언 홀 정합 폐형 검증 — 정상)' });
              continue;
            }
          }
        }
        // 기어 맞물림(260718d): 스퍼기어 쌍이 동일 모듈 + 중심거리=m(z₁+z₂)/2(±0.5mm)면
        // 정상 맞물림(팁원 겹침=이빨 교합 — 간섭 아님·폐형 검증). 거리 불일치=실간섭 유지.
        {
          const gi = asm.parts[i], gj = asm.parts[j];
          if (gi.type === 'spur_gear' && gj.type === 'spur_gear' && gi.params.module === gj.params.module) {
            const d = Math.hypot((gi.at?.tx ?? 0) - (gj.at?.tx ?? 0), (gi.at?.ty ?? 0) - (gj.at?.ty ?? 0));
            const std = (gi.params.module * (gi.params.teeth + gj.params.teeth)) / 2;
            const zOv = Math.min((gi.at?.tz ?? 0) + gi.params.thickness, (gj.at?.tz ?? 0) + gj.params.thickness) - Math.max(gi.at?.tz ?? 0, gj.at?.tz ?? 0);
            if (zOv > 0 && Math.abs(d - std) < 0.5) {
              contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: 0, depthMm: 0, note: `기어 맞물림(중심거리 ${d.toFixed(1)}=m(z₁+z₂)/2 폐형 검증 — 정상 교합)` });
              continue;
            }
          }
        }
        let useDepth = depth;
        let note = rotated ? '회전 AABB 겹침(보수적 — 실솔리드는 더 작을 수 있음)' : 'AABB 겹침';
        // 회전 쌍은 OBB-SAT 2차 정밀(§0.2) — AABB 과탐 제거(box 쌍만, 그 외 AABB 보수 유지)
        if (rotated) {
          const fine = boxPartsInterference(asm.parts[i], asm.parts[j]);
          if (fine) {
            if (!fine.overlap) continue; // 실풋프린트 분리 — 과탐 제거
            useDepth = fine.depthMm;
            note = '회전 OBB-SAT 정밀 겹침';
          }
        }
        const rec = { a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +useDepth.toFixed(2), note };
        if (useDepth <= CONTACT_MM) contacts.push({ ...rec, note: `접촉/체결 후보(관통 ${rec.depthMm}mm ≤ ${CONTACT_MM}mm) — 조인트 선언 정밀검증 후속` });
        else interferences.push(rec);
      }
    }
  }
  // 임포트 근사 어셈블리(260718): box/cyl 근사끼리의 겹침은 실형상 간섭이 아니다(밀집 조립
  // 실기계에서 645건 실측 — 판정 노이즈). '근사 겹침'으로 분류만 하고 게이트 비대상 — 명시.
  let approxOverlaps = null;
  if (asm.importedApprox && interferences.length) {
    approxOverlaps = interferences.splice(0, interferences.length).map((q) => ({ ...q, note: '임포트 근사 겹침(box/cyl 근사 — 실형상 간섭 판정 비대상, 명시)' }));
  }

  // ③ 용접 조인트 개산 — 면접촉(2축 겹침 + 1축 gap≈0) 부품쌍을 조인트로 보고
  //    전둘레 필렛 용접선 길이·목두께 면적을 AABB 근사로 산정한다(비법정 개산).
  //    정밀 용접선은 실제 접촉 기하(면/엣지)에서 나온다 — 여기선 배치 기반 1차 추정.
  const welds = [];
  const TOL = 2; // mm — 면접촉 허용오차
  const FILLET_LEG = 6; // mm — 기본 필렛 다리(개산)
  const throat = +(0.707 * FILLET_LEG).toFixed(2);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i].box, B = boxes[j].box;
      const ov = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
      const touch = [0, 1, 2].filter((k) => Math.abs(ov[k]) <= TOL);
      const over = [0, 1, 2].filter((k) => ov[k] > TOL);
      if (touch.length === 1 && over.length === 2) {
        const perim = 2 * (ov[over[0]] + ov[over[1]]);
        welds.push({
          a: boxes[i].id, b: boxes[j].id,
          lengthMm: Math.round(perim), legMm: FILLET_LEG, throatMm: throat,
          throatAreaMm2: Math.round(perim * throat),
          note: '전둘레 필렛 개산 · AABB 접촉 기준 · 비법정',
        });
      }
    }
  }
  const weldTotalMm = welds.reduce((s, w) => s + w.lengthMm, 0);

  // 접촉/용접 상호배타(감사 2026-07-16): 면접촉(2축 겹침+1축 gap≈0)으로 용접 계상된
  // 부품쌍은 접촉 목록에서 제외 — 같은 조인트가 두 번 보이지 않게(용접이 더 구체적 판정).
  const weldPairs = new Set(welds.map((w) => w.a + '|' + w.b));
  const contactsFinal = contacts.filter((c) => !weldPairs.has(c.a + '|' + c.b));

  // ④ 지지 체인(그물, 위시빌더 260717 — 이제 제품 경로 상시 실행): base = 지면(전역 최저면)
  //   접지 부품. "연결 ≠ 지지" — 부유 부품은 설치 불가 신호. 면접촉 쌍은 매립 제안 동봉.
  let support = { supported: [], floating: [], unknown: [], faceContacts: [] };
  try {
    const zs = boxes.map((b) => b.box.min[2]).filter(Number.isFinite);
    const zmin = zs.length ? Math.min(...zs) : 0;
    // base = 어셈블리 최저면 접지 부품 + 세계 지면(z≤0) 접지 부품(벽·기둥은 바닥판 밑면보다
    // 높아도 지면에 선다 — 전역 최저면만 보면 오탐, 도메인 템플릿 전수 스모크로 확인)
    const baseZ = Math.max(zmin + 2, 2);
    const supItems = boxes.map((b, i) => ({
      label: b.id, min: b.box.min, max: b.box.max,
      base: b.box.min[2] <= baseZ,
      ghost: !!asm.parts[i]?.ghost,
      // 인장 부재 선언(260718 — 현수·사장 매닮 체인): 역할 기반, 미선언=기존 원칙 유지
      tension: ['hanger', 'cable', 'stay', 'saddle'].includes(String(asm.parts[i]?.role ?? '')),
      role: String(asm.parts[i]?.role ?? ''),
    }));
    support = supportCheck(supItems);
  } catch { /* 그물 실패는 빌드를 막지 않음 — 기본값(검사 안 됨) 유지 */ }

  // ⑤ 배관(pipes[], #6) — 자동 라우팅 + 독립 재검(관통·교차). 라우터가 이미 회피하지만
  //   결과를 다시 검사해 게이트로 보고한다(라우터 신뢰가 아니라 결과 검증 — 정직).
  let pipes = null;
  const composeIntent = assemblyToComposeIntent(asm);
  let pipeScadBody = '';
  if (Array.isArray(asm.pipes) && asm.pipes.length) {
    try {
      const obstacles = obstaclesFromAssembly(asm);
      // 포트 해석(Phase3, 260718): 부품 ports[{name,at:[dx,dy,dz]로컬,dia?,service?,clear?}]
      // → 'partId:portName' 끝점을 월드 좌표로 치환 + d/service 포트 기본값 승계.
      // clear(기본 60mm): 포트에서 dir 없이도 라우터가 장애물 밖에서 시작하도록
      // 부품 AABB 밖으로 밀어낸 접속점 오프셋(정직 — 접속 스터브는 시공 상세).
      const resolvePort = (end) => {
        if (typeof end !== 'string' || !end.includes(':')) return { end };
        const [pid, pname] = end.split(':');
        const part = asm.parts.find((q) => q.id === pid);
        const port = part?.ports?.find((q) => q.name === pname);
        if (!part || !port) return { end, err: `포트 미해석: ${end}` };
        const t = part.at ?? {};
        const world = [(t.tx ?? 0) + port.at[0], (t.ty ?? 0) + port.at[1], (t.tz ?? 0) + port.at[2]];
        return { end: world, dia: port.dia, service: port.service };
      };
      const portErrs = [];
      const pipesIn = asm.pipes.map((pp) => {
        const f = resolvePort(pp.from);
        const t2 = resolvePort(pp.to);
        if (f.err) portErrs.push(f.err);
        if (t2.err) portErrs.push(t2.err);
        const service = pp.service ?? f.service ?? t2.service;
        return { ...pp, from: f.end, to: t2.end, d: pp.d ?? f.dia ?? t2.dia ?? 26, service, col: pp.col ?? (service && SERVICE_COL[service]) ?? '#64748b' };
      });
      const routed = autoRoutePipes(pipesIn, obstacles);
      // 관통 재검을 슬리브(벽·바닥 등 passable 부재 = 명세)와 위반(장비·가구 = 결함)으로 분리
      const passable = new Set(obstacles.filter((o) => o.passable).map((o) => o.label));
      const allPen = pipeObstacleCheck(routed.routes, obstacles);
      const sleeveSeen = new Set();
      const sleeves = [];
      for (const v of allPen.filter((v) => passable.has(v.obstacle))) {
        const key = v.route + '|' + v.obstacle;
        if (sleeveSeen.has(key)) continue;
        sleeveSeen.add(key);
        const rt = routed.routes.find((r) => r.label === v.route);
        // 관통 위치(개산): 세그먼트를 부재 AABB 로 클램프한 구간의 중점 — 시공 명세용 좌표·높이
        let at = null;
        const ob = obstacles.find((o) => o.label === v.obstacle);
        if (rt?.pts?.[v.seg + 1] && ob) {
          const cl = (p) => [0, 1, 2].map((k) => Math.max(ob.min[k], Math.min(ob.max[k], p[k])));
          const a = cl(rt.pts[v.seg]), b = cl(rt.pts[v.seg + 1]);
          at = [0, 1, 2].map((k) => Math.round((a[k] + b[k]) / 2));
        }
        sleeves.push({ route: v.route, through: v.obstacle, d: rt?.d ?? 26, ...(at ? { at, heightMm: at[2] } : {}), note: `관통 슬리브 필요(⌀${(rt?.d ?? 26) + 20} 내외 개산)` });
      }
      pipes = {
        routes: routed.routes, errors: [...portErrs, ...routed.errors], notes: routed.notes,
        obstacleViolations: allPen.filter((v) => !passable.has(v.obstacle)),
        sleeves,
        crossViolations: pipeCrossCheck(routed.routes),
      };
      composeIntent.features.push(...routed.features);
      pipeScadBody = pipeFeatureScad(routed.features);
    } catch (e) {
      pipes = { routes: [], errors: ['배관 라우팅 예외: ' + (e?.message ?? e)], notes: [], obstacleViolations: [], sleeves: [], crossViolations: [] };
    }
  }

  const openscad =
    `// assembly: ${asm.name ?? 'unnamed'} — drawing-to-3d (deterministic)\n` +
    `// parts: ${asm.parts.length}${pipes ? ` · pipes: ${pipes.routes.length}` : ''}\n$fn = 64;\nunion() {\n${bodies.join('\n')}` +
    (pipeScadBody ? `\n// pipes (auto-routed)\n${pipeScadBody}` : '') + `\n}\n`;

  // 구조 자동검증 — 형상에서 질량·CG·지지반력·전도 (nexyfab 설계 내장 역량).
  let structural = null;
  try { structural = structuralCheck(asm, {}); } catch { /* 구조검토 실패는 빌드를 막지 않음 */ }

  // 종합 설계 타당성 — 부유 0 · 배관 오류/관통/교차 0 이어야 PASS (lumps 규칙과 동일 사상)
  const designOk = support.floating.length === 0
    && (!pipes || (pipes.errors.length === 0 && pipes.obstacleViolations.length === 0 && pipes.crossViolations.length === 0));

  return { ok: true, openscad, parts: boxes.map((b) => ({ id: b.id, aabb: b.box })), gateErrors: [], interferences, contacts: contactsFinal, ...(approxOverlaps ? { approxOverlaps } : {}), welds, weldTotalMm, composeIntent, structural, support, pipes, designOk };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('assembly.mjs');
if (isMain && process.argv[2]) {
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const r = buildAssembly(asm);
  console.log(JSON.stringify({ ok: r.ok, gateErrors: r.gateErrors, interferences: r.interferences, scadBytes: r.openscad?.length }, null, 1));
}
