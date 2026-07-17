/**
 * domain-assemblies.mjs — 비-기계 분야 **결정론 어셈블리 템플릿** (#6 타분야 3D).
 *
 * 프리셋(단품 compose intent)과 달리 여기는 **어셈블리(parts[] type·params·at·material·role)**
 * 를 만든다 → buildAssembly → 설계 패키지(GA 3D 계통색·2D GA·구조·BOQ·Dossier)가 그대로
 * 이어진다. 기계 스키드와 같은 파이프라인, 다른 분야(건축 RC·조경 목구조·인테리어 레이아웃).
 *
 * 원칙: 파라미터→형상은 100% 결정론(AI 없음). 재질(material)·역할(role)을 부품에 태깅해
 * 질량(DENSITY)·계통색(ROLE_COL)·BOQ(부피/재적)가 분야에 맞게 산출된다.
 * 검증: 각 템플릿 기본값은 self-test 로 게이트·간섭 0 을 상시 보증.
 */

const num = (v, d) => (Number.isFinite(v) ? v : d);
const P = (id, type, params, at = {}, material, role) => ({ id, type, params, at, ...(material ? { material } : {}), ...(role ? { role } : {}) });

/** 건축: RC 라멘 골조 — 다베이·다층(B3). 기둥 그리드 + 층별 외곽·내부 보 + 층별 슬래브. */
function rcFrameAssembly(p) {
  const bx = num(p.bayX, 6000), by = num(p.bayY, 6000), H = num(p.storyH, 3300);
  const nbx = Math.max(1, Math.min(4, Math.round(num(p.baysX, 1))));
  const nby = Math.max(1, Math.min(4, Math.round(num(p.baysY, 1))));
  const nf = Math.max(1, Math.min(20, Math.round(num(p.floors, 1))));
  const c = num(p.colSize, 500);            // 기둥 c×c
  const bw = num(p.beamWidth, 300), bh = num(p.beamHeight, 600);
  const st = num(p.slabThk, 150);
  const W = nbx * bx, D = nby * by;
  const storyT = H + st;                    // 층 피치(기둥+보구간 H, 그 위 슬래브 st)
  const parts = [];
  for (let f = 0; f < nf; f++) {
    const z0 = f * storyT;
    // 기둥 그리드 (nbx+1)×(nby+1)
    for (let i = 0; i <= nbx; i++) for (let j = 0; j <= nby; j++) {
      parts.push(P(`col_f${f + 1}_${i}_${j}`, 'box', { width: c, depth: c, height: H }, { tx: i * bx - c / 2, ty: j * by - c / 2, tz: z0 }, 'concrete', 'column'));
    }
    // 보 — X방향 (nby+1)행 × nbx스팬, Y방향 (nbx+1)열 × nby스팬. 보 상단 = 슬래브 하단
    const bz = z0 + H - bh;
    for (let j = 0; j <= nby; j++) for (let i = 0; i < nbx; i++) {
      parts.push(P(`bmX_f${f + 1}_${i}_${j}`, 'box', { width: bx - c, depth: bw, height: bh }, { tx: i * bx + c / 2, ty: j * by - bw / 2, tz: bz }, 'concrete', 'beam'));
    }
    for (let i = 0; i <= nbx; i++) for (let j = 0; j < nby; j++) {
      parts.push(P(`bmY_f${f + 1}_${i}_${j}`, 'box', { width: bw, depth: by - c, height: bh }, { tx: i * bx - bw / 2, ty: j * by + c / 2, tz: bz }, 'concrete', 'beam'));
    }
    // 슬래브 — 층당 1장 (외곽 기둥 반폭 여유)
    parts.push(P(`slab_f${f + 1}`, 'box', { width: W + c, depth: D + c, height: st }, { tx: -c / 2, ty: -c / 2, tz: z0 + H }, 'concrete', 'slab'));
  }
  // 우수 입상관(MEP 확산) — 지붕→지상 수직 1본. 원시좌표 배관(스텁 없음), 층 슬래브 관통은
  // 전부 슬리브 명세로 자동 산출된다. 위치=코너 기둥에서 이격(기둥 c/2+450), 관경 DN100 개산.
  const topZ = (nf - 1) * storyT + H + st;
  const rx = W - c / 2 - 450, ry = c / 2 + 450;
  const pipes = [{ id: 'rain_riser', from: [rx, ry, topZ + 150], to: [rx, ry, 0], d: 100, service: 'drain' }];
  return {
    name: `RC 라멘 골조 (${nbx}×${nby}베이 ${nf}층)`, domain: 'building', parts, pipes,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    frameGrid: { baysX: nbx, baysY: nby, floors: nf, bayX: bx, bayY: by, storyH: H, slabThk: st },
  };
}

/** 조경: 목재 파고라 — 기둥4 + 거더2 + 서까래 N. 부재=방부목(timber). */
function pergolaAssembly(p) {
  const W = num(p.width, 3600), D = num(p.depth, 3000), H = num(p.height, 2400);
  const post = num(p.postSize, 120);        // 기둥 post×post
  const gw = num(p.girderWidth, 60), gh = num(p.girderHeight, 180);
  const rw = num(p.rafterWidth, 45), rh = num(p.rafterHeight, 120);
  const nR = Math.max(2, Math.round(num(p.rafterCount, 7)));
  const parts = [];
  [[0, 0], [W, 0], [0, D], [W, D]].forEach(([x, y], i) =>
    parts.push(P(`post${i + 1}`, 'box', { width: post, depth: post, height: H }, { tx: x - post / 2, ty: y - post / 2, tz: 0 }, 'timber', 'column')));
  // 거더 2 — X방향, 기둥 상단, 양끝 300 오버행
  const oh = 300;
  for (const [i, y] of [0, D].entries())
    parts.push(P(`girder${i + 1}`, 'box', { width: W + 2 * oh, depth: gw, height: gh }, { tx: -oh, ty: y - gw / 2, tz: H }, 'timber', 'beam'));
  // 서까래 N — Y방향, 거더 위, 등간격
  for (let k = 0; k < nR; k++) {
    const x = (W / (nR - 1)) * k;
    parts.push(P(`rafter${k + 1}`, 'box', { width: rw, depth: D + 2 * oh, height: rh }, { tx: x - rw / 2, ty: -oh, tz: H + gh }, 'timber', 'joist'));
  }
  // 관수 라인(MEP 확산) — 지중 인입(원시좌표)→입상→서까래 상부 살수 런. 유량·헤드=사양 입력
  // (landscape-check 관수 체인이 pump_head 로 전양정·동력 산출 — 지어내지 않음).
  const irr = Math.round(num(p.irrigation, 1));
  const pipes = irr > 0 ? [{ id: 'irr_line', from: [-500, D / 2, -300], to: [W + oh + 100, D / 2, H + gh + rh + 80], d: 25, service: 'supply' }] : [];
  return { name: '목재 파고라', domain: 'landscape', parts, ...(pipes.length ? { pipes } : {}) };
}

