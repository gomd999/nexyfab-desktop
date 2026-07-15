/**
 * P19 건축 — 2방향 슬래브 직접설계법 (KDS 14 20 70 §4.1.3 원문 판독).
 * 제한(§4.1.3.1 — 게이트): 3경간+·장단변비≤2·경간차≤1/3·기둥 어긋남≤10%·등분포·L≤2D.
 * Mo = wu·l2·ln²/8 (식4.1-2 — ln≥0.65l1 원문).
 * 분배: 내부 경간 −0.65/+0.35 · 단부 경간 표 4.1-1(5열 전문 전사).
 * 주열대: 내부 −M 표 4.1-2 · 외부 −M 표 4.1-3(βt) · +M 표 4.1-4 — α·l2/l1 직선보간(원문).
 * 보 있는 경우 α≥1 → 보가 주열대 M의 85%(§4.1.3.5). 중간대=잔여(§4.1.3.6).
 * 배근은 rc_beam(단위폭 스트립)으로 연계 — 본 계산기는 모멘트 분배 산정.
 */
const T411 = { // 표 4.1-1 [내부−, +, 외부−]
  unrestrained: [0.75, 0.63, 0.0],
  beamsAll: [0.70, 0.57, 0.16],
  flatNoEdgeBeam: [0.70, 0.52, 0.26],
  flatEdgeBeam: [0.70, 0.50, 0.30],
  fullyRestrained: [0.65, 0.35, 0.65],
};
const interp = (x, x1, y1, x2, y2) => y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
function colStripPct(table, alphaL2L1, l2l1, bt) {
  // table: 'int' | 'ext' | 'pos' — 표 4.1-2/3/4 (l2/l1 0.5·1.0·2.0 열, α(l2/l1) 0·≥1 행 보간)
  const cols = [0.5, 1.0, 2.0];
  const clampL = Math.min(2.0, Math.max(0.5, l2l1));
  const pick = (row) => {
    if (clampL <= 1.0) return interp(clampL, 0.5, row[0], 1.0, row[1]);
    return interp(clampL, 1.0, row[1], 2.0, row[2]);
  };
  let r0, r1; // α=0 행, α≥1 행
  if (table === 'int') { r0 = [75, 75, 75]; r1 = [90, 75, 45]; }
  else if (table === 'pos') { r0 = [60, 60, 60]; r1 = [90, 75, 45]; }
  else { // 외부 −M: βt 0/≥2.5 보간 (표 4.1-3)
    const bt2 = Math.min(2.5, Math.max(0, bt ?? 0));
    const a0 = interp(bt2, 0, 100, 2.5, 75);   // α=0
    const a1v = interp(bt2, 0, 100, 2.5, pick([90, 75, 45])); // α≥1 βt≥2.5 행이 90/75/45
    const aClamp = Math.min(1, Math.max(0, alphaL2L1));
    return interp(aClamp, 0, a0, 1, table === 'ext' ? a1v : a0);
  }
  const v0 = pick(r0), v1 = pick(r1);
  const aClamp = Math.min(1, Math.max(0, alphaL2L1));
  return interp(aClamp, 0, v0, 1, v1);
  void cols;
}
export default {
  id: 'two_way_slab',
  domain: 'architecture/slab',
  title: '2방향 슬래브 직접설계법 (§4.1.3)',
  description: '제한 게이트 → Mo → 경간·주열대/중간대 모멘트 분배 — 배근은 rc_beam 연계.',
  refs: ['KDS 14 20 70:2021 §4.1.3 — Mo=wu·l2·ln²/8·ln≥0.65l1·내부 0.65/0.35·표 4.1-1~4 전사·보 85% — 원문 판독'],
  status: 'verified — 원문 계수·표 전사 + Mo 폐형. 불균형모멘트 전달(4.1.2.3)·뚫림전단 연계·모멘트 확대는 후속',
  inputSchema: {
    type: 'object',
    required: ['l1_m', 'l2_m', 'ln_m', 'wu_kNm2', 'spanType'],
    properties: {
      l1_m: { type: 'number', exclusiveMinimum: 0, maximum: 15, description: '해석방향 경간(중심간)' },
      l2_m: { type: 'number', exclusiveMinimum: 0, maximum: 15, description: '직각방향 경간(설계대 폭 — 양측 평균)' },
      ln_m: { type: 'number', exclusiveMinimum: 0, description: '순경간 (받침 내면간 — ≥0.65l1 하한 원문 적용)' },
      wu_kNm2: { type: 'number', exclusiveMinimum: 0, description: '계수 등분포하중 (1.2D+1.6L 등 산정 입력)' },
      spanType: { enum: ['interior', 'end'], description: '내부/단부 경간' },
      endCase: { enum: ['unrestrained', 'beamsAll', 'flatNoEdgeBeam', 'flatEdgeBeam', 'fullyRestrained'], description: '단부 구분 (표 4.1-1 5열 — 기본 flatNoEdgeBeam)' },
      alphaL2L1: { type: 'number', minimum: 0, maximum: 5, description: 'α·l2/l1 (보 상대강성 — 플랫플레이트 0. 보 있으면 산정 입력)' },
      betaT: { type: 'number', minimum: 0, maximum: 5, description: 'βt (테두리보 비틀림강성비 — 외부 −M 표 4.1-3. 기본 0)' },
      nSpans: { type: 'integer', minimum: 1, description: '연속 경간 수 (제한 ①: ≥3)' },
      liveOverDead: { type: 'number', minimum: 0, description: 'L/D 비 (제한 ⑥: ≤2)' },
    },
  },
  run(input) {
    const { l1_m: l1, l2_m: l2, wu_kNm2: wu } = input;
    const gates = [];
    if (Number(input.nSpans) > 0) gates.push({ gate: '3경간 이상(§4.1.3.1(2))', value: input.nSpans, pass: input.nSpans >= 3 });
    const aspect = Math.max(l1, l2) / Math.min(l1, l2);
    gates.push({ gate: '장단변비 ≤2(§(3))', value: +aspect.toFixed(2), pass: aspect <= 2 });
    if (Number(input.liveOverDead) >= 0) gates.push({ gate: 'L/D ≤2(§(6))', value: input.liveOverDead, pass: input.liveOverDead <= 2 });
    if (gates.some((g) => !g.pass)) {
      return { verdict: 'FAIL', checks: { gates }, notes: ['직접설계법 제한 위반 — 등가골조법/해석 필요(§4.1.3.1(9) 예외는 해석 입증 시).'] };
    }
    const ln = Math.max(input.ln_m, 0.65 * l1); // 원문 하한
    const Mo = (wu * l2 * ln * ln) / 8;
    const dist = input.spanType === 'interior' ? [0.65, 0.35, 0.65] : T411[input.endCase ?? 'flatNoEdgeBeam'];
    const [negIntF, posF, negExtF] = input.spanType === 'interior' ? [0.65, 0.35, 0.65] : dist;
    const Mneg_int = negIntF * Mo, Mpos = posF * Mo, Mneg_ext = negExtF * Mo;
    const a = input.alphaL2L1 ?? 0, l2l1 = l2 / l1, bt = input.betaT ?? 0;
    const csInt = colStripPct('int', a, l2l1) / 100;
    const csPos = colStripPct('pos', a, l2l1) / 100;
    const csExt = colStripPct('ext', a, l2l1, bt) / 100;
    const beamShare = a >= 1 ? 0.85 : a > 0 ? 0.85 * a : 0; // §4.1.3.5 (0<α<1 직선보간)
    const mk = (M, cs) => ({
      total_kNm: +M.toFixed(1),
      colStrip_kNm: +(M * cs * (1 - beamShare)).toFixed(1),
      ...(beamShare > 0 ? { beam_kNm: +(M * cs * beamShare).toFixed(1) } : {}),
      midStrip_kNm: +(M * (1 - cs)).toFixed(1),
      colStripPct: +(cs * 100).toFixed(0),
    });
    return {
      verdict: 'INFO',
      checks: {
        gates,
        Mo_kNm: +Mo.toFixed(1),
        negInterior: mk(Mneg_int, csInt),
        positive: mk(Mpos, csPos),
        ...(input.spanType === 'end' ? { negExterior: mk(Mneg_ext, csExt) } : {}),
      },
      intermediate: { ln_used_m: +ln.toFixed(2), lnFloorApplied: ln > input.ln_m, l2l1: +l2l1.toFixed(2), alphaL2L1: a, betaT: bt },
      notes: [
        `Mo=wu·l2·ln²/8=${Mo.toFixed(1)}kN·m (식4.1-2${ln > input.ln_m ? ' — ln 0.65l1 하한 적용(원문)' : ''}). 분배: ${input.spanType === 'interior' ? '내부 0.65/0.35' : `단부 표 4.1-1(${input.endCase ?? 'flatNoEdgeBeam'})`}.`,
        '주열대 % = 표 4.1-2/3/4 직선보간(원문). 중간대=잔여. 배근: 스트립 폭당 모멘트를 rc_beam(b=스트립폭)으로 검토.',
        '경간차 1/3·기둥 어긋남 10% 게이트는 기하 입력 시(전수 루프 연계 후속). 뚫림전단=isolated_footing 신형식 계열 별도. 모멘트 재분배 불가(§(8)).',
      ],
    };
  },
};
