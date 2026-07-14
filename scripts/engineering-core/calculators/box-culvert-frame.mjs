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
export default {
  id: 'box_culvert_frame',
  domain: 'civil',
  title: '박스 암거 강성라멘 단면력 (단일 셀)',
  description: '처짐각법 정해로 우각부·중앙 모멘트와 전단력 산출. 이후 rc_beam으로 부재 검토 연계.',
  refs: [
    '처짐각법(slope-deflection) 고전 정해 — 대칭 폐합 라멘. 검증 앵커: 정사각 등압 시 M=wL²/12',
    'KDS 11 80 05(토압 일반)·KDS 14 20 (부재 검토는 rc_beam 연계)',
  ],
  status: 'draft — 수학 앵커(등압 wL²/12) 상시검증. 공표예제(도로암거 표준도) 재현 대기(§7.0)',
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
    },
  },
  run(input) {
    const { innerWidth: Bi, innerHeight: Hi, wallThk: t, cover: hc, gammaSoil: g, K } = input;
    const q = input.surcharge ?? 0;
    const gc = input.gammaConcrete ?? 24;
    // 중심선 치수
    const L = Bi + t;   // 상·하판 스팬
    const h = Hi + t;   // 벽 높이
    const It = t ** 3 / 12, Iw = t ** 3 / 12; // 단위폭
    const kT = It / L, kW = Iw / h; // 강성비 (E 공통 소거)

    // ── 하중 ──────────────────────────────────────────────────────────────
    const wv = g * hc + q + t * gc;                 // 상판 연직 ↓
    const wallSelf = h * t * gc;                    // 벽 1면 자중
    const wb = wv + (2 * wallSelf) / L;             // 저판 상향 순반력 ↑ (저판 자중 상쇄 가정)
    const zTop = hc + t / 2;                        // 벽 상단 중심선 깊이
    const pTop = K * (g * zTop + q);                // 벽 상단 측압
    const pBot = K * (g * (zTop + h) + q);          // 벽 하단 측압
    const pU = pTop;                                // 균등 성분
    const pT = pBot - pTop;                         // 삼각 성분(하단 최대)

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
    // → [2kT+4kW, 2kW; 2kW, 2kT+4kW]·[θA;θD] = −[FEM_top_A+FEM_w_AD; FEM_bot_D+FEM_w_DA]
    const a11 = 2 * kT + 4 * kW, a12 = 2 * kW;
    const a21 = 2 * kW, a22 = 2 * kT + 4 * kW;
    const b1 = -(FEM_top_A + FEM_w_AD);
    const b2 = -(FEM_bot_D + FEM_w_DA);
    const det = a11 * a22 - a12 * a21;
    const thA = (b1 * a22 - b2 * a12) / det; // E·θ (E 소거된 상대값)
    const thD = (a11 * b2 - a21 * b1) / det;

    const M_top_A = FEM_top_A + 2 * kT * thA;   // 상판 좌단(=우각부 상부) 모멘트
    const M_bot_D = FEM_bot_D + 2 * kT * thD;   // 저판 좌단
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
        '부재 검토: 각 위치 Mu·Vu를 rc_beam에 입력(1.2D+1.6L 계수는 하중 입력 단계에서).',
      ],
    };
  },
};
