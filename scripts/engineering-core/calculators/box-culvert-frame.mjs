/**
 * P2 토목 — 박스 암거(단일 셀) 강성라멘 단면력 (보완 #7b).
 *
 * 방법: 처짐각법(slope-deflection) 정해 — 대칭 구조+대칭 하중 → 좌측 상·하 절점
 * 회전 2자유도(우측은 반대칭 미러), 스웨이 0. 폐형 2×2 선형해. 결정론 역학
 * (근사계수·도표 아님). 등두께 단면(I=t³/12, 단위폭 1m).
 *
 * 하중(단위 m당): 상판 연직 wv = γ·토피 + 상재 + 상판자중 / 저판 상향반력
 * w_b = wv + 2×벽자중/L (저판 자중은 지반반력과 직접 상쇄 — 저판 휨 미기여 가정 명시)
 * / 측벽 사다리꼴 토압 p(z) = K·γ·(토피+z) + K·상재 (중심선 기준 근사).
 *
 * 검증 앵커(수학적 정해 대조): 정사각·등I·4면 등압 → 모든 우각부 |M| = wL²/12,
 * 절점회전 0 (교과서 폐합 프레임 정해). self-test로 상시 보증.
 * 한계: 등두께·단일셀·정지토압 K 입력·활하중 등분포 근사. 윤하중 분포·다셀은 후속.
 */
import { solveFrame2D } from '../frame2d.mjs';

