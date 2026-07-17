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

// 부품 → 계통색 (service/role 우선, 없으면 type). 계통색 GA 3D·도면 색분류 공용.
export const SERVICE_COL = {
  feed: '#2563eb', hp: '#dc2626', permeate: '#0891b2', concentrate: '#ea580c', inlet: '#2563eb', outlet: '#0891b2', frame: '#3f4756', motor: '#4d7c0f', panel: '#59606b', sludge: '#8a5a2b',
  // 건축설비 MEP(위시빌더 배관 어휘의 비기계 적용): 급수·배수
  supply: '#0284c7', drain: '#92400e',
  // 비-기계 role (#6): 건축·조경·인테리어 부재 계통색
  column: '#475569', beam: '#0e7490', slab: '#94a3b8', joist: '#854d0e', deck: '#a16207', floor: '#d1d5db', table: '#0f766e', counter: '#7c3aed', wall: '#78716c', base: '#57534e',
  stack: '#7c2d12',
};
export const TYPE_COL = { box: '#5b6472', plate_with_holes: '#9aa7b5', stepped_plate: '#9aa7b5', base_plate: '#5b6472', l_bracket: '#8b98a6', bent_sheet: '#8b98a6', flange: '#78838f', tube: '#9aa7b5', rect_tube: '#3f4756', cylinder: '#9aa7b5', gusset: '#8b98a6', spur_gear: '#a16207', hex_bolt: '#6b7280', sheet_profile: '#8b98a6', wall_with_openings: '#78716c' };
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
  '#0284c7': '급수', '#92400e': '배수', '#7c2d12': 'PS/스택',
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
  for (const part of asm.parts ?? []) {
    const t = part.at ?? {};
    const tx = t.tx ?? 0, ty = t.ty ?? 0, tz = t.tz ?? 0, rx = t.rx ?? 0, ry = t.ry ?? 0, rz = t.rz ?? 0;
    const rot = (rx || ry || rz) ? [rx, ry, rz] : undefined;
    const p = part.params ?? {};
    const col = colorOf(part);
    const F = (kind, extra, lx = 0, ly = 0, lz = 0, op = 'add') => ({
      kind, ...extra, op, _col: col, at: { translate: [lx + tx, ly + ty, lz + tz], ...(rot ? { rotate: rot } : {}) },
    });
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
    return { ok: false, gateErrors: ['assembly: parts[] 비어있음'], interferences: [] };
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
  const CONTACT_MM = 2;
  const interferences = [];
  const contacts = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const { v, depth } = overlapInfo(boxes[i].box, boxes[j].box);
      const rotated = boxes[i].box.rotated || boxes[j].box.rotated;
      if (v > 1) { // 1mm³ 초과 겹침
        const rec = {
          a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +depth.toFixed(2),
          note: rotated ? '회전 AABB 겹침(보수적 — 실솔리드는 더 작을 수 있음)' : 'AABB 겹침',
        };
        if (depth <= CONTACT_MM) contacts.push({ ...rec, note: `접촉/체결 후보(관통 ${rec.depthMm}mm ≤ ${CONTACT_MM}mm) — 조인트 선언 정밀검증 후속` });
        else interferences.push(rec);
      }
    }
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
      const pipesIn = asm.pipes.map((pp) => ({ ...pp, col: pp.col ?? (pp.service && SERVICE_COL[pp.service]) ?? '#64748b' }));
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
        sleeves.push({ route: v.route, through: v.obstacle, d: rt?.d ?? 26, note: `관통 슬리브 필요(⌀${(rt?.d ?? 26) + 20} 내외 개산)` });
      }
      pipes = {
        routes: routed.routes, errors: routed.errors, notes: routed.notes,
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

  return { ok: true, openscad, parts: boxes.map((b) => ({ id: b.id, aabb: b.box })), gateErrors: [], interferences, contacts: contactsFinal, welds, weldTotalMm, composeIntent, structural, support, pipes, designOk };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('assembly.mjs');
if (isMain && process.argv[2]) {
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const r = buildAssembly(asm);
  console.log(JSON.stringify({ ok: r.ok, gateErrors: r.gateErrors, interferences: r.interferences, scadBytes: r.openscad?.length }, null, 1));
}
