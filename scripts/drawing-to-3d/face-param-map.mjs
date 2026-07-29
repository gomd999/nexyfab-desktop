/**
 * face-param-map.mjs — "사람이 면을 잡으면 파라미터가 잡힌다" (P2 두뇌).
 *
 * 어휘별 AABB 면(±X/±Y/±Z) → 지배 파라미터 결정론 매핑. 뷰어에서 레이캐스트로
 * 면 법선을 얻으면 이 모듈이 (파라미터, 증감 방향, 현재값)을 돌려주고, 수정 후
 * 체인 재검증이 자동으로 따라온다 — 형상·계산 링크가 끊기지 않는 편집.
 *
 * 원칙: 매핑은 어휘 정의에서 결정론 파생(추측 없음). 면이 복합 의미(예: 좌우 대칭
 * 쌍)면 대표 파라미터 1개 + note. 매핑 불가 면은 null(정직) — '비검증 직접편집'
 * 경로(P4)로 안내.
 *
 * face 키: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' (AABB 로컬 기준).
 */

const M = {
  box: { '+x': 'width', '-x': 'width', '+y': 'depth', '-y': 'depth', '+z': 'height', '-z': 'height' },
  plate_with_holes: { '+x': 'width', '-x': 'width', '+y': 'depth', '-y': 'depth', '+z': 'thickness', '-z': 'thickness' },
  stepped_plate: { '+x': 'width', '-x': 'width', '+y': 'depth', '-y': 'depth', '+z': 'thickness', '-z': 'thickness' },
  l_bracket: { '+x': 'legA', '-x': 'legA', '+y': 'width', '-y': 'width', '+z': 'legB', '-z': 'legB' },
  flange: { '+x': 'outerDia', '-x': 'outerDia', '+y': 'outerDia', '-y': 'outerDia', '+z': 'thickness', '-z': 'thickness' },
  bent_sheet: { '+x': 'length', '-x': 'length', '+y': 'webWidth', '-y': 'webWidth', '+z': 'flangeHeight', '-z': 'thickness' },
  tube: { '+x': 'outerDia', '-x': 'outerDia', '+y': 'outerDia', '-y': 'outerDia', '+z': 'length', '-z': 'length' },
  rect_tube: { '+x': 'length', '-x': 'length', '+y': 'width', '-y': 'width', '+z': 'height', '-z': 'height' },
  cylinder: { '+x': 'diameter', '-x': 'diameter', '+y': 'diameter', '-y': 'diameter', '+z': 'length', '-z': 'length' },
  gusset: { '+x': 'legA', '-x': 'legA', '+y': 'legB', '-y': 'legB', '+z': 'thickness', '-z': 'thickness' },
  base_plate: { '+x': 'width', '-x': 'width', '+y': 'depth', '-y': 'depth', '+z': 'thickness', '-z': 'thickness' },
  spur_gear: { '+x': null, '-x': null, '+y': null, '-y': null, '+z': 'thickness', '-z': 'thickness' }, // 외경=모듈·잇수 파생(직접 편집 불가 — 정직 null)
  hex_bolt: { '+x': 'threadDia', '-x': 'threadDia', '+y': 'threadDia', '-y': 'threadDia', '+z': 'length', '-z': 'length' },
  sheet_profile: { '+x': null, '-x': null, '+y': null, '-y': null, '+z': 'width', '-z': 'width' }, // 단면은 segments/angles 배열 — 스케치 편집 경로(P3)
  wall_with_openings: { '+x': 'length', '-x': 'length', '+y': 'thickness', '-y': 'thickness', '+z': 'height', '-z': 'height' },
  slab_with_openings: { '+x': 'length', '-x': 'length', '+y': 'depth', '-y': 'depth', '+z': 'thickness', '-z': 'thickness' },
  i_girder: { '+x': 'length', '-x': 'length', '+y': null, '-y': null, '+z': 'topT', '-z': 'botT' }, // 폭은 topW/botW 복합 — 단면 패널(P3)로
  // ⚠ tapered_girder 는 축이 다르다(x=스팬·y=춤·z=폭). 또 춤이 양 끝에서 다르므로
  // ±y 면을 단일 파라미터로 잡을 수 없다 — null(면 드래그 편집 불가, 단면 패널로).
  tapered_girder: { '+x': 'length', '-x': 'length', '+y': null, '-y': null, '+z': null, '-z': null },
};

/** 단면(2차) 파라미터 — 면 매핑이 null인 어휘의 '단면 편집' 패널용 목록 (P3 간이). */
export const SECTION_PARAMS = {
  i_girder: ['topW', 'topT', 'webT', 'webH', 'botW', 'botT'],
  tapered_girder: ['topW', 'topT', 'webT', 'webH1', 'webH2', 'botW', 'botT'],
  sheet_profile: ['segments', 'angles', 'thickness'],
  spur_gear: ['module', 'teeth', 'boreDia'],
};

/** 파라미터별 증감 한계는 reconstruct PARAMS 게이트가 최종 판정 — 여기선 방향만. */
export function mapFace(type, face) {
  const table = M[type];
  if (!table) return { ok: false, reason: `unsupported type '${type}'` };
  const param = table[face];
  if (param === undefined) return { ok: false, reason: `unknown face '${face}'` };
  if (param === null) {
    return {
      ok: false, reason: 'section',
      note: `이 면은 단일 파라미터로 매핑되지 않음 — 단면 편집 패널(${(SECTION_PARAMS[type] ?? []).join('·')}) 사용`,
      sectionParams: SECTION_PARAMS[type] ?? [],
    };
  }
  // 증감 방향: +면을 바깥으로 끌면 파라미터 증가(치수형 어휘 공통 규약)
  const sign = face.startsWith('+') ? +1 : -1;
  return { ok: true, param, dragSign: sign, face };
}

