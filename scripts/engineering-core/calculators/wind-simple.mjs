/**
 * P5 건축 — 주골조설계용 수평풍하중 간편법 — KDS 41 12 00 §5.15.
 * W_SF = 0.25·V0²·H^0.44·Ce·Cf·A (식 5.15-1, 원문 GIF 판독).
 * 적용조건(§5.15.1 게이트): H≤20m · H/√BD≤1.0 · 0.5H≤B≤30m · 지붕경사<10° · 정형 대칭.
 * Cf = Cpe(풍상 0.6) − Cpe(풍하 −0.5~−0.3, D/B 직선보간) — 표 5.15-1.
 * 최소풍압 675 N/m² 하한(§5.15.2 단서). V0는 그림 5.5-1 지역값 — 필수 입력(지어내지 않음).
 */
export default {
  id: 'wind_simple',
  domain: 'architecture/lateral',
  title: '수평풍하중 간편법 (저층 주골조)',
  description: 'KDS 41 12 00 §5.15 간편법 — 설계풍압·기단전단력. 저층(H≤20m) 정형 건물 전용.',
  refs: [
    'KDS 41 12 00:2022 §5.15 식(5.15-1)·표 5.15-1 (원문 GIF 판독)',
    'KDS 41 12 00:2022 그림 5.5-1 (기본풍속 — 사용자 입력)',
  ],
  status: 'verified — 식·표·적용조건 원문 판독. 정식법(5.2)·지붕풍하중은 후속',
  inputSchema: {
    type: 'object',
    required: ['V0', 'H', 'B', 'D', 'demandNone'],
    properties: {
      V0: { type: 'number', minimum: 20, maximum: 50, description: '기본풍속 m/s (그림 5.5-1 건설지 등풍속선 — 필수 입력, 예: 서울 26·부산 38·제주 44)' },
      H: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: '기준높이 m (간편법 상한 20)' },
      B: { type: 'number', exclusiveMinimum: 0, maximum: 30, description: '대표폭(풍직각방향) m' },
      D: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '깊이(풍방향) m' },
      roofSlopeDeg: { type: 'number', minimum: 0, maximum: 45, description: '지붕경사각 ° (기본 0 — ≥10°는 적용 불가)' },
      terrain: { type: 'string', enum: ['normal', 'flatOpen', 'coast'], description: '환경계수 Ce: 통상 1.0 / 장애물 없는 평탄지 1.5 / 해안가 2.0 (기본 normal)' },
      Kzt: { type: 'number', minimum: 1.0, maximum: 2.0, description: '지형계수 (언덕·산 정상부 할증 시 — Ce에 Kzt² 곱, 기본 1.0)' },
      demandNone: { type: 'number', minimum: 0, maximum: 0, description: '자리표시 0 입력 (풍하중 산출 계산기 — 판정은 골조 연계)' },
    },
  },
  run(input, std) {
    const ws = std.windSimple;
    if (!ws) throw new Error('standard gate: windSimple 미탑재');
    const { V0, H, B, D } = input;
    const slope = input.roofSlopeDeg ?? 0;

    // 적용조건 게이트 (§5.15.1) — 벗어나면 정식법(5.2) 필요, 근사 강행하지 않음
    const gateFails = [];
    if (H > 20) gateFails.push(`H ${H} > 20m (조건①)`);
    if (H / Math.sqrt(B * D) > 1.0) gateFails.push(`H/√BD ${(H / Math.sqrt(B * D)).toFixed(2)} > 1.0 (조건②)`);
    if (B < 0.5 * H || B > 30) gateFails.push(`B ${B}m — 0.5H(${(0.5 * H).toFixed(1)})≤B≤30 위반 (조건③)`);
    if (slope >= 10) gateFails.push(`지붕경사 ${slope}° ≥ 10° (조건④)`);
    if (gateFails.length) {
      const e = new Error(`간편법 적용범위 밖 — 정식법(§5.2) 필요: ${gateFails.join('; ')}`);
      e.code = 'INPUT_GATE';
      throw e;
    }

    // Cf = Cpe풍상 − Cpe풍하 (표 5.15-1: 풍상 0.6 · 풍하 D/B≤1→−0.5, ≥2→−0.3, 직선보간)
    const db = D / B;
    const cpeLee = db <= 1 ? -0.5 : db >= 2 ? -0.3 : -0.5 + 0.2 * (db - 1);
    const Cf = 0.6 - cpeLee;

    // 환경계수 Ce (통상 1.0 / 평탄지 1.5 / 해안가 2.0) × Kzt² (지형 할증)
    const CeBase = ws.Ce[input.terrain ?? 'normal'];
    const Kzt = input.Kzt ?? 1.0;
    const Ce = CeBase * Kzt * Kzt;

    // 식(5.15-1): 단위면적당 풍압 (A=1) + 최소풍압 675 N/m²
    const pRaw = 0.25 * V0 * V0 * Math.pow(H, 0.44) * Ce * Cf;
    const minGoverns = pRaw < ws.minPressure_Nm2;
    const p = Math.max(pRaw, ws.minPressure_Nm2);
    const baseShear_kN = (p * B * H) / 1000;

    // 층전단 분포(균등 압력 가정 — 간편법 특성 명시): 층수 입력 시 균등 분할
    return {
      inputsEcho: input,
      verdict: 'INFO', // 하중 산출 계산기 — 골조 판정은 연계 계산기에서
      pressure: { design_Nm2: +p.toFixed(1), raw_Nm2: +pRaw.toFixed(1), minGoverns, min_Nm2: ws.minPressure_Nm2 },
      coefficients: { Cf: +Cf.toFixed(3), cpeWindward: 0.6, cpeLeeward: +cpeLee.toFixed(3), Ce: +Ce.toFixed(3), CeBase, Kzt },
      baseShear_kN: +baseShear_kN.toFixed(1),
      notes: [
        `W = 0.25×${V0}²×${H}^0.44×${Ce.toFixed(2)}×${Cf.toFixed(2)} = ${pRaw.toFixed(0)} N/m²${minGoverns ? ` → 최소풍압 675 지배` : ''}`,
        `기단전단 V = p×B×H = ${baseShear_kN.toFixed(1)} kN (풍압 균등 분포 — 간편법 근사 명시)`,
        'V0는 그림 5.5-1 건설지 등풍속선 값 — 등풍속선 사이는 큰 값 사용(원문 주2).',
        '지붕풍하중(5.15-2)·외장재(5.15-3)·내압은 미포함 — 수평 주골조 전용.',
      ],
    };
  },
};
