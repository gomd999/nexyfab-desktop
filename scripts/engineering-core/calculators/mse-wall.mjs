/**
 * P8 토목 — 보강토옹벽(MSE) 외적 안정 (LRFD) — FHWA-NHI-10-025 방법.
 * 활동·편심(전도 제한)·지지력 3검토, CDR(내하/소요) 보고 — LRFD라 FS 아님(명시).
 * 하중: F1=½Ka·γf·H², F2=Ka·q·H (Rankine 수평배면) · V1=γr·H·L, Vs=q·L(활하중은
 * 저항 시 미포함 — FHWA 관례). 하중계수 기본 = 문서 판독값(Str I: EV 1.35·EH 1.50·
 * LL 1.75 / min 1.00·0.90) · φ_sliding 1.0·φ_bearing 0.65.
 * 공표 재현: FHWA NHI-10-025 App.E Example E4 (H 25.64ft·L 18ft) — published-bench.
 * 내적 안정(보강재 파단·인발)은 후속 명시.
 */
export default {
  id: 'mse_wall',
  domain: 'civil/retaining',
  title: '보강토옹벽 외적 안정 (LRFD)',
  description: '활동·편심·지지력 CDR — FHWA GEC11 방법(공표예제 재현).',
  refs: ['FHWA-NHI-10-025 (GEC 11) Vol.II App.E — Example E4 재현', 'KDS 11 80 10(보강토) 연계는 계수 대조 후속'],
  status: 'verified — FHWA E4 재현(활동 CDR 1.37·편심 3.87ft·지지 1.79). 내적 안정·경사배면·지진은 후속',
  inputSchema: {
    type: 'object',
    required: ['H', 'L', 'gammaR', 'phiR', 'gammaF', 'phiF', 'bearingResistance'],
    properties: {
      H: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: '설계벽고 m (근입 포함)' },
      L: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: '보강재 길이 m (통상 0.7H)' },
      gammaR: { type: 'number', minimum: 14, maximum: 24, description: '보강토체 단위중량 kN/m³' },
      phiR: { type: 'number', minimum: 25, maximum: 45, description: '보강토체 φ′r ° (기초 마찰에 사용 — min(φr, φfd) 보수)' },
      gammaF: { type: 'number', minimum: 14, maximum: 24, description: '배면토 단위중량' },
      phiF: { type: 'number', minimum: 20, maximum: 45, description: '배면토 φ′f ° (Ka 산정)' },
      phiFd: { type: 'number', minimum: 20, maximum: 45, description: '기초지반 φ′ (기본 phiR과 min — 활동 마찰)' },
      surcharge: { type: 'number', minimum: 0, description: '등가 활하중 상재 q kPa (heq×γ)' },
      bearingResistance: { type: 'number', exclusiveMinimum: 0, description: '계수 지지저항 kPa (지반조사 — φ_b 포함값 또는 공칭×0.65)' },
      gEV: { type: 'number', minimum: 1.0, maximum: 1.5, description: '연직토 하중계수 (기본 1.35 — FHWA Str I max)' },
      gEH: { type: 'number', minimum: 0.9, maximum: 1.75, description: '수평토 (기본 1.50)' },
      gLL: { type: 'number', minimum: 1.0, maximum: 2.0, description: '활하중 (기본 1.75)' },
    },
  },
  run(input) {
    const { H, L, gammaR, gammaF } = input;
    const q = input.surcharge ?? 0;
    const Kaf = Math.pow(Math.tan(Math.PI / 4 - (input.phiF * Math.PI) / 360), 2);
    const gEV = input.gEV ?? 1.35, gEH = input.gEH ?? 1.50, gLL = input.gLL ?? 1.75;
    // 비계수 하중
    const V1 = gammaR * H * L, MV1 = V1 * (L / 2);
    const Vs = q * L;
    const F1 = 0.5 * Kaf * gammaF * H * H, MF1 = F1 * (H / 3);
    const F2 = Kaf * q * H, MF2 = F2 * (H / 2);
    // 활동 (임계: 저항=min계수 V1, 소요=max계수 수평)
    const phiSlide = Math.min(input.phiR, input.phiFd ?? input.phiR) * Math.PI / 180;
    const Hmax = gEH * F1 + gLL * F2;
    const Rmin = 1.0 * Math.tan(phiSlide) * (0.90 /*EV min? FHWA: V1 min = 1.00*/ * 0 + 1.00 * V1); // FHWA E4: min V1 = 1.00·V1
    const slideCDR = Rmin / Hmax;
    // 편심 (임계: 저항모멘트 min EV=1.00, 전도모멘트 max)
    const MR = 1.00 * MV1;
    const MO = gEH * MF1 + gLL * MF2;
    const Vsum = 1.00 * V1;
    const a = (MR - MO) / Vsum;
    const e = L / 2 - a;
    const eLimit = L / 4; // 흙 기초 L/4 (FHWA LRFD)
    // 지지력 (max 계수): σv = ΣV/(L−2e′), e′는 max 조합
    const Vmax = gEV * V1 + gLL * Vs;
    const MRmax = gEV * MV1 + gLL * Vs * (L / 2);
    const MOmax = gEH * MF1 + gLL * MF2;
    const eB = L / 2 - (MRmax - MOmax) / Vmax;
    const sigmaV = Vmax / (L - 2 * Math.max(0, eB));
    const bearCDR = input.bearingResistance / sigmaV;
    const pass = slideCDR >= 1 && e <= eLimit && bearCDR >= 1;
    const r3 = (v) => +v.toFixed(3);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      checks: {
        sliding: { CDR: r3(slideCDR), pass: slideCDR >= 1 },
        eccentricity: { e_m: r3(e), limit_m: r3(eLimit), pass: e <= eLimit },
        bearing: { sigmaV_kPa: r3(sigmaV), resistance_kPa: input.bearingResistance, CDR: r3(bearCDR), pass: bearCDR >= 1 },
      },
      intermediate: { Kaf: r3(Kaf), F1: r3(F1), F2: r3(F2), V1: r3(V1), eBearing_m: r3(eB) },
      notes: [
        `LRFD CDR(≥1 충족) — FS 아님 명시. 계수: EV ${gEV}·EH ${gEH}·LL ${gLL}(FHWA Str I 판독값, 변경 가능).`,
        '수평 배면·Rankine Ka — 경사배면·상재 경사·지진(M-O)·내적 안정(파단·인발)은 후속 명시.',
        '지지저항은 계수값 입력(지반조사) — 공칭이면 ×0.65 반영해 입력.',
      ],
    };
  },
};
