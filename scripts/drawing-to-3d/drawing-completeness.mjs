/**
 * drawing-completeness.mjs — 도면 완성도 게이트 D1 (260718, 코퍼스급 체크리스트 C1~C9).
 * 생성 HTML 을 마커 기반으로 자동 판정 — 미충족=정직 보고(면책 문구 아님, 보완 대상 목록).
 */
/**
 * 적용 가능성(applicability) — 260728 §7-3.
 *
 * 종전엔 `pass:null`(해당 없음)을 쓰는 항목이 C9 하나뿐이라, **필요 없는 항목이 없는 것**과
 * **필요한데 빠진 것**이 같은 FAIL 로 보였다. 실측(단순 브래킷 GA): `7/8`, 유일한 실패가
 * **C5 선 종류** — 구멍도 은닉 엣지도 없는 부품이라 중심선이 없는 게 맞다. 즉 과탐이었고,
 * 이 상태로는 소비자 문서에 실을 수 없었다(§6-3 이 정합 게이트에 세운 것과 같은 착수 조건).
 *
 * 호출자가 어셈블리에서 아는 사실만 넘긴다 — 여기서 HTML 을 보고 추측하지 않는다.
 * 넘기지 않으면 종전 동작 그대로(전부 적용)라 하위호환이 유지된다.
 *
 * ⚠ 규칙을 세울 수 있는 것에만 붙였다. C2(단면도)·C3(상세 콜아웃)은 "이 부품에 단면이
 * 필요한가"를 기하에서 판정할 방법이 지금 없어 손대지 않았다 — 다만 현재 GA 생성기가
 * 이 마커를 사실상 항상 찍으므로 두 항목은 "도면이 완전한가"보다 "생성기가 돌았는가"에
 * 가깝다는 한계를 여기 남긴다(다음 세션 과제).
 *
 * @typedef {{ hasWelds?: boolean, hasCircular?: boolean }} CompletenessApplicability
 *   hasWelds    용접이 하나라도 있나 → C8
 *   hasCircular 구멍·원형 단면 부재가 있나 → C5(중심선)·C6(원형 심볼)
 *
 * @param {string} html
 * @param {{ kind?: string, applicability?: CompletenessApplicability | null }} [opts]
 */
