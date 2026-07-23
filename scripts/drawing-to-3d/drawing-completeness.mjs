/**
 * drawing-completeness.mjs — 도면 완성도 게이트 D1 (260718, 코퍼스급 체크리스트 C1~C9).
 * 생성 HTML 을 마커 기반으로 자동 판정 — 미충족=정직 보고(면책 문구 아님, 보완 대상 목록).
 */
export function checkDrawingCompleteness(html, { kind = 'ga' } = {}) {
  const has = (re) => (typeof re === 'string' ? html.includes(re) : re.test(html));
  const items = [
    { id: 'C1', name: '도곽·표제란(도번·축척·REV·시트)', pass: has('nf-titleblock') && has('data-dwg') && has('시트') },
    { id: 'C2', name: '단면도+해칭', pass: has('nfhatch') && has('SECTION A-A') },
    { id: 'C3', name: '부분 상세 콜아웃', pass: has('DETAIL ') },
    { id: 'C4', name: '치수 체계(⌀·치수문자)', pass: has('⌀') || has(/\d+×\d+/) },
    { id: 'C5', name: '선 종류(중심선·파선)', pass: has('8 2 2 2') && has('stroke-dasharray="5 3"') },
    { id: 'C6', name: '심볼 표기(원형 장비·P&ID)', pass: has('<circle') },
    { id: 'C7', name: 'BOM 규격열(발주 규격)', pass: has('발주 규격') && (has('SCH40') || has('SQ TUBE') || has('가공품(도면 제작)')) },
    { id: 'C8', name: '용접 일람(조인트별)', pass: has('필릿 △') },
    { id: 'C9', name: 'DXF 레이어 분리', pass: null, note: 'DXF 파일 별도 검사(HTML 범위 외)' },
  ];
  const applicable = items.filter((i) => i.pass !== null);
  const passed = applicable.filter((i) => i.pass);
  return {
    kind,
    score: `${passed.length}/${applicable.length}`,
    passed: passed.map((i) => i.id),
    failed: applicable.filter((i) => !i.pass).map((i) => `${i.id} ${i.name}`),
    na: items.filter((i) => i.pass === null).map((i) => `${i.id} (${i.note})`),
    ok: passed.length === applicable.length,
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
