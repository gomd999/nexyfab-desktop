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
  /**
   * B-L4(260808) — MEP: 수직 라이저 샤프트(전층 정렬) + 층별 천장 플레넘 존의
   * 수평 덕트 트렁크(복도측) + 샤프트-트렁크 층별 접속. 간섭 0 기하 계약:
   * 트렁크는 보 하부 플레넘 밴드(z: colH−plenumH..colH)만 쓰고, 샤프트는
   * 베이 내부(기둥·보 풋프린트 밖) 고정 평면 위치에 전층 연속.
   */
  const withMep = p.withMep === true;
  const plenumH = 350, ductW = 600, ductH = 300, shaftW = 900, shaftD = 700;
  /**
   * B-2/B-L4 잔여(260808d) — 외피 커튼월: 4개 파사드에 멀리언 그리드+패널을
   * IR grid 패턴으로 인스턴싱. 규약:
   *  - 모듈폭 = 파사드 길이/모듈수(fit-to-length) → 커버리지 항등이 구성적으로
   *    성립하고 게이트가 이를 재검증한다(전개 실측 기준).
   *  - x-런(남/북)이 코너까지 전장, y-런(동/서)은 코너 밴드만큼 인셋 —
   *    코너 수직 클로저 조인트는 미모델(정직 표기, 물량은 런 기준).
   *  - 패널 밴드 = 층 전고(스팬드럴/비전 분할 미모델 — 정직 표기).
   */
  const withCurtainWall = p.withCurtainWall === true;
  const cwModule = p.cwModule ?? 1500;
  const cwMullionW = 60, cwMullionD = 150, cwPanelT = 30, cwStandoff = 100;
  const cwBand = cwStandoff + cwMullionD; // 슬래브 엣지 밖 점유 밴드
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
      defId: 'mep_shaft', system: 'mep',
      // 코어 옆 베이 내부 고정 위치 — 슬래브 '하면'까지(관통부=개구, 미모델 정직 표기).
      // 위층 샤프트가 슬래브 상면에서 이어져 면접촉 스택으로 수직 연속이 성립한다.
      parts: [box('shaft', shaftW, shaftD, floorH - slabT, {}, { material: 'steel', role: 'mep_shaft' })],
    },
    {
      defId: 'mep_trunk', system: 'mep',
      // 복도측 수평 트렁크 덕트: 보 하부 플레넘 밴드, 기둥 열 사이 순길이
      parts: [box('duct', bayX - colW - 100, ductW, ductH, {}, { material: 'steel', role: 'duct' })],
    },
    {
      defId: 'mep_connect', system: 'mep',
      // 샤프트→트렁크 층별 접속 스터브
      parts: [box('stub', 400, ductW, ductH, {}, { material: 'steel', role: 'duct' })],
    },
    ...(withCurtainWall ? (() => {
      const defs = [];
      const L_x = nx * bayX + colW;            // 남/북 파사드 전장(슬래브 폭)
      const L_y = ny * bayY + colW - 2 * cwBand; // 동/서 파사드(코너 밴드 인셋)
      const nModX = Math.max(1, Math.round(L_x / cwModule));
      const nModY = Math.max(1, Math.round(L_y / cwModule));
      const modX = L_x / nModX, modY = L_y / nModY;
      defs.push({ defId: 'cw_mullion_x', system: 'facade', parts: [box('cwm', cwMullionW, cwMullionD, floorH, {}, { material: 'aluminum', role: 'cw_mullion' })] });
      defs.push({ defId: 'cw_panel_x', system: 'facade', parts: [box('cwp', modX - cwMullionW, cwPanelT, floorH, {}, { material: 'glass', role: 'cw_panel' })] });
      defs.push({ defId: 'cw_mullion_y', system: 'facade', parts: [box('cwm', cwMullionD, cwMullionW, floorH, {}, { material: 'aluminum', role: 'cw_mullion' })] });
      defs.push({ defId: 'cw_panel_y', system: 'facade', parts: [box('cwp', cwPanelT, modY - cwMullionW, floorH, {}, { material: 'glass', role: 'cw_panel' })] });
      return defs;
    })() : []),
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
        ...(withCurtainWall ? (() => {
          const L_x = nx * bayX + colW;
          const L_y = ny * bayY + colW - 2 * cwBand;
          const nModX = Math.max(1, Math.round(L_x / cwModule));
          const nModY = Math.max(1, Math.round(L_y / cwModule));
          const modX = L_x / nModX, modY = L_y / nModY;
          const x0 = -colW / 2, y0 = -colW / 2;
          const yS = y0 - cwStandoff - cwMullionD;              // 남측 멀리언 외면 기준 배치
          const yN = ny * bayY + colW / 2 + cwStandoff;         // 북측
          const xW = x0 - cwStandoff - cwMullionD;              // 서측
          const xE = nx * bayX + colW / 2 + cwStandoff;         // 동측
          const yRun0 = y0 + cwBand;                            // 동/서 런 시작(코너 인셋)
          const panelInset = (cwMullionD - cwPanelT) / 2;
          return [
            // 남/북: 멀리언 nMod+1(경계 중심), 패널 nMod(경계 사이)
            { ref: 'cw_mullion_x', id: 'cwmS', at: { tx: x0 - cwMullionW / 2, ty: yS }, pattern: { kind: 'grid', nx: nModX + 1, ny: 1, dx: modX, dy: 0 } },
            { ref: 'cw_panel_x', id: 'cwpS', at: { tx: x0 + cwMullionW / 2, ty: yS + panelInset }, pattern: { kind: 'grid', nx: nModX, ny: 1, dx: modX, dy: 0 } },
            { ref: 'cw_mullion_x', id: 'cwmN', at: { tx: x0 - cwMullionW / 2, ty: yN }, pattern: { kind: 'grid', nx: nModX + 1, ny: 1, dx: modX, dy: 0 } },
            { ref: 'cw_panel_x', id: 'cwpN', at: { tx: x0 + cwMullionW / 2, ty: yN + panelInset }, pattern: { kind: 'grid', nx: nModX, ny: 1, dx: modX, dy: 0 } },
            // 동/서: 코너 인셋 런
            { ref: 'cw_mullion_y', id: 'cwmW', at: { tx: xW, ty: yRun0 - cwMullionW / 2 }, pattern: { kind: 'grid', nx: 1, ny: nModY + 1, dx: 0, dy: modY } },
            { ref: 'cw_panel_y', id: 'cwpW', at: { tx: xW + panelInset, ty: yRun0 + cwMullionW / 2 }, pattern: { kind: 'grid', nx: 1, ny: nModY, dx: 0, dy: modY } },
            { ref: 'cw_mullion_y', id: 'cwmE', at: { tx: xE, ty: yRun0 - cwMullionW / 2 }, pattern: { kind: 'grid', nx: 1, ny: nModY + 1, dx: 0, dy: modY } },
            { ref: 'cw_panel_y', id: 'cwpE', at: { tx: xE + panelInset, ty: yRun0 + cwMullionW / 2 }, pattern: { kind: 'grid', nx: 1, ny: nModY, dx: 0, dy: modY } },
          ];
        })() : []),
        ...(withMep ? [
          // 샤프트: 코어 베이 동측 여백(코어 x≤4000+2300 뒤) — 전층 같은 평면 위치
          { ref: 'mep_shaft', id: 'shaft', at: { tx: 6800, ty: 600 } },
          // 트렁크: 각 베이 X열을 따라 플레넘 밴드(보 하부), 베이 y 중앙선 위쪽
          { ref: 'mep_trunk', id: 'trunk', at: { tx: colW / 2 + 50, ty: bayY / 2, tz: colH - plenumH }, pattern: { kind: 'grid', nx, ny, dx: bayX, dy: bayY } },
          // 접속 스터브: 샤프트 동측면 → 첫 트렁크 방향
          { ref: 'mep_connect', id: 'stub', at: { tx: 6800 + shaftW, ty: bayY / 2, tz: colH - plenumH } },
        ] : []),
      ],
    },
  ];

  /**
   * B-L3(260808) — 층 차별화: 로비(2배층고·유닛 없음·코어 연속) + 기준층 ×N +
   * 옥상(파라펫). withLobby=false 면 종전 균일 스택(B-L2)과 동일하다.
   * 수직 동선 연속성: 코어 벽 정의는 층고만 파라미터로 받는 공유 정의라
   * 평면 위치가 변형층에서도 동일하다 — gateTower 가 결과에서 재검증한다.
   */
  const withLobby = p.withLobby === true;
  const lobbyH = withLobby ? floorH * 2 : 0;
  const typicalCount = withLobby ? Math.max(1, floors - 1) : floors;
  if (withLobby) {
    const lobbyColH = lobbyH - beamD - slabT;
    definitions.push({
      defId: 'lobby_core', system: 'structure',
      parts: definitions.find(d => d.defId === 'core').parts.map(w => ({
        ...w, params: { ...w.params, height: lobbyColH },
      })),
    });
    definitions.push({
      defId: 'lobby_floor', system: 'structure',
      parts: [
        { ...box('slab', W, D, slabT, { tx: -colW / 2, ty: -colW / 2, tz: lobbyColH + beamD }), material: 'concrete', role: 'slab' },
      ],
      children: [
        { ref: 'lobby_column', id: 'col', at: { tx: -colW / 2, ty: -colW / 2 }, pattern: { kind: 'grid', nx: nx + 1, ny: ny + 1, dx: bayX, dy: bayY } },
        { ref: 'beam_x', id: 'gx', at: { tx: colW / 2, ty: -beamW / 2, tz: lobbyColH }, pattern: { kind: 'grid', nx, ny: ny + 1, dx: bayX, dy: bayY } },
        { ref: 'beam_y', id: 'gy', at: { tx: -beamW / 2, ty: colW / 2, tz: lobbyColH }, pattern: { kind: 'grid', nx: nx + 1, ny, dx: bayX, dy: bayY } },
        { ref: 'lobby_core', id: 'core' },
      ],
    });
    definitions.push({
      defId: 'lobby_column', system: 'structure',
      parts: [box('col', colW, colW, lobbyColH, {}, { material: 'concrete', role: 'column' })],
    });
  }
  definitions.push({
    defId: 'roof_parapet', system: 'envelope',
    parts: [
      { ...box('parapet_s', W, 200, 1100, { tx: -colW / 2, ty: -colW / 2 }), material: 'concrete', role: 'parapet' },
      { ...box('parapet_n', W, 200, 1100, { tx: -colW / 2, ty: D - colW / 2 - 200 }), material: 'concrete', role: 'parapet' },
      { ...box('parapet_w', 200, D - 400 - colW, 1100, { tx: -colW / 2, ty: -colW / 2 + 200 }), material: 'concrete', role: 'parapet' },
      { ...box('parapet_e', 200, D - 400 - colW, 1100, { tx: W - colW / 2 - 200, ty: -colW / 2 + 200 }), material: 'concrete', role: 'parapet' },
    ],
  });

  const root = [
    ...(withLobby ? [{ ref: 'lobby_floor', id: 'lobby' }] : []),
    { ref: 'typical_floor', id: 'fl', at: { tz: lobbyH }, pattern: { kind: 'linear', count: typicalCount, dz: floorH } },
    { ref: 'roof_parapet', id: 'roof', at: { tz: lobbyH + typicalCount * floorH } },
  ];

  return {
    schema: 'nexyfab.assembly-hierarchy.v1',
    name: `tower_${floors}f_${nx}x${ny}`, domain: 'building', kind: 'tower',
    meta: { floors, nx, ny, bayX, bayY, floorH, colW, beamW, beamD, slabT, footprint: [W, D], withLobby, lobbyH, typicalCount, withMep, plenumH, withCurtainWall, cwModule, cwBand, cwMullionW },
    definitions,
    root,
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
  const levels = (ir.meta.withLobby ? 1 : 0) + (ir.meta.typicalCount ?? floors);
  const gridPoints = (nx + 1) * (ny + 1);
  if (colXY.size !== gridPoints) errs.push(`column_grid: 평면 기둥 위치 ${colXY.size} ≠ 그리드 ${gridPoints}`);
  for (const [key, n] of colXY) if (n !== levels) errs.push(`column_continuity: (${key}) 발생 ${n} ≠ 레벨 수 ${levels}`);

  // ①b B-L3 수직 동선 연속성: 코어 벽 평면 위치(tx,ty)가 전 레벨에서 동일하게 발생
  const coreXY = new Map();
  for (const part of parts) {
    if (part.role !== 'core_wall') continue;
    const key = `${part.at.tx.toFixed(1)},${part.at.ty.toFixed(1)}`;
    coreXY.set(key, (coreXY.get(key) ?? 0) + 1);
  }
  if (coreXY.size > 0) {
    for (const [key, n] of coreXY) if (n !== levels) errs.push(`core_continuity: 코어벽 (${key}) 발생 ${n} ≠ 레벨 수 ${levels} — 수직 동선 단절`);
  }

  // ①c B-L4: MEP 샤프트 수직 정렬 — 전 레벨 동일 (tx,ty)
  if (ir.meta.withMep) {
    const shaftXY = new Map();
    for (const part of parts) {
      if (part.role !== 'mep_shaft') continue;
      const key = `${part.at.tx.toFixed(1)},${part.at.ty.toFixed(1)}`;
      shaftXY.set(key, (shaftXY.get(key) ?? 0) + 1);
    }
    if (shaftXY.size !== 1) errs.push(`shaft_alignment: 샤프트 평면 위치 ${shaftXY.size}종 — 수직 정렬 단절`);
    for (const [key, n] of shaftXY) if (n !== (ir.meta.typicalCount ?? floors)) errs.push(`shaft_continuity: (${key}) 발생 ${n} ≠ 기준층 수`);
    // 트렁크가 플레넘 밴드를 벗어나지 않는다(보 하부 z 검증)
    const colH2 = ir.meta.floorH - ir.meta.beamD - ir.meta.slabT;
    for (const part of parts) {
      if (part.role !== 'duct') continue;
      const zTop = part.at.tz - Math.floor(part.at.tz / ir.meta.floorH) * ir.meta.floorH; // 층 내 상대 z
      if (zTop > colH2 - 1e-6) { errs.push(`plenum_band: 덕트 ${part.id} 층내 z ${zTop.toFixed(0)} — 보 밴드 침범`); break; }
    }
  }

  // ①c 스택 표고 닫힌형: 슬래브 z 집합 = 각 레벨의 (레벨базa + colH + beamD)
  const slabZ = new Set(parts.filter(pp => pp._occ.leaf === 'slab').map(pp => pp.at.tz.toFixed(1)));
  if (slabZ.size !== levels) errs.push(`slab_levels: 슬래브 표고 ${slabZ.size}종 ≠ 레벨 ${levels}`);

  // ② BOQ 교차: hierarchyCounts(정의×패턴 곱) = 전개 실측 — 닫힌형 두 개
  const counts = hierarchyCounts(ir);
  const slabTotal = parts.filter(pp => pp._occ.leaf === 'slab').length;
  if (slabTotal !== levels) errs.push(`boq_slab: ${slabTotal} ≠ 레벨 ${levels}`);
  const colTotal = parts.filter(pp => pp._occ.leaf === 'col').length;
  const colExpected = (counts.get('column') ?? 0) + (counts.get('lobby_column') ?? 0);
  if (colTotal !== colExpected) errs.push(`boq_column: 전개 ${colTotal} ≠ 패턴곱 ${colExpected}`);

  // ③ 풋프린트 포함: 모든 부품 AABB 시작점이 풋프린트+여유 안.
  //    facade 시스템은 설계상 슬래브 엣지 밖 밴드(cwBand)를 점유 — 그만큼 확장.
  const [W, D] = ir.meta.footprint;
  const cwMargin = ir.meta.withCurtainWall ? (ir.meta.cwBand ?? 0) + (ir.meta.cwMullionW ?? 0) : 0;
  for (const part of parts) {
    const { tx = 0, ty = 0 } = part.at;
    const margin = part.system === 'facade' ? ir.meta.colW + cwMargin : ir.meta.colW;
    if (tx < -margin || ty < -margin || tx > W + cwMargin || ty > D + cwMargin) {
      errs.push(`footprint: ${part.id} (${tx.toFixed(0)},${ty.toFixed(0)}) 풋프린트 밖`);
      break;
    }
  }

  // ④ B-2 커튼월 게이트: (a) 멀리언 수직 연속 — 평면 위치별 발생 = 기준층 수
  //    (b) 파사드 커버리지 — 층·파사드별 패널/멀리언 개수 = 모듈 산식(전개 실측)
  if (ir.meta.withCurtainWall) {
    const typical = ir.meta.typicalCount ?? floors;
    const mullXY = new Map();
    for (const part of parts) {
      if (part.role !== 'cw_mullion') continue;
      const key = `${part.at.tx.toFixed(1)},${part.at.ty.toFixed(1)}`;
      mullXY.set(key, (mullXY.get(key) ?? 0) + 1);
    }
    for (const [key, n] of mullXY) {
      if (n !== typical) { errs.push(`cw_mullion_continuity: (${key}) 발생 ${n} ≠ 기준층 ${typical} — 수직 그리드 단절`); break; }
    }
    const L_x = nx * ir.meta.bayX + ir.meta.colW;
    const nModX = Math.max(1, Math.round(L_x / (ir.meta.cwModule ?? 1500)));
    const panelsPerFloor = parts.filter(pp => pp.role === 'cw_panel').length / typical;
    const L_y = ny * ir.meta.bayY + ir.meta.colW - 2 * (ir.meta.cwBand ?? 0);
    const nModY = Math.max(1, Math.round(L_y / (ir.meta.cwModule ?? 1500)));
    const expectedPanels = 2 * nModX + 2 * nModY;
    if (Math.abs(panelsPerFloor - expectedPanels) > 1e-9) {
      errs.push(`cw_coverage: 층당 패널 ${panelsPerFloor} ≠ 모듈 산식 ${expectedPanels}`);
    }
    const mullionsPerFloor = parts.filter(pp => pp.role === 'cw_mullion').length / typical;
    const expectedMullions = 2 * (nModX + 1) + 2 * (nModY + 1);
    if (Math.abs(mullionsPerFloor - expectedMullions) > 1e-9) {
      errs.push(`cw_coverage: 층당 멀리언 ${mullionsPerFloor} ≠ 산식 ${expectedMullions}`);
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