/** 조경: 목재 데크 — 장선 N(Y방향) + 데크보드 M(X방향, 5mm 갭). */
function timberDeckAssembly(p) {
  const W = num(p.width, 3600), D = num(p.depth, 2400);
  // 장선 기본 45×140 — 스팬 2.4m·주거활하중에서 timber_beam 검토 통과 단면(45×90은 휨 초과)
  const jw = num(p.joistWidth, 45), jh = num(p.joistHeight, 140);
  const spacing = num(p.joistSpacing, 450);
  const bw = num(p.boardWidth, 120), bt = num(p.boardThk, 21), gap = 5;
  const parts = [];
  const nJ = Math.max(2, Math.floor(W / spacing) + 1);
  for (let k = 0; k < nJ; k++) {
    const x = Math.min((W - jw) * (k / (nJ - 1)), W - jw);
    parts.push(P(`joist${k + 1}`, 'box', { width: jw, depth: D, height: jh }, { tx: x, ty: 0, tz: 0 }, 'timber', 'joist'));
  }
  const nB = Math.floor((D + gap) / (bw + gap));
  for (let k = 0; k < nB; k++)
    parts.push(P(`board${k + 1}`, 'box', { width: W, depth: bw, height: bt }, { tx: 0, ty: k * (bw + gap), tz: jh }, 'timber', 'deck'));
  return { name: '목재 데크', domain: 'landscape', parts, floorAreaM2: +((W * D) / 1e6).toFixed(2) };
}

/** 인테리어: 카페 룸 — 바닥 + 벽 4면(출입문·창) + 카운터 + 테이블 그리드. furniture·exits 메타로 피난 검증 연동. */
function cafeRoomAssembly(p) {
  const W = num(p.width, 8000), D = num(p.depth, 6000);
  const rows = Math.max(1, Math.round(num(p.tableRows, 2)));
  const cols = Math.max(1, Math.round(num(p.tableCols, 3)));
  const seatsPer = Math.max(1, Math.round(num(p.seatsPerTable, 4)));
  const wallT = 150, wallH = 2700, doorW = num(p.doorWidth, 1000), doorH = 2100;
  const nExits = Math.max(1, Math.min(2, Math.round(num(p.exitCount, 1))));
  const parts = [P('floor', 'box', { width: W, depth: D, height: 100 }, { tz: -100 }, 'concrete', 'floor')];
  // 벽 4면 (바닥 외곽 바깥쪽) — 전면(y=0)에 출입문, 전면 좌측에 창. exitCount=2면 후면에 비상구.
  const doorX = W / 2 - doorW / 2;
  parts.push(P('wall_front', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: doorX, w: doorW, h: doorH, sill: 0 }, { x: 400, w: Math.max(600, doorX - 800), h: 1500, sill: 900 }] }, { tx: 0, ty: -wallT, tz: 0 }, 'concrete', 'wall'));
  const backOpenings = nExits === 2 ? [{ x: W - 1300, w: 900, h: 2100, sill: 0 }] : [];
  parts.push(P('wall_back', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, ...(backOpenings.length ? { openings: backOpenings } : {}) }, { tx: 0, ty: D, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_left', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: 0, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_right', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: W + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 카운터 — 통짜 박스는 재적 과대(날조) → 상판+전면+측판 패널 구조
  const cw = Math.min(3100, W * 0.4), cx = W - cw - 400, cy = D - 1100;
  parts.push(P('counter_top', 'box', { width: cw, depth: 800, height: 40 }, { tx: cx, ty: cy, tz: 1010 }, 'timber', 'counter'));
  parts.push(P('counter_front', 'box', { width: cw, depth: 18, height: 1010 }, { tx: cx, ty: cy, tz: 0 }, 'timber', 'counter'));
  parts.push(P('counter_sideL', 'box', { width: 18, depth: 782, height: 1010 }, { tx: cx, ty: cy + 18, tz: 0 }, 'timber', 'counter'));
  parts.push(P('counter_sideR', 'box', { width: 18, depth: 782, height: 1010 }, { tx: cx + cw - 18, ty: cy + 18, tz: 0 }, 'timber', 'counter'));
  // 테이블 — 상판 30t + 다리 4 (통짜 블록 재적 과대 방지)
  // 자유 배치(B 인테리어 에디터): customFurniture=[{kind:'table2'|'table4'|'sofa', x, y}] 입력 시
  // 그리드 대신 커스텀 배치 — 좌표는 실내 원점 기준 mm(형상·피난 검증이 그대로 추종).
  const CATALOG = {
    table2: { w: 700, d: 700, seats: 2, name: '2인 테이블' },
    table4: { w: 1200, d: 1200, seats: 4, name: '4인 테이블' },
    sofa: { w: 1800, d: 850, seats: 3, name: '소파' },
  };
  const custom = Array.isArray(p.customFurniture) ? p.customFurniture.filter((f) => CATALOG[f.kind] && Number.isFinite(f.x) && Number.isFinite(f.y)).slice(0, 40) : null;
  let nT = 0, seatSum = 0;
  if (custom) {
    for (const [i, f] of custom.entries()) {
      const c = CATALOG[f.kind];
      const fx = Math.max(0, Math.min(W - c.w, f.x)), fy = Math.max(0, Math.min(D - c.d, f.y));
      parts.push(P(`cf_${i}_top`, 'box', { width: c.w, depth: c.d, height: 30 }, { tx: fx, ty: fy, tz: 720 }, 'timber', 'table'));
      for (const [k, [lx, ly]] of [[60, 60], [c.w - 110, 60], [60, c.d - 110], [c.w - 110, c.d - 110]].entries())
        parts.push(P(`cf_${i}_leg${k + 1}`, 'box', { width: 50, depth: 50, height: 720 }, { tx: fx + lx, ty: fy + ly, tz: 0 }, 'timber', 'table'));
      nT++; seatSum += c.seats;
    }
  } else {
    const zoneW = W - 1600, zoneD = D - 2400;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const tx = 800 + (zoneW / cols) * (c + 0.5) - 600, ty = 800 + (zoneD / rows) * (r + 0.5) - 600;
      parts.push(P(`table_${r}_${c}_top`, 'box', { width: 1200, depth: 1200, height: 30 }, { tx, ty, tz: 720 }, 'timber', 'table'));
      for (const [k, [lx, ly]] of [[100, 100], [1050, 100], [100, 1050], [1050, 1050]].entries())
        parts.push(P(`table_${r}_${c}_leg${k + 1}`, 'box', { width: 50, depth: 50, height: 720 }, { tx: tx + lx, ty: ty + ly, tz: 0 }, 'timber', 'table'));
    }
    nT = rows * cols;
  }
  return {
    name: '카페 레이아웃', domain: 'interior', parts,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    // 피난 검증용 메타 — 출입구(문) 위치·폭 (형상과 동일 소스에서 결정론 생성)
    exits: [
      { x: doorX + doorW / 2, y: 0, widthMm: doorW },
      ...(nExits === 2 ? [{ x: W - 850, y: D, widthMm: 900 }] : []),
    ],
    roomBounds: { W, D },
    furniture: [
      { id: 'table', name: '테이블', count: nT, seats: 0 },
      { id: 'chair', name: '의자', count: custom ? seatSum : nT * seatsPer, seats: 1 },
      { id: 'counter', name: '서비스 카운터', count: 1, seats: 0 },
    ],
    ...(custom ? { customFurniture: custom } : {}),
  };
}