export function checkDrawingCompleteness(html, opts = {}) {
  const { kind = 'ga', applicability = null } = opts;
  const has = (re) => (typeof re === 'string' ? html.includes(re) : re.test(html));
  // applicability 미전달 = 전부 적용(종전 동작). 전달 시 해당 항목만 N/A 가 될 수 있다.
  const naIf = (cond, note) => (applicability && cond ? { pass: null, note } : null);
  const item = (id, name, pass, na) => (na ? { id, name, ...na } : { id, name, pass });
  /**
   * 선택 뷰(C2 단면도·C3 부분 상세) — **PASS 는 보존, FAIL 만 판정 불가로** (260728 자율 점검).
   *
   * 실측: 6개 도메인 중 **5개**가 C3 로 실패했다(mech 만 통과). 원인을 열어보니 GA 생성기는
   * 작은/얇은 부품이 있을 때만 DETAIL 을 그린다 — RC 프레임처럼 큰 부재만 있으면 **상세도가
   * 필요 없는 게 맞다.** 즉 그 FAIL 은 과탐이었고, §7-4 로 완성도를 소비자 문서에 실으면서
   * 거의 모든 패키지에 "도면에 갖춰지지 않은 항목이 있습니다"가 뜨고 있었다.
   *
   * 있으면(PASS) 실제로 그려졌다는 뜻이라 그대로 정보다. 없으면 "필요한데 빠졌다"와
   * "필요 없어서 안 그렸다"를 **이 층에서는 구별할 수 없다** — 그 판단은 생성기가 부품
   * 치수를 보고 내린다. 규칙을 여기 복제하면 드리프트이므로, 구별 불가를 그대로 적는다.
   * (제대로 된 해법: 생성기가 "어떤 선택 뷰를 그렸고 왜 안 그렸는지"를 보고하는 것 — 후속.)
   */
  const optionalView = (id, name, pass, why) =>
    pass ? { id, name, pass: true } : { id, name, pass: null, note: why };
  const items = [
    { id: 'C1', name: '도곽·표제란(도번·축척·REV·시트)', pass: has('nf-titleblock') && has('data-dwg') && has('시트') },
    optionalView('C2', '단면도+해칭', has('nfhatch') && has('SECTION A-A'),
      '단면이 필요한 형상인지 이 층에서 판정 불가 — 생성기는 필요할 때만 그린다'),
    optionalView('C3', '부분 상세 콜아웃', has('DETAIL '),
      '확대가 필요한 소형·박판 부위가 있는지 이 층에서 판정 불가 — 생성기는 필요할 때만 그린다'),
    { id: 'C4', name: '치수 체계(⌀·치수문자)', pass: has('⌀') || has(/\d+×\d+/) },
    item('C5', '선 종류(중심선·파선)', has('8 2 2 2') && has('stroke-dasharray="5 3"'),
      naIf(applicability?.hasCircular === false, '구멍·원형 부재가 없어 중심선이 필요 없음')),
    item('C6', '심볼 표기(원형 장비·P&ID)', has('<circle'),
      naIf(applicability?.hasCircular === false, '원형 장비·부재가 없음')),
    { id: 'C7', name: 'BOM 규격열(발주 규격)', pass: has('발주 규격') && (has('SCH40') || has('SQ TUBE') || has('가공품(도면 제작)')) },
    item('C8', '용접 일람(조인트별)', has('필릿 △'),
      naIf(applicability?.hasWelds === false, '용접 조인트가 없음')),
    { id: 'C9', name: 'DXF 레이어 분리', pass: null, note: 'DXF 파일 별도 검사(HTML 범위 외)' },
  ];
  const applicable = items.filter((i) => i.pass !== null);
  const passed = applicable.filter((i) => i.pass);
  // 근거 충분성 — execution-gate 와 같은 규칙(260728). 판정한 항목이 0개면
  // `passed.length === applicable.length` 가 0===0 으로 **참**이 되어 빈 검사가 합격이 된다.
  // 실 CAD 코퍼스가 독립적으로 같은 함정을 잡았다(evidence_sufficient).
  //
  // ⚠ 정직하게: 여기서는 **아직 도달 불가**하다 — C1·C6·C7 은 applicability 를 보지 않고
  // 항상 평가되므로 applicable 은 최소 3이다. 실제로 0/0 PASS 가 관측된 곳은
  // execution-gate 쪽이다(GA·부품도 동시 미생성 → M1~M6 전부 N/A). 그럼에도 같은 식을
  // 남겨두는 이유는 이번 세션에 N/A 경로를 계속 늘려 왔기 때문이다 — 다음에 C1 이
  // 선택 항목이 되는 순간 조용히 빈 합격이 생긴다.
  const evidenceSufficient = applicable.length > 0;
  const naCount = items.length - applicable.length;
  return {
    kind,
    // 분모 붕괴를 감추지 않는다 — "2/2" 와 "9/9" 는 똑같이 100% 로 읽힌다.
    score: `${passed.length}/${applicable.length}`
      + (naCount ? ` (전 ${items.length}항목 중 ${naCount}개 해당없음·판정불가)` : ''),
    passed: passed.map((i) => i.id),
    failed: applicable.filter((i) => !i.pass).map((i) => `${i.id} ${i.name}`),
    na: items.filter((i) => i.pass === null).map((i) => `${i.id} (${i.note})`),
    evidenceSufficient,
    ok: evidenceSufficient && passed.length === applicable.length,
  };
}

