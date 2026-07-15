/**
 * P20 기계 — 기어 굽힘강도 (루이스식 — Lewis 1892 고전 공표 + Barth 속도계수).
 * σ = Ft / (b·m·Y) · 동적 보정 Kv(Barth): 밀링가공 (3.05+V)/3.05 · 절삭 (6.1+V)/6.1
 *   (V m/s — 가공법 선택, 고전 공표 계수).
 * Y = 루이스 폼팩터 (20° 표준 전치형 — Shigley 등 교과서 공표 표 전사, 잇수 보간).
 * AGMA 정밀법(J·Ka·Km 등)은 표준 라이선스 확보 시 후속 — 루이스는 보수적 개산 명시.
 * 면압(피팅)은 Hertz 접촉 — 후속. 허용응력 = 재료 입력 원칙.
 */
const LEWIS_Y = [ // [잇수, Y] — 20° full-depth (교과서 공표 고전)
  [12, 0.245], [13, 0.261], [14, 0.277], [15, 0.290], [16, 0.296], [17, 0.303], [18, 0.309],
  [19, 0.314], [20, 0.322], [22, 0.331], [24, 0.337], [26, 0.346], [28, 0.353], [30, 0.359],
  [34, 0.371], [38, 0.384], [43, 0.397], [50, 0.409], [60, 0.422], [75, 0.435], [100, 0.447],
  [150, 0.460], [300, 0.472],
];
export default {
  id: 'gear_bending',
  domain: 'mechanical/power',
  title: '기어 굽힘강도 (루이스식)',
  description: 'σ=Ft/(bmY)·Barth Kv — 20° 폼팩터 공표 표. AGMA 정밀법은 보류(라이선스).',
  refs: ['Lewis(1892) 굽힘식 + Barth 속도계수 — 기계설계 교과서 공표 고전', 'Y 폼팩터=20° 표준 전치형 공표 표 전사(보간)', 'AGMA 2001 정밀계수=표준 라이선스 미확보 — 정직 보류(루이스=보수 개산 명시)'],
  status: 'verified — 고전 공표식·표 전사(폐형). 면압(Hertz)·AGMA J계수·치형계수 상세는 후속',
  inputSchema: {
    type: 'object',
    required: ['power_kW', 'rpm', 'module_mm', 'teeth', 'faceWidth_mm', 'sigmaAllow_MPa'],
    properties: {
      power_kW: { type: 'number', exclusiveMinimum: 0, description: '전달 동력' },
      rpm: { type: 'number', exclusiveMinimum: 0, description: '회전수' },
      module_mm: { type: 'number', minimum: 0.5, maximum: 25, description: '모듈 m' },
      teeth: { type: 'integer', minimum: 12, maximum: 300, description: '잇수 (12~300 — 표 범위)' },
      faceWidth_mm: { type: 'number', exclusiveMinimum: 0, description: '치폭 b (관례 9m~14m 범위 확인)' },
      sigmaAllow_MPa: { type: 'number', exclusiveMinimum: 0, description: '허용 굽힘응력 (재료·열처리 입력 원칙 — 지어내지 않음)' },
      finish: { enum: ['milled', 'cast'], description: '가공 (Barth: 밀링 (3.05+V)/3.05 · 주조/절삭 (6.1+V)/6.1 — 기본 milled)' },
      serviceFactor: { type: 'number', minimum: 1.0, maximum: 3.0, description: '사용계수 Ks (충격·원동기 — 관례표 입력, 기본 1.0=미반영 명시)' },
    },
  },
  run(input) {
    const { module_mm: m, teeth: z, faceWidth_mm: b } = input;
    const d = m * z; // 피치원 지름 mm
    const V = (Math.PI * d * input.rpm) / 60000; // m/s
    const Ft = (input.power_kW * 1000) / V; // N
    // Y 보간
    let Y = LEWIS_Y[LEWIS_Y.length - 1][1];
    for (let i = 0; i < LEWIS_Y.length - 1; i++) {
      const [z1, y1] = LEWIS_Y[i], [z2, y2] = LEWIS_Y[i + 1];
      if (z >= z1 && z <= z2) { Y = y1 + ((y2 - y1) * (z - z1)) / (z2 - z1); break; }
    }
    const Kv = (input.finish ?? 'milled') === 'cast' ? (6.1 + V) / 6.1 : (3.05 + V) / 3.05;
    const Ks = input.serviceFactor ?? 1.0;
    const sigma = (Kv * Ks * Ft) / (b * m * Y);
    const ratio = sigma / input.sigmaAllow_MPa;
    const bOk = b >= 9 * m && b <= 14 * m;
    return {
      verdict: ratio <= 1 ? 'PASS' : 'FAIL',
      checks: {
        bending: { sigma_MPa: +sigma.toFixed(1), allow_MPa: input.sigmaAllow_MPa, ratio: +ratio.toFixed(3), pass: ratio <= 1 },
        faceWidth: { b_mm: b, range: `${9 * m}~${14 * m}`, ok: bOk, note: bOk ? '관례 범위 내' : '⚠ 치폭 관례(9m~14m) 밖 — 편하중 주의' },
      },
      intermediate: { d_mm: d, V_ms: +V.toFixed(2), Ft_N: +Ft.toFixed(0), Y: +Y.toFixed(3), Kv: +Kv.toFixed(3), Ks },
      notes: [
        `σ=Kv(${Kv.toFixed(2)})·Ks(${Ks})·Ft/(b·m·Y=${Y.toFixed(3)}) = ${sigma.toFixed(1)}MPa — 루이스 고전(보수 개산 명시).`,
        '허용응력=재료·열처리 입력 원칙. AGMA 정밀법(J·Km·수명계수)은 표준 라이선스 확보 시 승격 — 정직 보류.',
        '면압(피팅 — Hertz)·치면 윤활·백래시는 후속/별도.',
      ],
    };
  },
};
