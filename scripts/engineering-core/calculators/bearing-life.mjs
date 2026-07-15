/**
 * P17 기계 — 구름베어링 수명 L10 (ISO 281 기본식 — 폐형).
 * L10 = (C/P)^p [10⁶ rev], p=3(볼)·10/3(롤러). 시간수명 L10h = L10·10⁶/(60n).
 * 등가하중 P = X·Fr + Y·Fa — X·Y는 베어링별 카탈로그 값 입력 원칙(지어내지 않음.
 *   순수 레이디얼이면 P=Fr). C(기본동정격)=카탈로그 입력.
 * 신뢰도 보정 a1: 90% 1.0 · 95% 0.64 · 96% 0.55 · 97% 0.47 · 98% 0.37 · 99% 0.25
 *   (ISO 281 공표 표준값). a_iso(윤활·오염)는 도표 의존 — 입력(기본 1.0=미반영 명시).
 * 앵커: C=P → L10=10⁶ rev 정의 자체검증.
 */
const A1 = { 90: 1.0, 95: 0.64, 96: 0.55, 97: 0.47, 98: 0.37, 99: 0.25 }; // ISO 281 표준
export default {
  id: 'bearing_life',
  domain: 'mechanical/element',
  title: '베어링 수명 L10 (ISO 281 기본식)',
  description: '기본 정격수명 + 신뢰도 보정 — C·X·Y는 카탈로그 입력 원칙.',
  refs: ['ISO 281 기본 정격수명식 (폐형)', '신뢰도 계수 a1 = ISO 공표 표준값 · a_iso=입력(도표 의존 명시)'],
  status: 'verified — 폐형 앵커(C=P→10⁶rev 정의). 등가하중 X·Y=카탈로그 입력. a_iso 도표는 입력 원칙',
  inputSchema: {
    type: 'object',
    required: ['C_kN', 'type', 'n_rpm'],
    properties: {
      C_kN: { type: 'number', exclusiveMinimum: 0, description: '기본 동정격하중 (카탈로그)' },
      type: { enum: ['ball', 'roller'], description: '볼(p=3) / 롤러(p=10/3)' },
      Fr_kN: { type: 'number', minimum: 0, description: '레이디얼 하중' },
      Fa_kN: { type: 'number', minimum: 0, description: '축하중 (X·Y 필요)' },
      X: { type: 'number', minimum: 0, maximum: 1, description: '레이디얼 계수 (카탈로그 — Fa 있으면 필수)' },
      Y: { type: 'number', minimum: 0, maximum: 5, description: '축 계수 (카탈로그)' },
      n_rpm: { type: 'number', exclusiveMinimum: 0, description: '회전수' },
      reliability_pct: { enum: [90, 95, 96, 97, 98, 99], description: '신뢰도 % (기본 90 — a1=ISO 표준값)' },
      aIso: { type: 'number', minimum: 0.1, maximum: 50, description: '수명수정계수 a_iso (윤활·오염 도표 산정 입력 — 기본 1.0=미반영 명시)' },
      targetHours: { type: 'number', exclusiveMinimum: 0, description: '목표 수명 h (판정용 — 장비 관례 입력)' },
    },
  },
  run(input) {
    const Fr = Number(input.Fr_kN) || 0, Fa = Number(input.Fa_kN) || 0;
    let P;
    if (Fa > 0) {
      if (!(Number(input.X) >= 0) || !(Number(input.Y) >= 0)) throw new Error('input gate: 축하중 시 X·Y 카탈로그 값 필수(지어내지 않음)');
      P = Math.max(input.X * Fr + input.Y * Fa, Fr); // P ≥ Fr 관례
    } else {
      if (!(Fr > 0)) throw new Error('input gate: Fr 또는 Fa 필요');
      P = Fr;
    }
    const p = input.type === 'roller' ? 10 / 3 : 3;
    const L10 = Math.pow(input.C_kN / P, p); // 10^6 rev
    const a1 = A1[input.reliability_pct ?? 90];
    const aIso = Number(input.aIso) > 0 ? Number(input.aIso) : 1.0;
    const Lnm = a1 * aIso * L10;
    const L10h = (Lnm * 1e6) / (60 * input.n_rpm);
    const pass = Number(input.targetHours) > 0 ? L10h >= input.targetHours : null;
    return {
      verdict: pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL',
      checks: { life: { P_kN: +P.toFixed(2), L10_Mrev: +L10.toFixed(1), Lh_hours: Math.round(L10h), ...(pass !== null ? { target_h: input.targetHours, pass } : {}) } },
      intermediate: { p, a1, aIso, reliability: input.reliability_pct ?? 90 },
      notes: [
        `L${100 - (input.reliability_pct ?? 90)}h = a1(${a1})·a_iso(${aIso})·(C/P)^${p === 3 ? '3' : '10/3'}·10⁶/(60n) = ${Math.round(L10h).toLocaleString()}h.`,
        'C·X·Y=카탈로그 입력 원칙. a_iso=윤활·오염 도표 산정 입력(1.0=미반영 명시). 정정격(C0)·최소하중·온도보정 별도.',
      ],
    };
  },
};
