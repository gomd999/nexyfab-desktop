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
  return {
    name: `RC 라멘 골조 (${nbx}×${nby}베이 ${nf}층)`, domain: 'building', parts,
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
  return { name: '목재 파고라', domain: 'landscape', parts };
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
  const zoneW = W - 1600, zoneD = D - 2400;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const tx = 800 + (zoneW / cols) * (c + 0.5) - 600, ty = 800 + (zoneD / rows) * (r + 0.5) - 600;
    parts.push(P(`table_${r}_${c}_top`, 'box', { width: 1200, depth: 1200, height: 30 }, { tx, ty, tz: 720 }, 'timber', 'table'));
    for (const [k, [lx, ly]] of [[100, 100], [1050, 100], [100, 1050], [1050, 1050]].entries())
      parts.push(P(`table_${r}_${c}_leg${k + 1}`, 'box', { width: 50, depth: 50, height: 720 }, { tx: tx + lx, ty: ty + ly, tz: 0 }, 'timber', 'table'));
  }
  const nT = rows * cols;
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
      { id: 'chair', name: '의자', count: nT * seatsPer, seats: 1 },
      { id: 'counter', name: '서비스 카운터', count: 1, seats: 0 },
    ],
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
        { name: 'length', labelKo: '연장', unit: 'mm', default: 10000, min: 1000, max: 20000 },
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
  interior: [
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
