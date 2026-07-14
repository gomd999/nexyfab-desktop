/**
 * P5 건축 — 주골조설계용 수평풍하중 정식법 (강체·밀폐형·사각평면) — KDS 41 12 00 §5.2/5.5/5.6.2/5.7.1.
 * VH=V0·Kd·Kzr·Kzt·Iw (식 5.5-2) → qH=½·1.225·VH² (식 5.5-1) → GD=1+4γD√BD (식 5.6-2)
 * → p(z)=qH·GD·(0.8kz+0.05) 풍상 + qH·GD·0.5 풍하 (표 5.7-1 — v1 보수측 일괄, 명시).
 * 층전단: 풍상 kz(z) 폐형 적분 + 풍하 균등. 강체 판정: 고유진동수>1Hz (미입력 시
 * KDS 41 17 00 근사주기 Ta=Ct·hn^x 재사용 — 명시).
 * 전 계수 원문 GIF 판독(kds.json windFull) — Kzr 표 5.5-2 상수항 재현 검증.
 */
export default {
  id: 'wind_static',
  domain: 'architecture/lateral',
  title: '수평풍하중 정식법 (강체 밀폐형)',
  description: 'KDS 41 12 00 §5.2 — 설계속도압·가스트·풍압분포·기단전단. 간편법(§5.15) 범위 밖 건물용.',
  refs: [
    'KDS 41 12 00:2022 식 5.5-1·5.5-2·5.6-2·5.6-1.c~e·표 5.5-2·3·5·표 5.7-1 (원문 GIF 판독)',
    'KDS 14 20 10 하중조합 U=1.2D+1.3W+1.0L (원문 판독)',
  ],
  status: 'verified — 수식 원문 판독·Kzr 표 재현. 유연구조물(f≤1Hz)·지붕풍·내압·비틀림 미구현(게이트)',
  inputSchema: {
    type: 'object',
    required: ['V0', 'H', 'B', 'D', 'exposure', 'demandNone'],
    properties: {
      V0: { type: 'number', minimum: 20, maximum: 50, description: '기본풍속 m/s (그림 5.5-1 — 필수 입력)' },
      H: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '기준높이 m (v1 상한 100 — 초고층 별도)' },
      B: { type: 'number', exclusiveMinimum: 0, maximum: 200, description: '건물폭(풍직각방향) m' },
      D: { type: 'number', exclusiveMinimum: 0, maximum: 200, description: '깊이(풍방향) m' },
      exposure: { type: 'string', enum: ['A', 'B', 'C', 'D'], description: '지표면조도 (표 5.5-1: A 대도시밀집~D 해안·평탄)' },
      importance: { type: 'string', enum: ['skyscraper', 'special', '1', '2', '3'], description: '중요도 (표 5.5-5, 기본 1)' },
      Kzt: { type: 'number', minimum: 1.0, maximum: 2.0, description: '지형계수 (기본 1.0 평탄지)' },
      Kd: { type: 'number', minimum: 0.85, maximum: 1.0, description: '풍향계수 (기본 1.0 — 관측자료 없을 때, §5.5.3(3)①)' },
      natFreqHz: { type: 'number', exclusiveMinimum: 0, maximum: 20, description: '풍방향 고유진동수 Hz (미입력 시 KDS 41 17 근사주기로 판정 — structType 필요)' },
      structType: { type: 'string', enum: ['rc_moment', 'steel_moment', 'steel_ebf_brb'], description: '근사주기용 구조형식 (natFreqHz 미입력 시)' },
      dampingRatio: { type: 'number', minimum: 0.005, maximum: 0.05, description: '풍방향 1차 감쇠비 ζD (유연건물 식 5.6-1 필수 — 프로젝트 결정값, 통상 RC 0.02·강구조 0.01 관례는 참고만)' },
      modeExp: { type: 'number', minimum: 0.5, maximum: 2.0, description: '1차 모드 연직분포 지수 β (기본 1.0 직선 — 원문 §5.6.1 모드 미상 시 기준 제시값, 질량 균등 가정 명시)' },
      storyH: { type: 'number', minimum: 2, maximum: 6, description: '층고 m (층전단 산출용, 기본 3.5)' },
      demandNone: { type: 'number', minimum: 0, maximum: 0, description: '자리표시 0 (하중 산출 계산기)' },
    },
  },
  run(input, std) {
    const wf = std.windFull;
    if (!wf) throw new Error('standard gate: windFull 미탑재');
    const { V0, H, B, D } = input;
    const ex = wf.exposure[input.exposure];
    const { zb, zg, alpha: a, c, plateau } = ex;

    // 강체 판정 (f > 1Hz) — 고유진동수 입력 또는 근사주기(KDS 41 17 00) 재사용
    let f1 = input.natFreqHz;
    let fSrc = '입력';
    if (!f1) {
      const ap = std.seismicBuilding?.approxPeriod;
      if (!input.structType || !ap) {
        throw new Error('input gate: natFreqHz 또는 structType(근사주기 판정용) 필요 — 강체 여부를 지어내지 않음');
      }
      const { Ct, x } = ap[input.structType];
      const Ta = Ct * Math.pow(H, x);
      f1 = 1 / Ta;
      fSrc = `근사주기 Ta=${Ta.toFixed(2)}s (KDS 41 17 00 식 — 명시적 근사)`;
    }
    const flexible = f1 <= 1;
    if (flexible && !(input.dampingRatio > 0)) {
      const e = new Error(`고유진동수 ${f1.toFixed(2)}Hz ≤ 1Hz — 유연건축구조물 식(5.6-1): dampingRatio(감쇠비 ζD) 필수 입력 (지어내지 않음)`);
      e.code = 'INPUT_GATE';
      throw e;
    }

    // 설계풍속·속도압 (식 5.5-2·5.5-1)
    const Kzr = (z) => Math.min(z, zg) <= zb ? plateau : c * Math.pow(Math.min(z, zg), a);
    const Iw = wf.importanceIw[input.importance ?? '1'];
    const Kzt = input.Kzt ?? 1.0;
    const Kd = input.Kd ?? 1.0;
    const VH = V0 * Kd * Kzr(H) * Kzt * Iw;
    const qH = 0.5 * wf.airDensity * VH * VH; // N/m²

    // 가스트영향계수 (식 5.6-2 강체 / 식 5.6-1 유연 — 전 구성 원문 GIF 판독)
    const IH = 0.1 * Math.pow(Math.max(H, zb) / zg, -a - 0.05);
    const gammaD = ((3 + 3 * a) / (2 + a)) * IH;
    const LH = H <= 30 ? 100 : 100 * Math.sqrt(H / 30);
    const kk = H >= B ? 0.33 : -0.33;
    const BD = 1 - Math.pow(1 / (1 + 5.1 * Math.pow(LH / Math.sqrt(H * B), 1.3) * Math.pow(B / H, kk)), 1 / 3);
    let GD, gustFlex = null;
    // VH는 아래에서 계산 — 유연식이 VH를 쓰므로 선계산
    const KzrH_ = Math.min(H, zg) <= zb ? plateau : c * Math.pow(Math.min(H, zg), a);
    const VH_ = V0 * (input.Kd ?? 1.0) * KzrH_ * (input.Kzt ?? 1.0) * wf.importanceIw[input.importance ?? '1'];
    if (!flexible) {
      GD = 1 + 4 * gammaD * Math.sqrt(BD); // 식 5.6-2
    } else {
      // 식 5.6-1: GD = 1 + gD·γD·√(BD + φD²·RD)
      const nD = f1, zeta = input.dampingRatio;
      const SD = 1 / ((1 + 4.0 * nD * B / VH_) * (1 + 2.3 * nD * H / VH_));          // 5.6-1.h (사이즈)
      const xF = nD * LH / VH_;
      const FD = (4.0 * xF) / Math.pow(1 + 71 * xF * xF, 5 / 6);                      // 5.6-1.l (스펙트럼)
      const RD = (Math.PI / (4 * zeta)) * SD * FD;                                    // 공진계수
      const beta = input.modeExp ?? 1.0;
      const lambda = 1.0 - 0.4 * Math.log(beta);                                      // 5.6-1.k
      const phiD = ((2 * beta + 1) / (2 + beta)) * lambda;                            // 질량 균등 가정: M/M* = 2β+1 (명시)
      const nuD = nD * Math.sqrt(RD / (BD + RD));                                     // 5.6-1.b
      const gDp = Math.sqrt(2 * Math.log(600 * nuD)) + 1.2;                           // 5.6-1.a
      GD = 1 + gDp * gammaD * Math.sqrt(BD + phiD * phiD * RD);
      gustFlex = { SD: +SD.toFixed(4), FD: +FD.toFixed(4), RD: +RD.toFixed(4), phiD: +phiD.toFixed(3), nuD_Hz: +nuD.toFixed(4), gD: +gDp.toFixed(3), zeta, beta };
    }

    // 외압계수 (표 5.7-1 — v1 보수측 일괄: 풍상 0.8kz+0.05, 풍하 −0.5)
    const kz = (z) => z < zb ? Math.pow(zb / H, 2 * a) : Math.pow(z / H, 2 * a);
    // 풍상벽 압력 적분 ∫0^H (0.8kz+0.05)dz = 0.8[zb(zb/H)^2a + (H^(2a+1)−zb^(2a+1))/((2a+1)H^2a)] + 0.05H
    const intKz = zb * Math.pow(zb / H, 2 * a) + (Math.pow(H, 2 * a + 1) - Math.pow(zb, 2 * a + 1)) / ((2 * a + 1) * Math.pow(H, 2 * a));
    const baseShear_N = qH * GD * B * (0.8 * intKz + 0.05 * H + 0.5 * H);
    const pTop_Nm2 = qH * GD * (0.8 * kz(H) + 0.05 + 0.5); // 최상부 설계풍압(풍상+풍하 합)

    // 층별 풍압·전단 (층고 storyH)
    const sh = input.storyH ?? 3.5;
    const nStories = Math.max(1, Math.round(H / sh));
    const stories = [];
    for (let i = 1; i <= nStories; i++) {
      const z = Math.min(H, i * sh);
      const pz = qH * GD * (0.8 * kz(z) + 0.05 + 0.5);
      const trib = i === nStories ? (H - (i - 0.5) * sh + sh / 2) : sh; // 상하 절반 분담
      stories.push({ level: i, z_m: +z.toFixed(1), p_Nm2: +pz.toFixed(0), F_kN: +((pz * B * Math.max(0, trib)) / 1000).toFixed(1) });
    }

    return {
      inputsEcho: input,
      verdict: 'INFO',
      designSpeed: { VH_ms: +VH.toFixed(2), KzrH: +Kzr(H).toFixed(3), Iw, Kzt, Kd, rigidCheck: flexible ? `f=${f1.toFixed(2)}Hz ≤ 1Hz — 유연 식(5.6-1) 적용 (${fSrc})` : `f=${f1.toFixed(2)}Hz > 1Hz (${fSrc})` },
      pressure: { qH_Nm2: +qH.toFixed(1), GD: +GD.toFixed(3), pTop_Nm2: +pTop_Nm2.toFixed(0) },
      gustDetail: { IH: +IH.toFixed(4), gammaD: +gammaD.toFixed(4), LH_m: +LH.toFixed(1), BD: +BD.toFixed(4), k: kk, ...(gustFlex ? { flexible: gustFlex } : {}) },
      baseShear_kN: +(baseShear_N / 1000).toFixed(1),
      stories,
      combo: wf.combos.wind,
      notes: [
        `VH=${V0}×${Kd}×${Kzr(H).toFixed(2)}×${Kzt}×${Iw}=${VH.toFixed(1)} m/s → qH=${qH.toFixed(0)} N/m² → GD=${GD.toFixed(2)}`,
        '외압계수 v1 보수측 일괄: 풍상 0.8kz+0.05·풍하 −0.5 (완화조건(−0.35 등) 원문 조건변수 미판독 — 채택 안 함 명시). 내압·지붕풍 미포함.',
        ...(gustFlex ? [`유연 가스트 식(5.6-1): RD ${gustFlex.RD}(ζ ${gustFlex.zeta})·φD ${gustFlex.phiD}(β ${gustFlex.beta}, 질량 균등 가정)·gD ${gustFlex.gD}. 풍직각방향(5.9)·비틀림(5.10) 풍하중은 별도 검토 필요 — 세장 고층은 필수.`] : []),
        `하중조합: ${wf.combos.wind} — 골조 검토 시 1.3W 적용.`,
      ],
    };
  },
};