/**
 * C9 — DXF 레이어 분리 검사(도면 관례: DIM/CENTER 전용 레이어 + 파선 라인타입).
 *
 * ⚠ 반드시 ENTITIES 섹션 안에서만 검사한다. `dxf-export.mjs`의 shell()은 모든
 * DXF 파일 헤더에 LTYPE 테이블(CENTER·DASHED 정의)과 LAYER 테이블(DIM 포함
 * 전체 레이어 목록)을 무조건 선언하므로, 파일 전체를 substring 검색하면 실제로
 * 중심선/파선을 하나도 안 그린 도면(예: 심플한 기계 브래킷)도 항상 pass — "검증
 * 못하는 검증"(도그푸딩 발견). ENTITIES 안에서 그룹코드로 실사용을 확인한다:
 * 8=레이어명(DIM 레이어에 실제로 배치된 엔티티) · 6=엔티티별 라인타입 오버라이드
 * (CENTER/DASHED로 그려진 실제 엔티티) — dxf-export.mjs 자신의 self-test가 쓰는
 * 것과 같은 기법(`entSec.matchAll(/^8\n(\w+)$/gm)`).
 */
export function checkDxfLayers(dxfText) {
  const idx = dxfText.indexOf('ENTITIES');
  const entSec = idx >= 0 ? dxfText.slice(idx) : '';
  const layersUsed = new Set([...entSec.matchAll(/^8\n(\S+)$/gm)].map((m) => m[1]));
  const ltypesUsed = new Set([...entSec.matchAll(/^6\n(\S+)$/gm)].map((m) => m[1]));
  const dimLayerUsed = layersUsed.has('DIM');
  const centerUsed = ltypesUsed.has('CENTER');
  const dashed = ltypesUsed.has('DASHED');
  const found = [dimLayerUsed && 'DIM', centerUsed && 'CENTER'].filter(Boolean);
  const pass = dimLayerUsed && centerUsed && dashed;
  return {
    id: 'C9',
    pass,
    found,
    dashed,
    note: pass
      ? 'DIM 레이어+CENTER/DASHED 라인타입이 ENTITIES에 실사용 확인'
      : `누락(엔티티 실사용 기준): ${[!dimLayerUsed && 'DIM', !centerUsed && 'CENTER', !dashed && 'DASHED'].filter(Boolean).join(',')}`,
  };
}

/**
 * 어셈블리에서 완성도 검사의 적용 가능성을 뽑는다 (260728 §7-3).
 *
 * 규칙을 여기 한 곳에 둔다 — 웹 라우트와 MCP 두 발생지가 각자 판정하면 그게 곧 드리프트다
 * (이번 세션에 검도 리포트·REV 규약에서 반복해 확인한 것).
 *
 * **모르면 "적용됨"으로 둔다.** N/A 를 과하게 주면 검사가 조용히 사라지고, 그건 과탐보다
 * 나쁘다 — 미검출은 소비자가 알 방법이 없다.
 *
 * @param {object} assembly
 * @param {object} [built] buildAssembly 결과(welds 만 읽는다)
 */
export function completenessApplicability(assembly, built = null) {
  const parts = assembly?.parts ?? [];
  // 원형 요소가 하나라도 있으면 중심선·원형 심볼이 필요하다. 판단이 서지 않는 type 은
  // 원형으로 간주하지 않되(아래 목록에 없으면 false), 구멍 선언은 type 과 무관하게 원형이다.
  const CIRCULAR_TYPES = new Set([
    'cylinder', 'tube', 'rect_tube', 'pipe_reducer', 'pipe_elbow', 'pipe_tee', 'flange',
    'coil_spring', 'revolve', 'spur_gear', 'hex_bolt', 'hex_nut', 'washer', 'pillow_block',
    'rebar', 'plate_with_holes', 'base_plate', 'cavity_block',
  ]);
  const hasCircular = parts.some((p) => {
    if (CIRCULAR_TYPES.has(String(p?.type))) return true;
    const q = p?.params ?? {};
    if (Array.isArray(q.holes) && q.holes.length > 0) return true;
    // 지름류 파라미터가 있으면 원형으로 본다(보수적으로 '적용됨' 쪽).
    return ['d', 'diameter', 'od', 'id', 'boreD', 'radius'].some((k) => Number.isFinite(Number(q[k])));
  });
  const hasWelds = Array.isArray(built?.welds) ? built.welds.length > 0 : true; // 모르면 적용
  return { hasCircular, hasWelds };
}
