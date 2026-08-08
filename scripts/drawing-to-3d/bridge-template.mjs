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

  const definitions = [
    {
      defId: 'girder', system: 'structure',
      parts: [{ id: 'g', type: 'i_girder', params: { length: girderLen, topW, botW, topT, botT, webH, webT: 20 }, at: {}, material: 'steel', role: 'girder' }],
    },
    {
      defId: 'cross_frame', system: 'structure',
      // 인접 거더 내측 면 사이만: 길이 = spacing − botW (AABB 접촉 0)
      parts: [box('cf', 300, spacing - botW, 500, {}, { material: 'steel', role: 'crossbeam' })],
    },
    {
      defId: 'span_deck', system: 'structure',
      parts: [
        { ...box('deck', girderLen, deckW, deckT), material: 'concrete', role: 'deck' },
        { ...box('barrier_l', girderLen, 400, 900, { ty: 0, tz: deckT }), material: 'concrete', role: 'barrier' },
        { ...box('barrier_r', girderLen, 400, 900, { ty: deckW - 400, tz: deckT }), material: 'concrete', role: 'barrier' },
      ],
    },
    {
      defId: 'span', system: 'structure',
      children: [
        { ref: 'girder', id: 'g', at: { tx: gap / 2, ty: -botW / 2, tz: zGirder }, pattern: { kind: 'linear', count: girders, dy: spacing } },
        // 가로보 3열(1/4·1/2·3/4 지점), 거더 사이(girders−1)개씩, 거더 상부 근처
        {
          ref: 'cross_frame', id: 'cf',
          at: { tx: gap / 2 + girderLen / 4 - 150, ty: botW / 2, tz: zGirder + girderH - 600 },
          pattern: { kind: 'grid', nx: 3, ny: girders - 1, dx: girderLen / 4, dy: spacing },
        },
        { ref: 'span_deck', id: 'deck', at: { tx: gap / 2, ty: -botW / 2 - 250, tz: zDeck } },
      ],
    },
    {
      defId: 'bearing', system: 'structure',
      parts: [box('brg', 500, 500, bearingH, {}, { material: 'steel', role: 'bearing' })],
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

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `bridge_${spans}span_${girders}g`, domain: 'civil', kind: 'bridge',
    meta: { spans, spanL, girders, spacing, pierH, gap, girderH, girderLen, zDeck, deckT, width },
    definitions,
    root: [
      // 경간: x = k·spanL 에서 시작. 거더 열 y 중심 = 0..(girders−1)·spacing
      { ref: 'span', id: 'sp', pattern: { kind: 'linear', count: spans, dx: spanL } },
      // 지점: x = 0..spans·spanL, 코핑 중심이 지점선
      { ref: 'pier', id: 'pier', at: { ty: ((girders - 1) * spacing) / 2 }, pattern: { kind: 'linear', count: spans + 1, dx: spanL } },
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

  // ③ 바닥판 표고 연속: 모든 deck 의 tz 동일
  const deckZ = new Set(parts.filter(pp => pp._occ.leaf === 'deck').map(pp => pp.at.tz.toFixed(1)));
  if (deckZ.size !== 1) errs.push(`deck_elevation: 표고 ${[...deckZ].join(',')} — 불연속`);
  else if (Math.abs([...deckZ][0] - zDeck) > 0.1) errs.push(`deck_elevation_value: ${[...deckZ][0]} ≠ ${zDeck}`);

  // ④ 교좌: 지점×거더열 격자 전부 존재
  const brg = parts.filter(pp => pp._occ.leaf === 'brg');
  if (brg.length !== (spans + 1) * girders) errs.push(`bearing_count: ${brg.length} ≠ ${(spans + 1) * girders}`);

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
