/**
 * interior-floor-template — D-L3 of the complex-scale plan (260808).
 *
 * 층 전체 인테리어: 중앙 복도 스파인 + 양측 유닛 ×N(남측 열은 같은 유닛 정의를
 * yaw 180° 인스턴싱 — IR 회전 계약의 실전 사용) + 양끝 계단 출구.
 *
 * 층 단위 검증 연동(D-L3의 핵심): 형상 게이트가 아니라 **기존 interiorCheck
 * (다실 BFS — 문 개구 통행)와 passageWidthCheck(침식 통로폭)를 층 스케일로
 * 돌려** 피난거리·복도 유효폭을 판정한다. 어휘 재사용: wall_with_openings
 * (sill<300·h≥1800 개구 = 문), role table/counter 가 보행 차단.
 *
 * 좌표: 복도가 y 중앙 밴드. 유닛 로컬은 "복도 접속벽이 y=unitD(북쪽)" 기준 —
 * 남측 열은 yaw 180 + 평행이동으로 문이 복도를 향한다.
 */
import { expandHierarchy, hierarchyCounts } from './hierarchy-ir.mjs';

const box = (id, w, d, h, at = {}, extra = {}) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at, ...extra });
const wall = (id, length, at, openings = []) =>
  ({ id, type: 'wall_with_openings', params: { length, thickness: 150, height: 2700, openings }, at, material: 'concrete', role: 'wall' });

export function buildInteriorFloorIR(p = {}) {
  const unitsPerSide = Math.round(p.unitsPerSide ?? 4);
  const unitW = p.unitW ?? 6000, unitD = p.unitD ?? 4000;
  const corridorW = p.corridorW ?? 1800;
  const doorW = p.doorW ?? 900;
  if (!(unitsPerSide >= 1 && unitsPerSide <= 20)) throw new Error('floor: unitsPerSide 1..20');
  if (!(corridorW >= 1200)) throw new Error('floor: corridorW ≥ 1200 (피난 폭 하한 관례 — 용도별 법규 확인)');
  const W = unitsPerSide * unitW;
  const D = unitD * 2 + corridorW;
  const corridorY0 = unitD, corridorY1 = unitD + corridorW;

  const definitions = [
    {
      defId: 'unit', system: 'interior',
      // 로컬: 서측 파티션벽(x=0) + 복도 접속벽(y=unitD, 중앙 문) — 동측 벽은
      // 이웃 유닛의 서측 벽이 담당(마지막 유닛 동측은 외벽이 봉합).
      parts: [
        wall('party_w', unitD, { tx: 150, ty: 0, rz: 90 }),
        wall('corr_wall', unitW - 150, { tx: 150, ty: unitD - 150 }, [{ x: unitW / 2 - 150 - doorW / 2, w: doorW, h: 2100, sill: 0 }]),
        { ...box('desk', 1400, 700, 740, { tx: 400, ty: 400 }), material: 'wood', role: 'table' },
        { ...box('shelf', 900, 450, 1800, { tx: unitW - 1400, ty: 400 }), material: 'wood', role: 'counter' },
      ],
    },
    {
      defId: 'stair_exit', system: 'interior',
      // 코어 계단 표식(비차단 마커 — exits 메타가 판정 기준)
      parts: [{ ...box('stair_marker', 300, 300, 100, {}), material: 'concrete', role: 'marker' }],
    },
  ];

  const root = [
    // 북측 열: 유닛 로컬 그대로(문이 남쪽 복도로)
    { ref: 'unit', id: 'unitN', at: { ty: corridorY1 + unitD, rz: 180, tx: unitW }, pattern: { kind: 'linear', count: unitsPerSide, dx: unitW } },
    // 남측 열: 로컬 북벽(문)이 복도(북쪽)를 향하도록 그대로 배치
    { ref: 'unit', id: 'unitS', at: { ty: 0 }, pattern: { kind: 'linear', count: unitsPerSide, dx: unitW } },
    { ref: 'stair_exit', id: 'exitW', at: { tx: 150, ty: corridorY0 + corridorW / 2 } },
    { ref: 'stair_exit', id: 'exitE', at: { tx: W - 450, ty: corridorY0 + corridorW / 2 } },
  ];

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `interior_floor_${unitsPerSide}x2`, domain: 'interior', kind: 'floor_plan',
    meta: { unitsPerSide, unitW, unitD, corridorW, doorW, W, D, corridorY0, corridorY1 },
    definitions,
    root,
  };
}

/**
 * 층 전체 어셈블리(+interiorCheck 메타). 외벽 4면과 유닛 동측 봉합벽을 전개
 * 결과에 덧붙인다(외곽은 인스턴스 대상이 아니라 층 고유 요소).
 */
export function buildInteriorFloor(params = {}, opts = {}) {
  const ir = buildInteriorFloorIR(params);
  const expanded = expandHierarchy(ir, opts);
  if (!expanded.ok) return { ok: false, gateErrors: expanded.gateErrors, ir };
  const { W, D, corridorY0, corridorY1, unitsPerSide } = ir.meta;
  const shell = [
    wall('shell_s', W, { tx: 0, ty: -150 }),
    wall('shell_n', W, { tx: 0, ty: D }),
    // 동서 외벽 — 복도 밴드에 계단실 문(출구) 개구
    wall('shell_w', D, { tx: -0, ty: 0, rz: 90 }, [{ x: corridorY0 + 100, w: 1000, h: 2100, sill: 0 }]),
    wall('shell_e', D, { tx: W + 150, ty: 0, rz: 90 }, [{ x: corridorY0 + 100, w: 1000, h: 2100, sill: 0 }]),
  ];
  const assembly = {
    name: expanded.name, domain: 'interior', kind: ir.kind,
    parts: [...expanded.parts, ...shell],
    roomBounds: { W, D },
    exits: [
      { x: 0, y: corridorY0 + corridorW_of(ir) / 2, widthMm: 1000, side: 'w' },
      { x: W, y: corridorY0 + corridorW_of(ir) / 2, widthMm: 1000, side: 'e' },
    ],
    hierarchy: expanded.hierarchy,
  };
  return { ok: true, gateErrors: [], ir, assembly, counts: hierarchyCounts(ir), unitsPerSide };
}
const corridorW_of = (ir) => ir.meta.corridorW;
