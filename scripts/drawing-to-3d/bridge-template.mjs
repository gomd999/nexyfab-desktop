/**
 * bridge-template — N3 of the complex-scale plan (260808).
 *
 * 복잡 교량 C-L1→C-L2: 경간(거더 ×n열 + 가로보 + 바닥판 + 방호벽) ×N경간
 * 인스턴싱 + 지점(기초→기둥→코핑→교좌) ×(N+1). hierarchy-ir 소비자 2호.
 *
 * 기하 계약(간섭 0 구조 보장):
 *  - 수직 스택 전부 면접촉: 기초(−fH..0)→기둥(0..pH)→코핑→교좌→거더→바닥판→방호벽.
 *  - 가로보는 인접 거더 "내측 면 사이"(길이 = 거더간격 − 플랜지폭)만 스팬.
 *  - 거더는 지점 중심에서 양측 각 gap/2 물러난 순길이(신축이음 자리).
 *
 * v1 단순화(정직 표기): 교좌 1열/지점(연속교 유사 — 단순교의 지점당 2열은 C-L3
 * 신축이음과 함께), 종단선형=수평(종곡선·횡경사 = C-L3).
 *
 * 게이트(결과 검증): 지점 수=경간+1 · 거더 열 정렬(전 경간 동일 y) · 바닥판
 * 표고 연속 · 교좌가 모든 거더 열×지점 아래 존재 · BOQ 교차(패턴곱=전개).
 */
import { expandHierarchy, hierarchyCounts } from './hierarchy-ir.mjs';

const box = (id, w, d, h, at = {}, extra = {}) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at, ...extra });