/** Winkler 스프링 모드: 전체 박스 골조 + 하판 지반스프링 매트릭스 해석 */
function solveWithSprings(input, g) {
  const { L, h, t, tt, tb, wv, gc, pTop, pBot } = g;
  const fck = 24;
  const E = (input.EcMPa ?? 8500 * Math.cbrt(fck + 4)) * 1000; // kPa
  const ks = input.subgradeKs;
  const NS = 10; // 부재당 분할
  const nodes = [];
  const elements = [];
  // 절점: 하판 0..NS (y=0) · 좌벽 상행 · 상판 · 우벽 — 공유 절점으로 폐합
  for (let i = 0; i <= NS; i++) nodes.push([i * L / NS, 0]);            // 하판 0..NS
  for (let i = 1; i <= NS; i++) nodes.push([0, i * h / NS]);            // 좌벽 NS+1..2NS (상단=2NS)
  for (let i = 1; i <= NS; i++) nodes.push([i * L / NS, h]);            // 상판 2NS+1..3NS (우상단=3NS)
  for (let i = 1; i < NS; i++) nodes.push([L, h - i * h / NS]);         // 우벽 3NS+1..4NS-1
  const A_ = (thk) => thk, I_ = (thk) => thk ** 3 / 12;
  // 하판 (좌→우, 국부+y=상): 자중 하향 −tb·gc
  for (let i = 0; i < NS; i++) elements.push({ i, j: i + 1, E, A: A_(tb), I: I_(tb), w1: -(tb * gc), w2: -(tb * gc) });
  // 좌벽 (하→상, 국부+y=−x방향): 토압은 +x(내향) → w=−p(z). z=벽하단 0→상단 h: p 선형 pBot→pTop
  for (let i = 0; i < NS; i++) {
    const ni = i === 0 ? 0 : NS + i;             // 좌벽 시작: 하판 좌단(0) → NS+1..
    const nj = NS + i + 1;
    const z0 = i * h / NS, z1 = (i + 1) * h / NS;
    const pz = (z) => pBot + (pTop - pBot) * (z / h);
    elements.push({ i: ni, j: nj, E, A: A_(t), I: I_(t), w1: -pz(z0), w2: -pz(z1) });
  }
  // 상판 (좌→우, 국부+y=상): wv 하향 → w=−wv. 좌상단=2NS, 우상단=3NS
  for (let i = 0; i < NS; i++) {
    const ni = i === 0 ? 2 * NS : 2 * NS + i;
    const nj = 2 * NS + i + 1;
    elements.push({ i: ni, j: nj, E, A: A_(tt), I: I_(tt), w1: -wv, w2: -wv });
  }
  // 우벽 (상→하 연결: 3NS → 3NS+1.. → 하판 우단 NS). 국부: 진행방향 −y(하행), cx=0, cy=−1 → 국부+y=+x.
  // 토압은 −x(내향) → w=−p(z)
  for (let i = 0; i < NS; i++) {
    const ni = i === 0 ? 3 * NS : 3 * NS + i;
    const nj = i === NS - 1 ? NS : 3 * NS + i + 1;
    const z0 = h - i * h / NS, z1 = h - (i + 1) * h / NS;
    const pz = (z) => pBot + (pTop - pBot) * (z / h);
    elements.push({ i: ni, j: nj, E, A: A_(t), I: I_(t), w1: -pz(z0), w2: -pz(z1) });
  }
  // 스프링: 하판 절점 ky = ks × 분담폭 × 1m (국토부 방식 동일). 수평은 중앙 1점 고정.
  const springs = [];
  for (let i = 0; i <= NS; i++) {
    const trib = (i === 0 || i === NS) ? L / NS / 2 : L / NS;
    springs.push({ node: i, ky: ks * trib });
  }
  // 벽 자중: 절점 연직하중으로 분배 (frame2d는 횡분포만 지원 — 축방향 자중은 절점 등가)
  const loads = [];
  const wallNodeW = t * gc * (h / NS); // kN per 분담높이
  for (let i = 0; i <= NS; i++) {
    const half = (i === 0 || i === NS) ? 0.5 : 1;
    const nL = i === 0 ? 0 : NS + i;                       // 좌벽 절점열 (하단=하판0)
    const nR = i === 0 ? NS : i === NS ? 3 * NS : 4 * NS - i; // 우벽 절점열 (하단=하판NS, 상단=3NS)
    loads.push({ node: nL, fy: -wallNodeW * half });
    loads.push({ node: nR, fy: -wallNodeW * half });
  }
  const fixes = [{ node: Math.floor(NS / 2), ux: true }];
  const sol = solveFrame2D({ nodes, elements, springs, fixes, loads });
  // 단부·중앙 모멘트 추출 (요소 인덱스: 하판 0..NS-1 · 좌벽 NS..2NS-1 · 상판 2NS..3NS-1 · 우벽 3NS..4NS-1)
  const ee = sol.elementEnd;
  const M_bot_corner = ee[0].Mi;                       // 하판 좌단
  const M_bot_mid = ee[NS / 2 - 1].Mj;                 // 하판 중앙
  const M_wall_bot = ee[NS].Mi;                        // 좌벽 하단
  const M_wall_top = ee[2 * NS - 1].Mj;                // 좌벽 상단
  const M_top_corner = ee[2 * NS].Mi;                  // 상판 좌단
  const M_top_mid = ee[2 * NS + NS / 2 - 1].Mj;        // 상판 중앙
  const M_wall_mid = ee[NS + NS / 2 - 1].Mj;           // 좌벽 중앙
  const V_top_end = Math.abs(ee[2 * NS].Vi);
  const V_bot_end = Math.abs(ee[0].Vi);
  const V_wall_b = Math.abs(ee[NS].Vi), V_wall_t = Math.abs(ee[2 * NS - 1].Vj);
  const r2 = (v) => +v.toFixed(2);
  return {
    inputsEcho: input,
    loads: { wv_kNm: r2(wv), pTop_kPa: r2(pTop), pBot_kPa: r2(pBot), model: `Winkler ks=${ks} kN/m³ (절점 ky=ks×분담폭 — 국토부 2008 방식)` },
    geometry: { spanL_m: r2(L), wallH_m: r2(h) },
    moments_kNm: {
      cornerTop: r2(-Math.abs(M_top_corner)), cornerBottom: r2(Math.abs(M_bot_corner)),
      wallAtTop: r2(Math.abs(M_wall_top)), wallAtBottom: r2(-Math.abs(M_wall_bot)),
      midTop: r2(Math.abs(M_top_mid)), midBottom: r2(Math.abs(M_bot_mid)), midWall: r2(Math.abs(M_wall_mid)),
    },
    shears_kN: { top: r2(V_top_end), bottom: r2(V_bot_end), wallTop: r2(V_wall_t), wallBottom: r2(V_wall_b) },
    verdict: 'INFO',
    notes: [
      `Winkler 매트릭스 해석(frame2d, 부재당 ${NS}분할·부재별 I) — 하판 지반스프링·저판자중 포함.`,
      '우각부=외측 인장, 중앙=내측 인장. 중앙 정모멘트는 단일재하 기준(포락선은 envelope 모드).',
      '부재 검토: 각 위치 Mu·Vu를 rc_beam에 입력.',
    ],
  };
}

