/**
 * P1 가설·랙 — 랙 프레임 원스톱 검토 (해석→검토 결합 워크플로우 1호).
 * frame2d(직접강성법)로 부재력·횡변위 산출 → 포스트 좌굴(column_buckling 로직)·빔 휨(simple_beam 로직)·
 * 횡변위 사용성까지 한 번에 판정. 2D 단일 베이(보수측) 모델.
 *
 * ⚠️ 정직 게이트(백로그 rack_load_table 판정 반영):
 *  - 커넥터 반강접·유공 포스트 유효단면은 시험 기반 — 본 계산기는 강접+총단면 가정.
 *    실제 랙 인증은 제조사 시험성적서(KS R 2029/RMI) 병행 필수.
 *  - 포스트는 축력 지배 가정(P-M 조합 미포함) — 횡하중 큰 경우 별도 검토.
 */
import { analyzeFrame2D } from '../analysis/frame2d.mjs';
import columnBuckling from './column-buckling.mjs';
import simpleBeam from './simple-beam.mjs';

export default {
  id: 'rack_frame',
  domain: 'temporary-structures/rack',
  title: '랙 프레임 검토 (해석+포스트 좌굴+빔 휨+횡변위)',
  description:
    '2D 단일베이 랙 프레임: 직접강성법 해석으로 포스트 축력·횡변위 산출 후 포스트 좌굴(KDS 14 31 10)·빔 휨/처짐·횡변위(H/n) 판정. 커넥터 반강접·유공단면 미반영(시험성적서 병행 필수).',
  refs: [
    'KDS 14 31 10:2024 §4.2 (포스트 좌굴 — 원문 대조 완료 파라미터)',
    'KDS 21 60 00 비계 및 안전시설물 설계기준 (RAG 인덱스 kds-216000)',
    '해석: analysis/frame2d.mjs 직접강성법 (폐형식 정해 골든 4종)',
  ],
  status: 'draft — 워크플로우 v1. 커넥터 강성·유공단면은 시험 기반(제조사 성적서 입력 설계 예정), 공개 게이트 미충족',
  inputSchema: {
    type: 'object',
    required: ['bayWidth', 'postHeight', 'levels', 'levelPitch', 'loadPerLevel', 'Fy', 'post', 'beam'],
    properties: {
      bayWidth: { type: 'number', minimum: 500, maximum: 5000, description: '베이 폭 mm' },
      postHeight: { type: 'number', minimum: 1000, maximum: 15000, description: '포스트 전체 높이 mm' },
      levels: { type: 'integer', minimum: 1, maximum: 12, description: '적재단 수' },
      levelPitch: { type: 'number', minimum: 300, maximum: 3000, description: '단 간격 mm (균등)' },
      loadPerLevel: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: '단당 적재하중 kN (베이당)' },
      lateralLoadPct: { type: 'number', minimum: 0, maximum: 10, description: '수평하중 = 총 수직하중의 % (기본 2%)' },
      Fy: { type: 'number', minimum: 200, maximum: 700, description: '항복강도 MPa' },
      E: { type: 'number', minimum: 190000, maximum: 215000, description: '탄성계수 MPa (기본: 표준값)' },
      K: { type: 'number', minimum: 0.5, maximum: 2.4, description: '포스트 유효좌굴계수 (기본 1.0 — 반강접 클수록 증가)' },
      baseFixed: { type: 'boolean', description: '기초 고정단 여부 (기본 false=핀)' },
      swayLimitDenominator: { type: 'number', minimum: 100, maximum: 500, description: '횡변위 한계 H/n (기본 200)' },
      post: { type: 'object', description: '포스트 단면 {A mm², I mm⁴, r mm(약축)}' },
      beam: { type: 'object', description: '빔 단면 {A mm², Ix mm⁴, Sx mm³, Aw mm²}' },
    },
  },
  run(input, std) {
    const E = input.E ?? std.steel.E_MPa;
    const K = input.K ?? 1.0;
    const latPct = input.lateralLoadPct ?? 2;
    const swayN = input.swayLimitDenominator ?? 200;
    const { bayWidth: B, postHeight: H, levels, levelPitch: pitch, loadPerLevel, Fy, post, beam } = input;
    for (const [obj, keys, nm] of [[post, ['A', 'I', 'r'], 'post'], [beam, ['A', 'Ix', 'Sx', 'Aw'], 'beam']]) {
      for (const k of keys) if (!(obj?.[k] > 0)) throw new Error(`section gate: ${nm}.${k} > 0 required`);
    }
    if (levels * pitch > H) throw new Error(`geometry gate: levels×pitch(${levels * pitch}) > postHeight(${H})`);

    // ── 1) 해석 모델 구성 (2D 단일베이) ──
    const ys = [0, ...Array.from({ length: levels }, (_, i) => (i + 1) * pitch)];
    if (ys[ys.length - 1] < H) ys.push(H);
    const nodes = [];
    const nid = (side, yi) => side * 100 + yi; // left=0xx, right=1xx
    ys.forEach((y, yi) => { nodes.push({ id: nid(0, yi), x: 0, y }, { id: nid(1, yi), x: B, y }); });
    const elements = [];
    for (let s = 0; s < 2; s++) for (let yi = 0; yi < ys.length - 1; yi++) {
      elements.push({ id: `post${s}-${yi}`, from: nid(s, yi), to: nid(s, yi + 1), E, A: post.A, I: post.I });
    }
    const wBeam = -(loadPerLevel * 1000) / B; // N/mm (하향)
    for (let li = 1; li <= levels; li++) {
      elements.push({ id: `beam-${li}`, from: nid(0, li), to: nid(1, li), E, A: beam.A, I: beam.Ix, w: wBeam });
    }
    const fix = input.baseFixed === true;
    const supports = [{ node: nid(0, 0), ux: true, uy: true, rz: fix }, { node: nid(1, 0), ux: true, uy: true, rz: fix }];
    const totalV = loadPerLevel * levels; // kN
    const Hlat = (latPct / 100) * totalV * 1000; // N
    const topNode = nid(0, ys.length - 1);
    const loads = Hlat > 0 ? [{ node: topNode, fx: Hlat }] : [];

    const frame = analyzeFrame2D({ nodes, elements, supports, loads });

    // ── 2) 부재력 집계 ──
    const postAxials = frame.memberForces.filter((m) => m.element.startsWith('post'))
      .map((m) => Math.max(Math.abs(m.end_i.axial_N), Math.abs(m.end_j.axial_N)));
    const maxPostAxial_kN = Math.max(...postAxials) / 1000;
    const maxSway_mm = Math.max(...frame.displacements.map((d) => Math.abs(d.ux_mm)));

    // ── 3) 포스트 좌굴 검토 (비지지길이 = 단 간격) ──
    const postCheck = columnBuckling.run({ Fy, E, Ag: post.A, L: pitch, K, r: post.r, Pu: maxPostAxial_kN }, std);
    // ── 4) 빔 검토 (단순지지 보수측 가정 — 실제는 프레임 연속효과로 유리) ──
    const wBeam_kNm = loadPerLevel / (B / 1000);
    const beamCheck = simpleBeam.run({ L: B, w: wBeam_kNm, Fy, E, Sx: beam.Sx, Aw: beam.Aw, Ix: beam.Ix }, std);
    // ── 5) 횡변위 사용성 ──
    const swayLimit = H / swayN;
    const swayPass = maxSway_mm <= swayLimit;

    const checks = {
      postBuckling: { Pu_kN: maxPostAxial_kN, phiPn_kN: postCheck.checks.capacity_LRFD.phiPn_kN, ratio: postCheck.checks.capacity_LRFD.ratio, pass: postCheck.verdict === 'PASS' },
      beam: { verdict: beamCheck.verdict, bending: beamCheck.checks.bending, deflection: beamCheck.checks.deflection, pass: beamCheck.verdict === 'PASS' },
      sway: { max_mm: maxSway_mm, limit_mm: swayLimit, limitSpec: `H/${swayN}`, pass: swayPass },
    };
    const verdict = checks.postBuckling.pass && checks.beam.pass && checks.sway.pass ? 'PASS' : 'FAIL';
    return {
      inputsEcho: { ...input, E, K, lateralLoadPct: latPct, swayLimitDenominator: swayN },
      intermediate: {
        model: { nodes: nodes.length, elements: elements.length, totalVertical_kN: totalV, lateral_N: Hlat, base: fix ? 'fixed' : 'pinned' },
        maxPostAxial_kN, maxSway_mm,
        postDetail: postCheck.intermediate, beamDetail: beamCheck.intermediate,
      },
      checks,
      verdict,
      notes: [
        '2D 단일베이 강접 모델 — 커넥터 반강접·유공 포스트 유효단면 미반영: 제조사 시험성적서(KS R 2029/RMI) 병행 필수',
        '포스트는 축력 지배 가정(P-M 조합 미포함) — 횡하중 지배 시 별도 검토',
        '빔은 단순지지 보수측 검토(프레임 연속효과 무시)',
      ],
    };
  },
};