export function buildBridgeIR(p = {}) {
  const spans = Math.round(p.spans ?? 3);
  const spanL = p.spanL ?? 30000;           // 경간장(지점 중심 간)
  const girders = Math.round(p.girders ?? 4);
  const spacing = p.spacing ?? 2800;        // 거더 중심 간격
  const pierH = p.pierH ?? 7000;
  const gap = p.gap ?? 100;                 // 지점부 거더 이격(신축 자리)
  const gradePct = p.gradePct ?? 0;         // C-L3: 종단 경사(%) — 상수 구배(직선 종단)
  /**
   * B-3(260808e) — 구배 상한 ±6%:
   *  · |g| ≤ 3%: 종전 검증 경로 그대로(피치 단일 데크 + 셋백) — 무회귀.
   *  · 3% < |g| ≤ 6%: **스트립 계단 근사** — 데크·방호벽을 무회전 x-스트립으로
   *    나눠 구배선을 따라 계단식 배치. 단부면이 수직이라 조인트 침범(피치
   *    박스의 코너 잔차)이 원천 소멸 → 셋백 0, AABB 판정 전부 정확.
   *    정직 표기: 상면=계단 근사(실무 포장 종단면과 다름 — 표고·물량·간섭
   *    판정은 정확), 스트립 하면과 피치 거더 상면 사이 미세 헌치 간극(스트립
   *    상행 단부 기준 안착 — 간섭 방향 아님)은 실무 헌치 콘크리트 영역.
   */
  if (!(Math.abs(gradePct) <= 6)) throw new Error('bridge: |gradePct| ≤ 6 (스트립 근사 검증 범위)');
  const deckStripMode = Math.abs(gradePct) > 3;
  const deckStripLen = 500;
  if (!(spans >= 1 && spans <= 30)) throw new Error('bridge: spans 1..30');
  if (!(girders >= 2 && girders <= 12)) throw new Error('bridge: girders 2..12');

  // 거더 단면(i_girder 어휘 재사용): 춤 ≈ 경간/16
  const webH = Math.max(800, Math.round(spanL / 16 / 100) * 100 - 80 - 80);
  const topT = 80, botT = 80, topW = 600, botW = 700;
  const girderH = topT + webH + botT;
  const girderLen = spanL - gap;
  const deckT = 250, bearingH = 200, copingH = 1200, footH = 1000;
  const width = (girders - 1) * spacing + botW; // 하부플랜지 기준 총폭
  const deckW = width + 500;                    // 캔틸레버 250mm씩
  const copingW = width + 800;

  const zCoping = pierH + copingH;
  const zGirder = zCoping + bearingH;
  const zDeck = zGirder + girderH;
  /**
   * C-L3(260808) — 상수 종단 구배: 경간·지점 인스턴스가 선형 패턴의 dz 로
   * spanRise 씩 상승하고, 경간 내 장부재(거더·바닥판·방호벽)는 부품 로컬
   * ry 피치로 눕는다(인스턴스 회전은 yaw 전용 계약이므로 피치는 부품 레벨).
   * 회전 부재의 간섭은 3D OBB SAT 내로우페이즈가 과탐 없이 판정한다.
   */
  const slope = gradePct / 100;
  /**
   * 좌면 여유(SEAT): 구배에서 피치 거더 하면과 수평 교좌 상면의 정합은 실무상
   * 테이퍼 솔플레이트가 맡는다(미모델 — 정직 표기). 교좌 본체 높이를 여유만큼
   * 줄여 상면을 구배선 아래에 두면(±6% 상한에서 최대 어긋남 < 12mm) 기하
   * 간섭 없이 좌면 간극(솔플레이트 두께)으로 남는다.
   */
  // ±3%: 실측 <12mm. 3%<|g|≤6%(스트립 모드): 내부 지점 교좌에서 최대 침투
  // 실측 +2.99mm(6%) → 여유 16mm 로 상향(테이퍼 솔플레이트 영역 — 미모델 정직).
  const SEAT_ALLOWANCE = gradePct === 0 ? 0 : (Math.abs(gradePct) > 3 ? 16 : 12);
  // 피치 데크의 단부면은 구배에 수직으로 기울어 하단 모서리가 조인트 갭을
  // deckT·|slope| 만큼 침범한다(실무=수직 절단면, 박스 어휘 한계) — 길이 후퇴로 정합.
  const deckEndSetback = deckStripMode ? 0 : Math.abs(slope) * 250; // 스트립=수직 단부라 셋백 불요
  const deckLen = girderLen - 2 * deckEndSetback;
  const pitchDeg = -Math.atan(slope) * 180 / Math.PI; // OpenSCAD Ry: -각 = +x 진행시 +z 상승
  const spanRise = spanL * slope;
  const riseAtSetback = (gap / 2) * slope; // 거더 시점(지점+gap/2)의 구배선 높이

  const definitions = [
    {
      defId: 'girder', system: 'structure',
      parts: [{ id: 'g', type: 'i_girder', params: { length: girderLen, topW, botW, topT, botT, webH, webT: 20 }, at: { ry: pitchDeg, tz: riseAtSetback }, material: 'steel', role: 'girder' }],
    },
    {
      defId: 'cross_frame', system: 'structure',
      // 인접 거더 내측 면 사이만: 길이 = spacing − botW (AABB 접촉 0)
      parts: [box('cf', 300, spacing - botW, 500, {}, { material: 'steel', role: 'crossbeam' })],
    },
    {
      defId: 'span_deck', system: 'structure',
      parts: deckStripMode
        ? (() => {
            // 스트립 하면 z = 구배선의 스트립 **상행측 단부**(slope>0=끝, <0=시작)
            // — 피치 거더 상면이 스트립 전 구간에서 하면 아래 유지(간섭 0 보장,
            // 하행측 미세 헌치 간극은 안전 방향).
            const nStrips = Math.max(2, Math.ceil(girderLen / deckStripLen));
            // 피치 거더 OBB의 cos 수축 잔차: 회전된 거더 단면고의 유효 상면이
            // girderH·(1−cosθ) 만큼 구배선 위로 나온다(6%에서 ≈3.6mm — 간섭
            // 728건 실측 후 규명). 스트립 하면을 그만큼 들어 안착(안전 방향,
            // 실무 헌치 영역).
            const girderCosLift = girderH * (1 - Math.cos(Math.atan(Math.abs(slope))));
            const out = [];
            for (let i = 0; i < nStrips; i++) {
              const x0 = i * deckStripLen;
              const len = i === nStrips - 1 ? girderLen - x0 : deckStripLen;
              const upperX = slope > 0 ? x0 + len : x0;
              const bottom = (gap / 2 + upperX) * slope + girderCosLift;
              out.push({ ...box(i === 0 ? 'deck' : `deck_s${i}`, len, deckW, deckT, { tx: x0, tz: bottom }), material: 'concrete', role: 'deck' });
              out.push({ ...box(i === 0 ? 'barrier_l' : `barrier_l_s${i}`, len, 400, 900, { tx: x0, ty: 0, tz: bottom + deckT }), material: 'concrete', role: 'barrier' });
              out.push({ ...box(i === 0 ? 'barrier_r' : `barrier_r_s${i}`, len, 400, 900, { tx: x0, ty: deckW - 400, tz: bottom + deckT }), material: 'concrete', role: 'barrier' });
            }
            return out;
          })()
        : [
        { ...box('deck', deckLen, deckW, deckT, { tx: deckEndSetback, ry: pitchDeg, tz: riseAtSetback + deckEndSetback * slope }), material: 'concrete', role: 'deck' },
        { ...box('barrier_l', deckLen, 400, 900, { tx: deckEndSetback, ty: 0, tz: deckT + riseAtSetback + deckEndSetback * slope, ry: pitchDeg }), material: 'concrete', role: 'barrier' },
        { ...box('barrier_r', deckLen, 400, 900, { tx: deckEndSetback, ty: deckW - 400, tz: deckT + riseAtSetback + deckEndSetback * slope, ry: pitchDeg }), material: 'concrete', role: 'barrier' },
      ],
    },
    {
      defId: 'span', system: 'structure',
      children: [
        { ref: 'girder', id: 'g', at: { tx: gap / 2, ty: -botW / 2, tz: zGirder }, pattern: { kind: 'linear', count: girders, dy: spacing } },
        // 가로보 3열(1/4·1/2·3/4 지점) — 스테이션별 linear: 각 열의 z 가 구배선을 따른다
        ...[1, 2, 3].map((q) => ({
          ref: 'cross_frame', id: `cf${q}`,
          at: {
            tx: gap / 2 + (girderLen * q) / 4 - 150, ty: botW / 2,
            tz: zGirder + girderH - 600 + riseAtSetback + ((girderLen * q) / 4) * slope,
          },
          pattern: { kind: 'linear', count: girders - 1, dy: spacing },
        })),
        { ref: 'span_deck', id: 'deck', at: { tx: gap / 2, ty: -botW / 2 - 250, tz: zDeck } },
      ],
    },
    {
      defId: 'bearing', system: 'structure',
      parts: [box('brg', 500, 500, bearingH - SEAT_ALLOWANCE, {}, { material: 'steel', role: 'bearing' })],
    },
    {
      defId: 'pier', system: 'structure',
      parts: [
        { ...box('footing', 5000, copingW + 1000, footH, { tx: -2500, ty: -(copingW + 1000) / 2, tz: -footH }), material: 'concrete', role: 'footing' },
        { id: 'pcol', type: 'cylinder', params: { diameter: 2200, length: pierH }, at: { tz: 0 }, material: 'concrete', role: 'pier_column' },
        { ...box('coping', 2600, copingW, copingH, { tx: -1300, ty: -copingW / 2, tz: pierH }), material: 'concrete', role: 'coping' },
      ],
      children: [
        // 교좌 1열/지점(v1) — 거더 열(절대 y=0..(g−1)·spacing) 아래 코핑 "상면"
        // (z=코핑 위 면접촉; 교각 원점이 폭중심 yc라 −yc로 되돌린다)
        { ref: 'bearing', id: 'brg', at: { tx: -250, ty: -((girders - 1) * spacing) / 2 - 250, tz: pierH + copingH }, pattern: { kind: 'linear', count: girders, dy: spacing } },
      ],
    },
  ];

  /**
   * C-L3 1단계(260808) — 신축이음: 내부 지점(경간 사이)마다 바닥판 단부 사이
   * gap 을 메우는 이음 스트립(핑거조인트 개념 부재 — 표기용 하드웨어)을 둔다.
   * 스트립 폭 = gap, 바닥판과 면접촉(간섭 0 유지). 게이트가 「이음 수 = 경간−1」
   * 과 「인접 바닥판 단부 이격 = gap」을 결과에서 검증한다.
   * (종단선형·횡경사는 피치(ry) 부재의 AABB 간섭 과탐 해소(OBB) 선행 후 — 미구현 정직 표기)
   */
  definitions.push({
    defId: 'expansion_joint', system: 'envelope',
    parts: [{ ...box('joint_strip', gap, deckW, 60, { tx: -gap / 2, tz: -60 }), material: 'steel', role: 'expansion_joint' }],
  });

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `bridge_${spans}span_${girders}g`, domain: 'civil', kind: 'bridge',
    meta: { spans, spanL, girders, spacing, pierH, gap, girderH, girderLen, zDeck, deckT, width, gradePct, spanRise, pitchDeg, deckStripMode, deckStripLen },
    definitions,
    root: [
      // 경간: x = k·spanL 에서 시작. 거더 열 y 중심 = 0..(girders−1)·spacing
      { ref: 'span', id: 'sp', pattern: { kind: 'linear', count: spans, dx: spanL, dz: spanRise } },
      // 지점: x = 0..spans·spanL, 코핑 중심이 지점선
      // 지점 구배 추종: 기둥 길이는 동일하고 기초 표고가 함께 오른다(성토 가정 — 지반선 미모델 정직 표기)
      { ref: 'pier', id: 'pier', at: { ty: ((girders - 1) * spacing) / 2 }, pattern: { kind: 'linear', count: spans + 1, dx: spanL, dz: spanRise } },
      ...(spans > 1 ? [{ ref: 'expansion_joint', id: 'ej', at: { tx: spanL, ty: -botW / 2 - 250, tz: zDeck + deckT + spanRise }, pattern: { kind: 'linear', count: spans - 1, dx: spanL, dz: spanRise } }] : []),
    ],
  };
}

