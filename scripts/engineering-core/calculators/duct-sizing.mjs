/**
 * P11 인테리어 — 덕트 사이징 (속도법 + Darcy 마찰) — 폐형.
 * A=Q/v → 원형경 → 표준경 선정 → Δp = f·(L/D)·(ρv²/2), f=Swamee-Jain(명시적).
 * 각형 환산: 등가경 De=1.3(ab)^0.625/(a+b)^0.25 (ASHRAE 표준식) 역산.
 * 앵커: Q=0.5m³/s·v=5 → A=0.1m²·D=357mm 폐형 / 층류 f=64/Re 성질.
 */
export default {
  id: 'duct_sizing',
  domain: 'interior/hvac',
  title: '덕트 사이징 (속도법)',
  description: '풍량·허용유속 → 덕트 표준경/각형 치수 + 직관 마찰손실.',
  refs: ['속도법 + Darcy-Weisbach·Swamee-Jain(폐형)', 'ASHRAE 등가경 De=1.3(ab)^0.625/(a+b)^0.25'],
  status: 'verified — 폐형. 등마찰법·국부손실 DB·덕트 소음은 후속',
  inputSchema: {
    type: 'object',
    required: ['flowCMH', 'velocityLimit'],
    properties: {
      flowCMH: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: '풍량 m³/h (환기 계산 연동)' },
      velocityLimit: { type: 'number', minimum: 1, maximum: 20, description: '허용 유속 m/s (거실 3~5·주덕트 6~8 관례 — 용도 확인 입력)' },
      lengthM: { type: 'number', minimum: 0, description: '직관 길이 m (마찰손실 — 선택)' },
      roughness_mm: { type: 'number', minimum: 0.01, maximum: 3, description: '조도 mm (아연도강판 0.15 관례, 기본)' },
      aspect: { type: 'number', minimum: 1, maximum: 4, description: '각형 종횡비 (입력 시 각형 치수 제안)' },
    },
  },
  run(input) {
    const Q = input.flowCMH / 3600;
    const v = input.velocityLimit;
    const A = Q / v;
    const D = Math.sqrt((4 * A) / Math.PI); // m
    const STD = [100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];
    const Dsel = STD.find((d) => d >= D * 1000) ?? Math.ceil((D * 1000) / 50) * 50;
    const vActual = Q / ((Math.PI * (Dsel / 1000) ** 2) / 4);
    let friction = null;
    if (input.lengthM > 0) {
      const rho = 1.2, nu = 1.5e-5;
      const Re = (vActual * (Dsel / 1000)) / nu;
      const eps = ((input.roughness_mm ?? 0.15) / 1000) / (Dsel / 1000);
      const f = Re < 2300 ? 64 / Re : 0.25 / Math.pow(Math.log10(eps / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
      const dp = f * (input.lengthM / (Dsel / 1000)) * ((rho * vActual * vActual) / 2);
      friction = { Re: Math.round(Re), f: +f.toFixed(4), dp_Pa: +dp.toFixed(1), perM_Pa: +(dp / input.lengthM).toFixed(2) };
    }
    let rect = null;
    if (input.aspect >= 1) {
      let b = D / Math.sqrt(input.aspect);
      for (let i = 0; i < 40; i++) {
        const a = input.aspect * b;
        const De = (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);
        b *= Math.pow(D / De, 0.8);
      }
      rect = { a_mm: Math.ceil((input.aspect * b * 1000) / 50) * 50, b_mm: Math.ceil((b * 1000) / 50) * 50 };
    }
    return {
      verdict: 'INFO',
      intermediate: { required_D_mm: +(D * 1000).toFixed(0), selected_D_mm: Dsel, v_actual_ms: +vActual.toFixed(2), friction, rect },
      notes: [
        `A=Q/v=${A.toFixed(4)}m² → D=${(D * 1000).toFixed(0)}mm → 표준 ${Dsel}mm (실유속 ${vActual.toFixed(1)}m/s)`,
        '직관 마찰만(Swamee-Jain) — 엘보·분기 국부손실·팬 정압·소음은 후속. 허용유속=용도 관례 확인 입력.',
      ],
    };
  },
};