/** 뷰어 레이캐스트 법선(월드) + 파트 회전(rz 90° 지원) → 로컬 면 키. */
export function worldNormalToFace(normal, rz = 0) {
  let [nx, ny, nz] = normal;
  if (rz === 90) { const t = nx; nx = ny; ny = -t; } // 월드→로컬 역회전
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? '+x' : '-x';
  if (ay >= az) return ny >= 0 ? '+y' : '-y';
  return nz >= 0 ? '+z' : '-z';
}

/** 모서리(edge) = 두 면의 교차 → 파라미터 후보 2개 (사용자가 선택). */
export function mapEdge(type, faceA, faceB) {
  const a = mapFace(type, faceA), b = mapFace(type, faceB);
  const cands = [];
  for (const r of [a, b]) {
    if (r.ok && !cands.some((c) => c.param === r.param)) cands.push({ param: r.param, face: r.face, dragSign: r.dragSign });
  }
  if (!cands.length) {
    return { ok: false, reason: 'section', note: '이 모서리의 양면 모두 단면/파생 파라미터 — 단면 편집 패널 사용', sectionParams: SECTION_PARAMS[type] ?? [] };
  }
  return { ok: true, candidates: cands, note: cands.length === 2 ? '모서리 = 두 치수의 교차 — 수정할 치수 선택' : null };
}

/**
 * 거리(치수) 선택: 같은 role 파트 2개 → 간격/스팬 템플릿 파라미터 식별 (그리드 어셈블리).
 * 결정론 규칙: 두 파트의 role·정렬축으로 템플릿 파라미터 매핑 — 추측 없이 표로만.
 * axis: 'x' | 'y' (두 파트 중심 차이의 지배축 — 뷰어가 계산해 전달)
 */
const DISTANCE_MAP = {
  building: { column: { x: 'bayX', y: 'bayY' }, beam: { x: 'bayX', y: 'bayY' } },
  bridge: { girder: { y: 'girderSpacing' } },
  landscape: { joist: { x: 'joistSpacing', y: 'joistSpacing' }, post: { x: 'width', y: 'depth' } },
  interior: { table: null }, // 테이블 간격은 rows/cols 파생 — 개별 간격 파라미터 없음(정직)
};
export function mapDistance(domain, role, axis) {
  const d = DISTANCE_MAP[domain];
  if (!d || !(role in d)) return { ok: false, reason: `'${domain}/${role}' 거리 매핑 없음 — 지원: ${Object.keys(DISTANCE_MAP).join('·')}` };
  const m = d[role];
  if (m === null) return { ok: false, reason: 'derived', note: '이 간격은 배치 수(rows/cols)에서 파생 — 개수 파라미터를 수정' };
  const param = m[axis];
  if (!param) return { ok: false, reason: `축 '${axis}' 매핑 없음` };
  return { ok: true, param, kind: 'template' };
}

/** 전체 어휘 매핑 상태 요약(커버리지 리포트·테스트용). */
export function coverage() {
  const rows = [];
  for (const [type, table] of Object.entries(M)) {
    const faces = Object.values(table);
    rows.push({ type, mapped: faces.filter((v) => v).length, section: faces.filter((v) => v === null).length > 0 });
  }
  return rows;
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('face-param-map.mjs');
if (isMain) {
  let ok = 0, tot = 0;
  const chk = (n, c) => { tot++; if (c) ok++; else console.log('✗', n); };
  chk('box +z → height', mapFace('box', '+z').param === 'height');
  chk('i_girder -z → botT', mapFace('i_girder', '-z').param === 'botT');
  chk('i_girder +y → 단면 패널 안내', mapFace('i_girder', '+y').reason === 'section' && mapFace('i_girder', '+y').sectionParams.includes('webT'));
  chk('spur_gear +x → 정직 거부', mapFace('spur_gear', '+x').ok === false);
  chk('법선 변환', worldNormalToFace([0, 0, 1]) === '+z' && worldNormalToFace([-1, 0.1, 0]) === '-x');
  chk('rz=90 역회전', worldNormalToFace([0, 1, 0], 90) === '+x');
  const cov = coverage();
  chk('16어휘 전수 매핑', cov.length === 16 && cov.every((c) => c.mapped >= 2));
  const ed = mapEdge('box', '+x', '+z');
  chk('모서리 → 후보 2', ed.ok && ed.candidates.length === 2 && ed.candidates.some((c) => c.param === 'width') && ed.candidates.some((c) => c.param === 'height'));
  chk('거리: 기둥 x → bayX', mapDistance('building', 'column', 'x').param === 'bayX');
  chk('거리: 거더 y → girderSpacing', mapDistance('bridge', 'girder', 'y').param === 'girderSpacing');
  chk('거리: 테이블 → 파생 안내', mapDistance('interior', 'table', 'x').reason === 'derived');
  console.log(`face-param-map self-test: ${ok}/${tot}${ok === tot ? ' PASS' : ' FAIL'}`);
  console.log('coverage:', cov.map((c) => `${c.type}:${c.mapped}${c.section ? '+§' : ''}`).join(' '));
  if (ok !== tot) process.exit(1);
}