/** 교량 결정론 게이트 — 전개 결과 검증. @returns string[] */
export function gateBridge(ir, expanded) {
  const errs = [];
  const { spans, girders, zDeck } = ir.meta;
  const parts = expanded.parts ?? [];
  const counts = hierarchyCounts(ir);

  // ① 지점 수 = 경간 + 1
  const piers = parts.filter(pp => pp._occ.leaf === 'pcol');
  if (piers.length !== spans + 1) errs.push(`pier_count: ${piers.length} ≠ ${spans + 1}`);

  // ② 거더 열 정렬: 전 경간에서 y 좌표 집합이 동일(girders개)
  const gY = new Map();
  for (const pp of parts) {
    if (pp._occ.leaf !== 'g') continue;
    const key = pp.at.ty.toFixed(1);
    gY.set(key, (gY.get(key) ?? 0) + 1);
  }
  if (gY.size !== girders) errs.push(`girder_lines: 평면 열 ${gY.size} ≠ ${girders}`);
  for (const [key, n] of gY) if (n !== spans) errs.push(`girder_continuity: y=${key} 경간 발생 ${n} ≠ ${spans}`);

  // ③ 바닥판 표고: 경간 k 의 tz = zDeck + k·spanRise (구배 0 이면 종전 동일 표고와 일치)
  const spanRise = ir.meta.spanRise ?? 0;
  const decks = parts.filter(pp => pp._occ.leaf === 'deck')
    .map(pp => ({ k: Number((pp._occ.path.match(/sp\[(\d+)\]/) ?? [])[1]), tz: pp.at.tz }))
    .sort((a, b) => a.k - b.k);
  for (const item of decks) {
    const sl = (ir.meta.gradePct ?? 0) / 100;
    // 스트립 모드: 첫 스트립('deck' leaf) 하면 = 구배선의 상행측 단부
    //   (slope>0 → gap/2+stripLen, slope<0 → gap/2). 비스트립: 종전 셋백식.
    const cosLift = ir.meta.deckStripMode
      ? (ir.meta.girderH ?? 0) * (1 - Math.cos(Math.atan(Math.abs(sl))))
      : 0;
    const want = ir.meta.deckStripMode
      ? zDeck + item.k * spanRise + (ir.meta.gap / 2 + (sl > 0 ? ir.meta.deckStripLen : 0)) * sl + cosLift
      : zDeck + item.k * spanRise + (ir.meta.gap / 2) * sl + Math.abs(sl) * 250 * sl;
    if (Math.abs(item.tz - want) > 0.1) { errs.push(`deck_elevation: 경간 ${item.k} 표고 ${item.tz.toFixed(1)} ≠ 구배선 ${want.toFixed(1)}`); break; }
  }

  // ④ 교좌: 지점×거더열 격자 전부 존재
  const brg = parts.filter(pp => pp._occ.leaf === 'brg');
  if (brg.length !== (spans + 1) * girders) errs.push(`bearing_count: ${brg.length} ≠ ${(spans + 1) * girders}`);

  // ④b C-L3: 신축이음 — 내부 지점마다 1개, 인접 바닥판 단부 이격 = gap
  const joints = parts.filter(pp => pp._occ.leaf === 'joint_strip');
  if (spans > 1 && joints.length !== spans - 1) errs.push(`expansion_joint_count: ${joints.length} ≠ ${spans - 1}`);
  const deckXs = parts.filter(pp => pp._occ.leaf === 'deck').map(pp => pp.at.tx).sort((a, b) => a - b);
  for (let k = 1; k < deckXs.length; k++) {
    const separation = deckXs[k] - (deckXs[k - 1] + ir.meta.girderLen);
    if (Math.abs(separation - ir.meta.gap) > 0.5) { errs.push(`deck_gap: 지점 ${k} 이격 ${separation.toFixed(1)} ≠ ${ir.meta.gap}`); break; }
  }

  // ⑤ BOQ 교차: 패턴곱 = 전개
  const gTotal = parts.filter(pp => pp._occ.leaf === 'g').length;
  if (gTotal !== counts.get('girder')) errs.push(`boq_girder: ${gTotal} ≠ ${counts.get('girder')}`);
  return errs;
}

export function buildBridge(params = {}, opts = {}) {
  const ir = buildBridgeIR(params);
  const expanded = expandHierarchy(ir, opts);
  if (!expanded.ok) return { ok: false, gateErrors: expanded.gateErrors, ir };
  const errs = gateBridge(ir, expanded);
  return { ok: errs.length === 0, gateErrors: errs, ir, expanded };
}
