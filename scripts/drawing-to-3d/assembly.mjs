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
import { gate, scadBody, partAabb, gearPoly, sheetPoly, hexPts, boltDims, holeFeature, extrudePoly, compositeSubs } from './reconstruct.mjs';
import { structuralCheck } from './structural.mjs';
import { supportCheck } from './support-check.mjs';
import { autoRoutePipes, pipeObstacleCheck, pipeCrossCheck } from './pipe-route.mjs';
import { boxPartsInterference } from './obb2d.mjs';
import { TOL_CONTACT, PARTS_BUDGET } from './geometry-tolerance.mjs';
import { resolveConstraints } from './assembly-constraints.mjs'; // ⓑ 관계 배치(런타임 호출 — 순환 안전)

// 부품 → 계통색 (service/role 우선, 없으면 type). 계통색 GA 3D·도면 색분류 공용.
export const SERVICE_COL = {
  feed: '#2563eb', hp: '#dc2626', permeate: '#0891b2', concentrate: '#ea580c', inlet: '#2563eb', outlet: '#0891b2', frame: '#3f4756', motor: '#4d7c0f', panel: '#59606b', sludge: '#8a5a2b',
  // 건축설비 MEP(위시빌더 배관 어휘의 비기계 적용): 급수·배수·통기
  supply: '#0284c7', drain: '#92400e', vent: '#0d9488',
  // 비-기계 role (#6): 건축·조경·인테리어 부재 계통색
  column: '#475569', beam: '#0e7490', slab: '#94a3b8', joist: '#854d0e', deck: '#a16207', floor: '#d1d5db', table: '#0f766e', counter: '#7c3aed', wall: '#78716c', base: '#57534e',
  stack: '#7c2d12',
};
export const TYPE_COL = { box: '#5b6472', plate_with_holes: '#9aa7b5', stepped_plate: '#9aa7b5', base_plate: '#5b6472', l_bracket: '#8b98a6', bent_sheet: '#8b98a6', flange: '#78838f', tube: '#9aa7b5', rect_tube: '#3f4756', cylinder: '#9aa7b5', gusset: '#8b98a6', spur_gear: '#a16207', hex_bolt: '#6b7280', sheet_profile: '#8b98a6', wall_with_openings: '#78716c', slab_with_openings: '#8a8175', tapered_girder: '#0e7490', hex_nut: '#6b7280', washer: '#78838f', angle: '#8b98a6', tee_section: '#8b98a6', pipe_reducer: '#9aa7b5', mesh: '#7c6f9f', revolve: '#9aa7b5', cavity_block: '#7c6f9f', coil_spring: '#6b7280', pillow_block: '#78838f', rebar: '#a16207', pipe_elbow: '#9aa7b5', pipe_tee: '#9aa7b5', extrude_profile: '#8b98a6', masonry_block: '#a8a29e', composite: '#6d7c8a' };
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

/**
 * 부품의 **계통/역할 라벨** (260801, 격차 W2).
 *
 * ★ 이 값은 지금까지 **3D 색분류에만** 쓰였다 — 화면에서는 색으로 구별되는데
 *   BOM 표에는 안 실려, 표만 받은 사람은 각 부품이 **무엇을 위한 것인지** 알 수 없었다.
 * ⚠ 없는 것을 지어내지 않는다: 우리가 계산하는 것은 **공정 계통**(피드·고압·투과·모터·
 *   프레임…)이지 구동계 역할(DRIVE/DRIVEN)이 아니다. 후자는 계산하지 않으므로 적지 않는다.
 * ⚠ 추론으로 얻은 값과 명시된 값을 구별해 돌려준다 — 추론은 id/name 키워드 기반이라
 *   틀릴 수 있고, 그 사실을 표에서 감추면 안 된다.
 */
export function serviceLabelOf(p) {
  // ⚠ 널 가드 — `inferService` 는 부품 객체를 전제한다(테스트가 잡아냈다).
  if (!p || typeof p !== 'object') return null;
  const explicit = p.service ?? p.role ?? null;
  const key = explicit ?? inferService(p);
  if (!key) return null;
  const label = COLOR_LABEL[SERVICE_COL[key]] ?? null;
  return label ? { label, key, inferred: !explicit } : null;
}
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
 * ★role → 계통 매핑 (260803 확장) — **STEP 조립 트리의 하위조립 이름이 여기서 나온다.**
 *
 * ⚠ 확장 근거는 추측이 아니라 **템플릿 55종 전수 실측**이다. 종전 표는 15개 role 만
 * 알아서 48/55 템플릿이 '부품' 한 덩어리로 떨어졌다(ceiling_grid 95/95, parking_pavement
 * 46/46). 트리는 계통이 갈려야 쓸모가 있다 — 전부 한 덩어리면 평면 나열과 다를 바 없다.
 *
 * ⚠ `shell`·`head` 를 '용기·장비' 가 아니라 **'외피·셸'** 로 둔 이유: 같은 role 이
 *   압력용기(동체)와 굴착버킷(외판) 양쪽에 쓰인다. 한쪽에만 맞는 이름을 붙이면
 *   다른 쪽 트리가 거짓말이 된다 — 두 곳에서 참인 이름을 고른다.
 *
 * ⚠ **export 인 이유**: 라우트 프롬프트가 이 목록을 AI 에게 알려 줘야 하는데, 거기에
 *   목록을 따로 적으면 갈린다(어휘 16종 하드코딩과 같은 결손). 회귀가 두 곳을 대조한다.
 */