export default {
  id: 'box_culvert_frame',
  domain: 'civil',
  title: '박스 암거 강성라멘 단면력 (단일 셀)',
  description: '처짐각법 정해로 우각부·중앙 모멘트와 전단력 산출. 이후 rc_beam으로 부재 검토 연계.',
  refs: [
    '처짐각법(slope-deflection) 고전 정해 — 대칭 폐합 라멘. 검증 앵커: 정사각 등압 시 M=wL²/12',
    'KDS 11 80 05(토압 일반)·KDS 14 20 (부재 검토는 rc_beam 연계)',
  ],
  status: 'verified — 수학 앵커 + 국토부 2008 재현: Winkler(frame2d)+포락선 상판 ≤1.6%·하부 보수측 ≤11%(헌치 미모델 명시)',
  inputSchema: {
    type: 'object',
    required: ['innerWidth', 'innerHeight', 'wallThk', 'cover', 'gammaSoil', 'K'],
    properties: {
      innerWidth: { type: 'number', exclusiveMinimum: 0, maximum: 8, description: '내폭 m' },
      innerHeight: { type: 'number', exclusiveMinimum: 0, maximum: 8, description: '내고 m' },
      wallThk: { type: 'number', exclusiveMinimum: 0, maximum: 1.5, description: '부재 두께 m (등두께)' },
      cover: { type: 'number', minimum: 0, maximum: 20, description: '토피고 m' },
      gammaSoil: { type: 'number', minimum: 10, maximum: 24, description: '흙 단위중량 kN/m³' },
      K: { type: 'number', minimum: 0.2, maximum: 1.0, description: '측방토압계수 (정지토압 K0=1−sinφ 등 — 프로젝트 결정, 입력)' },
      surcharge: { type: 'number', minimum: 0, description: '등분포 상재하중 kPa (기본 0 — 윤하중 등가는 별도 산정 후 입력)' },
      gammaConcrete: { type: 'number', minimum: 20, maximum: 26, description: '콘크리트 단위중량 (기본 24)' },
      pTopOverride: { type: 'number', minimum: 0, maximum: 500, description: '벽 상단 측압 직접입력 kPa (별도 토압·수압 산정 결과 — 입력 시 K·γ 유도 대체, pBotOverride와 쌍)' },
      pBotOverride: { type: 'number', minimum: 0, maximum: 800, description: '벽 하단 측압 직접입력 kPa (pTopOverride와 쌍 필수)' },
      topThk: { type: 'number', exclusiveMinimum: 0, maximum: 1.5, description: '상판 두께 m (미입력 시 wallThk — 부재별 강성 반영)' },
      botThk: { type: 'number', exclusiveMinimum: 0, maximum: 1.5, description: '저판 두께 m (미입력 시 wallThk)' },
      surchargeV: { type: 'number', minimum: 0, description: '연직 활하중 등가 등분포 kPa (상판 전용 — surcharge와 분리 입력 시 측압에 미반영)' },
      subgradeKs: { type: 'number', minimum: 1000, maximum: 500000, description: '연직 지반반력계수 Kv kN/m³ (입력 시 하판 Winkler 스프링 매트릭스 해석 — 도로교 계열 Kv=Kv0(Bv/0.3)^(-3/4), 국토부 2008 예: 17778.5)' },
      envelope: { type: 'boolean', description: '활하중 포락선 (국토부 2008 표 12-2 사용하중 3조합: ①전재하 ②연직활하중 제외 ③측압 0.5배) — 위치별 최대' },
      EcMPa: { type: 'number', minimum: 15000, maximum: 45000, description: '콘크리트 탄성계수 MPa (스프링 모드 필수 상대강성 — 기본 8500∛(fck+4), fck=24 기준 25811)' },
    },
  },
  run(input) {
    // ── 활하중 포락선 (국토부 2008 표 12-2 사용하중 조합 1~3 — 원문 판독) ──
    if (input.envelope === true) {
      const base = { ...input, envelope: false };
      const halfLat = input.pTopOverride !== undefined
        ? { pTopOverride: input.pTopOverride * 0.5, pBotOverride: input.pBotOverride * 0.5 }
        : { K: input.K * 0.5 };
      const cases = [
        { label: '①전재하', inp: base },
        { label: '②연직활하중 제외', inp: { ...base, surchargeV: 0 } },
        { label: '③측압 0.5', inp: { ...base, ...halfLat } },
      ];
      const results = cases.map((c) => ({ label: c.label, r: this.run(c.inp) }));
      const keys = ['cornerTop', 'cornerBottom', 'wallAtTop', 'wallAtBottom', 'midTop', 'midBottom', 'midWall'];
      const moments = {}, governing = {};
      for (const k of keys) {
        let best = null;
        for (const { label, r } of results) {
          const v = r.moments_kNm[k];
          if (best === null || Math.abs(v) > Math.abs(best.v)) best = { v, label };
        }
        moments[k] = best.v; governing[k] = best.label;
      }
      const shears = {};
      for (const k of Object.keys(results[0].r.shears_kN)) {
        shears[k] = Math.max(...results.map(({ r }) => Math.abs(r.shears_kN[k])));
      }
      return {
        inputsEcho: input,
        loads: results[0].r.loads,
        geometry: results[0].r.geometry,
        moments_kNm: moments,
        governingCase: governing,
        shears_kN: shears,
        verdict: 'INFO',
        notes: [
          '활하중 포락선: 사용하중 3조합(국토부 2008 표 12-2 — ①전재하 ②연직활하중 제외 ③측압·수평 0.5) 위치별 최대.',
          ...results[0].r.notes.filter((n) => !n.includes('포락선')),
        ],
      };
    }
    const { innerWidth: Bi, innerHeight: Hi, wallThk: t, cover: hc, gammaSoil: g, K } = input;
    const q = input.surcharge ?? 0;
    const gc = input.gammaConcrete ?? 24;
    // 중심선 치수 (부재별 두께: 상판 tt·저판 tb·벽 t)
    const tt = input.topThk ?? t, tb = input.botThk ?? t;
    const L = Bi + t;                 // 상·하판 스팬
    const h = Hi + (tt + tb) / 2;     // 벽 높이 (상·하판 중심선 간)
    const ITop = tt ** 3 / 12, IBot = tb ** 3 / 12, Iw = t ** 3 / 12; // 단위폭
    const kTt = ITop / L, kTb = IBot / L, kW = Iw / h; // 강성비 (E 공통 소거)

    // ── 하중 ──────────────────────────────────────────────────────────────
    const qv = input.surchargeV ?? 0;               // 연직 전용 상재(활하중 등가)
    const wv = g * hc + q + qv + tt * gc;           // 상판 연직 ↓
    const wallSelf = h * t * gc;                    // 벽 1면 자중
    const wb = wv + (2 * wallSelf) / L;             // 저판 상향 순반력 ↑ (저판 자중 상쇄 가정)
    const zTop = hc + t / 2;                        // 벽 상단 중심선 깊이
    const hasOverride = input.pTopOverride !== undefined || input.pBotOverride !== undefined;
    if (hasOverride && (input.pTopOverride === undefined || input.pBotOverride === undefined)) {
      throw new Error('input gate: 측압 직접입력은 pTopOverride·pBotOverride 쌍 필수');
    }
    if (hasOverride && input.pBotOverride < input.pTopOverride) {
      throw new Error('input gate: pBotOverride ≥ pTopOverride (하단 측압이 상단보다 작을 수 없음 — 특수 분포는 미지원 명시)');
    }
    const pTop = hasOverride ? input.pTopOverride : K * (g * zTop + q);   // 벽 상단 측압
    const pBot = hasOverride ? input.pBotOverride : K * (g * (zTop + h) + q); // 벽 하단 측압
    const pU = pTop;                                // 균등 성분
    const pT = pBot - pTop;                         // 삼각 성분(하단 최대)

    // ── Winkler 스프링 모드 (정확도 라운드 2-② — frame2d 매트릭스 해석) ────
    // 하판을 지반스프링(ks×분담폭) 위에 올린 전체 골조 해석 — 국토부 2008 방식과
    // 동일 계열(절점 Kv×trib, 수평 1점 고정). 검증: 국토부 P1-16 하부 재현.
    if (input.subgradeKs > 0) {
      return solveWithSprings(input, { L, h, t, tt, tb, wv, gc, pTop, pBot });
    }

    // ── FEM (시계방향 +, 처짐각법 관례) ───────────────────────────────────
    // 상판(좌→우), 하중 ↓: FEM_L = −wL²/12, FEM_R = +wL²/12
    const FEM_top_A = -(wv * L * L) / 12;
    // 저판(좌→우), 하중 ↑(반력): 부호 반전
    const FEM_bot_D = +(wb * L * L) / 12;
    // 좌측 벽(상 A → 하 D), 외측→내측 압력: 폐합 프레임 순회 방향 기준 국부 −y 하중
    //   (앵커 검증: 4면 등압 시 절점회전 0·|M|=wL²/12 — 부호는 이 조건으로 확정)
    //   등분포 p: FEM_AD = +p h²/12, FEM_DA = −p h²/12
    //   삼각(하단 최대): FEM_AD = +pT h²/30, FEM_DA = −pT h²/20
    const FEM_w_AD = +(pU * h * h) / 12 + (pT * h * h) / 30;
    const FEM_w_DA = -(pU * h * h) / 12 - (pT * h * h) / 20;

    // ── 처짐각법: 좌측 절점 A(상)·D(하), 우측은 반대칭(θ' = −θ) ────────────
    // 상판: M_A(top) = FEM_top_A + 2kT(2θA + θA') = FEM_top_A + 2kT·θA
    // 저판: M_D(bot) = FEM_bot_D + 2kT·θD
    // 벽:   M_AD = FEM_w_AD + 2kW(2θA + θD),  M_DA = FEM_w_DA + 2kW(2θD + θA)
    // 절점 평형: M_A(top)+M_AD = 0 · M_D(bot)+M_DA = 0
    // → [2kTt+4kW, 2kW; 2kW, 2kTb+4kW]·[θA;θD] = −[FEM_top_A+FEM_w_AD; FEM_bot_D+FEM_w_DA]
    const a11 = 2 * kTt + 4 * kW, a12 = 2 * kW;
    const a21 = 2 * kW, a22 = 2 * kTb + 4 * kW;
    const b1 = -(FEM_top_A + FEM_w_AD);
    const b2 = -(FEM_bot_D + FEM_w_DA);
    const det = a11 * a22 - a12 * a21;
    const thA = (b1 * a22 - b2 * a12) / det; // E·θ (E 소거된 상대값)
    const thD = (a11 * b2 - a21 * b1) / det;

    const M_top_A = FEM_top_A + 2 * kTt * thA;   // 상판 좌단(=우각부 상부) 모멘트
    const M_bot_D = FEM_bot_D + 2 * kTb * thD;   // 저판 좌단
    const M_AD = FEM_w_AD + 2 * kW * (2 * thA + thD);
    const M_DA = FEM_w_DA + 2 * kW * (2 * thD + thA);
    // 평형 잔차 (해 검증 — 0이어야)
    const resA = M_top_A + M_AD, resD = M_bot_D + M_DA;

    // ── 부재 중앙 모멘트·전단 (정역학) ─────────────────────────────────────
    const Mc_top = Math.abs(M_top_A);
    const Mc_bot = Math.abs(M_bot_D);
    const Mmid_top = (wv * L * L) / 8 - Mc_top;   // 정모멘트(내측 인장)
    const Mmid_bot = (wb * L * L) / 8 - Mc_bot;
    // 벽 중앙(내측 인장): 등분포+삼각 단순보 최대 근사(중앙값) − 단부평균
    const MmidWallSimple = (pU * h * h) / 8 + (pT * h * h) / (9 * Math.sqrt(3)); // 삼각 최대 wL²/9√3
    const Mmid_wall = MmidWallSimple - (Math.abs(M_AD) + Math.abs(M_DA)) / 2;
    const V_top = (wv * L) / 2;
    const V_bot = (wb * L) / 2;
    const V_wall_top = (pU * h) / 2 + (pT * h) / 6;
    const V_wall_bot = (pU * h) / 2 + (pT * h) / 3;

    const r2 = (v) => +v.toFixed(2);
    return {
      inputsEcho: input,
      loads: { wv_kNm: r2(wv), wb_kNm: r2(wb), pTop_kPa: r2(pTop), pBot_kPa: r2(pBot) },
      geometry: { spanL_m: r2(L), wallH_m: r2(h) },
      moments_kNm: {
        cornerTop: r2(M_top_A), cornerBottom: r2(M_bot_D),
        wallAtTop: r2(M_AD), wallAtBottom: r2(M_DA),
        midTop: r2(Mmid_top), midBottom: r2(Mmid_bot), midWall: r2(Mmid_wall),
      },
      shears_kN: { top: r2(V_top), bottom: r2(V_bot), wallTop: r2(V_wall_top), wallBottom: r2(V_wall_bot) },
      equilibriumResidual: { jointA: +resA.toFixed(6), jointD: +resD.toFixed(6) },
      verdict: 'INFO', // 단면력 산출 계산기 — 부재 판정은 rc_beam 연계(As 입력) 후속
      notes: [
        '처짐각법 정해(등두께·단일셀·스웨이0). 저판 자중은 지반반력 상쇄 가정.',
        '우각부 모멘트=외측 인장, 중앙=내측 인장(통상 배근 방향).',
        'K·상재하중은 입력(윤하중 등가분포는 별도 산정 후 surcharge로).',
        ...(input.pTopOverride !== undefined ? [`측압 직접입력 모드: pTop ${input.pTopOverride}·pBot ${input.pBotOverride} kPa (K·γ 유도 대체 — 산정 근거는 입력자 책임 명시)`] : []),
        '부재 검토: 각 위치 Mu·Vu를 rc_beam에 입력(1.2D+1.6L 계수는 하중 입력 단계에서).',
        '중앙 정모멘트는 단일재하 시 과소 가능 — envelope:true(사용하중 3조합 포락선) 권장. Winkler+포락선으로 국토부 2008 상판 ≤1.6% 재현.',
      ],
    };
  },
};
