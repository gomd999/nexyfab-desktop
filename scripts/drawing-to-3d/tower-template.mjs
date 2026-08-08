/**
 * tower-template — N2 of the complex-scale plan (260808).
 *
 * 고층 건물 B-L1→B-L2: 코어(계단실+ELV 샤프트 벽) + 기준층 구조(기둥 그리드·
 * 양방향 보·슬래브) + 유닛 fit-out 슬롯 → **hierarchy-ir 인스턴싱으로 ×N층**.
 * AI 없는 결정론 전개기(D2)이자 hierarchy IR(D1)의 첫 실전 소비자.
 *
 * 기하 계약(간섭 0을 구조적으로 보장):
 *  - 기둥 z 0..(H−beamD−slabT), 보 z (H−beamD−slabT)..(H−slabT) — 기둥 상단과
 *    보 하단이 면접촉(겹침 0), 보는 기둥 면 사이 순경간만 스팬.
 *  - 슬래브 z (H−slabT)..H, 다음 층은 z=H에서 시작(면접촉 스택).
 *  - 코어 벽·유닛 가구는 베이 내부(기둥·보 풋프린트 밖)에만 배치.
 *
 * 결정론 게이트(gateTower): 기둥 수직 연속성(전 층 동일 (x,y) 발생), 층합
 * BOQ=전체(hierarchyCounts 교차), 코어·유닛의 풋프린트 내 포함.
 */
import { expandHierarchy, hierarchyCounts } from './hierarchy-ir.mjs';

const box = (id, w, d, h, at = {}, extra = {}) =>
  ({ id, type: 'box', params: { width: w, depth: d, height: h }, at, ...extra });

/**
 * @param {object} p
 *  floors, nx, ny(베이 수), bayX, bayY, floorH, colW, beamW, beamD, slabT,
 *  withUnits(기준층 유닛 fit-out 포함 여부)
 */
export function buildTowerIR(p = {}) {
  const floors = Math.round(p.floors ?? 10);
  const nx = Math.round(p.nx ?? 3), ny = Math.round(p.ny ?? 2);
  const bayX = p.bayX ?? 8000, bayY = p.bayY ?? 8000;
  const floorH = p.floorH ?? 3400, colW = p.colW ?? 500;
  const beamW = p.beamW ?? 400, beamD = p.beamD ?? 600, slabT = p.slabT ?? 200;
  const withUnits = p.withUnits !== false;
  if (!(floors >= 1 && floors <= 100)) throw new Error('tower: floors 1..100');
  if (!(nx >= 1 && ny >= 1 && nx * ny <= 400)) throw new Error('tower: bays invalid');
  const colH = floorH - beamD - slabT;
  if (!(colH > 1000)) throw new Error('tower: floorH가 보춤+슬래브 대비 너무 낮음');

  const W = nx * bayX + colW, D = ny * bayY + colW; // 외곽 풋프린트(기둥 중심 그리드 + 기둥폭)

  const definitions = [
    { defId: 'column', system: 'structure', parts: [box('col', colW, colW, colH, {}, { material: 'concrete', role: 'column' })] },
    // 보: X방향(순경간 bayX−colW), Y방향(순경간 bayY−colW) — 기둥 면 사이만.
    { defId: 'beam_x', system: 'structure', parts: [box('bx', bayX - colW, beamW, beamD, {}, { material: 'concrete', role: 'beam' })] },
    { defId: 'beam_y', system: 'structure', parts: [box('by', beamW, bayY - colW, beamD, {}, { material: 'concrete', role: 'beam' })] },
    {
      defId: 'core', system: 'structure',
      // 첫 베이 내부의 계단실(3000×2500)+ELV 샤프트(2500×2500) 벽 4+4장, t=200.
      parts: [
        box('stair_w_s', 3000, 200, colH, { tx: 600, ty: 600 }),
        box('stair_w_n', 3000, 200, colH, { tx: 600, ty: 600 + 2300 }),
        box('stair_w_w', 200, 2100, colH, { tx: 600, ty: 800 }),
        box('stair_w_e', 200, 2100, colH, { tx: 600 + 2800, ty: 800 }),
        box('elv_w_s', 2500, 200, colH, { tx: 4000, ty: 600 }),
        box('elv_w_n', 2500, 200, colH, { tx: 4000, ty: 600 + 2300 }),
        box('elv_w_w', 200, 2100, colH, { tx: 4000, ty: 800 }),
        box('elv_w_e', 200, 2100, colH, { tx: 4000 + 2300, ty: 800 }),
      ].map(w => ({ ...w, material: 'concrete', role: 'core_wall' })),
    },
    {
      defId: 'unit_fitout', system: 'interior',
      // 단순 유닛: 침대·책상·옷장·테이블(베이 내부 여백에 배치, z=슬래브 위).
      parts: [
        box('bed', 2000, 1500, 500, { tx: 300, ty: 300 }),
        box('desk', 1200, 600, 720, { tx: 300, ty: 2200 }),
        box('closet', 1200, 600, 2200, { tx: 2600, ty: 300 }),
        box('table', 900, 900, 720, { tx: 2600, ty: 2200 }),
      ].map(f => ({ ...f, material: 'wood', role: 'furniture' })),
    },
    {
      defId: 'typical_floor', system: 'structure',
      parts: [
        { ...box('slab', W, D, slabT, { tx: -colW / 2, ty: -colW / 2, tz: colH + beamD }), material: 'concrete', role: 'slab' },
      ],
      children: [
        { ref: 'column', id: 'col', at: { tx: -colW / 2, ty: -colW / 2 }, pattern: { kind: 'grid', nx: nx + 1, ny: ny + 1, dx: bayX, dy: bayY } },
        { ref: 'beam_x', id: 'gx', at: { tx: colW / 2, ty: -beamW / 2, tz: colH }, pattern: { kind: 'grid', nx, ny: ny + 1, dx: bayX, dy: bayY } },
        { ref: 'beam_y', id: 'gy', at: { tx: -beamW / 2, ty: colW / 2, tz: colH }, pattern: { kind: 'grid', nx: nx + 1, ny, dx: bayX, dy: bayY } },
        { ref: 'core', id: 'core' },
        ...(withUnits ? [{
          ref: 'unit_fitout', id: 'unit',
          // 코어 베이(0,0)를 제외한 베이들에 유닛 — 마지막 열은 남겨 다양성 확보.
          at: { tx: bayX + 600, ty: 600, tz: colH + beamD + slabT },
          pattern: { kind: 'grid', nx: Math.max(1, nx - 1), ny, dx: bayX, dy: bayY },
        }] : []),
      ],
    },
  ];

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `tower_${floors}f_${nx}x${ny}`, domain: 'building', kind: 'tower',
    meta: { floors, nx, ny, bayX, bayY, floorH, colW, beamW, beamD, slabT, footprint: [W, D] },
    definitions,
    root: [{ ref: 'typical_floor', id: 'fl', pattern: { kind: 'linear', count: floors, dz: floorH } }],
  };
}