export const SYS_ROLE = {
  // 구조·골격
  frame: '구조', column: '구조', beam: '구조', support: '구조', wall: '구조', floor: '구조',
  slab: '구조', deck: '구조', ceiling: '구조', base: '구조', link: '구조', sideplate: '구조', saddle_sup: '구조',
  // 설비·구동
  vessel: '용기·장비', tank: '용기·장비', pump: '구동', motor: '구동', joint: '구동', gripper: '구동',
  shell: '외피·셸', head: '외피·셸',
  cabinet: '전장', light: '전장', pipe: '배관', nozzle: '배관',
  // 철물
  mount: '거치·브래킷', bracket: '거치·브래킷', hinge: '거치·브래킷', boss: '거치·브래킷',
  fastener: '체결', pin: '체결', bolt: '체결',
  pad: '완충·패드', cushion: '완충·패드',
  stop: '스토퍼·가이드', guide: '스토퍼·가이드', rail: '스토퍼·가이드', slider: '스토퍼·가이드',
  edge: '마모부', tooth: '마모부',
  // 인테리어
  tee: '천장틀', hanger: '천장틀', tile: '마감재',
  // 토목·조경
  pavement: '포장', curb: '경계·연석', wheelstop: '경계·연석', coping: '경계·연석', parapet: '경계·연석',
  ground: '지반', building: '건물', green: '조경', trunk: '수목', canopy: '수목',
  // 부재(2차 실측 — 미분류 상위 role 을 role 빈도순으로 채웠다)
  girder: '주부재', chord: '주부재', arch: '주부재', crossbeam: '주부재', joist: '주부재',
  rafter: '주부재', purlin: '주부재', stringer: '주부재', header: '주부재', post: '구조',
  stud: '구조', vertical: '구조', pier: '하부구조', abutment: '하부구조', pedestal: '하부구조',
  plinth: '하부구조', pylon: '하부구조', tower: '하부구조', footing: '하부구조',
  diagonal: '가새·브레이싱', brace: '가새·브레이싱', bracing: '가새·브레이싱',
  cable: '케이블·정착', stay: '케이블·정착', anchorage: '케이블·정착', saddle: '케이블·정착',
  bearing: '받침·지승',
  board: '판재·마감', panel: '판재·마감', plate: '판재·마감', roof: '판재·마감', fence: '판재·마감',
  tread: '계단', landing: '계단', handrail: '난간', guardrail: '난간', guiderail: '난간', guard: '난간',
  duct: '덕트·설비', stack: '덕트·설비', inlet: '덕트·설비', outlet: '덕트·설비', valve: '덕트·설비',
  equipment: '용기·장비', conveyor: '용기·장비', shaft: '구동', trolley: '구동', hook: '구동',
  counterweight: '구동', cab: '운전실', car: '운전실', station: '운전실',
  table: '가구', counter: '가구', countertop: '가구', furniture: '가구', sofa: '가구', bed: '가구',
  toilet: '위생기구', basin: '위생기구', sink: '위생기구', bathtub: '위생기구',
  track: '궤도', buffer: '완충·패드', mold: '금형',
};
const SYS_TYPE = { hex_bolt: '체결', hex_nut: '체결', washer: '체결', flange: '플랜지', spur_gear: '구동', mesh: '자유곡면', coil_spring: '체결' };
const DETAIL2 = new Set(['hex_bolt', 'hex_nut', 'washer', 'mesh', 'coil_spring']);

/**
 * 계통/상세 자동 태깅(260719 — 1차 골격→2차 상세 웹 배선): 미지정 부품만 role/type
 * 휴리스틱으로 채움(기지정 값 불변). detail 2=철물·자유곡면(2차 상세), 그 외 1(골격).
 */
export function autoTagAssembly(asm) {
  const parts = (asm.parts ?? []).map((p) => ({
    ...p,
    ...(p.system ? {} : { system: SYS_TYPE[p.type] ?? SYS_ROLE[p.role] ?? '부품' }),
    ...(p.detail != null ? {} : DETAIL2.has(p.type) ? { detail: 2 } : {}),
  }));
  return { ...asm, parts };
}

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

/** 배치 후 로컬 AABB 8코너의 월드 좌표(E1 실윤곽 투영용) — placedAabb 와 동일 변환 단일 수학. */
export function placedCorners(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = part.at ?? {};
  const out = [];
  for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
    const [px, py, pz] = (rx || ry || rz) ? rotatePoint([cx, cy, cz], rx, ry, rz) : [cx, cy, cz];
    out.push([px + tx, py + ty, pz + tz]);
  }
  return out;
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
 *
 * ## ⚠ 순서가 규율이다 — **배치를 정한 뒤에 보정한다** (260803 실측 버그)
 * 종전에는 이 보정기가 **구속을 해석하기 전에** 돌았다(라우트: auto-fix → autoPlaceCorrect →
 * buildAssembly, 그리고 구속 해석은 `buildAssembly` 안에 있다). 구속만 선언하고 `at` 이 빈
 * 부품은 여기서 **전부 원점에 있는 것처럼** 보였고, 그 위에서 「부유 드롭·관통 분리」를
 * 계산해 **의미 없는 절대 좌표**를 써 넣었다. 그 뒤 구속 해석은 자기가 소유한 축만 덮으므로
 * **나머지 축에 엉터리 보정이 남았다.**
 * ```
 *   벤치 8부품: 좌판·등받이가 서로에 onFace+offset 으로 매달렸는데 부유 7 —
 *   좌판 1장만 서고 나머지는 원점 기준으로 「드롭」당한 상태였다.
 * ```
 * 그래서 여기서 **먼저 구속을 푼다.** 해석은 결정론이라 `buildAssembly` 가 다시 풀어도 같다.
 */
