/**
 * P10 기계 — 기본 진동: 보 고유진동수(폐형) + 1자유도 조화응답 전달률.
 * fn = (λ²/2π)·√(EI/(m̄·L⁴)) — λ² 고전값: 단순 π² · 캔틸레버 3.5160 ·
 * 양단고정 22.373 · 고정-힌지 15.418 (교과서 표준). TR = √(1+(2ζr)²)/√((1−r²)²+(2ζr)²).
 * 앵커: 폐형 자기시험 + TR(r=√2, ζ→0)=1 성질.
 */
const LAMBDA2 = { simple: Math.PI * Math.PI, cantilever: 3.5160, fixedFixed: 22.373, fixedPinned: 15.418 };

export default {
  id: 'vibration_basic',
  domain: 'mech/dynamics',
  title: '보 고유진동수·조화응답 전달률',
  description: '1차 굽힘 고유진동수(폐형) + 가진 주파수 공진 여유·전달률 검토.',
  refs: ['Euler 보 고유진동수 고전 폐형 (λ²: 단순 π²·캔틸레버 3.516·양단고정 22.373)', '1자유도 조화응답 전달률(교과서 표준)'],
  status: 'verified — 폐형 앵커. 다모드·집중질량·회전기계 밸런싱은 후속',
  inputSchema: {
    type: 'object',
    required: ['support', 'E_MPa', 'I_mm4', 'massPerM_kg', 'L_mm'],
    properties: {
      support: { type: 'string', enum: ['simple', 'cantilever', 'fixedFixed', 'fixedPinned'], description: '지지 조건' },
      E_MPa: { type: 'number', exclusiveMinimum: 0, description: '탄성계수 MPa' },
      I_mm4: { type: 'number', exclusiveMinimum: 0, description: '단면 2차모멘트 mm⁴' },
      massPerM_kg: { type: 'number', exclusiveMinimum: 0, description: '단위길이 질량 kg/m (부가질량 환산 포함 — 명시)' },
      L_mm: { type: 'number', exclusiveMinimum: 0, maximum: 60000, description: '길이 mm' },
      forcingHz: { type: 'number', minimum: 0, description: '가진 주파수 Hz (입력 시 공진 여유·전달률 검토)' },
      zeta: { type: 'number', minimum: 0.001, maximum: 0.5, description: '감쇠비 (기본 0.02 관례 명시 — 측정값 권장)' },
      marginRequired: { type: 'number', minimum: 1.05, maximum: 3, description: '공진 이격비 요구 (기본 1.25 관례)' },
    },
  },
  run(input) {
    const lam2 = LAMBDA2[input.support];
    const EI = input.E_MPa * 1e6 * (input.I_mm4 * 1e-12); // N·m²
    const L = input.L_mm / 1000;
    const fn = (lam2 / (2 * Math.PI)) * Math.sqrt(EI / (input.massPerM_kg * Math.pow(L, 4)));
    let checks;
    if (input.forcingHz > 0) {
      const r = input.forcingHz / fn;
      const z = input.zeta ?? 0.02;
      const TR = Math.sqrt(1 + (2 * z * r) ** 2) / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
      const margin = r < 1 ? 1 / r : r;
      const req = input.marginRequired ?? 1.25;
      checks = { resonance: { r: +r.toFixed(3), margin: +margin.toFixed(3), required: req, TR: +TR.toFixed(3), pass: margin >= req } };
    }
    return {
      verdict: checks ? (checks.resonance.pass ? 'PASS' : 'FAIL') : 'INFO',
      fn_Hz: +fn.toFixed(3),
      ...(checks ? { checks } : {}),
      intermediate: { lambda2: lam2 },
      notes: [
        `1차 고유진동수 fn=${fn.toFixed(2)}Hz (λ²=${lam2}, ${input.support}) — 균일 단면 가정.`,
        ...(checks ? [`가진 → r=${checks.resonance.r}, 전달률 ${checks.resonance.TR}, 이격 ${checks.resonance.margin}(요구 ${checks.resonance.required}).`] : []),
        '고차 모드·비균일 단면·기초 유연성은 후속(FEA 모드해석).',
      ],
    };
  },
};
