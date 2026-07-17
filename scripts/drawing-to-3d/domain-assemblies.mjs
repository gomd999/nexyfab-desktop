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

import { buildElements, chordPolyline, clipElements, chainAt, groundFromContours, groundFromSurvey } from './alignment-geom.mjs';
import { TOL_TRIM_RESIDUAL, minSeg } from './geometry-tolerance.mjs';

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

/**
 * 토목: 옹벽 선형 구간(①선형 어휘) — IP점 폴리라인을 따라 세그먼트별 벽체·저판을 회전 배치.
 * params.ips = [[x,y],...] mm (미입력=기본 L형 선형). 접합부는 baseW 만큼 트림(회전 AABB
 * 간섭 회피) — "IP 접합 상세(마이터·코너블록)=후속, 물량·측점은 중심선 연장 기준" 정직 명시.
 * meta.alignment = { ips, totalMm, segments } → 선형 평면(STA·IP)·종단면도·시트 분할이 공유.
 */
function retainingWallAlignmentAssembly(p) {
  const H = num(p.H, 3000), baseW = num(p.baseWidth, 2000), baseT = num(p.baseThickness, 400);
  const stemT = num(p.stemThickness, 300), toe = num(p.toeLength, 600);
  const okIps = Array.isArray(p.ips) && p.ips.length >= 2 && p.ips.every((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  const L1 = num(p.leg1, 120000), L2 = num(p.leg2, 100000), defl = num(p.deflectionDeg, 30);
  const rd = (defl * Math.PI) / 180;
  const ips = okIps ? p.ips.map((q) => [q[0], q[1]]) : [[0, 0], [L1, 0], [L1 + L2 * Math.cos(rd), L2 * Math.sin(rd)]];
  const curves = Array.isArray(p.curves) ? p.curves : [];
  // 요소열(직선|원호) — 사전 게이트(교각≤90°·TL합+여유·최소반경 2·baseW) 포함(§1-1)
  const built = buildElements(ips, curves, { minR: 2 * baseW, baseW });
  if (!built.ok) return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: built.errors };
  const { elements, totalMm, curveTable } = built;
  // ── 구조물(§1-2): STA 배치 · 암거=벽 분절(개구) · 게이트(범위·간격·MIN_SEG) ──
  const structuresIn = Array.isArray(p.structures) ? p.structures : [];
  const structErrors = [];
  const structs = [];
  for (const [si, st] of structuresIn.entries()) {
    const sta = Number(st.sta);
    if (!(sta >= 0 && sta <= totalMm)) { structErrors.push(`structures[${si}]: sta ${st.sta} ∉ [0, ${Math.round(totalMm)}]`); continue; }
    const type = ['culvert', 'catch_basin', 'expansion_joint'].includes(st.type) ? st.type : 'culvert';
    const prm = st.params ?? {};
    const innerW = num(prm.innerWidthMm, 2000), innerH = num(prm.innerHeightMm, 2000), thk = num(prm.thkMm, 300);
    const along = type === 'culvert' ? innerW + 2 * thk : type === 'catch_basin' ? num(prm.sizeMm, 900) : 0;
    structs.push({ sta, type, innerW, innerH, thk, along, clr: 100, prm, offset: num(st.offset, 0) });
  }
  structs.sort((a, b) => a.sta - b.sta);
  for (let k = 1; k < structs.length; k++) {
    const gap = (structs[k].sta - structs[k].along / 2) - (structs[k - 1].sta + structs[k - 1].along / 2);
    if (gap < 500) structErrors.push(`structures: STA ${Math.round(structs[k - 1].sta / 1000)}m·${Math.round(structs[k].sta / 1000)}m 이격 ${Math.round(gap)}mm < 500mm — STA 조정 필요`);
  }
  // 벽 분절: 암거 구간을 갭으로(개구 명세) — 분절 후 각 런이 MIN_SEG 미달이면 정직 거부
  const gaps = structs.filter((q) => q.type === 'culvert').map((q) => [Math.max(0, q.sta - q.along / 2 - q.clr), Math.min(totalMm, q.sta + q.along / 2 + q.clr)]);
  const runs = [];
  {
    let cur = 0;
    for (const [g0, g1] of gaps) { if (g0 > cur) runs.push([cur, g0]); cur = Math.max(cur, g1); }
    if (cur < totalMm) runs.push([cur, totalMm]);
  }
  const MINSEG = minSeg(stemT);
  for (const [r0, r1] of runs) if (r1 - r0 < MINSEG) structErrors.push(`분절 후 벽 구간 STA ${Math.round(r0 / 1000)}~${Math.round(r1 / 1000)}m 길이 ${Math.round(r1 - r0)}mm < ${MINSEG}mm — STA 조정 필요(자동 이동 금지)`);
  if (structErrors.length) return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: structErrors };
  const chordNotes = [];
  // 정확 마이터 트림(§0.2): 꼭짓점 교각 Δ에서 스트립(중심선 오프셋 o·반폭 h)의 트림
  //   m = (|o|+h)·tan(|Δ|/2) + TOL_TRIM_RESIDUAL — OBB 겹침 0을 수학으로 보장(갭 최소).
  const miter = (absDelta, o, h) => (Math.abs(o) + h) * Math.tan(absDelta / 2) + TOL_TRIM_RESIDUAL;
  const oStem = toe + stemT / 2 - baseW / 2; // 스템 중심선의 정렬 중심선 대비 오프셋
  const parts = [];
  for (const [ri, [r0, r1]] of runs.entries()) {
  const sub = clipElements(elements, r0, r1);
  const { pts, notes: cn } = chordPolyline(sub);
  chordNotes.push(...cn);
  const rp = runs.length > 1 ? `r${ri + 1}_` : '';
  const brgOf = (j) => Math.atan2(pts[j + 1][1] - pts[j][1], pts[j + 1][0] - pts[j][0]);
  const vertexDelta = (j) => {
    let d = brgOf(j) - brgOf(j - 1);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  };
  for (let j = 0; j < pts.length - 1; j++) {
    const [x1, y1] = pts[j], [x2, y2] = pts[j + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const dPrev = j > 0 ? Math.abs(vertexDelta(j)) : 0;
    const dNext = j < pts.length - 2 ? Math.abs(vertexDelta(j + 1)) : 0;
    const brgDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const theta = ((brgDeg - 90) * Math.PI) / 180;
    const cth = Math.cos(theta), sth = Math.sin(theta);
    const off = (lx) => [lx * cth, lx * sth]; // 로컬 x 오프셋만 회전(로컬 y=0)
    const place = (id, halfW, o, w, z0, hh, role) => {
      const t0 = j > 0 ? miter(dPrev, o, halfW) : 0;
      const t1 = j < pts.length - 2 ? miter(dNext, o, halfW) : 0;
      const segLen = len - t0 - t1;
      if (segLen <= 1) return; // 트림 초과 초단 현 — 방어(새그 공차상 미발생)
      const sx = x1 + ux * t0, sy = y1 + uy * t0;
      const [bx, by] = off(o - w / 2);
      parts.push(P(id, 'box', { width: w, depth: segLen, height: hh }, { tx: sx + bx, ty: sy + by, tz: z0, rz: +(brgDeg - 90).toFixed(4) }, 'concrete', role));
    };
    place(`${rp}seg${j + 1}_base`, baseW / 2, 0, baseW, 0, baseT, 'base');
    place(`${rp}seg${j + 1}_stem`, stemT / 2, oStem, stemT, baseT, H - baseT, 'wall');
  }
  }
  // 구조물 부품: 암거=중심선 직교 관통(개산 외형) · 집수정=전면 오프셋 배치 · 신축이음=마커만
  for (const [k, st2] of structs.entries()) {
    const { p: cp, dir } = chainAt(elements, st2.sta);
    const brg = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
    const th2 = ((brg - 90) * Math.PI) / 180;
    const c2 = Math.cos(th2), s2 = Math.sin(th2);
    const loc = (lx, ly) => [cp[0] + lx * c2 - ly * s2, cp[1] + lx * s2 + ly * c2];
    if (st2.type === 'culvert') {
      const W2 = baseW + 3000; // 관통 연장(옹벽 전후 여유 개산)
      const [ox2, oy2] = loc(-W2 / 2, -st2.along / 2);
      parts.push(P(`culvert${k + 1}`, 'box', { width: W2, depth: st2.along, height: st2.innerH + 2 * st2.thk }, { tx: ox2, ty: oy2, tz: 0, rz: +(brg - 90).toFixed(4) }, 'concrete', 'culvert'));
    } else if (st2.type === 'catch_basin') {
      const off2 = st2.offset || (baseW / 2 + 700);
      const [ox2, oy2] = loc(-off2 - st2.along / 2, -st2.along / 2);
      parts.push(P(`basin${k + 1}`, 'box', { width: st2.along, depth: st2.along, height: 1200 }, { tx: ox2, ty: oy2, tz: 0, rz: +(brg - 90).toFixed(4) }, 'concrete', 'catchbasin'));
    }
  }
  // §1-3 등고→지반선 결정론 파생(명시 profileGround 입력이 우선·모순=정직 거부)
  // 스키마 게이트: 등고는 {elevM(미터)·pts[[x,y]mm..]} — 표고 필드가 다르면 조용히 무시되어
  // "교차<2" 오진으로 이어지므로(260717 예시 배터리 검출) 여기서 명시 거부한다.
  if (Array.isArray(p.contours)) {
    const bad = p.contours.filter((c) => !Number.isFinite(Number(c?.elevM)) || !Array.isArray(c?.pts) || c.pts.length < 2);
    if (bad.length) {
      return {
        name: '옹벽 선형 구간', domain: 'civil', parts: [],
        alignmentErrors: [`contours ${bad.length}건 불량 — 각 등고는 {"elevM": 표고(m), "pts": [[x,y]mm, ...]} 필요(el/elev/elevMm 아님)`],
      };
    }
  }
  let derivedGround = null, groundNote = null;
  // Wave 2 — 측량점 인입(우선순위: profileGround 직접입력 > surveyPoints 실측 > contours):
  // surveyPoints=[[E,N,EL] m, 절대 평면직각좌표(TM)] — origin{E,N}(m) 필수(로컬 변환 기준.
  // 미입력=매칭 불능이므로 정직 거부, 좌표를 지어 맞추지 않음).
  if (!Array.isArray(p.profileGround) && Array.isArray(p.surveyPoints) && p.surveyPoints.length) {
    const og = p.origin;
    if (!(Number.isFinite(Number(og?.E)) && Number.isFinite(Number(og?.N)))) {
      return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: ['surveyPoints 에는 origin {E, N}(m, 평면직각좌표 원점=선형 시점) 필수 — 좌표계 정합 없이 투영 불가(정직 거부)'] };
    }
    const bad = p.surveyPoints.filter((q) => !Array.isArray(q) || q.length < 3 || q.some((v) => !Number.isFinite(Number(v))));
    if (bad.length) {
      return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: [`surveyPoints ${bad.length}건 불량 — 각 점은 [E(m), N(m), EL(m)] 숫자 3열`] };
    }
    const local = p.surveyPoints.map((q) => ({ x: (Number(q[0]) - Number(og.E)) * 1000, y: (Number(q[1]) - Number(og.N)) * 1000, elevMm: Number(q[2]) * 1000 }));
    const g = groundFromSurvey(elements, local, { corridorMm: baseW / 2 + 5000 });
    if (g.errors.length) return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: g.errors };
    derivedGround = g.ground;
    groundNote = g.note;
  } else if (!Array.isArray(p.profileGround) && Array.isArray(p.contours)) {
    const g = groundFromContours(elements, p.contours);
    if (g.errors.length) return { name: '옹벽 선형 구간', domain: 'civil', parts: [], alignmentErrors: g.errors };
    derivedGround = g.ground;
    groundNote = g.note;
  }
  return {
    name: '옹벽 선형 구간', domain: 'civil', parts,
    ...(Array.isArray(p.contours) ? { contours: p.contours } : {}),
    // 측량 origin(m)→assembly.origin(mm): DXF·LandXML 실좌표 방출과 단일 규약(§F)
    ...(Array.isArray(p.surveyPoints) && Number.isFinite(Number(p.origin?.E)) ? { origin: { E: Number(p.origin.E) * 1000, N: Number(p.origin.N) * 1000 } } : {}),
    ...(Array.isArray(p.siteBoundary) ? { siteBoundary: p.siteBoundary } : {}),
    // §1-4 토공 파라미터 패스스루(기면고·기면폭·사면경사=입력 원칙 — 미입력 시 토공 생략)
    ...(p.earthwork && typeof p.earthwork === 'object' ? { earthwork: p.earthwork } : {}),
    // 옹벽 안정 지반 정수 패스스루(γ·φ·μ·qa=입력 원칙 — 미입력 시 RW 시트가 정직 게이트)
    ...(p.soil && typeof p.soil === 'object' ? { soil: p.soil } : {}),
    // 배근 패스스루(Wave 3 — 입력 원칙: BBS 는 입력 배근의 물량 산출만, 설계 아님)
    ...(p.rebar && typeof p.rebar === 'object' ? { rebar: p.rebar } : {}),
    // 시공 문서 입력(Wave 4 — 타설 능력=입력 원칙·검측=참고 서식 요청 시)
    ...(p.construction && typeof p.construction === 'object' ? { construction: p.construction } : {}),
    alignment: {
      ips, curves, elements, totalMm, curveTable, halfWidthMm: baseW / 2, chordNotes,
      structures: structs.map((q) => ({ sta: q.sta, type: q.type, innerWmm: q.innerW, innerHmm: q.innerH, thkMm: q.thk, alongMm: q.along, params: q.prm })),
      wallGaps: gaps,
      note: '곡선=원곡선+클로소이드(Fresnel 정밀 전개·폐합 자기검증<0.5mm) · 3D=현 근사(새그 공차 — 평면·DXF는 진짜 원호) · 물량·측점=중심선 호장 기준 · 접합=정확 마이터 트림',
    },
    // 종단(계획고): 기본=벽정점 일정고(형상 파생). 지반선·계획고 변경=입력 원칙(profileDesign/profileGround)
    profile: {
      design: Array.isArray(p.profileDesign) ? p.profileDesign : [{ staMm: 0, elevMm: H }, { staMm: totalMm, elevMm: H }],
      ground: Array.isArray(p.profileGround) ? p.profileGround : derivedGround,
      designNote: Array.isArray(p.profileDesign) ? '계획고=입력' : '계획고=벽정점 일정고(형상 파생 기본)',
      groundNote: Array.isArray(p.profileGround) ? '지반선=입력' : groundNote,
    },
    retainingWall: { H: H / 1000, stemThickness: stemT / 1000, baseWidth: baseW / 1000, baseThickness: baseT / 1000, toeLength: toe / 1000, length: totalMm / 1000 },
    // 물량=요소(호장) 기준 — 현 합이 아님(§1-1). 암거=culvert 수량 룰(관통 연장 기준)
    civilTakeoff: [
      ...elements.map((el, i) => ({ id: `rw_el${i + 1}`, type: 'retaining_wall', H: H / 1000, stemThickness: stemT / 1000, baseWidth: baseW / 1000, baseThickness: baseT / 1000, length: el.len / 1000 })),
      ...structs.filter((q) => q.type === 'culvert').map((q, i) => ({ id: `culv${i + 1}`, type: 'culvert', innerWidth: q.innerW / 1000, innerHeight: q.innerH / 1000, wallThk: q.thk / 1000, length: (baseW + 3000) / 1000, ...(Number(q.prm?.cover) >= 0 ? { cover: +q.prm.cover } : {}) })),
    ],
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

/** 타이드 아치교 + 접속 고가교(260717 신설 — 연륙교류).
 *  아치 리브=포물선 z=deckTop+4·rise·ξ(1−ξ) 를 현(chord) 분절 box(ry 회전)로 전개 —
 *  분절 끝점 공유(겹침 0)·행어=수직 실린더(닐센 경사 행어는 후속 명시)·타이=데크 연단 거더.
 *  구조검토 미포함(형상·물량·도서만 — 아치 해석은 별도 명시). */
function archBridgeAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const mainSpan = num(p.mainSpan, 120000);
  const rise = num(p.rise, Math.round(mainSpan * 0.22));
  const deckW = num(p.deckW, 12000), deckThk = num(p.deckThk, 450);
  const ribW = num(p.ribW, 900), ribH = num(p.ribH, 1400);
  const tieW = num(p.tieW, 800), tieH = num(p.tieH, 1800);
  const hangerSpacing = num(p.hangerSpacing, 6000), hangerDia = num(p.hangerDia, 90);
  const apLeft = Math.max(0, Math.round(Number(p.approachSpansLeft ?? 8)));
  const apRight = Math.max(0, Math.round(Number(p.approachSpansRight ?? 1)));
  const apSpan = num(p.approachSpan, 30000);
  const pierH = num(p.pierH, 12000), pierW = num(p.pierW, 5000), pierD = num(p.pierD, 2400);
  const capH = 1500, girderH = num(p.girderH, 1600);
  const nSeg = Math.max(12, Math.min(40, Math.round(num(p.archSegments, 24))));
  const deckBot = pierH + capH + girderH;
  const deckTop = deckBot + deckThk;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // ── 접속 고가교(좌/우): 교각(기둥+코핑)+연단 거더 2본+상판 ──
  const bent = (x, id, big = false) => {
    const w = big ? pierW * 1.5 : pierW, d2 = big ? pierD * 1.4 : pierD;
    P(`${id}_col`, 'box', { width: w, depth: d2, height: pierH }, { tx: x - w / 2, ty: (deckW - d2) / 2, tz: 0 }, 'concrete', 'pier');
    P(`${id}_cap`, 'box', { width: w + 1600, depth: deckW - 1500, height: capH }, { tx: x - (w + 1600) / 2, ty: 750, tz: pierH }, 'concrete', 'crossbeam');
  };
  const approach = (x0, spans, tag) => {
    if (!spans) return;
    const L = spans * apSpan;
    for (let k = 0; k <= spans; k++) {
      const x = x0 + k * apSpan;
      if (x === 0 || x === mainSpan) continue; // 주경간 교각은 별도(대형)
      bent(x, `${tag}_pier${k}`);
    }
    for (const [side, y] of [['L', 900], ['R', deckW - 900 - tieW]]) {
      P(`${tag}_girder_${side}`, 'box', { width: L, depth: tieW, height: girderH }, { tx: x0, ty: y, tz: pierH + capH }, 'steel', 'girder');
    }
    P(`${tag}_deck`, 'box', { width: L, depth: deckW, height: deckThk }, { tx: x0, ty: 0, tz: deckBot }, 'concrete', 'deck');
  };
  approach(-apLeft * apSpan, apLeft, 'apL');
  approach(mainSpan, apRight, 'apR');
  // 주경간 교각(대형) 2기
  bent(0, 'main_pier_A', true);
  bent(mainSpan, 'main_pier_B', true);
  // ── 주경간: 타이 거더 2본 + 상판 ──
  for (const [side, y] of [['L', 900], ['R', deckW - 900 - tieW]]) {
    P(`tie_${side}`, 'box', { width: mainSpan, depth: tieW, height: tieH }, { tx: 0, ty: y, tz: pierH + capH }, 'steel', 'girder');
  }
  P('main_deck', 'box', { width: mainSpan, depth: deckW, height: deckThk }, { tx: 0, ty: 0, tz: deckBot }, 'concrete', 'deck');
  // ── 아치 리브 2본(포물선 분절, ry 회전 — 로컬 원점 보정) ──
  const zArch = (x) => deckTop + (4 * rise * (x / mainSpan)) * (1 - x / mainSpan);
  const ribYs = [900 + (tieW - ribW) / 2, deckW - 900 - tieW + (tieW - ribW) / 2]; // 타이 위 정렬
  for (const [ri, yRib] of ribYs.entries()) {
    for (let k = 0; k < nSeg; k++) {
      const x0 = (mainSpan * k) / nSeg, x1 = (mainSpan * (k + 1)) / nSeg;
      const z0 = zArch(x0), z1 = zArch(x1);
      const segL = Math.hypot(x1 - x0, z1 - z0);
      const thetaDeg = (Math.atan2(z1 - z0, x1 - x0) * 180) / Math.PI;
      // 로컬 단면중심 c0=(0, ribW/2, ribH/2) 이 회전 후 시작점 P0 에 오도록 평행이동 보정
      const th = (thetaDeg * Math.PI) / 180;
      // Ry(θ): x' = x cosθ + z sinθ · z' = −x sinθ + z cosθ (placedAabb rotatePoint 규약 — 프로브 검증)
      const rcx = (ribH / 2) * Math.sin(th);
      const rcz = (ribH / 2) * Math.cos(th);
      P(`arch${ri + 1}_seg${k + 1}`, 'box', { width: segL, depth: ribW, height: ribH },
        { tx: x0 - rcx, ty: yRib, tz: z0 - rcz, ry: -thetaDeg }, 'steel', 'arch');
    }
  }
  // ── 행어(수직 — 닐센 경사 후속 명시) ──
  let nH = 0;
  for (let x = hangerSpacing; x < mainSpan - hangerSpacing / 2; x += hangerSpacing) {
    const top = zArch(x) - ribH / 2;
    const L = top - deckTop;
    if (L < hangerDia * 3) continue; // 스프링잉 부근 초단 행어 생략(시공 관례)
    for (const [ri, yRib] of ribYs.entries()) {
      P(`hanger_${ri + 1}_${++nH}`, 'cylinder', { diameter: hangerDia, length: L },
        { tx: x - hangerDia / 2, ty: yRib + ribW / 2 - hangerDia / 2, tz: deckTop }, 'steel', 'hanger');
    }
  }
  // ── 리브 간 수평 브레이싱(정점부 5개) ──
  for (let b = 0; b < 5; b++) {
    const x = mainSpan * (0.3 + 0.1 * b);
    const z = zArch(x) - ribH / 2;
    P(`brace_${b + 1}`, 'box', { width: 700, depth: ribYs[1] - ribYs[0] - ribW, height: 500 },
      { tx: x - 350, ty: ribYs[0] + ribW, tz: z - 250 }, 'steel', 'bracing');
  }
  return {
    name: `아치교 ${mainSpan / 1000}m+접속 ${apLeft + apRight}경간`, domain: 'bridge', kind: 'assembly', parts,
    archMeta: { mainSpan, rise, nSeg, hangers: nH, apLeft, apRight, apSpan, deckW, deckTop },
    note: '아치=포물선 현 분절(끝점 공유)·행어=수직(닐센 경사 후속)·구조해석 미포함(형상·물량·도서) — 명시',
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
    {
      id: 'retaining_wall_alignment', labelKo: '옹벽 선형 구간 (IP 폴리라인)', labelEn: 'Retaining wall alignment', build: retainingWallAlignmentAssembly,
      params: [
        { name: 'H', labelKo: '벽고(저면~상단)', unit: 'mm', default: 3000, min: 500, max: 8000 },
        { name: 'baseWidth', labelKo: '저판 폭', unit: 'mm', default: 2000, min: 500, max: 6000 },
        { name: 'baseThickness', labelKo: '저판 두께', unit: 'mm', default: 400, min: 150, max: 1200 },
        { name: 'stemThickness', labelKo: '벽체 두께', unit: 'mm', default: 300, min: 150, max: 1000 },
        { name: 'toeLength', labelKo: '앞굽 길이', unit: 'mm', default: 600, min: 0, max: 3000 },
        { name: 'leg1', labelKo: '제1구간 연장', unit: 'mm', default: 120000, min: 5000, max: 2000000 },
        { name: 'leg2', labelKo: '제2구간 연장', unit: 'mm', default: 100000, min: 0, max: 2000000 },
        { name: 'deflectionDeg', labelKo: 'IP 교각(굴절각)', unit: '°', default: 30, min: -90, max: 90 },
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
    {
      id: 'arch_bridge', labelKo: '타이드 아치교 + 접속 고가교', labelEn: 'Tied-arch bridge with approach viaduct', build: archBridgeAssembly,
      params: [
        { name: 'mainSpan', labelKo: '주경간', unit: 'mm', default: 120000, min: 40000, max: 300000 },
        { name: 'rise', labelKo: '아치 라이즈', unit: 'mm', default: 26400, min: 8000, max: 80000 },
        { name: 'deckW', labelKo: '상판 폭', unit: 'mm', default: 12000, min: 6000, max: 30000 },
        { name: 'hangerSpacing', labelKo: '행어 간격', unit: 'mm', default: 6000, min: 3000, max: 12000 },
        { name: 'approachSpansLeft', labelKo: '접속 경간 수(좌)', unit: '', default: 8, min: 0, max: 30 },
        { name: 'approachSpansRight', labelKo: '접속 경간 수(우)', unit: '', default: 1, min: 0, max: 30 },
        { name: 'approachSpan', labelKo: '접속 경간장', unit: 'mm', default: 30000, min: 15000, max: 60000 },
        { name: 'pierH', labelKo: '교각 높이', unit: 'mm', default: 12000, min: 5000, max: 40000 },
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
