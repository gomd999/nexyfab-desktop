/**
 * P17 기계 — 전동축 설계 (비틀림+굽힘 조합 — ASME 폐형).
 * 정적: 최대전단응력설(MSST) τmax = 16/(πd³)·√(M²+T²) ≤ τallow — 폐형.
 * ASME 축 공식(전동축 관례): d³ = 16/(π·τa)·√((Km·M)²+(Kt·T)²) — 충격계수 Km·Kt 입력
 *   (회전축 정하중 Km 1.5·Kt 1.0 관례 표 — 값은 입력 원칙, 관례 기본 명시).
 * 피로 조합(선택): 굽힘=완전교번(회전축)·비틀림=정상 가정 → Soderberg/Goodman
 *   σa=32M/πd³ vs Se(fatigue_goodman과 동일 Shigley 추정 재사용 원칙 — Se 입력).
 * 앵커: T=0 → 순수 굽힘 σ=32M/πd³ · M=0 → 순수 비틀림 τ=16T/πd³ (폐형 자체검증).
 */
export default {
  id: 'shaft_design',
  domain: 'mechanical/power',
  title: '전동축 설계 (굽힘+비틀림)',
  description: 'MSST/ASME 조합응력 — 소요지름 산정 또는 검토. 피로는 Se 입력 연계.',
  refs: ['MSST·ASME 전동축 공식 (기계설계 표준 폐형)', '충격계수 Km·Kt = 관례표 입력(기본 1.5/1.0 회전축 정하중 — 명시)'],
  status: 'verified — 폐형 앵커(순수 굽힘·순수 비틀림). 키홈 응력집중·처짐·위험속도는 후속',
  inputSchema: {
    type: 'object',
    required: ['M_Nm', 'T_Nm'],
    properties: {
      M_Nm: { type: 'number', minimum: 0, description: '굽힘모멘트 (지지점·하중 배치에서 산정 입력)' },
      T_Nm: { type: 'number', minimum: 0, description: '비틀림 토크 (동력/각속도 산정 입력)' },
      d_mm: { type: 'number', exclusiveMinimum: 0, maximum: 500, description: '축 지름 (입력 시 검토 모드 · 미입력 시 소요지름 산정)' },
      tauAllow_MPa: { type: 'number', exclusiveMinimum: 0, description: '허용전단응력 (재료·기준 산정 입력 — ASME 관례 0.3Sy·0.18Su 중 작은 값, 키홈 시 75% — 산정 근거 입력 원칙)' },
      Km: { type: 'number', minimum: 1.0, maximum: 3.0, description: '굽힘 충격계수 (기본 1.5 — 회전축 정하중 관례 명시)' },
      Kt: { type: 'number', minimum: 1.0, maximum: 3.0, description: '비틀림 충격계수 (기본 1.0)' },
      Se_MPa: { type: 'number', exclusiveMinimum: 0, description: '피로한도 (선택 — 입력 시 Soderberg 피로검토: 굽힘 완전교번·비틀림 정상 가정 명시)' },
      Sy_MPa: { type: 'number', exclusiveMinimum: 0, description: '항복강도 (Soderberg용)' },
      fatigueSF: { type: 'number', minimum: 1.0, maximum: 5.0, description: '피로 목표 안전율 (기본 2.0 관례)' },
    },
  },
  run(input) {
    const M = input.M_Nm * 1000, T = input.T_Nm * 1000; // N·mm
    const Km = input.Km ?? 1.5, Kt = input.Kt ?? 1.0;
    const Meq = Math.sqrt((Km * M) ** 2 + (Kt * T) ** 2);
    if (!(Number(input.tauAllow_MPa) > 0)) throw new Error('input gate: tauAllow_MPa (재료 근거 산정 입력)');
    const tauA = input.tauAllow_MPa;
    const checks = {};
    let d = Number(input.d_mm) || 0;
    if (d > 0) {
      const tau = (16 * Meq) / (Math.PI * d ** 3);
      checks.static = { tau_MPa: +tau.toFixed(1), tauAllow_MPa: tauA, ratio: +(tau / tauA).toFixed(3), pass: tau <= tauA };
    } else {
      d = Math.cbrt((16 * Meq) / (Math.PI * tauA));
      checks.sizing = { dRequired_mm: +d.toFixed(1), note: '표준 축지름 절상 권장(스냅 목록 별도)' };
    }
    // 피로 (Soderberg — 회전축: 굽힘 완전교번 σa=32M/πd³, 비틀림 정상 τm=16T/πd³)
    let fat = null;
    if (Number(input.Se_MPa) > 0 && Number(input.Sy_MPa) > 0 && d > 0) {
      const sigA = (32 * M) / (Math.PI * d ** 3);
      const tauM = (16 * T) / (Math.PI * d ** 3);
      // Soderberg + MSST 등가: 1/n = √( (σa/Se)² + ... ) 대신 ASME 타원 근사 대신 —
      // 보수 조합: von Mises 등가 σa'=σa, σm'=√3·τm → 1/n = σa'/Se + σm'/Sy (Soderberg 직선)
      const nInv = sigA / input.Se_MPa + (Math.sqrt(3) * tauM) / input.Sy_MPa;
      const nF = nInv > 0 ? 1 / nInv : Infinity;
      const target = input.fatigueSF ?? 2.0;
      fat = { sigmaA_MPa: +sigA.toFixed(1), tauM_MPa: +tauM.toFixed(1), n: +nF.toFixed(2), target, pass: nF >= target,
        note: 'Soderberg 직선+von Mises 등가(보수 명시) — 굽힘 완전교번·비틀림 정상 가정. Se=입력(fatigue_goodman Shigley 추정 재사용 가능). 키홈 Kf 별도 반영 필요 명시.' };
      checks.fatigue = fat;
    }
    const pass = Object.values(checks).every((c) => c.pass !== false);
    return {
      verdict: Number(input.d_mm) > 0 ? (pass ? 'PASS' : 'FAIL') : 'INFO',
      checks,
      intermediate: { Meq_Nmm: Math.round(Meq), Km, Kt, d_mm: +d.toFixed(1) },
      notes: [
        `등가모멘트 √((Km·M)²+(Kt·T)²)=${(Meq / 1000).toFixed(1)}N·m — ASME 전동축 공식(충격계수 관례 기본 명시).`,
        'τallow는 재료 근거 산정 입력(0.3Sy·0.18Su 관례 안내 — 지어내지 않음). 키홈 응집·처짐·위험속도(진동)는 vibration_basic/후속.',
      ],
    };
  },
};