/** 토목: 옹벽 연장 구간(C2) — 벽체+저판 box 분해. civilTakeoff 메타로 수량 룰엔진(터파기·거푸집·되메우기) 연동. */
function retainingWallRunAssembly(p) {
  const H = num(p.H, 3000), baseW = num(p.baseWidth, 2000), baseT = num(p.baseThickness, 400);
  const stemT = num(p.stemThickness, 300), toe = num(p.toeLength, 600), L = num(p.length, 10000);
  const parts = [
    P('base', 'box', { width: baseW, depth: L, height: baseT }, { tx: 0, ty: 0, tz: 0 }, 'concrete', 'base'),
    P('stem', 'box', { width: stemT, depth: L, height: H - baseT }, { tx: toe, ty: 0, tz: baseT }, 'concrete', 'wall'),
  ];
  return {
    name: '옹벽 연장 구간', domain: 'civil', parts,
    // 검증(C1)·수량(룰엔진) 공용 메타 — m 단위, retaining-wall-stability·takeoff 동일 기하
    retainingWall: { H: H / 1000, stemThickness: stemT / 1000, baseWidth: baseW / 1000, baseThickness: baseT / 1000, toeLength: toe / 1000, length: L / 1000 },
    civilTakeoff: [{ id: 'rw1', type: 'retaining_wall', H: H / 1000, stemThickness: stemT / 1000, baseWidth: baseW / 1000, baseThickness: baseT / 1000, length: L / 1000 }],
  };
}

/** 거더교 (단순경간): 바닥판 + I형 거더 N본 + 가로보 3열. role: deck/girder/crossbeam */
function girderBridgeAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const span = num(p.span, 30000), n = Math.max(2, Math.min(8, Math.round(num(p.nGirders, 4))));
  const s = num(p.girderSpacing, 2500), H = num(p.girderH, 1800), dt = num(p.deckThk, 240);
  const oh = num(p.overhang, 1100);
  const deckW = s * (n - 1) + 2 * oh;
  // I형 단면 비례(관례 형상 — 구조 치수는 체인에서 검토): 상부플랜지 0.35H·하부 0.30H 폭, 플랜지 두께 0.12H, 복부 0.10H
  const topW = Math.round(0.35 * H), botW = Math.round(0.30 * H);
  const ft = Math.round(0.12 * H), webT = Math.max(200, Math.round(0.10 * H));
  const webH = H - 2 * ft;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push({
      id: `girder-${i + 1}`, role: 'girder', type: 'i_girder', material: 'concrete',
      params: { length: span, topW, topT: ft, webT, webH, botW, botT: ft },
      at: { tx: 0, ty: oh + i * s - Math.max(topW, botW) / 2, tz: 0 },
    });
  }
  // 가로보(단부 2 + 중앙 1)
  for (const [k, x] of [[0, 0], [1, span / 2 - 150], [2, span - 300]]) {
    for (let i = 0; i < n - 1; i++) {
      parts.push({
        id: `cross-${k}-${i}`, role: 'crossbeam', type: 'box', material: 'concrete',
        params: { width: 300, depth: s - Math.max(topW, botW), height: Math.round(H * 0.6) },
        at: { tx: x, ty: oh + i * s + Math.max(topW, botW) / 2, tz: Math.round(H * 0.2) },
      });
    }
  }
  parts.push({
    id: 'deck', role: 'deck', type: 'box', material: 'concrete',
    params: { width: span, depth: deckW, height: dt },
    at: { tx: 0, ty: 0, tz: H },
  });
  return {
    name: `거더교 ${span / 1000}m×${n}거더`, domain: 'bridge', kind: 'assembly', parts,
    bridgeMeta: { span, nGirders: n, girderSpacing: s, girderH: H, deckThk: dt, overhang: oh, deckW,
      section: { topW, topT: ft, webT, webH, botW, botT: ft } },
  };
}

