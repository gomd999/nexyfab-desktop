/**
 * P19 건축 — RC 장기처짐 (KDS 14 20 30 §4.2.1(5)(6) 원문 판독).
 * λΔ = ξ/(1+50ρ′) (식 4.2-4) — ξ: 3개월 1.0 · 6개월 1.2 · 12개월 1.4 · 5년+ 2.0 (원문).
 * 추가 장기처짐 = λΔ × 지속하중 순간처짐. 총처짐 조합 vs 표 4.2-2 한계
 * (l/180 평지붕 비손상 · l/360 바닥 비손상 · l/480 손상쉬운 요소 지지 · l/240 그 외 — 원문).
 * 순간처짐(탄성·유효단면 Ie)은 별도 산정 입력 원칙(식 4.2-1 Ie는 후속 — 명시).
 */
const XI = { 3: 1.0, 6: 1.2, 12: 1.4, 60: 2.0 }; // 개월 → ξ (원문)
const LIMITS = { roof_nofragile: 180, floor_nofragile: 360, fragile: 480, nonfragile_attached: 240 }; // 표 4.2-2
export default {
  id: 'longterm_deflection',
  domain: 'architecture/serviceability',
  title: 'RC 장기처짐 (λΔ — §4.2.1)',
  description: 'λΔ=ξ/(1+50ρ′)·표 4.2-2 허용처짐 판정 — 순간처짐은 산정 입력.',
  refs: ['KDS 14 20 30:2021 식4.2-4(λΔ)·ξ 4단(1.0/1.2/1.4/2.0)·표 4.2-2(l/180·360·480·240) — 원문 GIF 판독'],
  status: 'verified — 원문 계수·표 전사(폐형). 유효단면 Ie(식4.2-1) 자동 산정은 후속(입력 원칙)',
  inputSchema: {
    type: 'object',
    required: ['span_mm', 'instSustained_mm', 'duration_months', 'memberType'],
    properties: {
      span_mm: { type: 'number', exclusiveMinimum: 0, description: '경간 l' },
      instSustained_mm: { type: 'number', minimum: 0, description: '지속하중(고정+지속활하중)에 의한 순간처짐 (Ie 반영 산정 입력)' },
      instLive_mm: { type: 'number', minimum: 0, description: '활하중 순간처짐 (표 4.2-2 조합용)' },
      duration_months: { enum: [3, 6, 12, 60], description: '지속 기간 (60=5년 이상 — ξ 원문 4단)' },
      rhoPrime: { type: 'number', minimum: 0, maximum: 0.04, description: '압축철근비 ρ′ (중앙부·캔틸레버는 받침부 — 원문. 0=압축철근 없음)' },
      memberType: { enum: ['roof_nofragile', 'floor_nofragile', 'fragile', 'nonfragile_attached'], description: '표 4.2-2 부재 구분 (손상쉬운 요소 지지 여부)' },
    },
  },
  run(input) {
    const xi = XI[input.duration_months];
    const rp = Number(input.rhoPrime) || 0;
    const lam = xi / (1 + 50 * rp);
    const addLong = lam * input.instSustained_mm;
    const live = Number(input.instLive_mm) || 0;
    // 표 4.2-2 검토 대상 처짐: 비손상 지붕/바닥=활하중 순간 / 손상쉬운·그외=활하중+장기(지속분) 합
    const isFragileRow = input.memberType === 'fragile' || input.memberType === 'nonfragile_attached';
    const checkDefl = isFragileRow ? addLong + live : live;
    const limit = input.span_mm / LIMITS[input.memberType];
    const pass = checkDefl <= limit;
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: {
        deflection: {
          lambda: +lam.toFixed(3), xi, addLong_mm: +addLong.toFixed(1),
          checked_mm: +checkDefl.toFixed(1), limit_mm: +limit.toFixed(1), limitRatio: 'l/' + LIMITS[input.memberType], pass,
        },
      },
      notes: [
        `λΔ=ξ(${xi})/(1+50·${rp})=${lam.toFixed(3)} → 추가 장기 ${addLong.toFixed(1)}mm (식4.2-4 원문).`,
        `검토 처짐=${isFragileRow ? '장기(지속분)+활하중 순간(표 4.2-2 주석 취지)' : '활하중 순간'} vs l/${LIMITS[input.memberType]}(표 4.2-2 원문).`,
        '순간처짐=유효단면 Ie 반영 산정 입력 원칙(식4.2-1 자동화 후속). 표 4.2-1 최소두께 충족 시 처짐계산 생략 가능(별도).',
      ],
    };
  },
};
