/**
 * P2 토목 — 캔틸레버/중력식 옹벽 안정 3종 검토 (전도·활동·지지력), Rankine 주동토압.
 * 근거 코퍼스(수집완료): USACE EM 1110-2-2502 §4, FHWA GEC 11.
 * 단위: m, kN, kPa, 단위중량 kN/m³ — 벽체 길이방향 1m당.
 */
const deg2rad = (d) => (d * Math.PI) / 180;

export default {
  id: 'retaining_wall_stability',
  domain: 'civil',
  title: '옹벽 안정 검토 (전도·활동·지지력)',
  description:
    'Rankine 주동토압 기반 캔틸레버 옹벽 외적 안정 3종 검토. 전도 FS + 합력 편심(e≤B/6), 활동 FS, 지지력(사다리꼴 접지압). 수동토압 저항은 보수적으로 무시(옵션).',
  refs: [
    'KDS 11 80 05:2025 §1.7.3(2) — 캔틸레버(역T/L형)·부벽식 옹벽의 뒷굽 연직 가상면에는 Rankine 토압 사용 의무 → 본 계산기 방법 그 자체. §1.7.3(3) 불규칙 뒤채움/상재는 시행쐐기법 영역(본 계산기 적용 불가). 가설흙막이는 KDS 21 30 00 §1.7.2①도 Rankine 허용',
    'KDS 11 80 05:2025 §4.4 표 4.4-1 기준안전율 (활동 1.5·전도 2.0·지지력 3.0 / 지진 1.2·1.5·2.0) — 원문 대조 완료, RAG 인덱스 kds-118005',
    'KDS 11 80 05:2025 §4.4.3(2) 전도 = 앞굽 중심 저항모멘트/활동모멘트 비 — 본 계산기와 동일 방법. §4.4.3(3) LRFD 대안판정(합력 위치 흙 B/4·암 3/8B)은 미적용',
    'USACE EM 1110-2-2502 §4 (RAG 코퍼스 수록: usace-em-1110-2-2502-retaining-walls)',
    'FHWA GEC 11 (RAG 코퍼스 수록)',
  ],
  status: 'draft — 안전율·검토방법 KDS 조항 대조 완료, 공개 게이트(§7.0: 공인예제 ≥10) 미충족(KDS 해설 예제 확충 대기)',
  inputSchema: {
    type: 'object',
    required: ['H', 'stemThickness', 'baseWidth', 'baseThickness', 'toeLength', 'gammaBackfill', 'phiBackfill', 'baseFriction', 'allowableBearing'],
    properties: {
      H: { type: 'number', exclusiveMinimum: 0, maximum: 12, description: '벽 전체 높이(기초 저면~상단) m' },
      stemThickness: { type: 'number', exclusiveMinimum: 0, description: '벽체(stem) 두께 m (등두께 가정)' },
      baseWidth: { type: 'number', exclusiveMinimum: 0, description: '기초 폭 B, m' },
      baseThickness: { type: 'number', exclusiveMinimum: 0, description: '기초 두께 m' },
      toeLength: { type: 'number', minimum: 0, description: '앞굽(toe) 길이 m' },
      gammaConcrete: { type: 'number', minimum: 20, maximum: 26, description: '콘크리트 단위중량 kN/m³ (기본 24)' },
      gammaBackfill: { type: 'number', minimum: 10, maximum: 24, description: '뒤채움 단위중량 kN/m³' },
      phiBackfill: { type: 'number', minimum: 15, maximum: 45, description: '뒤채움 내부마찰각 °' },
      surcharge: { type: 'number', minimum: 0, description: '상재하중 kPa (기본 0)' },
      baseFriction: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '저면 마찰계수 μ=tanδ' },
      allowableBearing: { type: 'number', exclusiveMinimum: 0, description: '허용지지력 q_allow kPa' },
    },
  },
  run(input, std) {
    const gc = input.gammaConcrete ?? 24;
    const q = input.surcharge ?? 0;
    const { H, stemThickness: ts, baseWidth: B, baseThickness: tb, toeLength: toe, gammaBackfill: g, phiBackfill: phi, baseFriction: mu, allowableBearing: qa } = input;
    const heel = B - toe - ts;
    if (heel < 0) throw new Error(`geometry gate: toe(${toe}) + stem(${ts}) > baseWidth(${B})`);
    const hStem = H - tb;
    if (hStem <= 0) throw new Error('geometry gate: baseThickness >= H');

    const crit = std.civil?.retaining_wall ?? { FS_overturning_min: 2.0, FS_sliding_min: 1.5, eccentricity_limit_fraction: 1 / 6 };

    // Rankine active pressure on vertical plane through heel
    const Ka = Math.tan(deg2rad(45 - phi / 2)) ** 2;
    const PaSoil = 0.5 * Ka * g * H * H; // kN/m, at H/3
    const PaSur = Ka * q * H; // kN/m, at H/2
    const Mo = PaSoil * (H / 3) + PaSur * (H / 2); // overturning about toe

    // Resisting weights, moments about toe front-bottom corner
    const parts = [
      { name: 'stem', W: ts * hStem * gc, x: toe + ts / 2 },
      { name: 'base', W: B * tb * gc, x: B / 2 },
      { name: 'soil-on-heel', W: heel * hStem * g, x: toe + ts + heel / 2 },
      ...(q > 0 ? [{ name: 'surcharge-on-heel', W: q * heel, x: toe + ts + heel / 2 }] : []),
    ];
    const V = parts.reduce((s, p) => s + p.W, 0);
    const Mr = parts.reduce((s, p) => s + p.W * p.x, 0);

    const FSot = Mr / Mo;
    const H_total = PaSoil + PaSur;
    const FSsl = (mu * V) / H_total;
    const xbar = (Mr - Mo) / V;
    const e = B / 2 - xbar;
    const eLimit = crit.eccentricity_limit_fraction * B;
    const withinKern = Math.abs(e) <= eLimit;
    const qmax = withinKern ? (V / B) * (1 + (6 * e) / B) : (2 * V) / (3 * (B / 2 - Math.abs(e))); // 삼각분포 폴백
    const qmin = withinKern ? (V / B) * (1 - (6 * e) / B) : 0;

    const checks = {
      overturning: { FS: FSot, min: crit.FS_overturning_min, pass: FSot >= crit.FS_overturning_min },
      sliding: { FS: FSsl, min: crit.FS_sliding_min, pass: FSsl >= crit.FS_sliding_min },
      eccentricity: { e_m: e, limit_m: eLimit, pass: withinKern },
      bearing: { qmax_kPa: qmax, qmin_kPa: qmin, allow_kPa: qa, pass: qmax <= qa },
    };
    return {
      inputsEcho: { ...input, gammaConcrete: gc, surcharge: q },
      intermediate: { Ka, PaSoil_kN: PaSoil, PaSurcharge_kN: PaSur, sumV_kN: V, Mr_kNm: Mr, Mo_kNm: Mo, parts },
      checks,
      verdict: Object.values(checks).every((c) => c.pass) ? 'PASS' : 'FAIL',
      notes: ['수동토압 저항 무시(보수측)', '내적 안정(부재 단면·활동면)은 별도 검토 대상'],
    };
  },
};