/** 다실: 2실+내부벽(문) — 피난 BFS가 내부 문 통과(개구 인식 차단) */
function twoRoomAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 12000), D = num(p.depth, 6000);
  const w1 = Math.min(W - 3000, Math.max(3000, num(p.room1W, 7000)));
  const doorW = num(p.doorWidth, 1000), innerDoorW = num(p.innerDoorWidth, 900);
  const wallT = 150, wallH = 2700;
  const parts = [P('floor', 'box', { width: W, depth: D, height: 100 }, { tz: -100 }, 'concrete', 'floor')];
  const doorX = w1 / 2 - doorW / 2;
  parts.push(P('wall_front', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: doorX, w: doorW, h: 2100, sill: 0 }] }, { tx: 0, ty: -wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_back', 'wall_with_openings', { length: W, thickness: wallT, height: wallH }, { tx: 0, ty: D, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_left', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: 0, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_right', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: W + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 내부벽 (rz=90, x=w1) — 중앙에 문
  parts.push(P('wall_inner', 'wall_with_openings', { length: D, thickness: wallT, height: wallH, openings: [{ x: D / 2 - innerDoorW / 2, w: innerDoorW, h: 2100, sill: 0 }] }, { tx: w1 + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 실2에 테이블 2개(점유 확인용)
  // ⚠버그 이력: 수동 인덱스 배열에 .entries() 이중 랩핑 → ty 가 배열(NaN AABB) — supportCheck unknown 가드가 검출
  for (const [i, [tx2, ty2]] of [[0, [w1 + 1000, 1200]], [1, [w1 + 1000, 3600]]]) {
    parts.push(P('t' + i + '_top', 'box', { width: 1200, depth: 1200, height: 30 }, { tx: tx2, ty: ty2, tz: 720 }, 'timber', 'table'));
    // 상판만 있으면 supportCheck 부유(정당) — cafe_room 과 동일하게 상판+다리 분해(통짜재적 날조 방지 원칙 공유)
    for (const [k, [lx, ly]] of [[100, 100], [1050, 100], [100, 1050], [1050, 1050]].entries())
      parts.push(P(`t${i}_leg${k + 1}`, 'box', { width: 50, depth: 50, height: 720 }, { tx: tx2 + lx, ty: ty2 + ly, tz: 0 }, 'timber', 'table'));
  }
  return {
    name: '2실 평면', domain: 'interior', kind: 'assembly', parts,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    exits: [{ x: doorX + doorW / 2, y: 0, widthMm: doorW }],
    roomBounds: { W, D },
    furniture: [{ id: 'table', name: '테이블', count: 2, seats: 0 }, { id: 'chair', name: '의자', count: 8, seats: 1 }],
    multiRoom: { rooms: 2, innerWallX: w1 },
  };
}

/** 욕실 설비(변기·세면대·욕조 — 개산 박스, role 태깅. 욕조는 공간이 되면만 — 정직) */
function bathFixtures(prefix, bx, by, bathW, bathD) {
  const parts = [
    P(prefix + '_toilet', 'box', { width: 400, depth: 650, height: 420 }, { tx: bx + 120, ty: by + bathD - 770, tz: 0 }, 'steel', 'toilet'),
    P(prefix + '_basin', 'box', { width: 500, depth: 420, height: 820 }, { tx: bx + 120, ty: by + 120, tz: 0 }, 'steel', 'basin'),
  ];
  if (bathW >= 1700 && bathD >= 1500) {
    parts.push(P(prefix + '_tub', 'box', { width: 700, depth: bathD - 300, height: 550 }, { tx: bx + bathW - 820, ty: by + 150, tz: 0 }, 'steel', 'bathtub'));
  }
  return parts;
}

/**
 * 자유 배치 가구(customFurniture) — 인테리어 에디터 드래그 산출물을 부품으로.
 * cafe_room 의 CATALOG 패턴을 유닛 템플릿에도 공유: 배치 가구는 보행 BFS 장애물이자
 * **배관 라우터 장애물**이 되어, 드래그 → 디바운스 리빌드 시 MEP 가 자동 재라우팅된다.
 */
const FURN_CATALOG = { table2: { w: 700, d: 700 }, table4: { w: 1200, d: 1200 }, sofa: { w: 1800, d: 850 } };
function customFurnitureParts(p, limit = 40) {
  const custom = Array.isArray(p.customFurniture) ? p.customFurniture.filter((f) => FURN_CATALOG[f.kind] && Number.isFinite(f.x) && Number.isFinite(f.y)).slice(0, limit) : [];
  const parts = [];
  for (const [i, f] of custom.entries()) {
    const c = FURN_CATALOG[f.kind];
    if (f.kind === 'sofa') { parts.push(P(`cf_${i}_sofa`, 'box', { width: c.w, depth: c.d, height: 750 }, { tx: f.x, ty: f.y, tz: 0 }, 'timber', 'sofa')); continue; }
    parts.push(P(`cf_${i}_top`, 'box', { width: c.w, depth: c.d, height: 30 }, { tx: f.x, ty: f.y, tz: 720 }, 'timber', 'table'));
    for (const [k, [lx, ly]] of [[60, 60], [c.w - 110, 60], [60, c.d - 110], [c.w - 110, c.d - 110]].entries())
      parts.push(P(`cf_${i}_leg${k + 1}`, 'box', { width: 50, depth: 50, height: 720 }, { tx: f.x + lx, ty: f.y + ly, tz: 0 }, 'timber', 'table'));
  }
  return parts;
}

/**
 * 욕실 MEP 배관(급수·배수) — 기계 pipes[] 어휘의 인테리어 적용(위시빌더 배관 일반화).
 * PS 입상관(스택)을 욕실 밖 벽 뒤에 두고 기구별 배수·급수를 "연결 선언"만 한다 —
 * 경로는 결정론 라우터(autoRoutePipes)가 잡고, 벽 관통은 위반이 아니라 **슬리브 명세**로
 * 자동 산출된다(passable role). GA 3D 계통색·2D 폴리라인·DXF PIPE 레이어에 그대로 반영.
 * ⚠관경·접속 위치=개산 표기. 구배·트랩·통기관 미모델(정직 한계) — DFU 산정은 drainage_vent 계산기.
 */
function bathMEP(prefix, bx, by, bathW, bathD, { hasTub = false, wallT = 150, sinkId = null } = {}) {
  const sx = bx + bathW + wallT + 250, sy = by + bathD - 300; // 욕실 수직벽 바깥(PS 샤프트 위치)
  const parts = [P('ps_stack', 'cylinder', { diameter: 100, length: 2700 }, { tx: sx, ty: sy, tz: 0 }, 'PVC', 'stack')];
  // 진입면·z 규칙: ①기구마다 스택 진입면을 달리해 코리도 하강 xy 가 겹치지 않게(동일면
  // 2라인=하강 수직선 중첩→교차 위반) ②진입 z=기구 포트 z 정렬(미세 z단차는 엘보 후퇴가
  // 안 되는 초단 조그가 됨 — 라우터가 정직 거부하므로 선언 단계에서 제거)
  const pipes = [
    { id: 'drain_toilet', from: `${prefix}_toilet.x+`, to: { part: 'ps_stack', face: 'x-', offset: [0, 0, -1140] }, d: 75, service: 'drain' },
    { id: 'drain_basin', from: `${prefix}_basin.x+`, to: { part: 'ps_stack', face: 'y-', offset: [0, 0, -940] }, d: 50, service: 'drain' },
    // 급수 입상 — 지면 인입(원시좌표, PS 샤프트 병설 y+측)에서 상승. 스택 z+ 포트 공유는
    // 통기와 수직 중첩(교차 위반)·x+측은 싱크 하강선과 근접이라 y+ 후면으로 분리.
    { id: 'supply_basin', from: [sx, sy + 200, 0], to: `${prefix}_basin.z+`, d: 20, service: 'supply' },
    // 신정통기 — 스택 상단 연장(지붕 위 대기 개방 개념). DN65 = §4.3(1) 하한(DN100의 1/2 초과).
    { id: 'vent_stack', from: 'ps_stack.z+', to: [sx, sy, 3400], d: 65, service: 'vent' },
  ];
  if (hasTub) pipes.push({ id: 'drain_tub', from: `${prefix}_tub.x+`, to: { part: 'ps_stack', face: 'y-', offset: [0, 0, -1075] }, d: 50, service: 'drain' });
  if (sinkId) pipes.push({ id: 'drain_sink', from: `${sinkId}.z-`, to: { part: 'ps_stack', face: 'x+', offset: [0, 0, -900] }, d: 50, service: 'drain' });
  return { parts, pipes };
}

/**
 * 원룸(스튜디오) 유닛(2026-07-16 후속): 단일 공간 + 욕실 + 주방 카운터·침대·책상.
 * 창호 = wall_with_openings의 sill 있는 개구부(후면 창 1). 설비 = bathFixtures.
 */
function studioUnitAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 6000), D = num(p.depth, 4500);
  const doorW = num(p.doorWidth, 1000), winW = Math.min(W - 2000, num(p.windowWidth, 1500));
  const bathW = Math.min(W - 2500, Math.max(1400, num(p.bathW, 1600)));
  const bathD = Math.min(D - 1800, Math.max(1200, num(p.bathD, 1400)));
  const wallT = 150, wallH = 2700;
  const parts = [P('floor', 'box', { width: W, depth: D, height: 100 }, { tz: -100 }, 'concrete', 'floor')];
  const entryX = W * 0.7 - doorW / 2;
  parts.push(P('wall_front', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: entryX, w: doorW, h: 2100, sill: 0 }] }, { tx: 0, ty: -wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_back', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: W - winW - 500, w: winW, h: 1200, sill: 900 }] }, { tx: 0, ty: D, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_left', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: 0, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_right', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: W + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 욕실(좌후 코너)
  parts.push(P('wall_bath_h', 'wall_with_openings', { length: bathW, thickness: wallT, height: wallH, openings: [{ x: bathW / 2 - 400, w: 800, h: 2100, sill: 0 }] }, { tx: 0, ty: D - bathD - wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_bath_v', 'wall_with_openings', { length: bathD, thickness: wallT, height: wallH }, { tx: bathW + wallT, ty: D - bathD, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(...bathFixtures('bath', 0, D - bathD, bathW, bathD));
  // 주방 카운터(+싱크) · 침대 · 책상
  parts.push(P('kitchen_counter', 'box', { width: 1800, depth: 600, height: 850 }, { tx: 300, ty: 300, tz: 0 }, 'timber', 'counter'));
  parts.push(P('sink', 'box', { width: 700, depth: 450, height: 180 }, { tx: 500, ty: 380, tz: 850 }, 'steel', 'sink'));
  // 간섭 이력: 침대(W-1900)·책상(W-1600)이 y 700~1000 구간서 관통 — 침대를 좌측으로 이동(그물 검출)
  parts.push(P('bed', 'box', { width: 1500, depth: 2000, height: 450 }, { tx: W - 3500, ty: D - bathD - 2400, tz: 0 }, 'timber', 'bed'));
  parts.push(P('desk', 'box', { width: 1200, depth: 600, height: 730 }, { tx: W - 1600, ty: 400, tz: 0 }, 'timber', 'table'));
  // MEP 배관(급수·배수) — PS 스택 + 기구 연결 선언(경로=결정론 라우터·벽 관통=슬리브 명세)
  parts.push(...customFurnitureParts(p)); // 에디터 드래그 가구 = 보행·배관 장애물(자동 재라우팅)
  const mep = bathMEP('bath', 0, D - bathD, bathW, bathD, { hasTub: bathW >= 1700 && bathD >= 1500, wallT, sinkId: 'sink' });
  parts.push(...mep.parts);
  return {
    name: '원룸 유닛', domain: 'interior', kind: 'assembly', parts, pipes: mep.pipes,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    exits: [{ x: entryX + doorW / 2, y: 0, widthMm: doorW }],
    roomBounds: { W, D },
    furniture: [
      { id: 'bed', name: '침대', count: 1, seats: 0 }, { id: 'table', name: '책상', count: 1, seats: 1 },
      { id: 'counter', name: '주방 카운터', count: 1, seats: 0 }, { id: 'sink', name: '싱크', count: 1, seats: 0 },
      { id: 'toilet', name: '변기', count: 1, seats: 0 }, { id: 'basin', name: '세면대', count: 1, seats: 0 },
    ],
    multiRoom: { rooms: 2, innerWallX: bathW },
  };
}

/**
 * 3룸 유닛(2026-07-16 후속): 방3(우측 2 + 좌후 1) + LDK + 욕실 + 설비·창호.
 */
function threeRoomUnitAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 11000), D = num(p.depth, 7800);
  const bedW = Math.min(W - 4500, Math.max(2800, num(p.bedZoneW, 3600)));
  const ldkW = W - bedW;
  const r3W = Math.min(ldkW - 2600, Math.max(2400, num(p.room3W, 3000)));
  const r3D = Math.min(D - 3000, Math.max(2400, num(p.room3D, 3300)));
  const doorW = num(p.doorWidth, 1000), inDoorW = num(p.innerDoorWidth, 800);
  const winW = Math.max(900, Math.min(2400, num(p.windowWidth, 1500)));
  const bathW = Math.min(ldkW - r3W - wallGap(), Math.max(1400, num(p.bathW, 1800)));
  const bathD = Math.min(r3D, Math.max(1200, num(p.bathD, 1600)));
  function wallGap() { return 800; }
  const wallT = 150, wallH = 2700;
  const parts = [P('floor', 'box', { width: W, depth: D, height: 100 }, { tz: -100 }, 'concrete', 'floor')];
  const entryX = (r3W + ldkW) / 2 - doorW / 2;
  // 외벽 — 전면(현관+방1 창), 후면(방3 창+방2 창)
  parts.push(P('wall_front', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [
    { x: entryX, w: doorW, h: 2100, sill: 0 },
    { x: ldkW + bedW / 2 - winW / 2, w: winW, h: 1200, sill: 900 },
  ] }, { tx: 0, ty: -wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_back', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [
    { x: r3W / 2 - winW / 2, w: winW, h: 1200, sill: 900 },
    { x: ldkW + bedW / 2 - winW / 2, w: winW, h: 1200, sill: 900 },
  ] }, { tx: 0, ty: D, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_left', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: 0, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_right', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: W + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 우측 침실 구역(방1 전면·방2 후면) — 수직벽 문2 + 분할벽
  parts.push(P('wall_bedzone', 'wall_with_openings', { length: D, thickness: wallT, height: wallH, openings: [
    { x: D * 0.25 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 },
    { x: D * 0.75 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 },
  ] }, { tx: ldkW + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_bed_div', 'wall_with_openings', { length: bedW - wallT, thickness: wallT, height: wallH }, { tx: ldkW + wallT, ty: D / 2, tz: 0 }, 'concrete', 'wall'));
  // 방3(좌후 코너) — 수평벽(문) + 수직벽
  parts.push(P('wall_r3_h', 'wall_with_openings', { length: r3W, thickness: wallT, height: wallH, openings: [{ x: r3W / 2 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 }] }, { tx: 0, ty: D - r3D - wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_r3_v', 'wall_with_openings', { length: r3D, thickness: wallT, height: wallH }, { tx: r3W + wallT, ty: D - r3D, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 욕실(방3 오른쪽) — 수평벽(문) + 수직벽
  const bathX = r3W + wallT + 400;
  parts.push(P('wall_bath_h', 'wall_with_openings', { length: bathW, thickness: wallT, height: wallH, openings: [{ x: bathW / 2 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 }] }, { tx: bathX, ty: D - bathD - wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_bath_vl', 'wall_with_openings', { length: bathD, thickness: wallT, height: wallH }, { tx: bathX, ty: D - bathD, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_bath_vr', 'wall_with_openings', { length: bathD, thickness: wallT, height: wallH }, { tx: bathX + bathW + wallT, ty: D - bathD, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(...bathFixtures('bath', bathX, D - bathD, bathW, bathD));
  // 가구·설비 — 침대3·소파·식탁·주방 카운터+싱크
  parts.push(P('bed1', 'box', { width: 1500, depth: 2000, height: 450 }, { tx: ldkW + wallT + 500, ty: 500, tz: 0 }, 'timber', 'bed'));
  parts.push(P('bed2', 'box', { width: 1500, depth: 2000, height: 450 }, { tx: ldkW + wallT + 500, ty: D / 2 + wallT + 500, tz: 0 }, 'timber', 'bed'));
  parts.push(P('bed3', 'box', { width: 1400, depth: 1900, height: 450 }, { tx: 400, ty: D - r3D + 400, tz: 0 }, 'timber', 'bed'));
  parts.push(P('sofa', 'box', { width: 2200, depth: 900, height: 750 }, { tx: 500, ty: 1100, tz: 0 }, 'timber', 'sofa'));
  parts.push(P('dining', 'box', { width: 1400, depth: 800, height: 730 }, { tx: 500, ty: 3000, tz: 0 }, 'timber', 'table'));
  parts.push(P('kitchen_counter', 'box', { width: 2200, depth: 600, height: 850 }, { tx: bathX, ty: D - bathD - wallT - 900, tz: 0 }, 'timber', 'counter'));
  parts.push(P('sink', 'box', { width: 700, depth: 450, height: 180 }, { tx: bathX + 300, ty: D - bathD - wallT - 820, tz: 850 }, 'steel', 'sink'));
  parts.push(...customFurnitureParts(p));
  const mep = bathMEP('bath', bathX, D - bathD, bathW, bathD, { hasTub: bathW >= 1700 && bathD >= 1500, wallT, sinkId: 'sink' });
  parts.push(...mep.parts);
  return {
    name: '3룸 유닛', domain: 'interior', kind: 'assembly', parts, pipes: mep.pipes,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    exits: [{ x: entryX + doorW / 2, y: 0, widthMm: doorW }],
    roomBounds: { W, D },
    furniture: [
      { id: 'bed', name: '침대', count: 3, seats: 0 }, { id: 'sofa', name: '소파', count: 1, seats: 3 },
      { id: 'table', name: '식탁', count: 1, seats: 4 }, { id: 'counter', name: '주방 카운터', count: 1, seats: 0 },
      { id: 'sink', name: '싱크', count: 1, seats: 0 }, { id: 'toilet', name: '변기', count: 1, seats: 0 },
      { id: 'basin', name: '세면대', count: 1, seats: 0 },
    ],
    multiRoom: { rooms: 5, innerWallX: ldkW },
  };
}

/**
 * 주거 아파트 유닛(2026-07-16 — "카페 말고 집도"): 방2 + 거실·주방(LDK) + 욕실.
 * two_room(벽·문)·cafe_room(가구 점유) 패턴 결합 — 외벽4·현관문·침실구역 수직벽(문2)·
 * 침실 분할벽·욕실 구획(문1) + 가구(침대2·소파·식탁·주방카운터, 보행 점유물).
 * interior-check 호환 메타(roomBounds·exits·furniture) 동봉 → 피난동선 검토 그대로 적용.
 */
function apartmentUnitAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 9000), D = num(p.depth, 7200);
  const bedW = Math.min(W - 3000, Math.max(2600, num(p.bedZoneW, 3600)));
  const ldkW = W - bedW;
  const doorW = num(p.doorWidth, 1000), inDoorW = num(p.innerDoorWidth, 800);
  const bathW = Math.min(ldkW - 800, Math.max(1400, num(p.bathW, 1800)));
  const bathD = Math.min(D - 2000, Math.max(1200, num(p.bathD, 1600)));
  const winW = Math.max(900, Math.min(2400, num(p.windowWidth, 1500))); // 창호(sill 개구부)
  const wallT = 150, wallH = 2700;
  const parts = [P('floor', 'box', { width: W, depth: D, height: 100 }, { tz: -100 }, 'concrete', 'floor')];
  const entryX = ldkW / 2 - doorW / 2;
  // 외벽 + 현관문(전면) + 창호(침실1 전면·침실2 후면 — sill 900 개구부)
  parts.push(P('wall_front', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: entryX, w: doorW, h: 2100, sill: 0 }, { x: ldkW + bedW / 2 - winW / 2, w: winW, h: 1200, sill: 900 }] }, { tx: 0, ty: -wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_back', 'wall_with_openings', { length: W, thickness: wallT, height: wallH, openings: [{ x: ldkW + bedW / 2 - winW / 2, w: winW, h: 1200, sill: 900 }] }, { tx: 0, ty: D, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_left', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: 0, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(P('wall_right', 'wall_with_openings', { length: D, thickness: wallT, height: wallH }, { tx: W + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 침실 구역 수직벽 — 침실1(전면측)·침실2(후면측) 문 2개
  parts.push(P('wall_bedzone', 'wall_with_openings', { length: D, thickness: wallT, height: wallH, openings: [
    { x: D * 0.25 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 },
    { x: D * 0.75 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 },
  ] }, { tx: ldkW + wallT, ty: 0, tz: 0, rz: 90 }, 'concrete', 'wall'));
  // 침실 분할 수평벽
  parts.push(P('wall_bed_div', 'wall_with_openings', { length: bedW - wallT, thickness: wallT, height: wallH }, { tx: ldkW + wallT, ty: D / 2, tz: 0 }, 'concrete', 'wall'));
  // 욕실(LDK 뒤쪽 코너) — 수평벽(문) + 수직벽
  parts.push(P('wall_bath_h', 'wall_with_openings', { length: bathW, thickness: wallT, height: wallH, openings: [{ x: bathW / 2 - inDoorW / 2, w: inDoorW, h: 2100, sill: 0 }] }, { tx: 0, ty: D - bathD - wallT, tz: 0 }, 'concrete', 'wall'));
  parts.push(P('wall_bath_v', 'wall_with_openings', { length: bathD, thickness: wallT, height: wallH }, { tx: bathW + wallT, ty: D - bathD, tz: 0, rz: 90 }, 'concrete', 'wall'));
  parts.push(...bathFixtures('bath', 0, D - bathD, bathW, bathD)); // 설비(변기·세면대·욕조)
  // 가구(보행 점유물) — 침대2·소파·식탁·주방 카운터
  parts.push(P('bed1', 'box', { width: 1500, depth: 2000, height: 450 }, { tx: ldkW + wallT + 500, ty: 500, tz: 0 }, 'timber', 'bed'));
  parts.push(P('bed2', 'box', { width: 1500, depth: 2000, height: 450 }, { tx: ldkW + wallT + 500, ty: D / 2 + wallT + 500, tz: 0 }, 'timber', 'bed'));
  parts.push(P('sofa', 'box', { width: 2200, depth: 900, height: 750 }, { tx: 500, ty: 1100, tz: 0 }, 'timber', 'sofa'));
  parts.push(P('dining', 'box', { width: 1400, depth: 800, height: 730 }, { tx: 500, ty: 3000, tz: 0 }, 'timber', 'table'));
  parts.push(P('kitchen_counter', 'box', { width: Math.max(1500, ldkW - bathW - 1400), depth: 600, height: 850 }, { tx: 300, ty: D - bathD - wallT - 800, tz: 0 }, 'timber', 'counter'));
  parts.push(P('sink', 'box', { width: 700, depth: 450, height: 180 }, { tx: 500, ty: D - bathD - wallT - 720, tz: 850 }, 'steel', 'sink'));
  parts.push(...customFurnitureParts(p));
  const mep = bathMEP('bath', 0, D - bathD, bathW, bathD, { hasTub: bathW >= 1700 && bathD >= 1500, wallT, sinkId: 'sink' });
  parts.push(...mep.parts);
  return {
    name: '아파트 유닛', domain: 'interior', kind: 'assembly', parts, pipes: mep.pipes,
    floorAreaM2: +((W * D) / 1e6).toFixed(2),
    exits: [{ x: entryX + doorW / 2, y: 0, widthMm: doorW }],
    roomBounds: { W, D },
    furniture: [
      { id: 'bed', name: '침대', count: 2, seats: 0 },
      { id: 'sofa', name: '소파', count: 1, seats: 3 },
      { id: 'table', name: '식탁', count: 1, seats: 4 },
      { id: 'counter', name: '주방 카운터', count: 1, seats: 0 },
      { id: 'sink', name: '싱크', count: 1, seats: 0 }, { id: 'toilet', name: '변기', count: 1, seats: 0 }, { id: 'basin', name: '세면대', count: 1, seats: 0 },
    ],
    multiRoom: { rooms: 4, innerWallX: ldkW },
  };
}

export const ASSEMBLY_TEMPLATES = {
  civil: [
    {
      id: 'retaining_wall_run', labelKo: '옹벽 연장 구간', labelEn: 'Retaining wall run', build: retainingWallRunAssembly,
      params: [
        { name: 'H', labelKo: '벽고(저면~상단)', unit: 'mm', default: 3000, min: 500, max: 8000 },
        { name: 'baseWidth', labelKo: '저판 폭', unit: 'mm', default: 2000, min: 500, max: 6000 },
        { name: 'baseThickness', labelKo: '저판 두께', unit: 'mm', default: 400, min: 150, max: 1200 },
        { name: 'stemThickness', labelKo: '벽체 두께', unit: 'mm', default: 300, min: 150, max: 1000 },
        { name: 'toeLength', labelKo: '앞굽 길이', unit: 'mm', default: 600, min: 0, max: 3000 },
        { name: 'length', labelKo: '연장', unit: 'mm', default: 10000, min: 1000, max: 2000000 },
      ],
    },
  ],
  building: [
    {
      id: 'rc_frame', labelKo: 'RC 라멘 골조 (다베이·다층)', labelEn: 'RC frame (multi-bay/story)', build: rcFrameAssembly,
      params: [
        { name: 'baysX', labelKo: '베이 수 X', unit: '', default: 1, min: 1, max: 4 },
        { name: 'baysY', labelKo: '베이 수 Y', unit: '', default: 1, min: 1, max: 4 },
        { name: 'floors', labelKo: '층수', unit: '', default: 1, min: 1, max: 20 },
        { name: 'bayX', labelKo: '베이 X (기둥 중심간)', unit: 'mm', default: 6000, min: 3000, max: 12000 },
        { name: 'bayY', labelKo: '베이 Y', unit: 'mm', default: 6000, min: 3000, max: 12000 },
        { name: 'storyH', labelKo: '층고', unit: 'mm', default: 3300, min: 2400, max: 6000 },
        { name: 'colSize', labelKo: '기둥 크기', unit: 'mm', default: 500, min: 300, max: 1200 },
        { name: 'beamWidth', labelKo: '보 폭', unit: 'mm', default: 300, min: 200, max: 800 },
        { name: 'beamHeight', labelKo: '보 춤', unit: 'mm', default: 600, min: 300, max: 1500 },
        { name: 'slabThk', labelKo: '슬래브 두께', unit: 'mm', default: 150, min: 120, max: 300 },
      ],
    },
  ],
  landscape: [
    {
      id: 'pergola', labelKo: '목재 파고라', labelEn: 'Timber pergola', build: pergolaAssembly,
      params: [
        { name: 'width', labelKo: '폭', unit: 'mm', default: 3600, min: 1800, max: 8000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 3000, min: 1500, max: 8000 },
        { name: 'height', labelKo: '기둥 높이', unit: 'mm', default: 2400, min: 1800, max: 3600 },
        { name: 'postSize', labelKo: '기둥 단면', unit: 'mm', default: 120, min: 90, max: 200 },
        { name: 'rafterCount', labelKo: '서까래 수', unit: '', default: 7, min: 3, max: 15 },
      ],
    },
    {
      id: 'timber_deck', labelKo: '목재 데크', labelEn: 'Timber deck', build: timberDeckAssembly,
      params: [
        { name: 'width', labelKo: '폭', unit: 'mm', default: 3600, min: 1200, max: 10000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 2400, min: 1200, max: 10000 },
        { name: 'joistSpacing', labelKo: '장선 간격', unit: 'mm', default: 450, min: 300, max: 600 },
        { name: 'boardWidth', labelKo: '데크보드 폭', unit: 'mm', default: 120, min: 90, max: 200 },
      ],
    },
  ],
  bridge: [
    {
      id: 'girder_bridge', labelKo: '거더교 (단순경간)', labelEn: 'Girder bridge (simple span)', build: girderBridgeAssembly,
      params: [
        { name: 'span', labelKo: '지간', unit: 'mm', default: 30000, min: 10000, max: 60000 },
        { name: 'nGirders', labelKo: '거더 수', unit: '', default: 4, min: 2, max: 8 },
        { name: 'girderSpacing', labelKo: '거더 간격', unit: 'mm', default: 2500, min: 1500, max: 4000 },
        { name: 'girderH', labelKo: '거더 춤(플랜지 포함)', unit: 'mm', default: 1800, min: 800, max: 3500 },
        { name: 'deckThk', labelKo: '바닥판 두께', unit: 'mm', default: 240, min: 180, max: 400 },
        { name: 'overhang', labelKo: '캔틸레버 내민길이', unit: 'mm', default: 1100, min: 500, max: 2500 },
      ],
    },
  ],
  interior: [
    {
      id: 'apartment_unit', labelKo: '주거 아파트 유닛 (방2·거실주방·욕실)', labelEn: 'Apartment unit (2BR + LDK + bath)', build: apartmentUnitAssembly,
      params: [
        { name: 'width', labelKo: '전체 폭', unit: 'mm', default: 9000, min: 6000, max: 20000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 7200, min: 5000, max: 16000 },
        { name: 'bedZoneW', labelKo: '침실 구역 폭', unit: 'mm', default: 3600, min: 2600, max: 8000 },
        { name: 'doorWidth', labelKo: '현관문 폭', unit: 'mm', default: 1000, min: 800, max: 1600 },
        { name: 'innerDoorWidth', labelKo: '내부문 폭', unit: 'mm', default: 800, min: 700, max: 1200 },
        { name: 'bathW', labelKo: '욕실 폭', unit: 'mm', default: 1800, min: 1400, max: 3000 },
        { name: 'bathD', labelKo: '욕실 깊이', unit: 'mm', default: 1600, min: 1200, max: 3000 },
        { name: 'windowWidth', labelKo: '창 폭', unit: 'mm', default: 1500, min: 900, max: 2400 },
      ],
    },
    {
      id: 'studio_unit', labelKo: '원룸 유닛 (스튜디오)', labelEn: 'Studio unit', build: studioUnitAssembly,
      params: [
        { name: 'width', labelKo: '전체 폭', unit: 'mm', default: 6000, min: 4000, max: 12000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 4500, min: 3200, max: 9000 },
        { name: 'doorWidth', labelKo: '현관문 폭', unit: 'mm', default: 1000, min: 800, max: 1600 },
        { name: 'windowWidth', labelKo: '창 폭', unit: 'mm', default: 1500, min: 900, max: 2400 },
        { name: 'bathW', labelKo: '욕실 폭', unit: 'mm', default: 1600, min: 1400, max: 2600 },
        { name: 'bathD', labelKo: '욕실 깊이', unit: 'mm', default: 1400, min: 1200, max: 2600 },
      ],
    },
    {
      id: 'three_room_unit', labelKo: '3룸 유닛 (방3·거실주방·욕실)', labelEn: 'Three-room unit', build: threeRoomUnitAssembly,
      params: [
        { name: 'width', labelKo: '전체 폭', unit: 'mm', default: 11000, min: 8000, max: 24000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 7800, min: 6000, max: 18000 },
        { name: 'bedZoneW', labelKo: '우측 침실 구역 폭', unit: 'mm', default: 3600, min: 2800, max: 8000 },
        { name: 'room3W', labelKo: '방3 폭', unit: 'mm', default: 3000, min: 2400, max: 8000 },
        { name: 'room3D', labelKo: '방3 깊이', unit: 'mm', default: 3300, min: 2400, max: 8000 },
        { name: 'doorWidth', labelKo: '현관문 폭', unit: 'mm', default: 1000, min: 800, max: 1600 },
        { name: 'innerDoorWidth', labelKo: '내부문 폭', unit: 'mm', default: 800, min: 700, max: 1200 },
        { name: 'windowWidth', labelKo: '창 폭', unit: 'mm', default: 1500, min: 900, max: 2400 },
        { name: 'bathW', labelKo: '욕실 폭', unit: 'mm', default: 1800, min: 1400, max: 3000 },
        { name: 'bathD', labelKo: '욕실 깊이', unit: 'mm', default: 1600, min: 1200, max: 3000 },
      ],
    },
    {
      id: 'two_room', labelKo: '2실 평면 (다실)', labelEn: 'Two-room plan', build: twoRoomAssembly,
      params: [
        { name: 'width', labelKo: '전체 폭', unit: 'mm', default: 12000, min: 6000, max: 30000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 6000, min: 3000, max: 20000 },
        { name: 'room1W', labelKo: '실1 폭', unit: 'mm', default: 7000, min: 3000, max: 20000 },
        { name: 'doorWidth', labelKo: '출입문 폭', unit: 'mm', default: 1000, min: 800, max: 2400 },
        { name: 'innerDoorWidth', labelKo: '내부문 폭', unit: 'mm', default: 900, min: 700, max: 2000 },
      ],
    },
    {
      id: 'cafe_room', labelKo: '카페 레이아웃', labelEn: 'Cafe layout', build: cafeRoomAssembly,
      params: [
        { name: 'width', labelKo: '실 폭', unit: 'mm', default: 8000, min: 4000, max: 20000 },
        { name: 'depth', labelKo: '실 깊이', unit: 'mm', default: 6000, min: 3000, max: 20000 },
        { name: 'tableRows', labelKo: '테이블 행', unit: '', default: 2, min: 1, max: 5 },
        { name: 'tableCols', labelKo: '테이블 열', unit: '', default: 3, min: 1, max: 6 },
        { name: 'seatsPerTable', labelKo: '테이블당 좌석', unit: '', default: 4, min: 1, max: 8 },
        { name: 'doorWidth', labelKo: '출입문 폭', unit: 'mm', default: 1000, min: 800, max: 2400 },
        { name: 'exitCount', labelKo: '출구 수(2=후면 비상구)', unit: '', default: 1, min: 1, max: 2 },
      ],
    },
  ],
};

/** 카탈로그(빌더 제외) — UI/라우트용. */
export function listAssemblyTemplates(domain) {
  const doms = domain ? [domain] : Object.keys(ASSEMBLY_TEMPLATES);
  return doms.flatMap((d) => (ASSEMBLY_TEMPLATES[d] ?? []).map((t) => ({ domain: d, id: t.id, labelKo: t.labelKo, labelEn: t.labelEn, params: t.params })));
}

/** domain+id+params → 어셈블리(결정론). 없으면 null. */
export function buildAssemblyTemplate(domain, templateId, params = {}) {
  const t = (ASSEMBLY_TEMPLATES[domain] ?? []).find((x) => x.id === templateId);
  return t ? t.build(params) : null;
}

// --- self-test: 각 템플릿 기본값 → buildAssembly 게이트·간섭 0 · 질량 sanity ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('domain-assemblies.mjs');
if (isMain) {
  const { buildAssembly } = await import('./assembly.mjs');
  let pass = 0, fail = 0;
  for (const [domain, templates] of Object.entries(ASSEMBLY_TEMPLATES)) {
    for (const t of templates) {
      const defaults = Object.fromEntries(t.params.map((x) => [x.name, x.default]));
      const asm = t.build(defaults);
      const r = buildAssembly(asm);
      const mass = r.structural?.totalMassKg ?? 0;
      const ok = r.ok && r.gateErrors.length === 0 && r.interferences.length === 0 && mass > 0;
      if (ok) { pass++; console.log(`OK ${domain}/${t.id}: parts ${asm.parts.length}, mass ${mass}kg`); }
      else { fail++; console.log(`FAIL ${domain}/${t.id}:`, JSON.stringify({ ok: r.ok, gate: r.gateErrors, clash: r.interferences.map((i) => `${i.a}×${i.b}`) })); }
    }
  }
  console.log(`domain-assemblies self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
