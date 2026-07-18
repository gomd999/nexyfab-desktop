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
    { id: 'C7', name: 'BOM 규격열(발주 규격)', pass: has('발주 규격') && (has('SCH40') || has('SQ TUBE')) },
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