export function autoPlaceCorrect(asm) {
  /**
   * ⚠ 그리고 **푼 뒤에는 구속을 내려놓는다.** 안 그러면 `buildAssembly` 가 같은 구속을 다시
   * 풀어 **여기서 한 보정을 그대로 덮어쓴다**(실측: 부유 드롭·90° 회전이 전부 무효였다).
   * 원본은 `_constraints` 로 남겨 화면·프로버넌스가 볼 수 있게 하고, 해석 보고는
   * 어셈블리에 실어 `buildAssembly` 가 그대로 내보내게 한다.
   */
  let carriedConflicts = null;
  if ((asm?.parts ?? []).some((p) => Array.isArray(p.constraints) && p.constraints.length > 0)) {
    // 관용 모드 — 망가진 구속 하나로 보정 전체를 잃지 않는다(buildAssembly 와 같은 규약).
    try {
      const r = resolveConstraints(asm, { lenient: true });
      carriedConflicts = r.constraintConflicts ?? null;
      asm = {
        ...r,
        parts: r.parts.map((p) => (p.constraints?.length
          ? { ...p, _constraints: p.constraints, constraints: undefined }
          : p)),
      };
    } catch { /* 순환 등은 buildAssembly 가 게이트로 보고한다 */ }
  }
  const parts = (asm.parts ?? []).map((p) => ({ ...p, at: { ...(p.at ?? {}) } }));
  const corrections = [];
  const box = (p) => placedAabb(p);
  const xyOverlap = (a, b) =>
    Math.min(a.max[0], b.max[0]) > Math.max(a.min[0], b.min[0]) &&
    Math.min(a.max[1], b.max[1]) > Math.max(a.min[1], b.min[1]);
  /**
   * ★① -b **부유 부품 90° 회전 시도**(260803) — 「긴 축을 잘못 놓았다」의 결정론 교정.
   *
   * 실측(벤치): 좌판 `60×1800` 을 **긴 축(1800)이 y** 로 놓았는데 다리는 **x 로 1400** 떨어져
   * 있어 좌판 5장 전부가 어디에도 안 걸렸다(부유 8/10). 사람 눈에는 「90도 돌리면 되는」
   * 상황이고, **치수는 그대로**다 — 지어내는 게 아니라 방향만 바꾼다.
   *
   * ## 규율
   * - 회전은 부품 **로컬 원점** 기준이라 AABB 가 이동한다 → 회전 뒤 **중심을 원위치**로 되돌린다.
   * - **엄격히 나아질 때만** 채택한다: 지지가 생기고(아래에 걸침) **새 관통이 늘지 않아야** 한다.
   * - 정사각 단면처럼 회전해도 AABB 가 같으면 건드리지 않는다(무의미한 보정 기록 방지).
   * - 채택하면 `corrections` 로 보고한다 — 우리가 방향을 바꿨다는 사실을 숨기지 않는다.
   */
  /**
   * 「아래에 받칠 것이 있는가」 — 높이는 안 본다(그건 ① 드롭이 맞춘다).
   * 회전 판단의 기준은 **xy 로 걸치는가**다: 긴 축이 어긋나면 어느 높이로 내려도 안 걸린다.
   */
  const hasFooting = (idx, arr) => {
    const b = box(arr[idx]);
    if (b.min[2] <= 1) return true; // 이미 지면
    for (let j = 0; j < arr.length; j++) {
      if (j === idx) continue;
      const ob = box(arr[j]);
      if (ob.max[2] > b.max[2] - 1) continue; // 위에 있는 것은 받침이 아니다
      const ox = Math.min(b.max[0], ob.max[0]) - Math.max(b.min[0], ob.min[0]);
      const oy = Math.min(b.max[1], ob.max[1]) - Math.max(b.min[1], ob.min[1]);
      if (ox >= 15 && oy >= 15) return true; // supportCheck 의 minBear 과 같은 값
    }
    return false;
  };
  /** 서로 2mm 넘게 파고드는 쌍 수 — 회전이 상황을 나쁘게 만들지 않는지 본다. */
  const deepPairs = (arr) => {
    let n = 0;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const A = box(arr[i]), B = box(arr[j]);
      const ov = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
      if (ov.every((o) => o > 0) && Math.min(...ov) > 2) n++;
    }
    return n;
  };
  {
    const before = deepPairs(parts);
    for (let i = 0; i < parts.length; i++) {
      if (hasFooting(i, parts)) continue;
      const p0 = parts[i];
      const b0 = box(p0);
      const c0 = [0, 1, 2].map((k) => (b0.min[k] + b0.max[k]) / 2);
      // 세 축 모두 시도한다 — 「세워야 할 것을 눕혔다」와 「눕혀야 할 것을 세웠다」가 둘 다 나온다.
      for (const axis of ['z', 'y', 'x']) {
        const at0 = { ...p0.at };
        const key = { z: 'rz', y: 'ry', x: 'rx' }[axis];
        const cand = { ...p0, at: { ...at0, [key]: (Number(at0[key] ?? 0) + 90) % 360 } };
        const b1 = box(cand);
        // 회전해도 AABB 크기가 같으면(정사각 단면 등) 시도할 이유가 없다
        if ([0, 1, 2].every((k) => Math.abs((b1.max[k] - b1.min[k]) - (b0.max[k] - b0.min[k])) < 1e-6)) continue;
        // 회전은 로컬 원점 기준이라 AABB 가 이동한다 → 중심을 원위치로 되돌린다
        const c1 = [0, 1, 2].map((k) => (b1.min[k] + b1.max[k]) / 2);
        cand.at.tx = Number(cand.at.tx ?? 0) + (c0[0] - c1[0]);
        cand.at.ty = Number(cand.at.ty ?? 0) + (c0[1] - c1[1]);
        cand.at.tz = Number(cand.at.tz ?? 0) + (c0[2] - c1[2]);
        const trial = parts.slice();
        trial[i] = cand;
        if (!hasFooting(i, trial)) continue;        // 받칠 것이 안 생기면 채택하지 않는다
        if (deepPairs(trial) > before) continue;    // 관통이 늘면 채택하지 않는다
        parts[i] = cand;
        corrections.push({
          id: p0.id ?? p0.type, fix: `rotate-${axis}90`,
          note: '긴 축 방향이 지지 부재와 어긋나 어디에도 안 걸렸다 — 치수 변경 없이 90° 돌려 얹었다(가정)',
        });
        break;
      }
    }
  }
  /**
   * ★①-c **보어 정렬**(260803) — 축이 지나가야 할 허브가 축과 다른 방향이면 돌려서 축심에 얹는다.
   *
   * 실측(기어박스 입력축): 모델이 축을 `ry:90`(x 방향)으로 눕혀 놓고 기어·커플링플랜지는
   * **무회전(z 보어)** 으로 뒀다. 5부품 중 4개가 `at={}` 였다. 결과는 간섭 3건인데,
   * 이건 「설계가 틀렸다」가 아니라 **방향을 안 적은 것**이다 — 보어와 축이 만나는 답은
   * 하나뿐이므로(동축) 지어내는 것이 아니다.
   *
   * ⚠ 축 방향의 위치는 **건드리지 않는다** — 축 위 어디에 앉힐지는 우리가 정할 수 없다.
   *   수직인 두 축만 축심에 맞춘다.
   * ⚠ 관통이 늘면 채택하지 않는다. 그리고 보정 사실을 반드시 보고한다.
   */
  {
    const SHAFT_T = new Set(['cylinder', 'tube']);
    const ROT_FOR = { z: { rx: 0, ry: 0 }, x: { rx: 0, ry: 90 }, y: { rx: -90, ry: 0 } };
    const before = deepPairs(parts);
    for (let i = 0; i < parts.length; i++) {
      const hub = parts[i];
      const g = BORE_GEOM[hub.type]?.(hub.params);
      if (!g?.originCentered) continue;
      const bore = Number(hub.params?.boreDia);
      if (!(bore > 0)) continue;
      for (let j = 0; j < parts.length; j++) {
        const sh = parts[j];
        if (i === j || !SHAFT_T.has(sh.type)) continue;
        const sd = Number(sh.params?.diameter ?? sh.params?.outerDia);
        const sAx = axisFromRotation(sh);
        if (!sAx || !(sd > 0) || sd > bore + Math.max(0.5, bore * 0.02)) continue;
        if (axisFromRotation(hub) === sAx) continue; // 이미 같은 축
        const A = box(hub), B = box(sh);
        if (![0, 1, 2].every((k) => Math.min(A.max[k], B.max[k]) > Math.max(A.min[k], B.min[k]))) continue;
        const cand = { ...hub, at: { ...(hub.at ?? {}), ...ROT_FOR[sAx], rz: 0 } };
        const k0 = { x: 0, y: 1, z: 2 }[sAx];
        const cb = box(cand);
        for (const k of [0, 1, 2]) {
          if (k === k0) continue;
          const hubC = (cb.min[k] + cb.max[k]) / 2;
          const shC = (B.min[k] + B.max[k]) / 2;
          cand.at[['tx', 'ty', 'tz'][k]] = Number(cand.at[['tx', 'ty', 'tz'][k]] ?? 0) + (shC - hubC);
        }
        const trial = parts.slice();
        trial[i] = cand;
        if (deepPairs(trial) > before) continue;
        parts[i] = cand;
        corrections.push({
          id: hub.id ?? hub.type, fix: `bore-align-${sAx}`,
          note: `보어 ⌀${bore} 가 축 ${sh.id ?? sh.type}(⌀${sd}, ${sAx}축)과 방향이 달라 동축으로 돌려 맞췄다(축 방향 위치는 그대로)`,
        });
        break;
      }
    }
  }

  /**
   * ① 부유 드롭 — z 오름차순(아래부터 안정화).
   *
   * ## ⚠ **접지된 부품만 받침으로 인정한다** (260803)
   * 종전에는 「xy 겹치고 z 가 닿으면 지지받았다」로 봤다. 그러면 **서로 얹힌 두 부품이
   * 서로를 받침으로 인정**해 둘 다 공중에 남는다 — 실측(파티션 워크스테이션)에서
   * 책상 상판 4장이 서로 닿아 「접촉」으로 통과했지만 `supportCheck` 는 지면까지의 체인이
   * 없어 전부 부유로 잡았다. **보정기와 판정기가 다른 기준을 쓰면 보정이 일을 못 한다.**
   * 그래서 여기서도 **지면에서 올라오는 체인**만 받침으로 센다(판정기와 같은 규약).
   */
  const order = parts.map((p, i) => ({ i, z: box(p).min[2] })).sort((a, b) => a.z - b.z).map((o) => o.i);
  const grounded = new Set(); // 지면까지 체인이 닿은 부품 인덱스
  for (const i of order) {
    const b = box(parts[i]);
    if (b.min[2] <= 1) { grounded.add(i); continue; } // 지면 착지
    let touching = false, topBelow = 0; // 지면 기본
    for (const j of grounded) {
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
    grounded.add(i); // 내렸든 이미 닿았든 이제 체인에 들어온다
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
  return {
    assembly: { ...asm, parts, ...(carriedConflicts?.length ? { constraintConflicts: carriedConflicts } : {}) },
    corrections,
  };
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
      return { kind, ...extra, op, _col: col, _pid: pidx, _pname: part.id ?? part.type, ...(part.system ? { _sys: part.system } : {}), ...(part.filletMm > 0 ? { _fillet: part.filletMm } : {}), ...(part.chamferMm > 0 ? { _chamfer: part.chamferMm } : {}), ...(Array.isArray(part.edgeOps) && part.edgeOps.length ? { _edgeOps: part.edgeOps } : {}), at: { translate: [wx + tx, wy + ty, wz + tz], ...(rot ? { rotate: rot } : {}) } };
    };
    switch (part.type) {
      case 'box': feats.push(F('box', { size: [p.width, p.depth, p.height] })); break;
      case 'cylinder': {
        feats.push(F('cylinder', { diameter: p.diameter, height: p.length }));
        // T1(260719): 축 키홈(+x측 z=0 시작 관례)·오링 홈(외면 원환) — SCAD/STEP 동일 피처
        const r = p.diameter / 2;
        if (p.keyway) {
          const k = p.keyway;
          feats.push(F('box', { size: [k.depth + 1, k.w, k.length ?? p.length] }, r - k.depth, -k.w / 2, 0, 'subtract'));
        }
        for (const g of p.oringGrooves ?? []) {
          feats.push(F('revolve', { profile: [[r - g.depth, g.z], [r + 1, g.z], [r + 1, g.z + g.w], [r - g.depth, g.z + g.w]] }, 0, 0, 0, 'subtract'));
        }
        break;
      }
      case 'plate_with_holes':
        feats.push(F('box', { size: [p.width, p.depth, p.thickness] }));
        // T1(260719): through/blind + cbore/csink/tap — holeFeature 단일 소스(상면 기준)
        for (const h of p.holes ?? []) {
          const hf = holeFeature(h, p.thickness);
          const z0 = hf.depth ? p.thickness - hf.depth : -1;
          const hh = hf.depth ? hf.depth + 1 : p.thickness + 2;
          feats.push(F('cylinder', { diameter: hf.drillD, height: hh }, h.x, h.y, z0, 'subtract'));
          if (hf.cb) feats.push(F('cylinder', { diameter: hf.cb.dia, height: hf.cb.depth + 1 }, h.x, h.y, p.thickness - hf.cb.depth, 'subtract'));
          if (hf.cs) {
            const ext = 0.5;
            const d2 = hf.cs.dia + 2 * ext * Math.tan((hf.cs.angleDeg / 2) * DEG);
            feats.push(F('cone', { dia1: h.d, dia2: d2, height: hf.cs.depth + ext }, h.x, h.y, p.thickness - hf.cs.depth, 'subtract'));
          }
        }
        break;
      case 'base_plate': {
        const m = p.edgeMargin ?? Math.max(12, p.boltDia * 1.5);
        feats.push(F('box', { size: [p.width, p.depth, p.thickness] }));
        for (const [hx, hy] of [[m, m], [p.width - m, m], [m, p.depth - m], [p.width - m, p.depth - m]])
          feats.push(F('cylinder', { diameter: p.boltDia, height: p.thickness + 2 }, hx, hy, -1, 'subtract'));
        break;
      }
      /**
       * 260801h — 솔리드 원뿔대·원환. 배선하지 않으면 3D·STEP 에서 **통째로 사라진다**
       * (부피·BOQ 는 나오는데 형상이 없는 상태 — 형태 ① 있는 것이 안 닿음).
       */
      case 'cone':
        feats.push(F('cone', { dia1: p.dia1, dia2: p.dia2, height: p.height }));
        break;
      // 260803 — 구·타원체. AABB 규약대로 밑점을 z=0 에 맞춰 중심을 반지름만큼 올린다.
      case 'sphere':
        feats.push(F('sphere', { diameter: p.diameter }, 0, 0, p.diameter / 2));
        break;
      case 'ellipsoid':
        feats.push(F('ellipsoid', { dx: p.dx, dy: p.dy, dz: p.dz }, 0, 0, p.dz / 2));
        break;
      case 'torus':
        // 도넛을 XY 평면에 눕힌다 — 중심 높이가 r 이라 밑면이 z=0 에 닿는다(AABB 와 정합).
        feats.push(F('torus', { majorDia: p.majorDia, minorDia: p.minorDia }, 0, 0, p.minorDia / 2));
        break;
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
      case 'composite': { // 복합 부품(260801) — 하위를 그대로 피처로 펼친다
        /**
         * ⚠ 하위를 **재귀 호출로 펼치지 않는다.** `assemblyToComposeIntent` 를 재귀시키면
         *   좌표계가 두 번 곱해질 위험이 있고, 어디까지 정확한지 말하기 어려워진다.
         *   1단만 받으므로 하위 프리미티브를 **여기서 직접** 배치한다.
         */
        for (const sb of compositeSubs(p)) {
          const inner = assemblyToComposeIntent({
            name: 'sub', parts: [{ id: 'sub', type: sb.type, params: sb.params, at: {}, material: part.material }],
          });
          for (const f of inner.features ?? []) {
            const tr = f.at?.translate ?? [0, 0, 0];
            feats.push({
              ...f, _col: col, _pid: pidx, _pname: part.id ?? part.type, ...(part.system ? { _sys: part.system } : {}),
              op: sb.op === 'subtract' ? 'subtract' : (f.op ?? 'add'),
              at: {
                ...(f.at ?? {}),
                translate: [
                  tr[0] + (Number(sb.at.tx) || 0) + tx,
                  tr[1] + (Number(sb.at.ty) || 0) + ty,
                  tr[2] + (Number(sb.at.tz) || 0) + tz,
                ],
              },
            });
          }
        }
        break;
      }
      case 'masonry_block': { // 조적 블록(260801) — 속빈 공동을 실제로 뺀다
        const n = Number(p.coreCount ?? 0);
        feats.push(F('box', { size: [p.length, p.thickness, p.height] }));
        if (n > 0) {
          const rib = (Number(p.length) - n * Number(p.coreW)) / (n + 1);
          const yy = (Number(p.thickness) - Number(p.coreD)) / 2;
          for (let k = 0; k < n; k++) {
            const x = rib * (k + 1) + Number(p.coreW) * k;
            feats.push(F('box', { size: [p.coreW, p.coreD, Number(p.height) + 2] }, x, yy, -1, 'subtract'));
          }
        }
        break;
      }
      case 'extrude_profile': { // 임의 폐곡선 압출(260801) — 코퍼스 압출의 67.6%가 이 형태다
        feats.push(F('extrude', { profile: extrudePoly(p), height: p.depth }));
        // 원형 관통홀만 지원 — 비원형 내부 루프는 **받지 않는다**(어휘 힌트에 명시).
        for (const h of p.holes ?? []) {
          feats.push(F('cylinder', { diameter: h.d, height: p.depth + 2 }, h.x, h.y, -1, 'subtract'));
        }
        break;
      }
      case 'wall_with_openings':
        feats.push(F('box', { size: [p.length, p.thickness, p.height] }));
        for (const o of p.openings ?? []) feats.push(F('box', { size: [o.w, p.thickness + 2, o.h] }, o.x, -1, o.sill ?? 0, 'subtract'));
        break;
      case 'slab_with_openings':
        feats.push(F('box', { size: [p.length, p.depth, p.thickness] }));
        // 관통 — z 를 위아래 1mm 씩 넘겨 잘라 낸다(경계면 동일평면 회피).
        for (const o of p.openings ?? []) feats.push(F('box', { size: [o.w, o.d, p.thickness + 2] }, o.x, o.y, -1, 'subtract'));
        break;
      case 'i_girder': { // 감사 2026-07-16: 매핑 누락으로 교량 거더가 GA·STEP에서 통째로 빠져 있었음
        const W = Math.max(p.topW, p.botW);
        feats.push(F('box', { size: [p.length, p.botW, p.botT] }, 0, (W - p.botW) / 2, 0));
        feats.push(F('box', { size: [p.length, p.webT, p.webH] }, 0, (W - p.webT) / 2, p.botT));
        feats.push(F('box', { size: [p.length, p.topW, p.topT] }, 0, (W - p.topW) / 2, p.botT + p.webH));
        break;
      }
      case 'tapered_girder': { // 변단면 거더 — 국소축 x=스팬 · y=춤 · z=폭(structural 주석 참조)
        const W = Math.max(p.topW, p.botW);
        const a1 = p.botT + p.webH1, a2 = p.botT + p.webH2; // 웨브 상단 y(양 끝)
        feats.push(F('box', { size: [p.length, p.botT, p.botW] }, 0, 0, (W - p.botW) / 2));
        // 웨브=사다리꼴 · 상부 플랜지=평행사변형. 둘 다 XY 프로파일을 Z(폭)로 압출 —
        // 경사면을 가진 프리즘은 축이 폭 방향이라 이 방향이라야 SCAD·STEP 이 같은 solid 를 낸다.
        feats.push(F('extrude', { profile: [[0, p.botT], [p.length, p.botT], [p.length, a2], [0, a1]], height: p.webT }, 0, 0, (W - p.webT) / 2));
        feats.push(F('extrude', { profile: [[0, a1], [p.length, a2], [p.length, a2 + p.topT], [0, a1 + p.topT]], height: p.topW }, 0, 0, (W - p.topW) / 2));
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
      case 'pipe_reducer': { // 동심 리듀서 — 원뿔대 실형상(260719, 계단 근사 폐기: 표시·STEP 정확)
        const t = p.wallThk ?? Math.max(2, p.dia1 * 0.03);
        feats.push(F('cone', { dia1: p.dia1, dia2: p.dia2, height: p.length }));
        feats.push(F('cone', { dia1: p.dia1 - 2 * t, dia2: p.dia2 - 2 * t, height: p.length + 2 }, 0, 0, -1, 'subtract'));
        break;
      }
      // 표준부품 확장 2(260718f): 프록시 표시(SCAD 정확·질량 폐형)
      case 'coil_spring': { // C2(260719b): 네이티브 coil 피처 단일 방출 — STEP=B-rep 헬릭스 스윕,
        // SCAD=세그먼트 근사(compose 방출부) — 원통 프록시 해소. 회전 배치도 placeSolid 가 처리.
        feats.push(F('coil', { wireDia: p.wireDia, coilDia: p.coilDia, pitch: p.pitch, turns: p.turns }));
        break;
      }
      case 'pillow_block': { // C2(260719b): SCAD 하우징과 동일 실형상(베이스+원통 상부−보어−볼트홀)
        const d2 = p.depth ?? Math.round(p.boreDia * 1.4);
        if (rot) { // 회전 배치=박스 프록시 유지(정직 — 피처 자체 회전과 부품 회전 중첩 미지원)
          feats.push(F('box', { size: [p.width, d2, p.height] }));
          feats.push(F('cylinder', { diameter: p.boreDia, height: d2 + 2 }, p.width / 2, -1, p.height, 'subtract'));
          break;
        }
        const bp = p.boltPitch ?? Math.round(p.width * 0.8);
        const domeD = Math.min(p.width * 0.9, p.height * 1.1);
        const db = Math.max(8, p.boreDia * 0.25);
        feats.push(F('box', { size: [p.width, d2, p.height * 0.55] }));
        feats.push({ kind: 'cylinder', diameter: domeD, height: d2, centered: true, op: 'add', _col: col, _pid: pidx, _pname: part.id ?? part.type, at: { translate: [tx + p.width / 2, ty + d2 / 2, tz + p.height * 0.55], rotate: [-90, 0, 0] } });
        feats.push({ kind: 'cylinder', diameter: p.boreDia, height: d2 + 2, op: 'subtract', _col: col, _pid: pidx, _pname: part.id ?? part.type, at: { translate: [tx + p.width / 2, ty - 1, tz + p.height], rotate: [-90, 0, 0] } });
        feats.push(F('cylinder', { diameter: db, height: p.height }, (p.width - bp) / 2, d2 / 2, -1, 'subtract'));
        feats.push(F('cylinder', { diameter: db, height: p.height }, (p.width + bp) / 2, d2 / 2, -1, 'subtract'));
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
      case 'pipe_elbow': { // 엘보(R2-⑧): 링 단면 revolve 부분각 — 외원 add + 내원 subtract
        const t = p.wallThk ?? Math.max(2, p.od * 0.05);
        const a = p.angleDeg ?? 90;
        const ring = (dia) => Array.from({ length: 24 }, (_, k) => {
          const th = (k * 2 * Math.PI) / 24;
          return [+(p.bendR + (dia / 2) * Math.cos(th)).toFixed(4), +((dia / 2) * Math.sin(th)).toFixed(4)];
        });
        feats.push(F('revolve', { profile: ring(p.od), ...(a < 360 ? { angle: a } : {}) }));
        feats.push(F('revolve', { profile: ring(p.od - 2 * t), ...(a < 360 ? { angle: a } : {}) }, 0, 0, 0, 'subtract'));
        break;
      }
      case 'pipe_tee': { // 티(R2-⑧): 본관(x)+지관(+z) — 부품 내 부울(_pid 스코프)로 정확 융합
        if (rot) { // 회전 배치 미지원 — AABB 프록시(정직)
          const bb = partAabb({ type: 'pipe_tee', ...p });
          feats.push(F('box', { size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] }, bb.min[0], bb.min[1], bb.min[2]));
          break;
        }
        const t2 = p.wallThk ?? Math.max(2, p.runOD * 0.05);
        const mk = (kind, extra, ltx, lty, ltz, rotv, op = 'add') => ({ kind, ...extra, op, _col: col, _pid: pidx, _pname: part.id ?? part.type, ...(part.system ? { _sys: part.system } : {}), at: { translate: [ltx + tx, lty + ty, ltz + tz], ...(rotv ? { rotate: rotv } : {}) } });
        feats.push(mk('cylinder', { diameter: p.runOD, height: p.runLen }, 0, 0, 0, [0, 90, 0]));
        feats.push(mk('cylinder', { diameter: p.runOD - 2 * t2, height: p.runLen + 2 }, -1, 0, 0, [0, 90, 0], 'subtract'));
        feats.push(mk('cylinder', { diameter: p.branchOD, height: p.branchLen }, p.runLen / 2, 0, 0, null));
        feats.push(mk('cylinder', { diameter: p.branchOD - 2 * t2, height: p.branchLen + 2 }, p.runLen / 2, 0, -1, null, 'subtract'));
        break;
      }
      case 'rebar': { // 철근(R2-④): 세그먼트별 2점 실린더+절점 스피어 — SCAD·STEP 동일 수학
        if (rot) { // 회전 배치=미지원(배근은 절대좌표 관례) — AABB 프록시 표시(정직)
          const bb = partAabb({ type: 'rebar', ...p });
          feats.push(F('box', { size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] }, bb.min[0], bb.min[1], bb.min[2]));
          break;
        }
        const pts = p.points ?? [];
        for (let k = 0; k < pts.length - 1; k++) {
          const [x1, y1, z1] = pts[k], [x2, y2, z2] = pts[k + 1];
          const dx2 = x2 - x1, dy2 = y2 - y1, dz2 = z2 - z1;
          const L = Math.hypot(dx2, dy2, dz2);
          if (L < 1e-9) continue;
          const ay = (Math.acos(dz2 / L) * 180) / Math.PI;
          const az = (Math.atan2(dy2, dx2) * 180) / Math.PI;
          feats.push({ kind: 'cylinder', diameter: p.dia, height: L, op: 'add', _col: col, _pid: pidx, _pname: part.id ?? part.type, ...(part.system ? { _sys: part.system } : {}), ...(part.filletMm > 0 ? { _fillet: part.filletMm } : {}), ...(part.chamferMm > 0 ? { _chamfer: part.chamferMm } : {}), ...(Array.isArray(part.edgeOps) && part.edgeOps.length ? { _edgeOps: part.edgeOps } : {}), at: { translate: [x1 + tx, y1 + ty, z1 + tz], rotate: [0, +ay.toFixed(6), +az.toFixed(6)] } });
        }
        for (let k = 1; k < pts.length - 1; k++) {
          feats.push({ kind: 'sphere', diameter: p.dia, op: 'add', _col: col, _pid: pidx, _pname: part.id ?? part.type, ...(part.system ? { _sys: part.system } : {}), at: { translate: [pts[k][0] + tx, pts[k][1] + ty, pts[k][2] + tz] } });
        }
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
  return axisFromRotation(part);
}

/**
 * 부품 **로컬 z 축**이 회전 뒤 향하는 월드 축('x'|'y'|'z'), 사축이면 null.
 * ⚠ 타입을 보지 않는다 — 보어를 가진 어휘는 `pillow_block`·`spur_gear` 처럼 단면이
 *   둥글지 않은 것도 있어서 `roundAxisOf` 의 타입 제한을 그대로 쓸 수 없다(260803 실측).
 */
export function axisFromRotation(part) {
  const { rx = 0, ry = 0, rz = 0 } = part?.at ?? {};
  if (!rx && !ry && !rz) return 'z';
  if (Math.abs(Math.abs(ry) - 90) < 1e-6 && !rx) return 'x';
  if (Math.abs(Math.abs(rx) - 90) < 1e-6 && !ry) return 'y';
  return null;
}

/**
 * ★보어 기하 — **어휘마다 보어의 축과 위치가 다르다**(260803 실측).
 *
 * `axis` = 보어가 뚫린 로컬 축. `c` = 그 축에 **수직인 두 축**에서의 보어 중심(로컬, 축 오름차순).
 * ```
 *   flange·spur_gear·hex_nut·washer   로컬 원점 중심 · 보어 축 = z      → c=[0,0] (x,y)
 *   pillow_block                      원점이 **모서리** · 보어 축 = y   → c=[width/2, height] (x,z)
 * ```
 * ⚠ `pillow_block` 을 z축·원점중심으로 가정했다가 면제가 안 걸렸다. 보어를 「보어가 있다」로만
 *   알고 **어디에 있는지** 모르면 판정이 틀린다 — 그래서 어휘 지식을 표로 둔다.
 * ⚠ 값은 `assemblyToComposeIntent` 의 실제 피처 배치와 **같아야 한다**(회귀가 대조한다).
 */
const BORE_GEOM = {
  // originCentered = 보어 축이 **로컬 원점을 지난다** → 회전해도 보어 중심이 부품 원점 그대로다.
  // 그래서 회전 배치(축을 눕힌 기어열 등)에서도 면제를 걸 수 있다.
  flange: () => ({ axis: 'z', c: [0, 0], originCentered: true }),
  spur_gear: () => ({ axis: 'z', c: [0, 0], originCentered: true }),
  hex_nut: () => ({ axis: 'z', c: [0, 0], originCentered: true }),
  washer: () => ({ axis: 'z', c: [0, 0], originCentered: true }),
  // ⚠ 원점이 모서리라 보어 중심이 로컬 오프셋에 있다 → 회전하면 그 오프셋도 돌려야 하고,
  //   회전 배치에서는 이 어휘가 스스로 박스 프록시로 떨어진다. 그래서 무회전만 면제한다.
  pillow_block: (p) => ({ axis: 'y', c: [p.width / 2, p.height], originCentered: false }),
};

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
  // ⓑ 관계 배치: 부품에 constraints 가 있으면 절대좌표(at)로 먼저 해석한다(좌표 없이 관계로 배치).
  // 해석 실패(순환·미지 참조 등)는 조용히 넘기지 않고 정직 게이트 에러로 되돌린다.
  /**
   * ⚠ 260803 — **관용 모드**로 푼다. 종전에는 형태가 망가진 구속 하나에도 throw 해서
   * 조립 전체를 잃었다(실측: 29부품짜리 피난계단이 `face:undefined` 한 건으로 0 이 됐다).
   * 지금은 그 구속만 버리고 `constraintConflicts` 로 보고한다 — 배치를 못 받은 부품은
   * 부유 검사에 걸려 드러나므로 **조용히 틀리지 않는다**.
   * 순환 구속·중복 id 처럼 「무엇을 버릴지 우리가 정할 수 없는」 것은 여전히 게이트 에러다.
   */
  // 이미 `autoPlaceCorrect` 가 풀었으면 그쪽 보고를 그대로 이어받는다(두 번 풀면 보정이 지워진다).
  let constraintConflicts = asm.constraintConflicts ?? null;
  if (asm.parts.some((p) => Array.isArray(p.constraints) && p.constraints.length > 0)) {
    try {
      asm = resolveConstraints(asm, { lenient: true });
      constraintConflicts = asm.constraintConflicts ?? null;
    } catch (e) { return { ok: false, gateErrors: [`구속 해석 실패: ${e instanceof Error ? e.message : String(e)}`], interferences: [] }; }
  }
  /**
   * ⓒ 계통 태깅(260803) — **여기서 한다.** 종전에는 라우트(`assemble/route.ts:53`)와
   * MCP 서버만 `autoTagAssembly` 를 불렀고, 템플릿 직접 빌드·테스트·CLI 경로는 못 받았다.
   * 그 결과 STEP 조립 트리의 계통이 전부 '부품' 한 덩어리로 나왔다(실측: desk_stand 25/25).
   * ⚠ 기지정 `system` 은 건드리지 않는다(멱등) — 부르는 쪽이 이미 태깅했어도 안전하다.
   */
  asm = autoTagAssembly(asm);
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
    boxes.push({ id: p.id ?? p.type, box: placedAabb(p), type: p.type, at: p.at ?? {} });
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
        // 철근 매입/교차(R2-④): rebar 가 부재에 전 구간 내포=매입 정상 · rebar 쌍=결속 교차 정상
        {
          const pi6 = asm.parts[i], pj6 = asm.parts[j];
          if (pi6.type === 'rebar' && pj6.type === 'rebar') {
            contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +depth.toFixed(2), note: '철근 교차(결속 — 배근 정상)' });
            continue;
          }
          const reb = pi6.type === 'rebar' ? i : pj6.type === 'rebar' ? j : -1;
          if (reb >= 0) {
            const rb = boxes[reb].box, hb = boxes[reb === i ? j : i].box;
            const inside = [0, 1, 2].every((k) => rb.min[k] >= hb.min[k] - 0.1 && rb.max[k] <= hb.max[k] + 0.1);
            if (inside) {
              contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +depth.toFixed(2), note: '철근 매입(전 구간 내포 — 배근 정상 · 피복두께 검토=도메인 계산 영역)' });
              continue;
            }
          }
        }
        /**
         * 관통 체결구(260803 — 힌지 핀·리벳·마찰 와셔): `role:'fastener'` 로 선언된 부품이
         * 상대 부재를 **가로지르는 형태**(자기 장축 외 두 축이 상대 범위 안에 내포)면
         * 매입/관통 정상이다. `rebar` 매입 면제와 같은 사유다 —
         * **실제로는 상대에 구멍이 뚫려 있는데 어휘(`l_bracket` 등)에 홀 파라미터가 없어
         * AABB 가 겹침으로 본다.**
         * ⚠ **두 축 내포**가 조건이다 — 옆구리를 스치는 부분 겹침은 실간섭이므로 유지한다.
         * ⚠ 선언 기반이다(`support-check.mjs` 의 fastener 예외와 같은 규율) — role 을
         *   안 붙인 부품에는 적용되지 않는다.
         */
        {
          const pf = asm.parts[i], qf = asm.parts[j];
          const fi = pf.role === 'fastener' ? i : qf.role === 'fastener' ? j : -1;
          if (fi >= 0) {
            const fb = boxes[fi].box, ob = boxes[fi === i ? j : i].box;
            const inAxes = [0, 1, 2].filter((k) => fb.min[k] >= ob.min[k] - 0.1 && fb.max[k] <= ob.max[k] + 0.1).length;
            if (inAxes >= 2) {
              contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +depth.toFixed(2),
                note: '체결구 관통(두 축 내포 — 상대 부재의 홀은 어휘 미표현. 홀 위치·끼워맞춤은 도면 계층 영역)' });
              continue;
            }
          }
        }
        /**
         * ★**보어 끼워맞춤**(260803) — 축에 끼운 부품은 간섭이 아니라 조립이다.
         *
         * 실측 계기: 「기어박스 입력축」 자유형 5부품에서 **간섭 10건**이 나왔다.
         * 전부 축 ↔ 기어·필로우블록·커플링플랜지였다. 이건 설계 오류가 아니라
         * **정상 조립**인데, 우리 어휘의 보어는 `boreDia` **숫자 하나**라 AABB 로는
         * 속이 찬 원기둥과 구별되지 않는다. `rebar` 매입·`fastener` 관통과 같은 사유다.
         *
         * ## 판정 (선언이 아니라 **기하**로 — role 을 안 붙여도 걸린다)
         * ```
         *   보어측 P : boreDia 를 가진 어휘(flange·spur_gear·hex_nut·washer·pillow_block)
         *   축측  Q : cylinder / tube — 지름 ≤ P.boreDia + 여유(0.5mm 또는 2%)
         *   같은 회전축 · 축에 수직인 두 축에서 Q 가 P 안에 내포
         * ```
         * ⚠ **지름이 보어보다 크면 면제하지 않는다** — 그건 진짜 간섭(안 들어간다)이다.
         * ⚠ 억지 끼움(shrink fit) 같은 음의 틈새는 여기서 판정하지 않는다 —
         *   끼워맞춤 등급은 공차 계층(`tolerance_stack`)의 일이고, 여기는 배치 판정이다.
         */
        {
          const SHAFT = new Set(['cylinder', 'tube']);
          const pb = asm.parts[i], qb = asm.parts[j];
          const bi = BORE_GEOM[pb.type] && SHAFT.has(qb.type) ? i : BORE_GEOM[qb.type] && SHAFT.has(pb.type) ? j : -1;
          if (bi >= 0) {
            const si = bi === i ? j : i;
            const hub = asm.parts[bi], shaft = asm.parts[si];
            const bore = Number(hub.params?.boreDia);
            const shaftD = Number(shaft.params?.diameter ?? shaft.params?.outerDia);
            const at = hub.at ?? {};
            const g0 = BORE_GEOM[hub.type](hub.params);
            const rotated2 = !!(at.rx || at.ry || at.rz);
            /**
             * 회전 허브: 보어 축이 원점을 지나는 어휘만 면제한다(위 `originCentered`).
             * 그때 월드 보어 축 = 회전 뒤 로컬 z 축이고, 중심은 여전히 부품 원점이다.
             * 실측 계기: 축을 눕힌 기어열에서 shaft∩gear·shaft∩flange 가 오탐이었다.
             */
            const g = !rotated2 ? g0
              : g0.originCentered ? { axis: axisFromRotation(hub), c: [0, 0] } : null;
            if (g && g.axis && bore > 0 && shaftD > 0 && g.axis === axisFromRotation(shaft)
              && shaftD <= bore + Math.max(0.5, bore * 0.02)) {
              const k0 = { x: 0, y: 1, z: 2 }[g.axis];
              const perp = [0, 1, 2].filter((k) => k !== k0);
              const sb2 = boxes[si].box;
              // 축의 중심선(AABB 중심)이 **보어 중심**에서 틈새 반경 안에 있는가.
              const slack = (bore - shaftD) / 2 + 0.5;
              const aligned = perp.every((k, n) => {
                const shaftC = (sb2.min[k] + sb2.max[k]) / 2;
                const boreC = Number(at[['tx', 'ty', 'tz'][k]] ?? 0) + g.c[n];
                return Math.abs(shaftC - boreC) <= slack;
              });
              if (aligned) {
                contacts.push({ a: boxes[i].id, b: boxes[j].id, overlapMm3: Math.round(v), depthMm: +depth.toFixed(2),
                  note: `보어 끼워맞춤(⌀${shaftD} 축 → ⌀${bore} 보어 — 조립 정상. 끼워맞춤 등급은 공차 계층)` });
                continue;
              }
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
  // F6(도그푸딩 260719b): 접합선 길이는 **실제 단면 둘레**여야 한다. 회전체(사일로 동체·
  // 호퍼·지붕)의 원주 이음을 AABB 사각 둘레로 재면 2(D+D)=4D 가 되어 πD 대비 +27.3%
  // 과대(실측 10,972mm vs π×2743=8,617mm). 축이 z 인 회전 단면 부품끼리 z 방향으로
  // 맞닿으면 이음선은 원(圓)이다.
  const ROUND_TYPES = new Set(['revolve', 'cylinder', 'tube', 'pipe_reducer', 'pipe_elbow']);
  const zAxisRound = (b) => {
    if (!ROUND_TYPES.has(b.type)) return false;
    // revolve 는 정의상 z축 회전체. 그 외(cylinder·tube 등)는 SCAD 기본 축이 z 이므로
    // rx/ry 회전이 걸리면 축이 눕는다 — 눕은 관은 원주 이음 판정 대상에서 제외(보수).
    if (b.type === 'revolve') return true;
    return !(b.at.rx || b.at.ry);
  };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i].box, B = boxes[j].box;
      const ov = [0, 1, 2].map((k) => Math.min(A.max[k], B.max[k]) - Math.max(A.min[k], B.min[k]));
      const touch = [0, 1, 2].filter((k) => Math.abs(ov[k]) <= TOL);
      const over = [0, 1, 2].filter((k) => ov[k] > TOL);
      if (touch.length === 1 && over.length === 2) {
        const [u, v] = [ov[over[0]], ov[over[1]]];
        let perim = 2 * (u + v);
        let note = '전둘레 필렛 개산 · AABB 접촉 기준 · 비법정';
        // 원주 이음: 양쪽이 z축 회전 단면 + 접촉면이 z 평면 + 겹침 XY 범위가 정사각(=원의
        // 외접 AABB). 이 세 조건이 모두 맞을 때만 π·D 로 바꾼다(그 외는 종전 사각 둘레 유지).
        const squareish = Math.max(u, v) > 0 && Math.abs(u - v) / Math.max(u, v) <= 0.02;
        if (touch[0] === 2 && squareish && zAxisRound(boxes[i]) && zAxisRound(boxes[j])) {
          const dia = (u + v) / 2; // 접합면 지름 = 겹침 XY 외접 정사각의 변
          perim = Math.PI * dia;
          note = `원주 이음(Ø${Math.round(dia)} 접합면 π·D) · 회전 단면 실둘레 · 비법정`;
        }
        welds.push({
          a: boxes[i].id, b: boxes[j].id,
          lengthMm: Math.round(perim), legMm: FILLET_LEG, throatMm: throat,
          throatAreaMm2: Math.round(perim * throat),
          note,
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

  /**
   * 종합 설계 타당성 — 부유 0 · **간섭 0** · 배관 오류/관통/교차 0 이어야 PASS.
   *
   * ⚠ 간섭은 260728 에 추가됐다. 종전엔 빠져 있어서, 쉬운요약이 같은 문서 안에서
   *   경고: "부품끼리 겹치는 곳 186군데 — 실제로는 들어가지 않는 자리가 있습니다"
   *   종합: "형상 타당성(부유·**간섭**·배관) 이상 없음"
   * 을 **동시에** 인쇄했다(실측: mech/transmission_tower, 99부재 격자탑). 종합 판정의
   * 라벨이 간섭을 포함한다고 적어놓고 실제로는 세지 않은 것이라, 라벨이 거짓이었다.
   *
   * 이 간섭들은 오탐이 아니다 — 같은 패키지의 B1 메시 부울 재판정이 교집합 부피를
   * 실측해 확정한다(11661.3 mm³ 등). 즉 두 부재가 실제로 같은 공간을 점유한다.
   *
   * 접촉(zero-thickness 맞닿음)은 `contacts` 로 따로 세므로 여기 걸리지 않는다 —
   * 맞닿는 설계를 겹침으로 오판하지 않는다.
   */
  const designOk = support.floating.length === 0
    && interferences.length === 0
    && (!pipes || (pipes.errors.length === 0 && pipes.obstacleViolations.length === 0 && pipes.crossViolations.length === 0));

  // 픽킹 OBB(260719 #3): 회전 부품은 로컬 치수+배치를 동봉 — 클라 프록시가 회전 적용
  // (AABB 프록시는 회전 부품에서 뚱뚱해져 옆 부품 오픽). 무회전=aabb 만(기존 하위호환).
  const partsOut = boxes.map((b, i) => {
    const src = asm.parts.find((q) => (q.id ?? q.type) === b.id) ?? asm.parts[i];
    const { rx = 0, ry = 0, rz = 0 } = src?.at ?? {};
    if (!rx && !ry && !rz) return { id: b.id, aabb: b.box };
    try {
      const la = partAabb({ type: src.type, ...src.params });
      return { id: b.id, aabb: b.box, obb: { local: { min: la.min, max: la.max }, at: { tx: src.at?.tx ?? 0, ty: src.at?.ty ?? 0, tz: src.at?.tz ?? 0, rx, ry, rz } } };
    } catch { return { id: b.id, aabb: b.box }; }
  });
  return { ok: true, openscad, parts: partsOut, gateErrors: [], interferences, contacts: contactsFinal, ...(approxOverlaps ? { approxOverlaps } : {}), welds, weldTotalMm, composeIntent, structural, support, pipes, designOk, ...(constraintConflicts?.length ? { constraintConflicts } : {}) };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('assembly.mjs');
if (isMain && process.argv[2]) {
  const asm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const r = buildAssembly(asm);
  console.log(JSON.stringify({ ok: r.ok, gateErrors: r.gateErrors, interferences: r.interferences, scadBytes: r.openscad?.length }, null, 1));
}
