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
  status: '검증 — 방향성 앵커(안정/불안정 케이스) 통과 · 안전율·방법 KDS 조항 대조. 비법정 참고(공표예제 확충중)',
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
      phiBackfill: { type: 'number', minimum: 10, maximum: 45, description: '뒤채움 내부마찰각 ° (개발강도 φd 입력 허용 — EM-2502 SMF 관례)' },
      surcharge: { type: 'number', minimum: 0, description: '상재하중 kPa (기본 0)' },
      baseFriction: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '저면 마찰계수 μ=tanδ' },
      allowableBearing: { type: 'number', exclusiveMinimum: 0, description: '허용지지력 q_allow kPa' },
      seismicKh: { type: 'number', minimum: 0, maximum: 0.5, description: '수평지진계수 kh (옵션 — >0이면 Mononobe-Okabe 지진시 검토 추가. 내진등급·지반에서 프로젝트가 결정)' },
      seismicKv: { type: 'number', minimum: -0.5, maximum: 0.5, description: '연직지진계수 kv (기본 0. 음수=상향 관례 소스도 있음 — 부호 그대로 (1−kv)에 반영)' },
      backfillSlopeDeg: { type: 'number', minimum: 0, maximum: 30, description: '뒤채움 경사 β° (기본 0 수평 — M-O 일반식용)' },
      wallFrictionDeg: { type: 'number', minimum: 0, maximum: 30, description: '벽마찰각 δ° (기본 0 보수측 — 지진시 수평성분 PAE·cosδ 적용, 연직 유리효과 무시)' },
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
    // 지압 분포: ① 커널 내(e ≤ B/6) 사다리꼴, ② B/6 < e < B/2 삼각분포 폴백,
    // ③ e ≥ B/2 합력이 저판 밖 → 지압 분포 성립 불가(전도 파괴) → qmax 미정·FAIL.
    // (③를 삼각식에 그대로 넣으면 분모 (B/2−|e|)<0 → 음수 qmax가 허위 PASS 됨 — 방지.)
    const triBase = B / 2 - Math.abs(e);
    let qmax, qmin, bearingPass, bearingNote;
    if (withinKern) {
      qmax = (V / B) * (1 + (6 * e) / B);
      qmin = (V / B) * (1 - (6 * e) / B);
      bearingPass = qmax <= qa;
    } else if (triBase > 0) {
      qmax = (2 * V) / (3 * triBase); // 삼각분포 폴백
      qmin = 0;
      bearingPass = qmax <= qa;
    } else {
      qmax = null; // 합력이 저판 외부 — 지압 성립 불가
      qmin = 0;
      bearingPass = false;
      bearingNote = '합력이 저판 외부(e ≥ B/2) — 지압 분포 성립 불가(전도 파괴). 지압 FAIL.';
    }
    const r2 = (x) => (x == null ? null : +x.toFixed(2));

    const checks = {
      overturning: { FS: +FSot.toFixed(3), min: crit.FS_overturning_min, pass: FSot >= crit.FS_overturning_min },
      sliding: { FS: +FSsl.toFixed(3), min: crit.FS_sliding_min, pass: FSsl >= crit.FS_sliding_min },
      eccentricity: { e_m: +e.toFixed(4), limit_m: +eLimit.toFixed(4), pass: withinKern },
      bearing: { qmax_kPa: r2(qmax), qmin_kPa: r2(qmin), allow_kPa: qa, pass: bearingPass, ...(bearingNote ? { note: bearingNote } : {}) },
    };

    // ── 지진시 검토 (옵션 kh>0, Mononobe-Okabe) — KDS 11 80 05 표 4.4-1 지진시 기준
    //    M-O 가정: 연직벽·수평뒤채움·벽마찰 δ=0(보수측)·kv=0. θ=atan(kh).
    //    작용점: 정적성분 H/3 + 동적증분 0.6H(Seed-Whitman 관례, 명시). 벽체관성 kh·W(CG).
    const kh = input.seismicKh ?? 0;
    const kv = input.seismicKv ?? 0;
    const betaR = deg2rad(input.backfillSlopeDeg ?? 0);
    const delR = deg2rad(input.wallFrictionDeg ?? 0);
    let seismic = null;
    if (kh > 0) {
      const th = Math.atan(kh / (1 - kv)); // 지진 경사각 ψ
      const phiR = deg2rad(phi);
      if (phiR <= th + betaR) {
        seismic = { error: `M-O 성립 불가: φ(${phi}°) ≤ ψ+β(${((th + betaR) * 180 / Math.PI).toFixed(1)}°) — 액상화/대변형 영역, 별도 검토` };
      } else {
        // 일반 M-O (연직벽 θw=0): 공표예제 재현 검증 — ITL-92-11 Ex.9 (KAE 0.4044) 벤치 통과
        const num_ = Math.cos(phiR - th) ** 2;
        // 표준 M-O(연직벽): den = cosψ·cos(δ+ψ)·[1+√(sin(φ+δ)sin(φ−ψ−β)/(cos(δ+ψ)cosβ))]²
        const den = Math.cos(th) * Math.cos(delR + th)
          * (1 + Math.sqrt((Math.sin(phiR + delR) * Math.sin(phiR - th - betaR)) / (Math.cos(delR + th) * Math.cos(betaR)))) ** 2;
        const Kae = num_ / den;
        const Pae = (0.5 * Kae * g * H * H + Kae * q * H) * (1 - kv); // 총 지진시 주동토압(상재 포함)
        const PaeH = Pae * Math.cos(delR); // 수평성분 (δ>0 시 연직 유리효과 무시 — 보수측)
        const dPae = Math.max(0, PaeH - (PaSoil + PaSur)); // 동적 증분(수평)
        const Wwall = ts * hStem * gc + B * tb * gc; // 콘크리트 자중(관성용)
        const Fw = kh * Wwall; // 벽체 관성력, 작용고 = 콘크리트 CG
        const zW = (ts * hStem * gc * (tb + hStem / 2) + B * tb * gc * (tb / 2)) / Wwall;
        const MoE = (PaSoil * H / 3 + PaSur * H / 2) + dPae * 0.6 * H + Fw * zW;
        const HE = PaeH + Fw;
        const critE = std.civil?.retaining_wall?.seismic ?? std.civil?.retaining_wall_seismic ?? { FS_overturning_min: 1.5, FS_sliding_min: 1.2, FS_bearing_min: 2.0 };
        const FSotE = Mr / MoE;
        const FSslE = (mu * V) / HE;
        seismic = {
          kh, theta_deg: +(th * 180 / Math.PI).toFixed(2), Kae: +Kae.toFixed(4),
          Pae_kN: +Pae.toFixed(2), dPae_kN: +dPae.toFixed(2), wallInertia_kN: +Fw.toFixed(2),
          checks: {
            overturning: { FS: FSotE, min: critE.FS_overturning_min, pass: FSotE >= critE.FS_overturning_min },
            sliding: { FS: FSslE, min: critE.FS_sliding_min, pass: FSslE >= critE.FS_sliding_min },
          },
          verdict: FSotE >= critE.FS_overturning_min && FSslE >= critE.FS_sliding_min ? 'PASS' : 'FAIL',
          method: 'M-O(δ=0·kv=0·연직벽·수평뒤채움) · 동적증분 0.6H(Seed-Whitman) · 지진시 기준 FS=표 4.4-1(활동 1.2·전도 1.5)',
        };
      }
    }

    const verdict = Object.values(checks).every((c) => c.pass) && (!seismic || seismic.error === undefined ? (seismic ? seismic.verdict === 'PASS' : true) : false) ? 'PASS' : 'FAIL';
    return {
      inputsEcho: { ...input, gammaConcrete: gc, surcharge: q },
      intermediate: { Ka, PaSoil_kN: PaSoil, PaSurcharge_kN: PaSur, sumV_kN: V, Mr_kNm: Mr, Mo_kNm: Mo, parts },
      checks,
      seismic,
      verdict,
      notes: [
        '수동토압 저항 무시(보수측)', '내적 안정(부재 단면·활동면)은 별도 검토 대상',
        ...(seismic ? ['지진시: M-O 표준식 — kh는 프로젝트 내진등급/지반에서 결정해 입력(지어내지 않음)'] : []),
      ],
    };
  },
};