/**
 * 타워 결정론 게이트 — 전개 산출물 검증(입력이 아니라 결과를 본다).
 * @returns string[] errors
 */
export function gateTower(ir, expanded) {
  const errs = [];
  const { floors, nx, ny } = ir.meta;
  const parts = expanded.parts ?? [];

  // ① 기둥 수직 연속성: (x,y) 그룹별 발생 수 = 층수 (전이·누락 즉시 검출)
  const colXY = new Map();
  for (const part of parts) {
    if (part._occ?.leaf !== 'col') continue;
    const key = `${part.at.tx.toFixed(1)},${part.at.ty.toFixed(1)}`;
    colXY.set(key, (colXY.get(key) ?? 0) + 1);
  }
  const gridPoints = (nx + 1) * (ny + 1);
  if (colXY.size !== gridPoints) errs.push(`column_grid: 평면 기둥 위치 ${colXY.size} ≠ 그리드 ${gridPoints}`);
  for (const [key, n] of colXY) if (n !== floors) errs.push(`column_continuity: (${key}) 발생 ${n} ≠ 층수 ${floors}`);

  // ② BOQ 교차: hierarchyCounts(정의×패턴 곱) = 전개 실측 — 닫힌형 두 개
  const counts = hierarchyCounts(ir);
  const slabTotal = parts.filter(pp => pp._occ.leaf === 'slab').length;
  if (slabTotal !== floors) errs.push(`boq_slab: ${slabTotal} ≠ ${floors}`);
  const colTotal = parts.filter(pp => pp._occ.leaf === 'col').length;
  if (colTotal !== counts.get('column')) errs.push(`boq_column: 전개 ${colTotal} ≠ 패턴곱 ${counts.get('column')}`);

  // ③ 풋프린트 포함: 모든 부품 AABB 시작점이 풋프린트+여유 안
  const [W, D] = ir.meta.footprint;
  for (const part of parts) {
    const { tx = 0, ty = 0 } = part.at;
    if (tx < -ir.meta.colW || ty < -ir.meta.colW || tx > W || ty > D) {
      errs.push(`footprint: ${part.id} (${tx.toFixed(0)},${ty.toFixed(0)}) 풋프린트 밖`);
      break;
    }
  }
  return errs;
}

/** 편의: IR 생성→전개→게이트 일괄. */
export function buildTower(params = {}, opts = {}) {
  const ir = buildTowerIR(params);
  const expanded = expandHierarchy(ir, opts);
  if (!expanded.ok) return { ok: false, gateErrors: expanded.gateErrors, ir };
  const errs = gateTower(ir, expanded);
  return { ok: errs.length === 0, gateErrors: errs, ir, expanded };
}
