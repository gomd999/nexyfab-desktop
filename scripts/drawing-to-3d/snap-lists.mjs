/**
 * snap-lists.mjs — ③ 표준규격 스냅: 드래그/스테퍼가 임의값이 아니라 "근거 있는 절점"에
 * 붙도록. 목록 전부 출처 명시 — 원문 표 절점·표준 호칭만(지어낸 값 없음).
 */
export const SNAP_LISTS = {
  boltDia: { values: [12, 16, 19, 22, 25], source: 'KDS 41 50 30 표 4.5-2 절점(원문 파싱)' },
  timberThk: { values: [38, 89, 140], source: 'KDS 41 50 30 표 4.5-2 주부재 두께 절점' },
  nailSideThk: { values: [12, 19, 25, 38], source: 'KDS 41 50 30 표 4.4-4 측면부재 절점' },
  nailLen: { values: [50, 63, 76, 82, 89, 101, 114, 127, 139, 152], source: 'KDS 41 50 30 표 4.4-4 못 길이 절점' },
  pipeDia: { values: [300, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1350, 1500, 1650, 1800], source: '표준관경(drainage_network STD_DIA와 동일)' },
  rebarDia: { values: [10, 13, 16, 19, 22, 25, 29, 32], source: 'KS D 3504 이형봉강 호칭(D10~D32)' },
  timberSection: { values: [38, 89, 140, 184, 235, 286], source: '구조용 제재 관례 규격 계열(38 배수 — 참고용, 프로젝트 수급 규격 확인)' },
  /**
   * 경량철골 벽체 스터드 (260801, 참고 코퍼스 근거).
   *
   * ⚠ 코퍼스 실측: `stud` 가 부품명에 43회 등장한다 — **어휘에 없는 것이 아니라 규격이
   * 없었다.** 형상은 기존 `c_channel` 이 그대로 맞으므로 **새 어휘를 만들지 않았다**
   * (같은 형상에 새 타입을 만들면 부피·BOQ·STEP 경로가 두 벌이 되고 언젠가 갈린다).
   * 필요한 것은 규격 절점이었다.
   *
   * ⚠ 출처를 정확히 적는다 — 아래는 **KS 표 절점이 아니라 시공 관례 계열**이다.
   * 확인하지 않은 표 번호를 적으면 근거가 없는 값에 근거가 붙는다.
   */
  studWeb: { values: [65, 75, 100, 125, 150], source: '경량철골 벽체 스터드 관례 규격 계열(웹 치수 — 표 절점 아님, 프로젝트 수급 규격 확인 필요)' },
  studSpacing: { values: [300, 450, 600], source: '경량철골 스터드 간격 관례(@300·@450·@600 — 표 절점 아님, 마감재 규격·하중이 정한다)' },
};

/** 템플릿/체인 파라미터명 → 스냅 키 (알려진 것만 — 매핑 없으면 grid 스텝 스냅) */
export const PARAM_SNAP = {
  boltDia: 'boltDia',
  nailLen: 'nailLen',
  sideThk: 'nailSideThk',
  mainThk: 'timberThk',
  postSize: 'timberSection',
  joistSpacing: null, // 간격은 표 절점 아님 — grid 스냅(50mm)
  studWeb: 'studWeb',
  studSpacing: 'studSpacing',
};

export function snapFor(paramName) {
  const key = PARAM_SNAP[paramName];
  if (key && SNAP_LISTS[key]) return { kind: 'list', ...SNAP_LISTS[key] };
  return { kind: 'grid', step: 50, source: '범용 50mm 그리드(관례 — 표 절점 아님 명시)' };
}

export function snapValue(paramName, raw) {
  const s = snapFor(paramName);
  if (s.kind === 'list') {
    let best = s.values[0];
    for (const v of s.values) if (Math.abs(v - raw) < Math.abs(best - raw)) best = v;
    return { value: best, ...s };
  }
  return { value: Math.round(raw / s.step) * s.step, ...s };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('snap-lists.mjs');
if (isMain) {
  const a = snapValue('boltDia', 18);
  const b = snapValue('bayX', 6123);
  const ok = a.value === 19 && a.kind === 'list' && b.value === 6100 && b.kind === 'grid';
  console.log('boltDia 18→', a.value, '| bayX 6123→', b.value);
  console.log(ok ? 'snap-lists self-test: PASS' : 'snap-lists self-test: FAIL');
  if (!ok) process.exit(1);
}
