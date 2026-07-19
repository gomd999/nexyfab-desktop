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
  if (girderH > tieH) {
    return { name: '아치교', domain: 'bridge', parts: [], alignmentErrors: [`접속 거더 춤(${girderH}) > 타이 거더 춤(${tieH}) — 노면고 통일 불가(girderH ≤ tieH 필요, 교좌 받침=차이만큼)`] };
  }
  const nSeg = Math.max(12, Math.min(40, Math.round(num(p.archSegments, 24))));
  // 노면고 통일(260717 마감): 데크 하면 = 타이 상면. 접속 거더는 교좌 받침(bearing,
  // h=tieH−girderH)으로 동일 노면고 — 실교량 교좌장치 관례.
  const deckBot = pierH + capH + tieH;
  const deckTop = deckBot + deckThk;
  const brgH = tieH - girderH;
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
      if (Math.abs(x) <= EJ + 1 || Math.abs(x - mainSpan) <= EJ + 1) continue; // 주경간 교각은 별도(대형) — EJ 시프트 포함
      bent(x, `${tag}_pier${k}`);
      // 교좌 받침(거더 2열 아래, h=tieH−girderH — 노면고 통일)
      if (brgH > 0) {
        for (const [side, y] of [['L', 900], ['R', deckW - 900 - tieW]]) {
          P(`${tag}_brg${k}_${side}`, 'box', { width: 400, depth: tieW, height: brgH }, { tx: x - 200, ty: y, tz: pierH + capH }, 'steel', 'bearing');
        }
      }
    }
    for (const [side, y] of [['L', 900], ['R', deckW - 900 - tieW]]) {
      P(`${tag}_girder_${side}`, 'box', { width: L, depth: tieW, height: girderH }, { tx: x0, ty: y, tz: pierH + capH + brgH }, 'steel', 'girder');
    }
    P(`${tag}_deck`, 'box', { width: L, depth: deckW, height: deckThk }, { tx: x0, ty: 0, tz: deckBot }, 'concrete', 'deck');
  };
  const EJ = 50; // 주경간↔접속 신축이음 갭(실교량 관례 — 스프링잉 접합부)
  approach(-apLeft * apSpan - EJ, apLeft, 'apL');
  approach(mainSpan + EJ, apRight, 'apR');
  // 주경간 교각(대형) 2기
  bent(0, 'main_pier_A', true);
  bent(mainSpan, 'main_pier_B', true);
  // ── 주경간: 타이 거더 2본 + 상판 ──
  for (const [side, y] of [['L', 900], ['R', deckW - 900 - tieW]]) {
    P(`tie_${side}`, 'box', { width: mainSpan, depth: tieW, height: tieH }, { tx: 0, ty: y, tz: pierH + capH }, 'steel', 'girder');
  }
  P('main_deck', 'box', { width: mainSpan, depth: deckW, height: deckThk }, { tx: 0, ty: 0, tz: deckBot }, 'concrete', 'deck');
  // ── 아치 리브 2본(포물선 분절, ry 회전 — 로컬 원점 보정) ──
  // 기점 클리어런스: 스프링잉 세그 하면이 데크 상면과 0겹침이 되도록 포물선을
  // (ribH/2)/cosθ0 만큼 올림(θ0=스프링잉 기울기 — 260717 마감, 회전 하면 폐형).
  // Ry(−θ0) 스프링잉 세그의 AABB min z = zArch(0) − (ribH/2)cosθ0 (코너 폐형 — 260718 정정:
  // 초판 1/cosθ0 은 397mm 과잉 부양 → 닐센에서 아치 지지 체인 단절로 검출)
  const th0 = Math.atan((4 * rise) / mainSpan);
  const archClear = (ribH / 2) * Math.cos(th0);
  const zArch = (x) => deckTop + archClear + (4 * rise * (x / mainSpan)) * (1 - x / mainSpan);
  const ribYs = [900 + (tieW - ribW) / 2, deckW - 900 - tieW + (tieW - ribW) / 2]; // 타이 위 정렬
  const chord = []; // 세그 현 데이터(행어 폐형 컷용): {x0,x1,z0,z1,thRad}
  // 스프링잉 오프셋: 회전 AABB 가 x<0 로 (ribH/2)sinθ0 뻗침 → 정의역을 [xs, L−xs]로 당기고
  // 그 구간은 **스프링잉 페데스탈**(수직 받침 — 실교량 관례)로 메움(접속 데크와 9.6mm 교차 해소).
  const xs0 = (ribH / 2) * Math.sin(th0);
  const span2 = mainSpan - 2 * xs0;
  for (const [ri, yRib] of ribYs.entries()) {
    for (let k = 0; k < nSeg; k++) {
      const x0 = xs0 + (span2 * k) / nSeg, x1 = xs0 + (span2 * (k + 1)) / nSeg;
      const z0 = zArch(x0), z1 = zArch(x1);
      const segL = Math.hypot(x1 - x0, z1 - z0);
      const thetaDeg = (Math.atan2(z1 - z0, x1 - x0) * 180) / Math.PI;
      const th = (thetaDeg * Math.PI) / 180;
      if (ri === 0) chord.push({ x0, x1, z0, z1, thRad: th });
      // Ry(θ): x' = x cosθ + z sinθ · z' = −x sinθ + z cosθ (placedAabb rotatePoint 규약 — 프로브 검증)
      const rcx = (ribH / 2) * Math.sin(th);
      const rcz = (ribH / 2) * Math.cos(th);
      P(`arch${ri + 1}_seg${k + 1}`, 'box', { width: segL, depth: ribW, height: ribH },
        { tx: x0 - rcx, ty: yRib, tz: z0 - rcz, ry: -thetaDeg }, 'steel', 'arch');
    }
  }
  // 스프링잉 페데스탈(수직 받침 — 아치 하단 컷 구간을 데크까지 메움, 관례).
  // 상면 = 스프링잉 세그 AABB 하면(tz = zArch(xs0) − (ribH/2)cos(현각)) — 접선각이 아니라
  // **현(chord) 각** 기준이라야 0겹침 면접촉(접선각 사용 시 수 mm 관통 — 그리드 검출).
  {
    const x1c = xs0 + span2 / nSeg;
    const thC = Math.atan2(zArch(x1c) - zArch(xs0), x1c - xs0);
    const hPed = Math.max(50, zArch(xs0) - (ribH / 2) * Math.cos(thC) - deckTop);
    for (const [ri, yRib] of ribYs.entries()) {
      for (const [tag, xP] of [['A', 0], ['B', mainSpan - xs0]]) {
        P(`ped_${tag}_${ri + 1}`, 'box', { width: xs0, depth: ribW, height: hPed }, { tx: xP, ty: yRib, tz: deckTop }, 'steel', 'pedestal');
      }
    }
  }
  // ── 행어(수직 사각 단면 box — OBB 정밀 판정 대상. 원형·닐센 경사=후속 명시) ──
  // 상단 = 세그 '현' 하면 폐형: zc(x)−(ribH/2)/cosθ − (d/2)tan|θ| (경사 하면과 상단
  // 모서리 0겹침 컷 — 260717 마감. 정착 상세 후속)
  const chordLowAt = (x) => {
    const s = chord.find((q) => x >= q.x0 - 1e-6 && x <= q.x1 + 1e-6) ?? chord[chord.length - 1];
    const zc = s.z0 + ((x - s.x0) / Math.max(1e-9, s.x1 - s.x0)) * (s.z1 - s.z0);
    return zc - (ribH / 2) / Math.cos(s.thRad) - (hangerDia / 2) * Math.abs(Math.tan(s.thRad));
  };
  let nH = 0;
  const nielsen = String(p.hangerStyle ?? 'vertical') === 'nielsen';
  for (let x = hangerSpacing; x < mainSpan - hangerSpacing / 2; x += hangerSpacing) {
    const top = chordLowAt(x);
    const L = top - deckTop;
    if (L < hangerDia * 3) continue; // 스프링잉 부근 초단 행어 생략(시공 관례)
    for (const [ri, yRib] of ribYs.entries()) {
      if (!nielsen) {
        P(`hanger_${ri + 1}_${++nH}`, 'box', { width: hangerDia, depth: hangerDia, height: L },
          { tx: x - hangerDia / 2, ty: yRib + ribW / 2 - hangerDia / 2, tz: deckTop }, 'steel', 'hanger');
        continue;
      }
      // 닐센(260718): 아치점(x, top)에서 데크점(x±s, deckTop)으로 경사 쌍(X 네트워크).
      // 실교차는 전/후면 y 분리(off=행어 지름)로 회피 — ry 단일축이라 OBB 정밀 판정 대상.
      // 측면 정착(닐센 관례): 경사 쌍을 리브 **외측** y 에 나란히 — 아치 세그·브레이싱과
      // y 비겹침(간섭 원천 해소)+쌍 간 y 분리(실교차 회피). 정착 거셋 상세=후속 명시.
      const s = hangerSpacing / 2;
      const outward = ri === 0 ? -1 : +1; // 리브0=전면 외측(y−)·리브1=후면 외측(y+)
      const gap = hangerDia / 2;
      for (const [pairIdx, dirSign] of [[0, +1], [1, -1]]) {
        const Dx = x + dirSign * s;
        if (Dx < hangerDia || Dx > mainSpan - hangerDia) continue;
        const phi = Math.atan2(dirSign * s, L); // 수직 기준 경사각(부호=x방향)
        const aSin = Math.abs(Math.sin(phi)), aCos = Math.cos(phi);
        // Ry(φ) 회전 AABB 폐형(부호별): φ>0 은 하단이 −d·sinφ 뻗침 → 하단 패드,
        // φ<0 은 상단이 +d·|sinφ| 뻗침 → 상단 컷. (반대쪽 패드=0 — 과잉 부양이 부유를 만들었음)
        const botPad = phi > 0 ? hangerDia * aSin : 0;
        const topPad = phi > 0 ? 0 : hangerDia * aSin;
        const tzH = deckTop + botPad;
        const Lh = (top - tzH - topPad) / aCos;
        if (Lh < hangerDia * 2) continue;
        const cxh = (hangerDia / 2) * aCos;
        const off = outward === -1
          ? -(gap + hangerDia) - pairIdx * (hangerDia + gap)
          : ribW + gap + pairIdx * (hangerDia + gap);
        P(`hanger_${ri + 1}_${++nH}`, 'box', { width: hangerDia, depth: hangerDia, height: Lh },
          { tx: Dx - cxh, ty: yRib + off, tz: tzH, ry: (phi * 180) / Math.PI }, 'steel', 'hanger');
      }
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
    archMeta: { mainSpan, rise, nSeg, hangers: nH, apLeft, apRight, apSpan, deckW, deckTop, deckThk, ribW, ribH, tieW, tieH, hangerDia, hangerSpacing, hangerStyle: nielsen ? 'nielsen' : 'vertical' },
    note: '아치=포물선 현 분절(끝점 공유)·행어=수직/닐센 X-경사 선택·구조검토=archBridgeCheck 간이 체인(비법정) 별도 — 명시',
  };
}

// ── 경사 부재 공통 폐형(260718 — 신규 교량 3종용). 단일축 ry 회전 = OBB 정밀 판정 대상 ──
// (A) 장축=X **중심 배치** 규약: 축 중점 (xm,zm)·각 θ·길이 L 로 배치 — 코너 회전의
//     비대칭 AABB(placedAabb 프로브: 내리막 쪽 1.5s·sinθ 치우침)를 중심 보정으로 대칭화.
//     회전 AABB = xm±hx, zm±hz (hx=(L|cosθ|+s|sinθ|)/2, hz=(L|sinθ|+s|cosθ|)/2) — 정확 폐형.
function chordBoxX(P, id, xm, zm, thetaRad, L, s, ty, depth, material, role) {
  const c = Math.cos(thetaRad), sn = Math.sin(thetaRad);
  const tx = xm - (L / 2) * c + (s / 2) * sn;
  const tz = zm - (L / 2) * sn - (s / 2) * c;
  P(id, 'box', { width: L, depth, height: s }, { tx, ty, tz, ry: (-thetaRad * 180) / Math.PI }, material, role);
  return { hx: (L * Math.abs(c) + s * Math.abs(sn)) / 2, hz: (L * Math.abs(sn) + s * Math.abs(c)) / 2 };
}
// (B) 장축=Z 규약(닐센 행어와 동일 — 수직 근접 부재): 하단 (xB, zB)→상단 (xT, zT).
//     φ=수직 기준 경사각. 부호별 패드(φ>0 하단·φ<0 상단)로 회전 AABB 0겹침 폐형(닐센 검증식 재사용).
function inclineBoxZ(P, id, xB, zB, xT, zT, s, ty, material, role) {
  const phi = Math.atan2(xT - xB, zT - zB);
  const aSin = Math.abs(Math.sin(phi)), aCos = Math.cos(phi);
  const botPad = phi > 0 ? s * aSin : 0;
  const topPad = phi < 0 ? s * aSin : 0;
  const tz = zB + botPad;
  const Lh = (zT - tz - topPad) / aCos;
  if (Lh < s) return null;
  P(id, 'box', { width: s, depth: s, height: Lh }, { tx: xB - (s / 2) * aCos, ty, tz, ry: (phi * 180) / Math.PI }, material, role);
  return { Lh, phi };
}

// (C) 수평면 현-박스(rz 회전 — 반원 유리벽·곡면 파사드용, 260718b). placedAabb 프로브:
//   rz 는 국소원점(0,0) 기준 CCW·tx/ty=원점 착지점·박스는 국소 [0,L]×[0,thick].
//   현 (x0,y0)→(x1,y1) 을 중심선으로, 양끝 marginAlong 인셋(멀리언 회피 폐형).
function chordBoxZrz(P, id, x0, y0, x1, y1, thick, z0, height, material, role, marginAlong = 0) {
  const dx = x1 - x0, dy = y1 - y0;
  const th = Math.atan2(dy, dx);
  const c = Math.cos(th), s = Math.sin(th);
  const sx = x0 + c * marginAlong, sy = y0 + s * marginAlong;
  const Lg = Math.hypot(dx, dy) - 2 * marginAlong;
  if (Lg < thick) return null;
  // 중심선 정렬: 국소 (0, thick/2) → 회전 → 착지가 (sx,sy) 되도록 tx/ty 보정
  const tx = sx + (thick / 2) * s;
  const ty = sy - (thick / 2) * c;
  P(id, 'box', { width: Lg, depth: thick, height }, { tx, ty, tz: z0, rz: (th * 180) / Math.PI }, material, role);
  return { Lg, th };
}

/** 산업용 강재 계단(직선/2련 U턴 — 260718, 참고파일들2 계단·핸드레일 대응).
 *  스트링거=경사 box(chordBoxX 중심 규약)·트레드=스트링거 안쪽 y-면 체결(0겹침)·
 *  난간=트레드 위 포스트 + 경사 레일. 리저 높이 gate ≤ 220(산업 관례). 구조검토 미포함. */
function industrialStairAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const rise = num(p.totalRise, 4000);
  const width = num(p.width, 900);
  const tread = num(p.treadDepth, 260), tThk = 45;
  const targetRiser = num(p.riserH, 180);
  const nStep = Math.max(3, Math.round(rise / targetRiser));
  const riser = rise / nStep;
  if (riser > 220) {
    return { name: '산업 계단', domain: 'building', parts: [], alignmentErrors: [`리저 ${Math.round(riser)}mm > 220 — totalRise/riserH 재조정(단수 ${nStep})`] };
  }
  const strH = num(p.stringerH, 300), strT = 60;
  const railH = num(p.handrailH, 1000), postS = 50, railS = 50;
  const flights = Math.round(num(p.flights, 1)) === 2 ? 2 : 1;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 1개 플라이트(스트링거 2+트레드+포스트+레일) — dir=+1 x증가/−1 x감소, (x0,z0)=하단 기준
  // 전부 기존 폐형 재사용: 스트링거 내접 연립·트레드 측면 체결·포스트 셰이브·레일 중심 규약.
  const flight = (tag, n, x0, z0, y0, dir) => {
    const runF = n * tread;
    const riseF = n * riser;
    let thS = Math.atan2(riseF, runF);
    for (let it = 0; it < 4; it++) thS = Math.atan2(riseF - strH * Math.cos(thS), runF - strH * Math.sin(thS));
    const Ls = (riseF - strH * Math.cos(thS)) / Math.sin(thS);
    const yStr = [y0, y0 + width - strT];
    const xm = x0 + (dir * runF) / 2;
    for (const [si, y] of yStr.entries()) {
      chordBoxX(P, `${tag}_stringer_${si + 1}`, xm, z0 + riseF / 2, dir > 0 ? thS : -thS, Ls, strH, y, strT, 'steel', 'stringer');
    }
    for (let k = 0; k < n; k++) {
      const txk = dir > 0 ? x0 + k * tread : x0 - (k + 1) * tread;
      P(`${tag}_tread_${k + 1}`, 'box', { width: tread, depth: width - 2 * strT, height: tThk },
        { tx: txk, ty: y0 + strT, tz: z0 + (k + 1) * riser - tThk }, 'steel', 'tread');
    }
    const postEvery = Math.max(1, Math.floor(n / 4));
    const shave = (postS / 2) * (riser / tread) + 1;
    for (const [si] of yStr.entries()) {
      const yPost = si === 0 ? y0 + strT + 5 : y0 + width - strT - postS - 5;
      let nP2 = 0;
      for (let k = 0; k < n; k += postEvery) {
        const txk = dir > 0 ? x0 + k * tread + (tread - postS) / 2 : x0 - (k + 1) * tread + (tread - postS) / 2;
        P(`${tag}_post_${si + 1}_${++nP2}`, 'box', { width: postS, depth: postS, height: railH - shave },
          { tx: txk, ty: yPost, tz: z0 + (k + 1) * riser }, 'steel', 'post');
      }
      const kLast = Math.floor((n - 1) / postEvery) * postEvery;
      const xa = dir > 0 ? x0 + tread / 2 : x0 - tread / 2;
      const xb = dir > 0 ? x0 + kLast * tread + tread / 2 : x0 - kLast * tread - tread / 2;
      const za = z0 + riser + railH, zb = z0 + (kLast + 1) * riser + railH;
      const thR = Math.atan2(zb - za, Math.abs(xb - xa));
      const Lr = Math.hypot(xb - xa, zb - za);
      chordBoxX(P, `${tag}_rail_${si + 1}`, (xa + xb) / 2, (za + zb) / 2 + (railS / 2) / Math.cos(thR), dir > 0 ? thR : -thR, Lr, railS, yPost, railS, 'steel', 'handrail');
    }
    return { runF, riseF };
  };
  const gap = 200; // 플라이트 사이 y 갭(U턴 관례)
  if (flights === 1) {
    const { runF } = flight('f1', nStep, 0, 0, 0, +1);
    P('landing', 'box', { width: tread * 2, depth: width - 2 * strT, height: tThk }, { tx: runF, ty: strT, tz: rise - tThk }, 'steel', 'landing');
    P('landing_leg_1', 'box', { width: 80, depth: 80, height: rise - tThk }, { tx: runF + tread * 2 - 80, ty: strT, tz: 0 }, 'steel', 'column');
    P('landing_leg_2', 'box', { width: 80, depth: 80, height: rise - tThk }, { tx: runF + tread * 2 - 80, ty: width - strT - 80, tz: 0 }, 'steel', 'column');
  } else {
    // U턴 2련: 플라이트1(+x, y=0열) → 중간참(양 열 전폭) → 플라이트2(−x, y=width+gap 열)
    const n1 = Math.ceil(nStep / 2), n2 = nStep - n1;
    const landW = Math.max(width + 100, 1100); // 참 깊이(x)
    const f1 = flight('f1', n1, 0, 0, 0, +1);
    const zL = n1 * riser;
    const totW = 2 * width + gap;
    P('mid_landing', 'box', { width: landW, depth: totW, height: tThk }, { tx: f1.runF, ty: 0, tz: zL - tThk }, 'steel', 'landing');
    for (const [li, [lx, ly]] of [[f1.runF + landW - 80, 0], [f1.runF + landW - 80, totW - 80], [f1.runF, 0], [f1.runF, totW - 80]].entries()) {
      P(`land_leg_${li + 1}`, 'box', { width: 80, depth: 80, height: zL - tThk }, { tx: lx, ty: ly, tz: 0 }, 'steel', 'column');
    }
    // 참 난간(회전측 x+ 연단)
    P('land_rail_post', 'box', { width: postS, depth: postS, height: railH }, { tx: f1.runF + landW - postS - 10, ty: totW / 2 - postS / 2, tz: zL }, 'steel', 'post');
    P('land_rail', 'box', { width: 60, depth: totW, height: railS }, { tx: f1.runF + landW - railS - 10, ty: 0, tz: zL + railH }, 'steel', 'handrail');
    if (n2 > 0) flight('f2', n2, f1.runF, zL, width + gap, -1);
    // 상부 착지(플라이트2 종점 x=f1.runF−n2·tread 쪽)
    const xTop = f1.runF - n2 * tread;
    P('top_landing', 'box', { width: tread * 2, depth: width - 2 * strT, height: tThk }, { tx: xTop - tread * 2, ty: width + gap + strT, tz: rise - tThk }, 'steel', 'landing');
    P('top_leg_1', 'box', { width: 80, depth: 80, height: rise - tThk }, { tx: xTop - tread * 2, ty: width + gap + strT, tz: 0 }, 'steel', 'column');
    P('top_leg_2', 'box', { width: 80, depth: 80, height: rise - tThk }, { tx: xTop - tread * 2, ty: width + gap + width - strT - 80, tz: 0 }, 'steel', 'column');
  }
  return {
    name: `산업 계단 H${rise / 1000}m×${nStep}단${flights === 2 ? ' U턴' : ''}`, domain: 'building', kind: 'assembly', parts,
    stairMeta: { totalRise: rise, steps: nStep, riser: +riser.toFixed(1), tread, width, railH, flights },
    note: `강재 ${flights === 2 ? 'U턴 2련' : '직선'} 계단(트레드=측면 체결·레일=경사 폐형·참=4주 지지) — 디딤판 무늬·볼트 상세 후속 명시. 구조검토=stairCheck 간이(비법정) 별도`,
  };
}

/** 엘리베이터 샤프트+카(260718 — 참고파일들2 반원형/트윈 대응은 직사각 간이 명시).
 *  샤프트 벽 3면+도어 개구 전면(층별 헤더/사이드), 가이드레일 2, 카+상부 머신빔·피트. */
function elevatorShaftAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const floors = Math.max(2, Math.min(30, Math.round(num(p.floors, 4))));
  const floorH = num(p.floorH, 3300);
  const carW = num(p.carW, 1600), carD = num(p.carD, 1500), carH = num(p.carH, 2300);
  const doorW = num(p.doorW, 900), doorH = num(p.doorH, 2100);
  const wallT = num(p.wallT, 200);
  const clr = 150; // 카-벽 주행 여유(관례)
  const pitD = num(p.pitDepth, 1500), ohH = num(p.overheadH, 4200);
  const shaftW = carW + 2 * clr + 2 * wallT;
  const shaftD = carD + 2 * clr + 2 * wallT;
  const H = floors * floorH + ohH;
  const shape = String(p.shape) === 'semicircular' ? 'semicircular' : 'rect';
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });

  if (shape === 'semicircular') {
    // 반원형 파노라마 엘베(참고파일들2 semi-circular/panoramic 대응): 후면 평벽(기계측 도어) +
    // 전면 반원 유리벽(멀리언 + 현-패널 rz 폐형). 원기하=현 분절 근사 명시.
    // 반경 R = 카 전면 코너가 반원에 내접하도록 산정(카가 반원 밖으로 관통하지 않게):
    const R = Math.ceil(Math.hypot(carW / 2, carD + clr) + clr);
    const sW = 2 * R, sD = R + wallT;         // 지름=2R·깊이=반경+후벽
    const cx = R, cyC = R;                     // 반원 중심(후벽 안쪽면)
    const nPan = Math.max(5, Math.min(16, Math.round(num(p.panels, 8))));
    const mw = 90, glassT = 40;
    P('pit_slab', 'box', { width: sW, depth: sD, height: 300 }, { tx: 0, ty: 0, tz: 0 }, 'concrete', 'slab');
    // 후면 평벽: 층별 도어 개구(사이드 2 + 헤더). y=[R, R+wallT]
    const sideW = (sW - doorW) / 2;
    for (let f = 0; f < floors; f++) {
      const z0 = 300 + f * floorH;
      P(`back_l_${f + 1}`, 'box', { width: sideW, depth: wallT, height: floorH }, { tx: 0, ty: R, tz: z0 }, 'concrete', 'wall');
      P(`back_r_${f + 1}`, 'box', { width: sideW, depth: wallT, height: floorH }, { tx: sW - sideW, ty: R, tz: z0 }, 'concrete', 'wall');
      P(`back_hdr_${f + 1}`, 'box', { width: doorW, depth: wallT, height: floorH - doorH }, { tx: sideW, ty: R, tz: z0 + doorH }, 'concrete', 'header');
    }
    P('back_top', 'box', { width: sW, depth: wallT, height: ohH }, { tx: 0, ty: R, tz: 300 + floors * floorH }, 'concrete', 'wall');
    // 반원 유리벽: a∈[0,π] → 점 (R−R·cosa, R−R·sina) — a0=좌코너·aπ=우코너·aπ/2=전면 정점
    const ptAt = (i) => { const a = Math.PI * (i / nPan); return [cx - R * Math.cos(a), cyC - R * Math.sin(a)]; };
    for (let i = 0; i <= nPan; i++) {
      const [px, py] = ptAt(i);
      // 스프링라인 멀리언(i=0/nPan)=후벽 플러시(코너 0겹침): x 풋프린트 안쪽·y 벽 앞
      const tx = i === 0 ? 0 : i === nPan ? sW - mw : px - mw / 2;
      const ty = (i === 0 || i === nPan) ? R - mw : py - mw / 2;
      P(`mullion_${i}`, 'box', { width: mw, depth: mw, height: H }, { tx, ty, tz: 300 }, 'steel', 'mullion');
    }
    for (let i = 0; i < nPan; i++) {
      const [x0, y0] = ptAt(i), [x1, y1] = ptAt(i + 1);
      chordBoxZrz(P, `glass_${i + 1}`, x0, y0, x1, y1, glassT, 300, H - 600, 'glass', 'glazing', mw + 15);
    }
    // 가이드레일 2(후벽 안쪽) + 카(후벽 앞 clr) + 머신빔 + 완충기
    const railInY = R - 70;
    for (const [ri, x] of [[0, wallT], [1, sW - wallT - 90]]) {
      P(`rail_${ri + 1}`, 'box', { width: 90, depth: 70, height: H - 300 - 450 }, { tx: x, ty: railInY, tz: 300 }, 'steel', 'guiderail');
    }
    const carY = R - clr - carD;
    P('buffer', 'box', { width: 300, depth: 300, height: pitD }, { tx: cx - 150, ty: carY + (carD - 300) / 2, tz: 300 }, 'steel', 'buffer');
    P('car', 'box', { width: carW, depth: carD, height: carH }, { tx: cx - carW / 2, ty: carY, tz: 300 + pitD }, 'steel', 'car');
    P('machine_beam', 'box', { width: sW - 2 * wallT, depth: 300, height: 400 }, { tx: wallT, ty: R - 300, tz: 300 + H - 400 }, 'steel', 'beam');
    return {
      name: `반원 파노라마 엘베 ${floors}층`, domain: 'building', kind: 'assembly', parts,
      elevMeta: { floors, floorH, shaftW: sW, shaftD: sD, carW, carD, pitD, ohH, shape: 'semicircular', panels: nPan, radius: R },
      note: '반원 파노라마 엘베(전면 유리=현 분절 근사·원기하 아님 명시·반경=카 내접 산정·후벽 도어)·카=1층 정지. 승강기 안전기준(KC) 검토 미포함 — 명시',
    };
  }

  // 피트 바닥 + 3면 벽(후면·좌우) 전고
  P('pit_slab', 'box', { width: shaftW, depth: shaftD, height: 300 }, { tx: 0, ty: 0, tz: 0 }, 'concrete', 'slab');
  P('wall_back', 'box', { width: shaftW, depth: wallT, height: H }, { tx: 0, ty: shaftD - wallT, tz: 300 }, 'concrete', 'wall');
  P('wall_left', 'box', { width: wallT, depth: shaftD - wallT, height: H }, { tx: 0, ty: 0, tz: 300 }, 'concrete', 'wall');
  P('wall_right', 'box', { width: wallT, depth: shaftD - wallT, height: H }, { tx: shaftW - wallT, ty: 0, tz: 300 }, 'concrete', 'wall');
  // 전면: 층별 도어 개구(사이드 2 + 헤더) — 개구=부재 생략 표현. 좌우 벽과 x-겹침 방지(코너 0겹침)
  const sideW = (shaftW - doorW) / 2;
  for (let f = 0; f < floors; f++) {
    const z0 = 300 + f * floorH;
    P(`front_l_${f + 1}`, 'box', { width: sideW - wallT, depth: wallT, height: floorH }, { tx: wallT, ty: 0, tz: z0 }, 'concrete', 'wall');
    P(`front_r_${f + 1}`, 'box', { width: sideW - wallT, depth: wallT, height: floorH }, { tx: shaftW - sideW, ty: 0, tz: z0 }, 'concrete', 'wall');
    P(`front_hdr_${f + 1}`, 'box', { width: doorW, depth: wallT, height: floorH - doorH }, { tx: sideW, ty: 0, tz: z0 + doorH }, 'concrete', 'header');
  }
  P('front_top', 'box', { width: shaftW - 2 * wallT, depth: wallT, height: ohH }, { tx: wallT, ty: 0, tz: 300 + floors * floorH }, 'concrete', 'wall');
  // 가이드레일 2(좌우 벽 안쪽면 체결 — T레일 간이 box, 머신빔 하부까지)
  for (const [ri, x] of [[0, wallT], [1, shaftW - wallT - 90]].map((v) => v)) {
    P(`rail_${ri + 1}`, 'box', { width: 90, depth: 70, height: H - 300 - 450 }, { tx: x, ty: wallT + (shaftD - 2 * wallT - 70) / 2, tz: 300 }, 'steel', 'guiderail');
  }
  // 카(1층 위치) — 피트 완충기 위 정지 상태(실승강기 관례 — 로프 현가 대신 정지 지지 명시)
  P('buffer', 'box', { width: 300, depth: 300, height: pitD }, { tx: wallT + clr + (carW - 300) / 2, ty: wallT + clr + (carD - 300) / 2, tz: 300 }, 'steel', 'buffer');
  P('car', 'box', { width: carW, depth: carD, height: carH }, { tx: wallT + clr, ty: wallT + clr, tz: 300 + pitD }, 'steel', 'car');
  P('machine_beam', 'box', { width: shaftW - 2 * wallT, depth: 300, height: 400 }, { tx: wallT, ty: (shaftD - 300) / 2, tz: 300 + H - 400 }, 'steel', 'beam');
  return {
    name: `엘리베이터 샤프트 ${floors}층`, domain: 'building', kind: 'assembly', parts,
    elevMeta: { floors, floorH, shaftW, shaftD, carW, carD, pitD, ohH },
    note: '직사각 샤프트 간이(반원형·트윈 유리샤프트는 후속 명시)·도어 개구=부재 생략 표현·카=1층 정지 위치. 승강기 안전기준(KC) 검토 미포함 — 명시',
  };
}

/** HVAC 덕트런(트렁크+분기+디퓨저 드롭 — 260718, 참고파일들2 덕트워크 대응).
 *  천장 슬래브(기둥 4) 아래 행어 로드(인장 선언)로 매닮 — supportCheck 인장 체인 실증. */
function ductRunAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const L = num(p.length, 18000);
  const tw = num(p.trunkW, 800), th2 = num(p.trunkH, 400);
  const nBrRaw = Number(p.branches);
  const nBr = Math.max(0, Math.min(12, Number.isFinite(nBrRaw) && p.branches !== undefined && p.branches !== null && `${p.branches}` !== '' ? Math.round(nBrRaw) : 4)); // 0 허용(num()은 0=기본값 — 260718)
  const bw = num(p.branchW, 400), bh = num(p.branchH, 250), bl = num(p.branchLen, 2500);
  const ceilH = num(p.ceilingH, 3600);
  const slabT = 200, rodS = 20, hangEvery = num(p.hangerSpacing, 2500); // 로드 20mm(전산볼트 관례 — 15mm 미만은 지지 접촉면 미달)
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 슬래브 + 기둥 4(슬래브 지지 — 매닮 체인의 접지 근원)
  const slabW = L + 2000, slabD = bl * 2 + tw + 2000;
  P('slab', 'box', { width: slabW, depth: slabD, height: slabT }, { tx: -1000, ty: -(bl + 1000), tz: ceilH }, 'concrete', 'slab');
  for (const [ci, [x, y]] of [[-800, -(bl + 800)], [L + 500, -(bl + 800)], [-800, bl + tw + 500], [L + 500, bl + tw + 500]].entries()) {
    P(`col_${ci + 1}`, 'box', { width: 300, depth: 300, height: ceilH }, { tx: x, ty: y, tz: 0 }, 'concrete', 'column');
  }
  // 트렁크(y=0..tw) — 상면 z = ceilH − 300(행어 로드 길이)
  const zTop = ceilH - 300;
  P('trunk', 'box', { width: L, depth: tw, height: th2 }, { tx: 0, ty: 0, tz: zTop - th2 }, 'steel', 'duct');
  // 행어 로드(인장 선언 role hanger): 슬래브 하면 ↔ 트렁크 상면
  let nR = 0;
  for (let x = hangEvery / 2; x < L; x += hangEvery) {
    for (const y of [tw * 0.2, tw * 0.8 - rodS]) {
      P(`rod_${++nR}`, 'box', { width: rodS, depth: rodS, height: 300 }, { tx: x, ty: y, tz: zTop }, 'steel', 'hanger');
    }
  }
  // 분기(교대로 ±y) + 디퓨저 드롭 + 분기 행어
  for (let b = 0; b < nBr; b++) {
    const x = ((b + 1) * L) / (nBr + 1);
    const side = b % 2 === 0 ? +1 : -1;
    const y0 = side > 0 ? tw : -bl;
    P(`branch_${b + 1}`, 'box', { width: bw, depth: bl, height: bh }, { tx: x - bw / 2, ty: y0, tz: zTop - bh }, 'steel', 'duct');
    const yEnd = side > 0 ? tw + bl - bw : -bl;
    P(`drop_${b + 1}`, 'box', { width: bw, depth: bw, height: zTop - bh - 2600 }, { tx: x - bw / 2, ty: side > 0 ? tw + bl - bw : -bl, tz: 2600 }, 'steel', 'duct');
    P(`diffuser_${b + 1}`, 'box', { width: bw + 150, depth: bw + 150, height: 60 }, { tx: x - bw / 2 - 75, ty: (side > 0 ? tw + bl - bw : -bl) - 75, tz: 2540 }, 'steel', 'duct');
    P(`rod_br_${b + 1}`, 'box', { width: rodS, depth: rodS, height: 300 + bh - th2 + (th2 - bh) }, { tx: x, ty: side > 0 ? tw + bl - bw / 2 : -bl + bw / 2, tz: zTop - bh + bh }, 'steel', 'hanger');
    void yEnd;
  }
  return {
    name: `HVAC 덕트런 ${L / 1000}m·분기 ${nBr}`, domain: 'building', kind: 'assembly', parts,
    ductMeta: { length: L, trunkW: tw, trunkH: th2, branches: nBr, ceilingH: ceilH },
    note: '사각 덕트 간이(원형·보온·댐퍼·기류 계산 미포함 명시)·지지=행어 로드 인장 선언(supportCheck 매닮 체인)·환기량 검토=interior-check 별도',
  };
}

/** 박공지붕 단독주택 셸(260718 — 참고파일들2 주택 DWG 대응 간이).
 *  벽 4면(창·문 개구=부재 생략)+슬래브+경사 지붕판 2(캐노피 rx 규약)+박공=계단형 근사 명시. */
function gableHouseAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 9000);   // x(용마루 방향)
  const D = num(p.depth, 7000);   // y(경사 방향)
  const wallH = num(p.wallH, 2700), wallT = 200;
  const pitch = Math.max(10, Math.min(45, num(p.pitchDeg, 30)));
  const roofT = num(p.roofThk, 150);
  const doorW = num(p.doorW, 1000), doorH = 2100;
  const winW = num(p.windowW, 1500), winH = 1200, sillH = 900;
  const th = (pitch * Math.PI) / 180;
  const halfD = D / 2;
  const ridgeH = wallH + halfD * Math.tan(th);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  P('slab', 'box', { width: W, depth: D, height: 200 }, { tx: 0, ty: 0, tz: 0 }, 'concrete', 'slab');
  // 전면(y=0): 문+창 개구 — 세그먼트 분해
  const segY0 = [
    ['f_l', wallT, W * 0.25 - doorW / 2 - wallT, 0, wallH],
    ['f_door_hdr', W * 0.25 - doorW / 2, doorW, doorH, wallH - doorH],
    ['f_m', W * 0.25 + doorW / 2, W * 0.55 - winW / 2 - (W * 0.25 + doorW / 2), 0, wallH],
    ['f_win_sill', W * 0.55 - winW / 2, winW, 0, sillH],
    ['f_win_hdr', W * 0.55 - winW / 2, winW, sillH + winH, wallH - sillH - winH],
    ['f_r', W * 0.55 + winW / 2, W - wallT - (W * 0.55 + winW / 2), 0, wallH],
  ];
  for (const [id, x, w, z, h] of segY0) {
    if (w > 10 && h > 10) P(id, 'box', { width: w, depth: wallT, height: h }, { tx: x, ty: 0, tz: 200 + z }, 'concrete', 'wall');
  }
  P('wall_back', 'box', { width: W - 2 * wallT, depth: wallT, height: wallH }, { tx: wallT, ty: D - wallT, tz: 200 }, 'concrete', 'wall');
  // 지붕판 2 — **캐노피 서까래 검증 규약**(rx 단면중심 보정 cy/cz): 하면 라인이 처마 벽
  // 상단(z=200+wallH, y=0/D)을 지나고 정점에서 맞댐. 처마 내밈 ovh=300(y-스팬 기준).
  const ovh = 300;
  const cy = (roofT / 2) * Math.sin(th);
  const runY = halfD + ovh;                       // 판 1장의 y-스팬(처마→정점)
  const slopeLen = (runY - roofT * Math.sin(th)) / Math.cos(th); // AABB-스팬 폐형(캐노피 동일)
  const apex = 200 + wallH + halfD * Math.tan(th); // 정점 하면(양판 맞댐선)
  // rx 회전=코너 기준(placedAabb 규약): 하면 코너 라인이 (y=0, 벽 상단)·(y=halfD, apex) 를
  // 정확히 지나도록 tz 역산 — 초판 중심선 가정은 21mm 관통(그리드 검출).
  P('roof_front', 'box', { width: W + 600, depth: slopeLen, height: roofT },
    { tx: -300, ty: -ovh + 2 * cy, tz: 200 + wallH - (ovh - 2 * cy) * Math.tan(th), rx: +pitch }, 'timber', 'roof');
  P('roof_back', 'box', { width: W + 600, depth: slopeLen, height: roofT },
    { tx: -300, ty: halfD, tz: apex, rx: -pitch }, 'timber', 'roof');
  // 용마루: 상면이 양판 하면 경사 안쪽(50·tanθ 컷)에 들어가도록 — 판·용마루 0겹침 폐형
  const ridgeTz = apex - 50 * Math.tan(th) - 1 - 100;
  P('ridge', 'box', { width: W + 600, depth: 100, height: 100 }, { tx: -300, ty: halfD - 50, tz: ridgeTz }, 'timber', 'beam');
  // 박공 측벽: 본체 + 계단형 박공(지붕 하면 라인 안쪽으로만 — 260718 그리드 검출 폐형):
  //   단 g 상단 z = wallH+ (g+1)Δ ≤ 하면(zUnder)·양끝 y 에서 성립하도록 dep 역산.
  for (const [gi, x] of [[0, 0], [1, W - wallT]]) {
    P(`wall_side_${gi + 1}`, 'box', { width: wallT, depth: D, height: wallH }, { tx: x, ty: 0, tz: 200 }, 'concrete', 'wall');
    const nG = 3;
    const gTopMax = ridgeTz - 200; // 스택 최상단 = 용마루 하면
    const dZ = (gTopMax - wallH) / nG;
    for (let g = 0; g < nG; g++) {
      const topZ = wallH + (g + 1) * dZ;
      const yEdge = (topZ - wallH) / Math.tan(th) + 20; // 하면 라인 도달 y + 여유
      const dep = D - 2 * yEdge;
      if (dep < 300) continue;
      P(`gable_${gi + 1}_${g + 1}`, 'box', { width: wallT, depth: dep, height: dZ },
        { tx: x, ty: yEdge, tz: 200 + wallH + g * dZ }, 'concrete', 'wall');
    }
  }
  return {
    name: `박공 주택 ${W / 1000}×${D / 1000}m`, domain: 'building', kind: 'assembly', parts,
    houseMeta: { width: W, depth: D, wallH, pitchDeg: pitch, ridgeH: +ridgeH.toFixed(0) },
    note: '주택 셸 간이(개구=부재 생략·박공=계단형 3단 근사·지붕=경사 판 — 내부 칸막이/마감/설비 미포함 명시). 구조검토=building 체인 별도',
  };
}

/** 상가 매스+입면 개구부(260718 — 참고파일들2 SKP 입면 대응 간이).
 *  N층 슬래브/기둥 + 전면 파사드 그리드(필라스터·스팬드럴·쇼윈도) — 의장 디테일 미포함 명시. */
function commercialMassingAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 15000), D = num(p.depth, 12000);
  const floors = Math.max(1, Math.min(20, Math.round(num(p.floors, 4))));
  const f1H = num(p.groundH, 4200), fH = num(p.floorH, 3600);
  const bayW = num(p.bayW, 3000);
  const wallT = 250, slabT = 250, colS = 500;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const zOf = (f) => (f === 0 ? 0 : f1H + (f - 1) * fH);
  const totalH = f1H + (floors - 1) * fH;
  // 곡면 파사드(260718b): 전면(y≈0)이 얕은 원호로 −y 로 부풂. yFront(x)=−bulge·sin(πx/W).
  // 견고화: 전 파사드 요소는 슬래브 착지 지지(필라스터/스팬드럴 rz 각도차 코너겹침을 마진으로
  // 분리·슬래브를 전방 −bulge 까지 확장해 부푼 파사드를 받침 — 상부 트랜섬 밴드 생략(개방 storefront)).
  const curved = String(p.facade) === 'curved';
  const bulge = curved ? Math.max(300, num(p.facadeBulge, Math.round(W * 0.06))) : 0;
  const yFront = (x) => (curved ? -bulge * Math.sin((Math.PI * x) / W) : 0);
  const slabY0 = curved ? -bulge - 100 : 0, slabD = D - slabY0;
  for (let f = 0; f <= floors; f++) {
    P(`slab_${f}`, 'box', { width: W, depth: slabD, height: slabT }, { tx: 0, ty: slabY0, tz: zOf(f) }, 'concrete', 'slab');
  }
  const nBay = Math.max(2, Math.round(W / bayW));
  for (let f = 0; f < floors; f++) {
    const z0 = zOf(f) + slabT, h = zOf(f + 1) - z0;
    for (let i = 0; i <= nBay; i++) {
      const x = Math.min((i * W) / nBay, W - colS);
      P(`col_${f + 1}_${i}`, 'box', { width: colS, depth: colS, height: h }, { tx: x, ty: D - colS - 300, tz: z0 }, 'concrete', 'column');
    }
    // 전면 파사드: 필라스터(기둥 라인, 전고) + 스팬드럴(바닥 밴드, 슬래브 착지) — 베이별 세그먼트.
    // 곡면=y=yFront(호 절점)·현(chordBoxZrz, 마진 분리)·전 요소 슬래브 착지 / 평면=y0 기존 폐형.
    const pilXs = [];
    for (let i = 0; i <= nBay; i++) {
      const x = Math.min((i * W) / nBay, W - 300);
      pilXs.push(x);
      if (curved) chordBoxZrz(P, `pilaster_${f + 1}_${i}`, x, yFront(x), x + 300, yFront(x + 300), wallT, z0, h, 'concrete', 'wall', 2);
      else P(`pilaster_${f + 1}_${i}`, 'box', { width: 300, depth: wallT, height: h }, { tx: x, ty: 0, tz: z0 }, 'concrete', 'wall');
    }
    for (let i = 0; i < nBay; i++) {
      const xa = pilXs[i] + 300, xb = pilXs[i + 1];
      if (xb - xa < 50) continue;
      if (curved) {
        // 스팬드럴 바닥 밴드(슬래브 착지·필라스터 마진 분리) — 상부 개방(트랜섬 생략)
        chordBoxZrz(P, `spandrel_${f + 1}_${i}`, xa, yFront(xa), xb, yFront(xb), wallT, z0, f === 0 ? 600 : 900, 'concrete', 'wall', 220);
      } else if (f === 0) {
        P(`transom_1_${i}`, 'box', { width: xb - xa, depth: wallT, height: 400 }, { tx: xa, ty: 0, tz: z0 + h - 400 }, 'concrete', 'beam');
      } else {
        P(`spandrel_${f + 1}_${i}`, 'box', { width: xb - xa, depth: wallT, height: 900 }, { tx: xa, ty: 0, tz: z0 }, 'concrete', 'wall');
      }
    }
  }
  // 발코니(260718c — 참고파일들3 주거 SKP 대응): balcony:'true'(평면 파사드 전용 명시) —
  // 층별·베이별 돌출 슬래브(위층 슬래브 하면 캔틸레버=본 슬래브와 일체 명시) + 난간.
  if (String(p.balcony) === 'true' && !curved) {
    const bd = 1400, railH2 = 1100, railT = 60;
    for (let f = 1; f < floors; f++) {
      const zS = zOf(f);
      for (let i = 0; i < nBay; i++) {
        const xa = (i * W) / nBay + 320, xb = ((i + 1) * W) / nBay - 20;
        if (xb - xa < 600) continue;
        // 발코니 슬래브: 본 슬래브에서 전방(-y) 돌출 — 슬래브와 x/z 동일면(일체 타설 명시)
        P(`balc_${f}_${i}`, 'box', { width: xb - xa, depth: bd, height: slabT }, { tx: xa, ty: -bd, tz: zS }, 'concrete', 'balcony');
        P(`balcrail_${f}_${i}`, 'box', { width: xb - xa, depth: railT, height: railH2 }, { tx: xa, ty: -bd, tz: zS + slabT }, 'concrete', 'railing');
      }
    }
  }
  // 파라펫: 곡면=베이별 현 세그먼트(최상 슬래브 착지)·평면=전폭 1매.
  // 세그먼트 접합부 코너겹침(각도차)=신축이음 갭 마진으로 분리(마진∝bulge — 명시).
  if (curved) {
    const ppMargin = Math.round(60 + (wallT * bulge) / W);
    for (let i = 0; i < nBay; i++) {
      const xa = (i * W) / nBay, xb = ((i + 1) * W) / nBay;
      chordBoxZrz(P, `parapet_${i}`, xa, yFront(xa), xb, yFront(xb), wallT, zOf(floors) + slabT, 1100, 'concrete', 'parapet', ppMargin);
    }
  } else {
    P('parapet', 'box', { width: W, depth: wallT, height: 1100 }, { tx: 0, ty: 0, tz: zOf(floors) + slabT }, 'concrete', 'parapet');
  }
  // 후면 벽: 층별 세그먼트(슬래브 사이 — 관통 방지 폐형)
  for (let f = 0; f < floors; f++) {
    const z0 = zOf(f) + slabT, h = zOf(f + 1) - z0;
    P(`wall_back_${f + 1}`, 'box', { width: W, depth: wallT, height: h }, { tx: 0, ty: D - wallT, tz: z0 }, 'concrete', 'wall');
  }
  return {
    name: `상가 매스 ${floors}층 ${W / 1000}×${D / 1000}m`, domain: 'building', kind: 'assembly', parts,
    massingMeta: { width: W, depth: D, floors, totalH: +totalH.toFixed(0), bays: nBay },
    note: '매스+입면 그리드 간이(몰딩·코니스 등 의장 디테일 미포함 명시 — SKP 입면류의 정직 대응)·창=개구 생략 표현. 구조검토=building 체인 별도',
  };
}

/** 굴착기 버킷(판금 셸 — 260718, 참고파일들2 20t 버킷 SLDPRT 대응 간이).
 *  바닥 셸=원호 3분절(chordBoxX ry 미터 컷)·측판 2·컷팅엣지·투스 5·힌지 보스 2(cylinder rx). */
function excavatorBucketAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.width, 1500);      // 버킷 폭(y)
  const depth = num(p.depth, 1200);  // 개구 깊이(x)
  const H = num(p.height, 1100);
  const tS = num(p.shellThk, 25), tSide = num(p.sideThk, 20);
  const teeth = Math.max(3, Math.min(7, Math.round(num(p.teeth, 5))));
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 측판 2(수직 — 접지)
  for (const [si, y] of [[0, 0], [1, W - tSide]]) {
    P(`side_${si + 1}`, 'box', { width: depth, depth: tSide, height: H }, { tx: 0, ty: y, tz: 0 }, 'steel', 'sideplate');
  }
  // 바닥 셸: 후면 수직판(접지 — 측판 체결 판두께<fastenBear 라 지지 불성립, 260718 그리드) +
  // 바닥 원호 3분절(내접 y-면 체결·측판 사이)
  const innerY = tSide, innerD = W - 2 * tSide;
  P('back_shell', 'box', { width: tS, depth: innerD, height: H }, { tx: depth - tS, ty: innerY, tz: 0 }, 'steel', 'shell');
  const arcPts = [[0, tS], [depth * 0.35, 0.02 * H + tS], [depth * 0.7, 0.12 * H + tS], [depth - tS, H * 0.25]];
  for (let k = 0; k < arcPts.length - 1; k++) {
    const [x0, z0] = arcPts[k], [x1, z1] = arcPts[k + 1];
    const th = Math.atan2(z1 - z0, x1 - x0);
    const Lk = Math.hypot(x1 - x0, z1 - z0) - tS; // 미터 컷
    if (Lk > tS) chordBoxX(P, `shell_${k + 1}`, (x0 + x1) / 2, (z0 + z1) / 2, th, Lk, tS, innerY, innerD, 'steel', 'shell');
  }
  // 컷팅엣지(전연 수평판) + 투스
  P('cutting_edge', 'box', { width: 220, depth: innerD, height: tS * 1.6 }, { tx: -220, ty: innerY, tz: 0 }, 'steel', 'edge');
  for (let i = 0; i < teeth; i++) {
    const y = innerY + ((i + 0.5) * innerD) / teeth - 40;
    P(`tooth_${i + 1}`, 'box', { width: 180, depth: 80, height: 60 }, { tx: -400, ty: y, tz: 0 }, 'steel', 'tooth');
  }
  // 힌지 보스 2(cylinder rx — 상부 후면, 측판 상단 y-면 체결 위치)
  for (const [bi, y] of [[0, tSide], [1, W - tSide - 120]]) {
    P(`boss_${bi + 1}`, 'cylinder', { diameter: 160, length: 120 }, { tx: depth - 250, ty: y, tz: H - 100, rx: -90 }, 'steel', 'boss');
  }
  return {
    name: `굴착기 버킷 ${W / 1000}m`, domain: 'mech', kind: 'assembly', parts,
    bucketMeta: { width: W, depth, height: H, teeth },
    note: '판금 셸 간이(원호=3분절 미터 컷·투스=box 근사·보강 리브/립 플레이트 후속 명시). 굴착력·마모 검토 미포함',
  };
}

// (D) y-z 평면 현-박스(rx 중심 배치 — 260718f 크레인 좌우면 사재용): chordBoxX 의 축 교체판.
//     회전 AABB = ym±hy, zm±hz — 대칭 폐형 동일.
function chordBoxYrx(P, id, ym, zm, thetaRad, L, s, tx, width, material, role) {
  const c = Math.cos(thetaRad), sn = Math.sin(thetaRad);
  const ty = ym - (L / 2) * c + (s / 2) * sn;
  const tz = zm - (L / 2) * sn - (s / 2) * c;
  P(id, 'box', { width, depth: L, height: s }, { tx, ty, tz, rx: (thetaRad * 180) / Math.PI }, material, role);
  return { hy: (L * Math.abs(c) + s * Math.abs(sn)) / 2, hz: (L * Math.abs(sn) + s * Math.abs(c)) / 2 };
}

/** 원심 펌프 유닛(260718f — 코퍼스4 pump 대응 매싱). 베이스+받침 2+모터+커플링 가드+볼루트
 *  +흡입/토출 노즐. 수력 성능(양정·효율)·축계 정렬 검토 미포함 — pump_head 체인 별도. */
function pumpUnitAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const suctionD = num(p.suctionDia, 150), dischD = num(p.dischargeDia, 100);
  const voluteD = num(p.voluteDia, Math.round(suctionD * 3.2));
  const motorD = num(p.motorDia, 350), motorL = num(p.motorLen, 600);
  const axisH = num(p.axisH, Math.round(voluteD / 2 + 120));
  const baseL = motorL + voluteD + 500, baseW = Math.max(motorD, voluteD) + 200;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  P('base', 'box', { width: baseL, depth: baseW, height: 60 }, { tx: 0, ty: -baseW / 2, tz: 0 }, 'steel', 'frame');
  // 모터(축 x — cylinder ry=90) + 받침
  const motorX = 150;
  P('motor_ped', 'box', { width: motorL * 0.7, depth: motorD * 0.8, height: axisH - motorD / 2 - 60 }, { tx: motorX + motorL * 0.15, ty: -motorD * 0.4, tz: 60 }, 'steel', 'frame');
  P('motor', 'cylinder', { diameter: motorD, length: motorL }, { tx: motorX, ty: 0, tz: axisH, ry: 90 }, 'steel', 'motor');
  // 커플링 가드(모터-볼루트 사이)
  const capX = motorX + motorL;
  P('coupling_guard', 'box', { width: 180, depth: 160, height: axisH + 20 }, { tx: capX + 10, ty: -80, tz: 60 }, 'steel', 'guard'); // 바닥 착지 커버형(관례)
  // 볼루트 케이싱(원판 revolve — 축 x: ry=90) + 케이싱 받침
  const volX = capX + 200 + voluteD * 0.28;
  P('volute', 'revolve', { profile: [[0, 0], [voluteD / 2, 0], [voluteD / 2, voluteD * 0.55], [0, voluteD * 0.55]] }, { tx: volX, ty: 0, tz: axisH, ry: 90 }, 'castiron', 'pump');
  P('pump_ped', 'box', { width: voluteD * 0.5, depth: voluteD * 0.5, height: axisH - voluteD / 2 - 60 }, { tx: volX + 20, ty: -voluteD * 0.25, tz: 60 }, 'steel', 'frame');
  // 흡입(축방향 전면) / 토출(상향 수직) 노즐 + 플랜지
  const sucX = volX + voluteD * 0.55;
  P('suction_noz', 'cylinder', { diameter: suctionD, length: 200 }, { tx: sucX, ty: 0, tz: axisH, ry: 90 }, 'steel', 'inlet');
  P('discharge_noz', 'cylinder', { diameter: dischD, length: 250 }, { tx: volX, ty: 0, tz: axisH + voluteD / 2 }, 'steel', 'outlet');
  P('disch_flange', 'flange', { outerDia: dischD + 100, boreDia: dischD, thickness: 20, bcd: dischD + 55, boltHoleD: 18, boltCount: 8 }, { tx: volX, ty: 0, tz: axisH + voluteD / 2 + 250 }, 'steel', 'outlet');
  return {
    name: `원심 펌프 유닛 ${suctionD}/${dischD}`, domain: 'mech', kind: 'assembly', parts,
    pumpMeta: { suctionDia: suctionD, dischargeDia: dischD, voluteDia: voluteD, motorDia: motorD, axisH },
    note: '펌프 유닛 매싱(임펠러·축계·메커니컬실 미포함 명시)·수력 성능=pump_head 체인 별도. 축 정렬·기초 볼트 상세 후속',
  };
}

/** 게이트 밸브 스탠드 전시(260718f — 코퍼스4 valve 대응 매싱). 몸통 revolve+플랜지 2+보닛+
 *  스템+핸드휠(토러스). 압력-온도 등급·시트 누설 검토 미포함. */
function gateValveAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const dn = num(p.dn, 150);
  const faceL = Math.round(dn * 1.6) + 100; // 면간 근사
  const bodyD = Math.round(dn * 1.8);
  const standH = num(p.standH, 500);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const zc = standH + bodyD / 2;
  // 전시 스탠드(받침 2)
  P('stand_base', 'box', { width: faceL + 200, depth: bodyD, height: 40 }, { tx: -100, ty: -bodyD / 2, tz: 0 }, 'steel', 'frame');
  for (const [si, x] of [[0, 40], [1, faceL - 120]]) {
    P(`stand_${si + 1}`, 'box', { width: 80, depth: bodyD * 0.6, height: standH - 40 }, { tx: x, ty: -bodyD * 0.3, tz: 40 }, 'steel', 'frame');
  }
  // 몸통(축 x revolve) + 플랜지 2(ry=90)
  P('body', 'revolve', { profile: [[0, 0], [bodyD / 2, 0], [bodyD / 2, faceL - 40], [0, faceL - 40]] }, { tx: 20, ty: 0, tz: zc, ry: 90 }, 'castiron', 'valve');
  for (const [fi, x] of [[0, 0], [1, faceL - 20]]) {
    P(`flange_${fi + 1}`, 'flange', { outerDia: dn + 130, boreDia: dn, thickness: 20, bcd: dn + 75, boltHoleD: 18, boltCount: 8 }, { tx: x, ty: 0, tz: zc, ry: 90 }, 'castiron', 'valve');
  }
  // 보닛(수직 원뿔대) + 스템 + 핸드휠(토러스 revolve)
  const bonX = faceL / 2;
  P('bonnet', 'revolve', { profile: [[0, 0], [bodyD * 0.32, 0], [bodyD * 0.2, dn * 0.9], [0, dn * 0.9]] }, { tx: bonX, ty: 0, tz: zc + bodyD / 2 }, 'castiron', 'valve');
  P('stem', 'cylinder', { diameter: Math.max(20, dn * 0.15), length: dn * 0.9 }, { tx: bonX, ty: 0, tz: zc + bodyD / 2 + dn * 0.9 }, 'steel', 'shaft');
  const hwR = dn * 0.8, hwT = Math.max(16, dn * 0.1);
  // 핸드휠 토러스 하연=스템 상면(0겹침) — 지지=shaft×joint 선언 체결
  P('handwheel', 'revolve', { profile: Array.from({ length: 9 }, (_, k) => { const a = (2 * Math.PI * k) / 8; return [hwR + (hwT / 2) * Math.cos(a), (hwT / 2) * Math.sin(a)]; }) }, { tx: bonX, ty: 0, tz: zc + bodyD / 2 + 2 * dn * 0.9 + hwT / 2 }, 'steel', 'joint');
  return {
    name: `게이트 밸브 DN${dn}(전시 스탠드)`, domain: 'mech', kind: 'assembly', parts,
    valveMeta: { dn, faceToFace: faceL, bodyDia: bodyD },
    note: '밸브 매싱(게이트/시트 내부 미포함 명시)·전시 스탠드 배치. 압력-온도 등급(KS B 2308)·면간 표준 검토 미포함',
  };
}

/** 타워 크레인(260718f — 코퍼스4 crane 대응). 마스트=4현재+4면 지그재그 사재(내접 연립,
 *  전후면 ry=chordBoxX·좌우면 rx=chordBoxYrx)+지브 트러스+카운터지브/웨이트+타이바(인장)+
 *  운전실+훅(인장 로프). 정격하중표·전도 검토 미포함 — 형상·물량·도서만. */
function towerCraneAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const mastH = num(p.mastH, 30000);
  const mastW = num(p.mastW, 1600);         // 마스트 정사각 한 변(현재 중심 간)
  const jibLen = num(p.jibLen, 35000);
  const cjLen = num(p.counterJibLen, Math.round(jibLen * 0.32));
  const chS = num(p.chordS, 160), dS = num(p.diagS, 90);
  const panelH = num(p.panelH, 1500);
  const nP = Math.max(4, Math.round(mastH / panelH));
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 베이스(십자 앵커 블록)
  P('base_block', 'box', { width: mastW * 2.2, depth: mastW * 2.2, height: 500 }, { tx: -mastW * 0.6, ty: -mastW * 0.6, tz: 0 }, 'concrete', 'base');
  // 마스트 현재 4(수직) — 베이스 위
  const cXY = [[0, 0], [mastW - chS, 0], [0, mastW - chS], [mastW - chS, mastW - chS]];
  for (const [ci, [x, y]] of cXY.entries()) {
    P(`chord_${ci + 1}`, 'box', { width: chS, depth: chS, height: mastH }, { tx: x, ty: y, tz: 500 }, 'steel', 'chord');
  }
  // 4면 지그재그 사재(면별 내접 연립 — 클리어존: 현재 안쪽면 사이 × 패널 높이)
  const Wc = mastW - 2 * chS - 2; // 면 내 클리어 폭
  let thM = Math.atan2(panelH, Wc);
  for (let it = 0; it < 4; it++) thM = Math.atan2(panelH - dS * Math.cos(thM), Wc - dS * Math.sin(thM));
  const Lm = (panelH - dS * Math.cos(thM)) / Math.sin(thM);
  if (Lm > dS * 2) {
    for (let k = 0; k < nP; k++) {
      const zm = 500 + k * panelH + panelH / 2;
      const up = k % 2 === 0;
      // 전면(y=0 스트립)·후면: x-z 평면 ry
      chordBoxX(P, `dF_${k + 1}`, mastW / 2 - chS / 2 + chS / 2, zm, up ? thM : -thM, Lm, dS, (chS - dS) / 2, dS, 'steel', 'diagonal');
      chordBoxX(P, `dB_${k + 1}`, mastW / 2 - chS / 2 + chS / 2, zm, up ? -thM : thM, Lm, dS, mastW - chS + (chS - dS) / 2, dS, 'steel', 'diagonal');
      // 좌면(x=0 스트립)·우면: y-z 평면 rx
      chordBoxYrx(P, `dL_${k + 1}`, mastW / 2 - chS / 2 + chS / 2, zm, up ? thM : -thM, Lm, dS, (chS - dS) / 2, dS, 'steel', 'diagonal');
      chordBoxYrx(P, `dR_${k + 1}`, mastW / 2 - chS / 2 + chS / 2, zm, up ? -thM : thM, Lm, dS, mastW - chS + (chS - dS) / 2, dS, 'steel', 'diagonal');
    }
  }
  const topZ = 500 + mastH;
  // 턴테이블 + 운전실(슬루 위 — 평면 겹침 확보로 지지 폐형)
  P('slew', 'cylinder', { diameter: mastW * 1.1, length: 400 }, { tx: mastW / 2, ty: mastW / 2, tz: topZ }, 'steel', 'joint');
  P('cab', 'box', { width: 1800, depth: 1500, height: 2200 }, { tx: mastW / 2 + 550, ty: (mastW - 1500) / 2, tz: topZ + 400 }, 'steel', 'cab'); // 피벗 우측면 밖(0겹침)·슬루 상면 걸침
  // 지브 기준면: 캡 상부 클리어(캡×지브 간섭 해소 — 260718f 그리드)
  const jz = topZ + 400 + 2200 + 200;
  const jH = 1400, jW2 = 1000;
  // 피벗 마운트(슬루 상면→지브 하현 하면 — 지브/카운터지브/헤드의 지지 근원)
  P('pivot', 'box', { width: mastW / 2 + 500 + 300, depth: jW2, height: jz - (topZ + 400) }, { tx: -300, ty: (mastW - jW2) / 2, tz: topZ + 400 }, 'steel', 'joint');
  const jy = [(mastW - jW2) / 2, (mastW + jW2) / 2 - 120];
  for (const [ji, y] of jy.entries()) {
    P(`jib_bot_${ji + 1}`, 'box', { width: jibLen, depth: 120, height: 120 }, { tx: mastW / 2 + 200, ty: y, tz: jz }, 'steel', 'chord');
  }
  P('jib_top', 'box', { width: jibLen * 0.85, depth: 120, height: 120 }, { tx: mastW / 2 + 200, ty: mastW / 2 - 60, tz: jz + 120 + jH }, 'steel', 'chord');
  const nJp = Math.max(4, Math.round(jibLen / 2500));
  for (let k = 0; k < nJp; k++) {
    const x = mastW / 2 + 200 + ((k + 0.5) * jibLen * 0.85) / nJp;
    P(`jib_v_${k + 1}`, 'box', { width: 90, depth: jW2, height: jH }, { tx: x, ty: (mastW - jW2) / 2, tz: jz + 120 }, 'steel', 'vertical'); // 격막형(양 하현 걸침 — 지지 폐형)
  }
  // 카운터지브(피벗 상면 착지) + 카운터웨이트
  P('cjib', 'box', { width: cjLen, depth: jW2, height: 300 }, { tx: -cjLen, ty: (mastW - jW2) / 2, tz: jz }, 'steel', 'deck');
  P('cweight', 'box', { width: Math.round(cjLen * 0.35), depth: jW2 * 0.9, height: 1400 }, { tx: -cjLen, ty: (mastW - jW2 * 0.9) / 2, tz: jz + 300 }, 'concrete', 'counterweight');
  // 타워헤드(피벗 상면) + 타이바 2(인장 — 내접 연립 chordBoxX)
  const headH = 4500;
  P('head', 'box', { width: 400, depth: 400, height: headH + 120 }, { tx: mastW / 2 - 200, ty: mastW / 2 - 200, tz: jz }, 'steel', 'chord');
  const tie = (id, x0, x1, z0, z1) => {
    const Wx = Math.abs(x1 - x0) - 20, Hz = Math.abs(z1 - z0);
    let th = Math.atan2(Hz, Wx);
    for (let it = 0; it < 4; it++) th = Math.atan2(Hz - 60 * Math.cos(th), Wx - 60 * Math.sin(th));
    const Lt = (Hz - 60 * Math.cos(th)) / Math.sin(th);
    if (Lt > 120) chordBoxX(P, id, (x0 + x1) / 2, (z0 + z1) / 2, x1 > x0 ? -th : th, Lt, 60, mastW / 2 - 30, 60, 'steel', 'stay');
  };
  tie('tie_jib', mastW / 2 + 220, mastW / 2 + 200 + jibLen * 0.6, jz + headH + 120, jz + 120 + jH + 120); // 정착=상현 상면(수직재/상현 관통 방지)
  tie('tie_cjib', mastW / 2 - 200 - (cjLen * 0.8 - 200), mastW / 2 - 200, jz + 250, jz + 120 + headH);
  // 트롤리 + 훅 로프(인장) + 훅 블록
  // 트롤리 x=수직재(격막) 사이 갭 중앙 스냅(장지브 충돌 방지 — 260718f 그리드)
  const jPitch = (jibLen * 0.85) / nJp;
  const trX = mastW / 2 + 200 + Math.round(nJp * 0.55) * jPitch - 350;
  // 트롤리=하현 상면 주행 근사(실기계=하부 주행 — 매싱 명시), 로프=인장 매닮
  P('trolley', 'box', { width: 700, depth: jW2, height: 250 }, { tx: trX, ty: (mastW - jW2) / 2, tz: jz + 120 }, 'steel', 'trolley');
  const ropeL = num(p.hookDrop, 8000);
  P('hoist_rope', 'box', { width: 30, depth: 30, height: ropeL }, { tx: trX + 335, ty: mastW / 2 - 15, tz: jz + 120 - ropeL }, 'steel', 'cable');
  P('hook_block', 'box', { width: 400, depth: 300, height: 600 }, { tx: trX + 150, ty: mastW / 2 - 150, tz: jz + 120 - ropeL - 600 }, 'steel', 'hook');
  return {
    name: `타워 크레인 H${mastH / 1000}m·지브 ${jibLen / 1000}m`, domain: 'mech', kind: 'assembly', parts,
    craneMeta: { mastH, mastW, jibLen, counterJibLen: cjLen, panels: nP },
    note: '타워 크레인 매싱+격자(지브 트러스 간이·권상 기구 미포함 명시). 정격하중표·전도/풍하중(KS B 6217) 검토 미포함 — 형상·물량·도서만',
  };
}

/** 수직 사일로/저장탱크(260718f — 코퍼스4 silo/tank 대응). revolve 셸(원통+콘 호퍼+지붕 콘)
 *  + 지지 다리 4(대각 배치 — revolve×box 반경 정밀로 간섭 0 폐형). 내압/풍하중 검토 미포함. */
function tankSiloAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const D = num(p.diameter, 3000), R = D / 2;
  const shellH = num(p.shellH, 6000);
  const t = num(p.wallThk, 6);
  const hopper = String(p.hopper ?? 'yes') !== 'no';
  const hopperH = hopper ? num(p.hopperH, Math.round(D * 0.7)) : 0;
  const outletD = num(p.outletDia, 300);
  const legH = num(p.legH, hopper ? hopperH + 600 : 800);
  const legS = num(p.legSize, 150);
  const roofH = Math.round(D * 0.18);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const z0 = legH; // 셸 하단(콘 상단 기준선)
  // 콘 호퍼 셸(원뿔대 링 — 폐단면 사다리꼴 회전) 또는 평 바닥
  if (hopper) {
    P('hopper', 'revolve', { profile: [[outletD / 2, z0 - hopperH], [outletD / 2 + t, z0 - hopperH], [R, z0 - t], [R, z0], [outletD / 2, z0 - hopperH + t]] }, { tx: 0, ty: 0, tz: 0 }, 'steel', 'shell');
  } else {
    P('bottom', 'revolve', { profile: [[0, z0 - t], [R, z0 - t], [R, z0], [0, z0]] }, { tx: 0, ty: 0, tz: 0 }, 'steel', 'shell');
  }
  // 원통 셸(링 단면 회전)
  P('shell', 'revolve', { profile: [[R - t, z0], [R, z0], [R, z0 + shellH], [R - t, z0 + shellH]] }, { tx: 0, ty: 0, tz: 0 }, 'steel', 'shell');
  // 지붕 콘
  P('roof', 'revolve', { profile: [[0, z0 + shellH + roofH], [R, z0 + shellH], [R, z0 + shellH + t], [0, z0 + shellH + roofH + t]] }, { tx: 0, ty: 0, tz: 0 }, 'steel', 'roof');
  // 지지 다리 4(대각 45° — 안쪽 코너 반경 R+0.1: revolve×box 반경 정밀 폐형으로 간섭 0.
  // 다리↔셸 러그 용접 상세=후속 명시 — 지지=AABB 체결 규칙로 성립)
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) + (i * Math.PI) / 2;
    const inner = (R + 0.1) / Math.SQRT2; // 안쪽 코너 좌표(45° 대각)
    const sx = Math.cos(a) >= 0 ? inner : -inner - legS;
    const sy = Math.sin(a) >= 0 ? inner : -inner - legS;
    P(`leg_${i + 1}`, 'box', { width: legS, depth: legS, height: z0 + 300 }, { tx: sx, ty: sy, tz: 0 }, 'steel', 'column');
  }
  return {
    name: `사일로 D${D / 1000}m${hopper ? '+호퍼' : ''}`, domain: 'mech', kind: 'assembly', parts,
    tankMeta: { diameter: D, shellH, hopper, hopperH, wallThk: t, capacityM3: +((Math.PI * R * R * shellH + (hopper ? (Math.PI * hopperH / 3) * (R * R + R * outletD / 2 + outletD * outletD / 4) : 0)) / 1e9).toFixed(2) },
    note: '셸=revolve 링 단면(파푸스 정밀 물량)·용량=기하 폐형·러그=셸 접촉 명시. 내압·좌굴·풍/지진·KS B 6283 검토 미포함 — 명시',
  };
}

/** 횡형 압력용기(260718f — 코퍼스4 ASME vessel 대응). 원통 셸+2:1 반타원 경판(revolve 8분할)
 *  rx=90 횡전+새들 2 — 새들 상면=셸 최하선 접선(0겹침). ASME/KS 압력 설계 미포함. */
function pressureVesselAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const D = num(p.diameter, 1600), R = D / 2;
  const L = num(p.shellLen, 4000);
  const t = num(p.wallThk, 12);
  const saddleH = num(p.saddleH, 600);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const zc = saddleH + R; // 축 높이
  // 셸(rx=90: z→y 축 회전 — 횡형): revolve 링, at.rx=90 로 눕힘. 배치 원점=축 y0 시작.
  P('shell', 'revolve', { profile: [[R - t, 0], [R, 0], [R, L], [R - t, L]] }, { tx: 0, ty: 0, tz: zc, rx: -90 }, 'steel', 'shell');
  // 경판 2(2:1 반타원 셸 링 — 8분할 근사 명시): 외피 타원(R, R/2)·내피 타원(R−t, R/2−t) 폐곡선
  const headProf = (dir) => {
    const prof = [];
    for (let k = 0; k <= 8; k++) { const a = (Math.PI / 2) * (k / 8); prof.push([R * Math.cos(a), dir * (R / 2) * Math.sin(a)]); }
    for (let k = 8; k >= 0; k--) { const a = (Math.PI / 2) * (k / 8); prof.push([Math.max(0, (R - t) * Math.cos(a)), dir * (R / 2 - t) * Math.sin(a)]); }
    return prof;
  };
  P('head_A', 'revolve', { profile: headProf(-1) }, { tx: 0, ty: 0, tz: zc, rx: -90 }, 'steel', 'head');
  P('head_B', 'revolve', { profile: headProf(+1) }, { tx: 0, ty: L, tz: zc, rx: -90 }, 'steel', 'head');
  // 새들 2(상면=셸 최하선 z=saddleH — 접선 0겹침·bearing 지지)
  for (const [si, y] of [[0, L * 0.2], [1, L * 0.8]]) {
    P(`saddle_${si + 1}`, 'box', { width: D * 0.8, depth: 300, height: saddleH }, { tx: -D * 0.4, ty: y - 150, tz: 0 }, 'steel', 'saddle_sup');
  }
  // 노즐(상부 2 — 수직 원통, 셸 상면 접선에서 위로)
  for (const [ni, y] of [[0, L * 0.3], [1, L * 0.7]]) {
    P(`nozzle_${ni + 1}`, 'cylinder', { diameter: 200, length: 350 }, { tx: 0, ty: y, tz: zc + R }, 'steel', 'nozzle');
  }
  return {
    name: `압력용기 D${D}×L${L}`, domain: 'mech', kind: 'assembly', parts,
    vesselMeta: { diameter: D, shellLen: L, wallThk: t, headType: '2:1 반타원(8분할 근사)', volumeM3: +((Math.PI * (R - t) ** 2 * L + 2 * (2 / 3) * Math.PI * (R - t) ** 2 * (R / 2)) / 1e9).toFixed(2) },
    note: '경판=2:1 반타원 8분할 근사(ASME F&D 아님 명시)·내용적=폐형·새들=접선 지지. 압력 설계(ASME VIII/KS B 6750)·노즐 보강 검토 미포함 — 명시',
  };
}

/** 금형 캐비티 블록(260718d — 자유곡면 대응 ③). 블록−음형 차 형상(폐형 차 체적).
 *  기본 음형=회전체 보울(advJson cavity={type,params,at}로 어휘 부품·≤20k 메시 대체 가능).
 *  파팅면·구배각·수축률·러너/게이트=입력 원칙(미입력=미포함 명시) — 몰드베이스 표준 미적용. */
function moldCavityAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const W = num(p.blockW, 300), D = num(p.blockD, 250), H = num(p.blockH, 120);
  const cd = num(p.cavityDia, 160);
  // 기본 음형: 반구형 보울 revolve(상면 개방 — 8분할 프로파일)
  const rr = Math.min(cd / 2, W / 2 - 10, D / 2 - 10, H - 15);
  const prof = [];
  for (let k = 0; k <= 8; k++) { const a = (Math.PI / 2) * (k / 8); prof.push([rr * Math.cos(a), -rr * Math.sin(a)]); }
  prof.push([0, 0]);
  const cavity = p.cavity && p.cavity.type ? p.cavity : { type: 'revolve', params: { profile: prof.map(([r, z]) => [r, z + rr]) }, at: { tx: W / 2, ty: D / 2, tz: H - rr } };
  const parts = [
    { id: 'cavity_block', type: 'cavity_block', params: { blockW: W, blockD: D, blockH: H, cavity }, at: { tx: 0, ty: 0, tz: 0 }, material: 'S45C', role: 'mold' },
  ];
  return {
    name: `금형 캐비티 ${W}×${D}×${H}`, domain: 'mech', kind: 'assembly', parts,
    moldMeta: { blockW: W, blockD: D, blockH: H, cavityType: cavity.type },
    note: '블록−음형 차 형상(체적=폐형 차). 파팅면·구배각·수축률·러너/게이트/이젝터=입력 원칙(미입력=미포함 명시)·몰드베이스 표준(FUTABA 등) 미적용 — 명시',
  };
}

/** 기어 트레인(맞물림 기구학 — 260718d). 인벌류트 스퍼기어열: 중심거리=m(z₁+z₂)/2 **폐형**
 *  배치·맞물림 위상=반피치 오프셋·기어비 표. 베이스 플레이트+축(cylinder). 동력·강도 검토 미포함. */
function gearTrainAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const m = num(p.module, 3);
  const teethArr = Array.isArray(p.teeth) && p.teeth.length >= 2 ? p.teeth.map((z) => Math.max(10, Math.min(120, Math.round(Number(z) || 20)))) : [20, 40, 20, 60];
  const thk = num(p.thickness, 25), shaftD = num(p.shaftDia, Math.max(10, Math.round(m * 5)));
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 중심 x 좌표: x_{i+1} = x_i + m(z_i+z_{i+1})/2 — 표준 맞물림 중심거리(폐형)
  const xs = [0];
  for (let i = 1; i < teethArr.length; i++) xs.push(xs[i - 1] + (m * (teethArr[i - 1] + teethArr[i])) / 2);
  const rTip = (z) => (m * (z + 2)) / 2;
  const plateW = xs[xs.length - 1] + rTip(teethArr[0]) + rTip(teethArr[teethArr.length - 1]) + 40;
  const plateY = 2 * Math.max(...teethArr.map(rTip)) + 40;
  const px0 = -rTip(teethArr[0]) - 20;
  // 베이스=홀 선언 플레이트(축 관통=핀-보어 폐형 검증 분류)
  P('base_plate', 'plate_with_holes', {
    width: plateW, depth: plateY, thickness: 15,
    holes: xs.map((x) => ({ x: x - px0, y: plateY / 2, d: shaftD + 1 })),
  }, { tx: px0, ty: -plateY / 2, tz: 0 }, 'steel', 'frame');
  let ratio = 1;
  for (const [i, z] of teethArr.entries()) {
    // 맞물림 위상: 인접 기어는 반피치(180/z°) 회전 — 이빨-골 정합(관례)
    const phase = i % 2 === 1 ? 180 / z : 0;
    P(`shaft_${i + 1}`, 'cylinder', { diameter: shaftD, length: 15 + 30 + thk + 10 }, { tx: xs[i], ty: 0, tz: 0 }, 'steel', 'shaft');
    P(`gear_${i + 1}`, 'spur_gear', { module: m, teeth: z, thickness: thk, boreDia: shaftD }, { tx: xs[i], ty: 0, tz: 45, rz: phase }, 'S45C', 'gear');
    if (i >= 1) ratio *= teethArr[i] / teethArr[i - 1];
  }
  return {
    name: `기어 트레인 ${teethArr.join('-')} (m${m})`, domain: 'mech', kind: 'assembly', parts,
    gearMeta: {
      module: m, teeth: teethArr, thickness: thk,
      centerDistances: xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(2)),
      totalRatio: +ratio.toFixed(4), outputPer1000rpm: +(1000 / ratio).toFixed(1),
      pitchDias: teethArr.map((z) => m * z),
    },
    note: '맞물림 중심거리=m(z₁+z₂)/2 폐형 배치·위상=반피치(전위·백래시 0 가정 명시)·기어비 폐형. 강도(굽힘/면압)·윤활·동력 전달 검토 미포함',
  };
}

/** 4절 링크(Freudenstein 폐형 포즈 — 260718d). 접지·크랭크·커플러·로커, 입력각 θ₂ →
 *  θ₄ 폐형해(코사인 법칙 2회)·Grashof 판정 게이트·전달각. z-레이어 적층(실기구 관례 — 링크 비간섭). */
function fourBarAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const g = num(p.ground, 400), a = num(p.crank, 120), b = num(p.coupler, 350), c = num(p.rocker, 250);
  const th2 = ((Number(p.inputDeg ?? 60) % 360) * Math.PI) / 180;
  const lw = num(p.linkW, 40), lt = num(p.linkThk, 12), pinD = num(p.pinDia, 16);
  // Grashof: s+l ≤ p+q — 회전 가능성 판정(폐형)
  const sorted = [g, a, b, c].sort((x, y) => x - y);
  const grashof = sorted[0] + sorted[3] <= sorted[1] + sorted[2];
  // 폐형해: A=(0,0)·D=(g,0). B=크랭크 끝. BD 대각 → 코사인 법칙으로 C.
  const B = [a * Math.cos(th2), a * Math.sin(th2)];
  const dBD = Math.hypot(g - B[0], -B[1]);
  if (dBD > b + c - 1 || dBD < Math.abs(b - c) + 1) {
    return { name: '4절 링크', domain: 'mech', parts: [], alignmentErrors: [`입력각 ${Math.round((th2 * 180) / Math.PI)}° 에서 조립 불가(대각 ${Math.round(dBD)} vs 커플러+로커 ${b + c}) — Grashof=${grashof ? '충족' : '미충족'}`] };
  }
  const angBD = Math.atan2(-B[1], g - B[0]);
  const angCBD = Math.acos((b * b + dBD * dBD - c * c) / (2 * b * dBD));
  const C = [B[0] + b * Math.cos(angBD + angCBD), B[1] + b * Math.sin(angBD + angCBD)];
  // 전달각(커플러-로커 사이각 — 폐형)
  const mu = Math.acos(Math.max(-1, Math.min(1, (b * b + c * c - dBD * dBD) / (2 * b * c))));
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // z-레이어: 접지(0)·크랭크(z1)·커플러(z2)·로커(z1) — 인접 레이어만 핀 공유(실기구 적층 관례).
  // 링크=**홀 선언 플레이트**(양단 핀홀 — 핀-보어 관통 폐형 검증 분류·SCAD 실구멍)
  const zG = 0, z1 = 20, z2 = 20 + lt + 3;
  const bar = (id, A2, B2, z, role) => {
    const th = Math.atan2(B2[1] - A2[1], B2[0] - A2[0]);
    const L = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
    // 로컬: x=0..L+lw(보스 연장)·y=0..lw·홀=(lw/2, lw/2)·(L+lw/2, lw/2). 배치=A 보스 원점.
    const rzDeg = (th * 180) / Math.PI;
    const ox = A2[0] - (lw / 2) * Math.cos(th) + (lw / 2) * Math.sin(th);
    const oy = A2[1] - (lw / 2) * Math.sin(th) - (lw / 2) * Math.cos(th);
    P(id, 'plate_with_holes', {
      width: L + lw, depth: lw, thickness: lt,
      holes: [{ x: lw / 2, y: lw / 2, d: pinD + 1 }, { x: L + lw / 2, y: lw / 2, d: pinD + 1 }],
    }, { tx: ox, ty: oy, tz: z, rz: rzDeg }, 'steel', role);
  };
  P('base_bar', 'plate_with_holes', {
    width: g + lw, depth: lw, thickness: lt,
    holes: [{ x: lw / 2, y: lw / 2, d: pinD + 1 }, { x: g + lw / 2, y: lw / 2, d: pinD + 1 }],
  }, { tx: -lw / 2, ty: -lw / 2, tz: zG }, 'steel', 'frame');
  bar('crank', [0, 0], B, z1, 'link');
  bar('coupler', B, C, z2, 'link');
  bar('rocker', [g, 0], C, z1, 'link');
  // 핀(레이어별 z-구간 — 홀 없는 몸통 관통 방지, 260718d 그리드 검출):
  //   A/D=접지+크랭크·로커 레이어(z2 커플러 미도달) · B/C=크랭크~커플러 레이어(접지 미도달)
  for (const [pid, [px, py]] of [['pin_A', [0, 0]], ['pin_D', [g, 0]]]) {
    P(pid, 'cylinder', { diameter: pinD, length: z2 - zG - 1 }, { tx: px, ty: py, tz: zG }, 'steel', 'joint'); // 상단=커플러 레이어 1mm 아래(침범 방지)
  }
  for (const [pid, [px, py]] of [['pin_B', B], ['pin_C', C]]) {
    P(pid, 'cylinder', { diameter: pinD, length: z2 + lt + 6 - z1 }, { tx: px, ty: py, tz: z1 }, 'steel', 'joint');
  }
  const th4 = Math.atan2(C[1], C[0] - g);
  return {
    name: `4절 링크 g${g}/a${a}/b${b}/c${c} @${Math.round((th2 * 180) / Math.PI)}°`, domain: 'mech', kind: 'assembly', parts,
    fourBarMeta: {
      ground: g, crank: a, coupler: b, rocker: c,
      inputDeg: +((th2 * 180) / Math.PI).toFixed(1), outputDeg: +((th4 * 180) / Math.PI).toFixed(2),
      transmissionDeg: +((mu * 180) / Math.PI).toFixed(1), grashof, grashofClass: grashof ? (sorted[0] === a ? 'crank-rocker 후보' : 'Grashof 충족') : 'non-Grashof(요동)',
      couplerPoint: C.map((v) => +v.toFixed(2)),
    },
    note: 'Freudenstein 폐형 포즈(개방 조립모드·백래시 0 명시)·z-레이어 적층=실기구 관례(링크 비간섭)·전달각 폐형. 관성력·핀 전단 검토 미포함',
  };
}

/** 프로펠러(축류 — 260718d, 자유곡면 어휘 1호). NACA 4-digit 폐형 단면(Abbott&von Doenhoff
 *  공표식·닫힌 TE −0.1036) × 반경별 시위/비틀림(β=atan(피치/2πr)) 로프트 → 워터타이트 메시
 *  (체적=발산정리 정밀 — 날조 아님·공표 수식/기하 파생). 유체역학 성능(추력·효율) 검토 미포함. */
/** 플랜지 피팅 패밀리(R2-⑧, 260719 — 참고파일들4 elbow/u-bend/manifold 대응).
 *  elbow=pipe_elbow(파푸스 폐형·revolve 부분각 STEP)·tee=pipe_tee(부품 내 부울 융합).
 *  플랜지=양단 맞댐(WN 관례 — 용접 상세=입력). DN 치수=KS 10K 표(std-snap) 참조 관례. */
function flangedFittingAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const kind = ['elbow90', 'ubend180', 'tee'].includes(p.kind) ? p.kind : 'elbow90';
  const od = num(p.od, 114.3);
  const t = num(p.wallThk, Math.max(3, Math.round(od * 0.05)));
  const bendR = num(p.bendR, Math.round(od * 1.5));
  const flOD = od + 95, flBore = od + 2, flThk = 16, bcd = od + 60;
  const FL = (id, at) => ({ id, type: 'flange', params: { outerDia: flOD, boreDia: flBore, thickness: flThk, bcd, boltHoleD: 19, boltCount: 8 }, at, role: 'mount', material: 'steel', system: '플랜지' });
  const parts = [];
  if (kind === 'tee') {
    const runLen = num(p.runLen, od * 4), brLen = num(p.branchLen, od * 2.5);
    parts.push({ id: 'tee', type: 'pipe_tee', params: { runOD: od, branchOD: num(p.branchOD, od), runLen, branchLen: brLen, wallThk: t }, at: { tx: 0, ty: 0, tz: 0 }, role: 'pipe', material: 'steel', system: '피팅' });
    parts.push(FL('fl_run_a', { tx: -flThk, ty: 0, tz: 0, ry: 90 }));
    parts.push(FL('fl_run_b', { tx: runLen, ty: 0, tz: 0, ry: 90 }));
    parts.push(FL('fl_branch', { tx: runLen / 2, ty: 0, tz: brLen }));
  } else {
    const a = kind === 'ubend180' ? 180 : 90;
    parts.push({ id: 'elbow', type: 'pipe_elbow', params: { od, bendR, angleDeg: a, wallThk: t }, at: { tx: 0, ty: 0, tz: 0 }, role: 'pipe', material: 'steel', system: '피팅' });
    // φ=0 끝면: (bendR,0) 노멀 −y → 플랜지 축 y(rx −90: 로컬 z→−y… rx:90=z→y) — 끝면 바깥(−y)
    parts.push(FL('fl_a', { tx: bendR, ty: 0, tz: 0, rx: 90 })); // z→+y? 배치 검증은 빌드 간섭·AABB 로
    if (a === 90) parts.push(FL('fl_b', { tx: 0, ty: bendR, tz: 0, ry: 90 }));
    else parts.push(FL('fl_b', { tx: -bendR, ty: 0, tz: 0, rx: 90 }));
  }
  return {
    name: `플랜지 ${kind === 'tee' ? '티' : kind === 'ubend180' ? 'U벤드' : '90° 엘보'} OD${od}`,
    domain: 'mech', kind: 'assembly', parts,
    note: '피팅 패밀리(비법정) — 플랜지=맞댐 관례(용접 상세·개스킷=입력), 치수=KS 10K 참조 관례. 티 체적=접합부 근사 명시.',
  };
}

/** 셸튜브 열교환기 TEMA AEL 단순화(R2-⑦, 260719 — 참고파일들4 shell-and-tube 6예제 대응).
 *  정직 범위: 형식 비례=TEMA 관례 · 튜브=대표 7본(중심+육각, 피치 표시 — 전체 본수·열설계=
 *  계산서/입력 영역) · 배플=원판(세그멘탈 컷 후속) · 노즐=셸 외면 맞댐(관통 용접 상세=입력).
 *  간섭 0 설계: 튜브 세그먼트를 배플 사이에서 분할(갭 0.5)·배플=셸 보어 내포·시트 맞댐. */
function heatExchangerAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const shellID = num(p.shellID, 600);
  const thk = num(p.shellThk, 10);
  const Lt = num(p.tubeLen, 3000);
  const tubeOD = num(p.tubeOD, 19);
  const pitch = num(p.tubePitch, Math.round(tubeOD * 1.33));
  const nBaf = Math.max(0, Math.min(12, Math.round(num(p.baffles, 4))));
  const nozOD = num(p.nozzleOD, 114.3); // DN100 관례
  const shellOD = shellID + 2 * thk;
  const R = shellOD / 2;
  const CY = R + 60, CZ = R + 120; // 축심(새들 위)
  const tsThk = 40, chLen = 250, capThk = 30;
  const x0 = 200; // 전방 채널 시작
  const xTS1 = x0 + chLen, xShell = xTS1 + tsThk, xTS2 = xShell + Lt, xEnd = xTS2 + tsThk;
  const parts = [];
  const P = (part) => parts.push(part);
  // 새들 2 + 베드 접지(지지 체인)
  P({ id: 'saddle_front', type: 'box', params: { width: 120, depth: shellOD, height: CZ - R + 2 }, at: { tx: xShell + Lt * 0.2, ty: CY - shellOD / 2, tz: 0 }, role: 'support', material: 'steel', system: '지지' });
  P({ id: 'saddle_rear', type: 'box', params: { width: 120, depth: shellOD, height: CZ - R + 2 }, at: { tx: xShell + Lt * 0.75, ty: CY - shellOD / 2, tz: 0 }, role: 'support', material: 'steel', system: '지지' });
  // 셸·시트·채널(A형)·후방 캡(L형 고정시트)
  P({ id: 'shell', type: 'tube', params: { outerDia: shellOD, innerDia: shellID, length: Lt }, at: { tx: xShell, ty: CY, tz: CZ, ry: 90 }, role: 'vessel', material: 'steel', system: '셸' });
  P({ id: 'tubesheet_front', type: 'cylinder', params: { diameter: shellOD, length: tsThk }, at: { tx: xTS1, ty: CY, tz: CZ, ry: 90 }, role: 'mount', material: 'steel', system: '셸' });
  P({ id: 'tubesheet_rear', type: 'cylinder', params: { diameter: shellOD, length: tsThk }, at: { tx: xTS2, ty: CY, tz: CZ, ry: 90 }, role: 'mount', material: 'steel', system: '셸' });
  P({ id: 'channel', type: 'tube', params: { outerDia: shellOD, innerDia: shellID, length: chLen }, at: { tx: x0, ty: CY, tz: CZ, ry: 90 }, role: 'vessel', material: 'steel', system: '채널' });
  P({ id: 'channel_cover', type: 'cylinder', params: { diameter: shellOD, length: capThk }, at: { tx: x0 - capThk, ty: CY, tz: CZ, ry: 90 }, role: 'mount', material: 'steel', system: '채널' });
  P({ id: 'rear_cap', type: 'cylinder', params: { diameter: shellOD, length: capThk }, at: { tx: xEnd, ty: CY, tz: CZ, ry: 90 }, role: 'mount', material: 'steel', system: '채널' });
  // 대표 튜브 7본(중심+육각) — 배플 사이 세그먼트 분할(갭 0.5, 접촉·간섭 0)
  const bafThk = 6, gap = 0.5;
  const bafXs = Array.from({ length: nBaf }, (_, k) => xShell + (Lt * (k + 1)) / (nBaf + 1) - bafThk / 2);
  const cuts = [xShell, ...bafXs.flatMap((bx) => [bx - gap, bx + bafThk + gap]), xShell + Lt];
  const tubePos = [[0, 0], ...Array.from({ length: 6 }, (_, k) => [pitch * Math.cos((k * Math.PI) / 3), pitch * Math.sin((k * Math.PI) / 3)])];
  tubePos.forEach(([dy, dz], ti) => {
    for (let s = 0; s + 1 < cuts.length; s += 2) {
      const a = cuts[s], b = cuts[s + 1];
      if (b - a < 1) continue;
      P({ id: `tube${ti + 1}_s${s / 2 + 1}`, type: 'cylinder', params: { diameter: tubeOD, length: +(b - a).toFixed(3) }, at: { tx: a, ty: CY + dy, tz: CZ + dz, ry: 90 }, role: 'mount', material: 'steel', system: '튜브 다발', detail: 2 });
    }
  });
  // 배플(원판 — 셸 보어 내포)
  bafXs.forEach((bx, k) => {
    P({ id: `baffle_${k + 1}`, type: 'cylinder', params: { diameter: shellID - 6, length: bafThk }, at: { tx: bx, ty: CY, tz: CZ, ry: 90 }, role: 'mount', material: 'steel', system: '배플', detail: 2 });
  });
  // 노즐 4(셸 in/out 상부 · 채널 in/out) — 외면 맞댐(원통 곡면 갭=도면 관례 명시)
  const nozLen = 120, flThk = 16;
  const noz = (id, x, top) => {
    const z0 = top ? CZ + R : CZ - R - nozLen;
    P({ id, type: 'tube', params: { outerDia: nozOD, innerDia: nozOD - 12, length: nozLen }, at: { tx: x, ty: CY, tz: z0 }, role: 'pipe', material: 'steel', system: '노즐', detail: 2 });
    P({ id: id + '_fl', type: 'flange', params: { outerDia: nozOD + 95, boreDia: nozOD + 2, thickness: flThk, bcd: nozOD + 60, boltHoleD: 19, boltCount: 8 }, at: { tx: x, ty: CY, tz: top ? z0 + nozLen - flThk : z0 }, role: 'mount', material: 'steel', system: '노즐', detail: 2 });
  };
  noz('shell_in', xShell + Lt * 0.1, true);
  noz('shell_out', xShell + Lt * 0.9, true);
  noz('channel_in', x0 + chLen / 2, true);
  noz('channel_out', x0 + chLen / 2, false);
  return {
    name: `셸튜브 열교환기 TEMA AEL ${shellID}×${Lt}`, domain: 'mech', kind: 'assembly', parts,
    hxMeta: { temaType: 'AEL', shellID, shellOD, tubeLen: Lt, tubeOD, tubePitch: pitch, baffles: nBaf, tubesShown: 7 },
    note: 'TEMA AEL 단순화(비법정) — 튜브=대표 7본(피치 표시, 전체 본수·전열 설계=계산서/입력 영역)·배플=원판(세그멘탈 컷 후속)·노즐=외면 맞댐(관통 용접 상세=입력). 형식 비례=관례 명시.',
  };
}

function propellerAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const D = num(p.diameter, 800), R = D / 2;
  const nB = Math.max(2, Math.min(6, Math.round(num(p.blades, 3))));
  const pitch = num(p.pitch, Math.round(D * 0.7));
  const hubD = num(p.hubDia, Math.round(D * 0.18)), hubL = num(p.hubLen, Math.round(D * 0.12));
  const boreD = num(p.boreDia, Math.round(hubD * 0.35));
  const naca = String(p.naca ?? '4412');
  const mC = (parseInt(naca[0], 10) || 0) / 100, pC = (parseInt(naca[1], 10) || 1) / 10, tC = (parseInt(naca.slice(2), 10) || 12) / 100;
  const SECS = 12, MPTS = 24; // 반경 분할 × 단면 점(상/하면 합) — 분할 명시
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 허브: revolve(보스 원통 + 보어) — 파푸스 정밀
  P('hub', 'revolve', { profile: [[boreD / 2, 0], [hubD / 2, 0], [hubD / 2, hubL], [boreD / 2, hubL]] }, { tx: 0, ty: 0, tz: 0 }, 'aluminum', 'joint');
  // NACA 단면(폐루프 — 앞전→상면→뒷전→하면)
  const nacaLoop = () => {
    const pts = [];
    const yt = (x) => 5 * tC * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camber = (x) => (x < pC ? (mC / (pC * pC)) * (2 * pC * x - x * x) : (mC / ((1 - pC) ** 2)) * (1 - 2 * pC + 2 * pC * x - x * x));
    const half = MPTS / 2;
    for (let i = 0; i <= half; i++) { const x = i / half; pts.push([x, camber(x) + yt(x)]); }        // 상면 LE→TE
    for (let i = half - 1; i > 0; i--) { const x = i / half; pts.push([x, camber(x) - yt(x)]); }     // 하면 TE→LE
    return pts; // 길이 = MPTS
  };
  const base = nacaLoop();
  // 블레이드 메시: 링 k(반경 r_k)마다 시위 스케일+비틀림 회전 → 로프트 + 양단 캡
  const rRoot = hubD / 2 + 1; // 허브면 1mm 갭(간섭 0 — 지지=mech 조인트 선언 체결)
  const blade = (bi) => {
    const phase = (2 * Math.PI * bi) / nB;
    const verts = [], faces = [];
    for (let k = 0; k <= SECS; k++) {
      const r = rRoot + ((R - rRoot) * k) / SECS;
      const taper = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + (0.85 * k) / SECS)); // 시위 분포(루트·팁 축소)
      const c = D * 0.16 * taper;
      const beta = Math.atan(pitch / (2 * Math.PI * r));
      for (const [xu, yu] of base) {
        // 단면 로컬(시위 x·두께 y) → 비틀림 β 회전(접선-축 평면) → 반경 r 배치, 허브 중간높이 기준
        const sx = (xu - 0.35) * c, sy = yu * c;
        const tangential = sx * Math.cos(beta) - sy * Math.sin(beta);
        const axial = sx * Math.sin(beta) + sy * Math.cos(beta);
        // 방위 phase 회전(z=축): 반경 방향 (cosφ,sinφ)·접선 방향 (−sinφ,cosφ)
        verts.push([
          r * Math.cos(phase) - tangential * Math.sin(phase),
          r * Math.sin(phase) + tangential * Math.cos(phase),
          hubL / 2 + axial,
        ]);
      }
    }
    const M = MPTS;
    for (let k = 0; k < SECS; k++) {
      for (let i = 0; i < M; i++) {
        const a = k * M + i, b2 = k * M + ((i + 1) % M), c2 = (k + 1) * M + ((i + 1) % M), d2 = (k + 1) * M + i;
        faces.push([a, b2, c2], [a, c2, d2]);
      }
    }
    // 캡(루트=팬 역방향·팁=팬)
    const rootC = verts.length; verts.push([0, 0, 0].map((_, j) => base.reduce((s, _q, i) => s + verts[i][j], 0) / M));
    for (let i = 0; i < M; i++) faces.push([rootC, ((i + 1) % M), i]);
    const tipC = verts.length; verts.push([0, 0, 0].map((_, j) => base.reduce((s, _q, i) => s + verts[SECS * M + i][j], 0) / M));
    for (let i = 0; i < M; i++) faces.push([tipC, SECS * M + i, SECS * M + ((i + 1) % M)]);
    // 발산정리 체적/AABB
    let vol6 = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const v of verts) for (let j = 0; j < 3; j++) { if (v[j] < mn[j]) mn[j] = v[j]; if (v[j] > mx[j]) mx[j] = v[j]; }
    for (const [a, b2, c2] of faces) {
      const A2 = verts[a], B2 = verts[b2], C2 = verts[c2];
      vol6 += A2[0] * (B2[1] * C2[2] - B2[2] * C2[1]) + A2[1] * (B2[2] * C2[0] - B2[0] * C2[2]) + A2[2] * (B2[0] * C2[1] - B2[1] * C2[0]);
    }
    P(`blade_${bi + 1}`, 'mesh', {
      volumeMm3: +Math.abs(vol6 / 6).toFixed(1), triCount: faces.length,
      aabb: { min: mn.map((v) => +v.toFixed(2)), max: mx.map((v) => +v.toFixed(2)) },
      verts: verts.map((v) => v.map((x) => +x.toFixed(3))), faces,
    }, { tx: 0, ty: 0, tz: 0 }, 'aluminum', 'link');
  };
  for (let bi = 0; bi < nB; bi++) blade(bi);
  return {
    name: `프로펠러 ${nB}익 D${D}`, domain: 'mech', kind: 'assembly', parts,
    propellerMeta: { diameter: D, blades: nB, pitch, hubDia: hubD, naca, sections: SECS },
    note: `NACA ${naca} 폐형 단면 ${SECS}분할 로프트(공표식 파생 — 원기하)·체적=발산정리 정밀·허브=파푸스. 추력/효율/공진 등 유체·구조 성능 검토 미포함 — 명시`,
  };
}

/** 다관절 로봇 암(5-DOF 포즈 — 260718c, 참고파일들3 robot-5-dof/robotic-arm 대응 간이).
 *  x-z 평면 2D 기구학(전 회전=ry 단일축 — OBB 정밀 판정)·조인트=무회전 하우징 box(링크와
 *  1.5mm 매립 체결=supportCheck 부피겹침 규칙·간섭 분류는 ≤2mm 접촉). 구동·배선·제어 미포함. */
function robotArmAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const L1 = num(p.upperArmLen, 700), L2 = num(p.forearmLen, 600);
  const a1 = Math.max(-80, Math.min(80, Number(p.shoulderDeg ?? 35)));   // 수직 기준 어깨각
  const a2 = Math.max(-120, Math.min(120, Number(p.elbowDeg ?? 55)));    // 상완 기준 팔꿈치 상대각
  const linkW = num(p.linkW, 120), jointS = num(p.jointS, 180);
  const baseD = num(p.baseDia, 260), baseH = num(p.baseH, 220);
  const embed = 1.5; // 링크↔하우징 매립(체결 — TOL_CONTACT 이내)
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 베이스 플레이트 + J1 요 베이스(원통)
  P('base_plate', 'box', { width: 340, depth: 340, height: 20 }, { tx: -170, ty: -170, tz: 0 }, 'steel', 'base');
  P('base_col', 'cylinder', { diameter: baseD, length: baseH }, { tx: 0, ty: 0, tz: 20 }, 'steel', 'joint');
  // 기구학(x-z): 어깨 S → 팔꿈치 E → 손목 W (각도=수직 기준)
  const r1 = (a1 * Math.PI) / 180, r2 = ((a1 + a2) * Math.PI) / 180;
  const S = [0, 20 + baseH + jointS / 2];
  const E = [S[0] + L1 * Math.sin(r1), S[1] + L1 * Math.cos(r1)];
  const W = [E[0] + L2 * Math.sin(r2), E[1] + L2 * Math.cos(r2)];
  if (W[1] < 150 || E[1] < 150) {
    return { name: '로봇 암', domain: 'mech', parts: [], alignmentErrors: [`포즈 불가(팔꿈치 z=${Math.round(E[1])}·손목 z=${Math.round(W[1])} < 150) — 각도/길이 재조정`] };
  }
  // 그리퍼=손목 하향 관례: 전완이 거의 수직 상향(|어깨+팔꿈치|<30°)이면 하향 그리퍼와 교차 — 정직 게이트
  if (Math.abs(a1 + a2) < 30) {
    return { name: '로봇 암', domain: 'mech', parts: [], alignmentErrors: [`손목 접근각 |어깨각+팔꿈치각|=${Math.abs(a1 + a2)}° < 30° — 하향 그리퍼와 전완 교차(각도 재조정 또는 그리퍼 방향 후속)`] };
  }
  const yC = -linkW / 2;
  // 조인트 하우징(무회전 box — 어깨는 베이스 원통에 매립 착지)
  const house = (id, cx, cz) => P(id, 'box', { width: jointS, depth: linkW + 40, height: jointS }, { tx: cx - jointS / 2, ty: yC - 20, tz: cz - jointS / 2 }, 'steel', 'joint');
  house('shoulder_j2', S[0], S[1] - embed); // 베이스 상면에 매립(체결)
  house('elbow_j3', E[0], E[1]);
  house('wrist_j4', W[0], W[1]);
  // 링크(중심 규약 경사 box): 경사 끝면 **모서리**의 하우징 관통을 수치 풀백으로 정확 해소
  //   (해석식은 면 선택 분기(코너 영역)로 각도별 오차 — 1mm 스텝 코너-사각형 포함검사 폐형).
  //   지지 = supportCheck 의 mech 조인트 선언 체결(role joint/link/gripper 근접 쌍 — 볼팅 관례).
  const link = (id, A, B, dropB = 0) => {
    const th = Math.atan2(B[1] - A[1], B[0] - A[0]);
    const c = Math.cos(th), s = Math.sin(th);
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const rect = (C2, drop = 0) => ({ x0: C2[0] - jointS / 2, x1: C2[0] + jointS / 2, z0: C2[1] - jointS / 2 - drop, z1: C2[1] + jointS / 2 });
    const rA = rect(A), rB = rect(B, dropB);
    const inside = (px, pz, r) => px > r.x0 + 0.5 && px < r.x1 - 0.5 && pz > r.z0 + 0.5 && pz < r.z1 - 0.5;
    // 역방향 침투 검사(그리드 38mm 검출): **하우징 모서리가 링크 몸통 안**에 드는 경우 —
    // 링크 로컬 좌표(u=축·v=수직)로 사각 포함검사. 양방향 전부 클리어될 때까지 1mm 풀백.
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const rectCorners = (r) => [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]];
    let pull = jointS / 2 - 4; // 시작=하우징 면 4mm 밖
    for (let it = 0; it < 200; it++) {
      const gl = dist - 2 * pull;
      const endA = [A[0] + c * pull, A[1] + s * pull];
      const endB = [B[0] - c * pull, B[1] - s * pull];
      const cornerHit = [+1, -1].some((sg) =>
        inside(endA[0] - s * sg * (linkW / 2), endA[1] + c * sg * (linkW / 2), rA)
        || inside(endB[0] - s * sg * (linkW / 2), endB[1] + c * sg * (linkW / 2), rB));
      const bodyHit = [...rectCorners(rA), ...rectCorners(rB)].some(([px, pz]) => {
        const dx = px - mid[0], dz = pz - mid[1];
        const u = dx * c + dz * s, v = -dx * s + dz * c;
        return Math.abs(u) < gl / 2 - 0.5 && Math.abs(v) < linkW / 2 - 0.5;
      });
      if (!cornerHit && !bodyHit) break;
      pull += 1;
    }
    const gapLen = dist - 2 * pull;
    if (gapLen < linkW) return false;
    chordBoxX(P, id, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, th, gapLen, linkW, yC, linkW, 'steel', 'link');
    return true;
  };
  if (!link('upper_arm', S, E) || !link('forearm', E, W, 95)) {
    return { name: '로봇 암', domain: 'mech', parts: [], alignmentErrors: ['링크 기하 퇴화(길이 < 폭) — 링크 길이/조인트 크기 재조정'] };
  }
  // 손목 롤(J5 — 하우징 하면 0-접촉 스택) + 그리퍼(팜+핑거 2, 순차 0-접촉)
  const gz = W[1] - jointS / 2;
  P('wrist_roll', 'cylinder', { diameter: linkW * 0.8, length: 90 }, { tx: W[0], ty: 0, tz: gz - 90 }, 'steel', 'joint');
  P('palm', 'box', { width: 140, depth: 100, height: 40 }, { tx: W[0] - 70, ty: -50, tz: gz - 130 }, 'steel', 'gripper');
  for (const [fi, fx] of [[0, -60], [1, 30]]) {
    P(`finger_${fi + 1}`, 'box', { width: 30, depth: 100, height: 90 }, { tx: W[0] + fx, ty: -50, tz: gz - 220 }, 'steel', 'gripper');
  }
  return {
    name: `로봇 암 5-DOF (${a1}°/${a2}°)`, domain: 'mech', kind: 'assembly', parts,
    robotMeta: { dof: 5, upperArmLen: L1, forearmLen: L2, shoulderDeg: a1, elbowDeg: a2, reach: +Math.hypot(W[0], W[1] - S[1]).toFixed(0), wrist: [Math.round(W[0]), Math.round(W[1])] },
    note: '5-DOF 포즈 매싱 간이(조인트=하우징 box 근사·1.5mm 매립 체결 명시 — 구동·감속기·배선·제어 미포함). 가반하중·작업영역 검토 미포함',
  };
}

/** 산업기계 라인(베이스프레임+스테이션 N+컨베이어+안전가드 — 260718b, 참고파일들2 포장기계 대응 간이).
 *  각형강 프레임 위에 스테이션 하우징을 일렬 배치, 컨베이어가 관통, 둘레 안전펜스. 기구·구동 미포함. */
function machineLineAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const nSt = Math.max(1, Math.min(12, Math.round(num(p.stations, 4))));
  const stPitch = num(p.stationPitch, 1500);
  const frameH = num(p.frameH, 900), legS = num(p.legSize, 80);
  const convW = num(p.conveyorW, 500), convH = num(p.conveyorH, 80);
  const stW = num(p.stationW, 700), stD = num(p.stationD, 900), stH = num(p.stationH, 1400);
  // 라인 폭 = 컨베이어 존(전) + 스테이션 존(후) 분리 산정(y 겹침 방지)
  const yGap = 120;
  const W = num(p.width, 2 * legS + convW + yGap + stD + 100);
  const L = nSt * stPitch;               // 라인 길이(x)
  const guard = String(p.guard ?? 'yes') !== 'no';
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 지지 스택(각 단이 아래 단에 착지 — box 각형강 근사, 중실 명시):
  //   다리 → 세로 레일(다리 위) → 가로 빔(레일 위) → 컨베이어·스테이션(가로 빔 위).
  const zLeg = frameH, zRail = frameH + legS, zTop = frameH + 2 * legS;
  const yEdge = [0, W - legS];
  // 가로 빔 x-위치 = 경계 + 스테이션 중앙(스테이션·컨베이어 착지 보장)
  const crossXs = [];
  for (let i = 0; i <= nSt; i++) crossXs.push(i * stPitch);
  for (let i = 0; i < nSt; i++) crossXs.push((i + 0.5) * stPitch);
  crossXs.sort((a, b) => a - b);
  // 다리(경계 x × 양 y열)
  for (let i = 0; i <= nSt; i++) {
    const x = Math.min(i * stPitch, L - legS);
    for (const [sy, y] of yEdge.entries()) {
      P(`leg_${i + 1}_${sy + 1}`, 'box', { width: legS, depth: legS, height: frameH }, { tx: x, ty: y, tz: 0 }, 'steel', 'frame');
    }
  }
  // 세로 레일 2본(x 전장 — 다리 위)
  for (const [sy, y] of yEdge.entries()) {
    P(`rail_${sy + 1}`, 'box', { width: L, depth: legS, height: legS }, { tx: 0, ty: y, tz: zLeg }, 'steel', 'frame');
  }
  // 가로 빔(전 폭 — 레일 위)
  for (const [ci, x] of crossXs.entries()) {
    P(`cross_${ci + 1}`, 'box', { width: legS, depth: W, height: legS }, { tx: Math.min(x, L - legS), ty: 0, tz: zRail }, 'steel', 'frame');
  }
  // 컨베이어(전면 존 — 가로 빔 위) / 스테이션(후면 존 — y 분리)
  const convY = legS + 50;
  P('conveyor', 'box', { width: L, depth: convW, height: convH }, { tx: 0, ty: convY, tz: zTop }, 'steel', 'conveyor');
  const stY = convY + convW + yGap;
  for (let i = 0; i < nSt; i++) {
    const x = (i + 0.5) * stPitch - stW / 2;
    P(`station_${i + 1}`, 'box', { width: stW, depth: stD, height: stH }, { tx: x, ty: stY, tz: zTop }, 'steel', 'station');
    // 작업 헤드(스테이션 위) + 지지 컬럼(스테이션 상면↔헤드)
    P(`hcol_${i + 1}`, 'box', { width: 100, depth: 100, height: 250 }, { tx: x + stW * 0.25, ty: stY + stD / 2 - 50, tz: zTop + stH }, 'steel', 'frame');
    P(`head_${i + 1}`, 'box', { width: stW * 0.5, depth: stD, height: 250 }, { tx: x + stW * 0.25, ty: stY, tz: zTop + stH + 250 }, 'steel', 'head');
  }
  // 제어반(라인 끝 — 접지)
  P('control_panel', 'box', { width: 600, depth: 400, height: 1800 }, { tx: L + 300, ty: 0, tz: 0 }, 'steel', 'panel');
  // 안전 펜스(전·후면 2변 — 프레임 밖 접지). 투입/배출(양단)=개구 생략.
  if (guard) {
    const fenceH = 1800;
    for (const [fi, y0] of [[0, -300], [1, W + 260]].entries()) {
      P(`fence_${fi + 1}`, 'box', { width: L + 600, depth: 40, height: fenceH }, { tx: -300, ty: y0, tz: 0 }, 'steel', 'fence');
    }
  }
  return {
    name: `산업기계 라인 ${nSt}스테이션`, domain: 'mech', kind: 'assembly', parts,
    machineLineMeta: { stations: nSt, stationPitch: stPitch, length: L, width: W, frameH, guard },
    note: '산업기계 라인 매싱 간이(프레임+스테이션 하우징+컨베이어+안전펜스 — 기구·구동·배선·제어 미포함 명시). 참고파일들2 포장기계류의 정직한 매싱 대응(내부 메커니즘 아님)',
  };
}

/** 벨트/롤러 컨베이어(R2-⑨, 260719). C찬넬 사이드 프레임 + 다리 + 롤러(실린더 rx90)
 *  + 벨트(박스)/헤드·테일 풀리 + 구동 모터. 수평 v1(경사=후속 명시). 구동 체인·베어링
 *  유닛·텐셔너 상세=입력 영역(정직) — BOM 발주는 std-snap(UCP·파이프) 감사로 보강. */
function conveyorAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const kind = String(p.kind) === 'roller' ? 'roller' : 'belt';
  const L = num(p.length, 6000);
  const W = num(p.width, 600);          // 롤러면 폭(프레임 내측)
  const frameH = num(p.frameH, 750);    // 롤러 상면 높이
  const legPitch = num(p.legPitch, 1500);
  const rollerPitch = num(p.rollerPitch, kind === 'belt' ? 900 : 300); // 벨트=캐리어 간격
  const rollerD = num(p.rollerD, 60);
  const chH = 150, chB = 75, chT = 6;   // 사이드 C찬넬(150×75)
  const legS = 60;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const zRailBot = frameH - rollerD / 2 - chH / 2; // 롤러 축=찬넬 중심 관례
  // 사이드 프레임 2본(C찬넬 — 웨브 외측·개구 내향 관례는 상세 입력 명시)
  for (const [si, y] of [[0, -chB], [1, W]]) {
    P(`side_ch_${si + 1}`, 'c_channel', { H: chH, B: chB, tw: chT, tf: chT, length: L }, { tx: 0, ty: y, tz: zRailBot }, 'steel', 'frame');
  }
  // 다리(문형 — 양측 각관 + 하부 가로대), 레일 하면에 맞댐
  const nLeg = Math.max(2, Math.floor(L / legPitch) + 1);
  for (let i = 0; i < nLeg; i++) {
    const x = Math.min(i * legPitch, L - legS);
    for (const [si, y] of [[0, -chB], [1, W]]) {
      P(`leg_${i + 1}_${si + 1}`, 'box', { width: legS, depth: chB, height: zRailBot }, { tx: x, ty: y, tz: 0 }, 'steel', 'frame');
    }
    P(`legtie_${i + 1}`, 'box', { width: legS, depth: W, height: legS }, { tx: x, ty: 0, tz: 200 }, 'steel', 'frame'); // 다리 내측면 맞댐(볼트 체결 — 측면 면접촉 규칙)
  }
  // 롤러(실린더 rx=-90: 축=+y, 프레임 내측 폭) — 상면=frameH. 프레임 부착=mount 선언
  // (축단 베어링 볼팅 관례 — 자중 지지 아님 명시). 벨트형은 풀리 구간 회피.
  const x0R = kind === 'belt' ? 2.5 * rollerD : rollerD / 2;
  const nRoll = Math.max(2, Math.floor((L - 2 * x0R) / rollerPitch) + 1);
  let rollers = 0;
  for (let i = 0; i < nRoll; i++) {
    const x = x0R + i * rollerPitch;
    if (x > L - x0R) break;
    rollers++;
    P(`roller_${i + 1}`, 'cylinder', { diameter: rollerD, length: W }, { tx: x, ty: 0, tz: frameH - rollerD / 2, rx: -90 }, 'steel', 'mount');
  }
  if (kind === 'belt') {
    // 헤드/테일 풀리(양단 — 상면=벨트 하면 접선) + 벨트(캐리어면 박스 근사 — 리턴측 생략 명시)
    const pd = 1.6 * rollerD;
    P('pulley_tail', 'cylinder', { diameter: pd, length: W }, { tx: rollerD, ty: 0, tz: frameH - pd / 2, rx: -90 }, 'steel', 'mount');
    P('pulley_head', 'cylinder', { diameter: pd, length: W }, { tx: L - rollerD, ty: 0, tz: frameH - pd / 2, rx: -90 }, 'steel', 'mount');
    P('belt', 'box', { width: L - 2 * rollerD, depth: W, height: 10 }, { tx: rollerD, ty: 0, tz: frameH }, 'rubber', 'conveyor');
    // 구동 모터+감속기(헤드측 하부 브래킷 — 체인/커플링 상세=입력)
    P('drive_motor', 'box', { width: 400, depth: 300, height: 300 }, { tx: L - 500, ty: W + chB + 20, tz: zRailBot - 150 }, 'steel', 'motor');
    P('motor_bracket', 'box', { width: 400, depth: 20, height: 300 }, { tx: L - 500, ty: W + chB, tz: zRailBot - 150 }, 'steel', 'mount');
  }
  return {
    name: kind === 'belt' ? `벨트 컨베이어 ${L / 1000}m` : `롤러 컨베이어 ${L / 1000}m`,
    domain: 'mech', kind: 'assembly', parts,
    conveyorMeta: { kind, length: L, width: W, frameH, rollerPitch, rollerD, legs: nLeg, rollers },
    note: '컨베이어 매싱(수평 v1) — 구동 체인·베어링 유닛·텐셔너·리턴 벨트 상세=입력 영역 명시. 경사·커브=후속.',
  };
}

/** 송전탑(R2-⑩, 260719). angle(L형강) 격자 — 4모서리 경사 주주재(패널별 세그먼트)
 *  + 수평재 + X브레이싱(전·배면 분리 배치 — 교차부 볼트 접합 관례를 면분리로 폐형)
 *  + 크로스암. 접합 상세(볼트·거셋 플레이트)=입력 영역 명시(부재=계획 배치). */
function towerAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const H = num(p.height, 30000);
  const baseW = num(p.baseW, 6000), topW = num(p.topW, 1500);
  const nP = Math.max(3, Math.min(12, Math.round(num(p.panels, 6))));
  const legA = num(p.legSize, 120), legT = num(p.legThk, 10);
  const brA = num(p.braceSize, 75), brT = num(p.braceThk, 6);
  const armL = num(p.armLen, 2500), armS = 300;
  const Hp = H / nP;
  const wAt = (z) => (baseW / 2) + (topW / 2 - baseW / 2) * (z / H); // 반폭 선형 테이퍼
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // angle 로컬 +x 를 방향 u 로: R=Rz·Ry·Rx, rx=0 → ry=-asin(uz), rz=atan2(uy,ux) (결정론 유도)
  const angleAt = (id, from, to, a, t, role) => {
    const v = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const Lm = Math.hypot(...v);
    const u = v.map((q) => q / Lm);
    const ry = (-Math.asin(u[2]) * 180) / Math.PI;
    const rz = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    P(id, 'angle', { legA: a, legB: a, thickness: t, length: Lm }, { tx: from[0], ty: from[1], tz: from[2], ry, rz }, 'steel', role);
  };
  for (let k = 0; k < nP; k++) {
    const z0 = k * Hp, z1 = z0 + Hp;
    const w0 = wAt(z0), w1 = wAt(z1);
    // 4모서리 주주재(경사) — 단면 중심 근사 배치(플랜지 내향 정렬=상세 입력 명시)
    for (const [ci, [sx, sy]] of [[1, 1], [1, -1], [-1, 1], [-1, -1]].entries()) {
      angleAt(`leg_${k + 1}_${ci + 1}`, [sx * w0 - legA / 2, sy * w0 - legA / 2, z0], [sx * w1 - legA / 2, sy * w1 - legA / 2, z1], legA, legT, 'column');
    }
    // 패널 상단 수평재 4변 — 전/배면=모서리 풀스팬(주주재 AABB 와 절점 체결),
    // 좌/우=brA 인셋(전/배면에 맞댐 — 수평재끼리 관통 없음)
    P(`hz_${k + 1}_f`, 'angle', { legA: brA, legB: brA, thickness: brT, length: 2 * w1 }, { tx: -w1, ty: -w1, tz: z1 - brA }, 'steel', 'beam');
    P(`hz_${k + 1}_b`, 'angle', { legA: brA, legB: brA, thickness: brT, length: 2 * w1 }, { tx: -w1, ty: w1 - brA, tz: z1 - brA }, 'steel', 'beam');
    angleAt(`hz_${k + 1}_l`, [-w1 + brA, -w1, z1 - brA], [-w1 + brA, w1, z1 - brA], brA, brT, 'beam');
    angleAt(`hz_${k + 1}_r`, [w1, -w1, z1 - brA], [w1, w1, z1 - brA], brA, brT, 'beam');
    // X브레이싱(4면·패널당 2본) — 교차부는 전/배면 분리(back-to-back 관례: ±brT 오프셋 폐형)
    const wm = (w0 + w1) / 2;
    for (const [fi, face] of ['yn', 'yp', 'xn', 'xp'].entries()) {
      const horiz = face[0] === 'y'; // 브레이싱이 x 방향으로 달리는 면
      const sgn = face[1] === 'n' ? -1 : 1;
      const off1 = sgn * (wm - brA - brT), off2 = sgn * (wm + brT) - (sgn > 0 ? brA : 0);
      const a0 = -w0 + legA, a1 = w1 - legA; // 진행축 시작/끝(테이퍼 반영·주주재 인셋)
      if (horiz) {
        angleAt(`xb_${k + 1}_${fi + 1}a`, [a0, off1, z0 + brA], [a1, off1, z1 - brA], brA, brT, 'brace');
        angleAt(`xb_${k + 1}_${fi + 1}b`, [a0, off2, z1 - brA], [a1, off2, z0 + brA], brA, brT, 'brace');
      } else {
        angleAt(`xb_${k + 1}_${fi + 1}a`, [off1, a0, z0 + brA], [off1, a1, z1 - brA], brA, brT, 'brace');
        angleAt(`xb_${k + 1}_${fi + 1}b`, [off2, a0, z1 - brA], [off2, a1, z0 + brA], brA, brT, 'brace');
      }
    }
  }
  // 크로스암 2단(상부 패널 절점 위 안착 — 절연체·도체 상세=입력 명시) + 정상 피크
  for (const [ai, zk] of [[0, nP - 2], [1, nP - 1]]) {
    const za = (zk + 1) * Hp; // 패널 절점(수평재 상면)
    const wa = wAt(za);
    P(`crossarm_${ai + 1}`, 'box', { width: armS, depth: 2 * (wa + armL), height: armS }, { tx: -armS / 2, ty: -(wa + armL), tz: za }, 'steel', 'beam');
  }
  P('peak', 'box', { width: armS, depth: armS, height: 1200 }, { tx: -armS / 2, ty: -armS / 2, tz: H + armS }, 'steel', 'column'); // 상단 크로스암 위 안착(접선)
  return {
    name: `송전탑 ${H / 1000}m×${nP}패널`, domain: 'mech', kind: 'assembly', parts,
    towerMeta: { height: H, baseW, topW, panels: nP, legSize: legA, braceSize: brA },
    note: 'angle 격자 송전탑 매싱 — 교차부=전/배면 분리 배치(볼트 접합 상세=입력), 절연체·도체·기초=입력 영역 명시. 회전 부재 AABB 간섭 의심쌍은 B1 메시 부울로 해제 검증.',
  };
}

/** 트러스교(하로교 — 260718 신설, 260718b 프랫/하우 확장). trussType='warren'(등변 지그재그)
 *  | 'pratt'(수직재+중앙향 인장 대각재) | 'howe'(수직재+지점향 압축 대각재).
 *  바닥판=하현재 위 가로보 사이(트러스면 안쪽 y) — 전 접촉 0겹침 폐형.
 *  포털 상세=후속 명시. 구조검토=trussBridgeCheck 간이 체인(비법정) 별도. */
function trussBridgeAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const span = num(p.span, 60000);
  const nP = Math.max(4, Math.min(24, 2 * Math.round(num(p.panels, 8) / 2))); // 짝수 패널(지그재그 대칭)
  const H = num(p.trussH, Math.round(span / 8));
  const cs = num(p.chordS, 500);   // 현재 단면(정사각)
  const ds = num(p.diagS, 350);    // 대각재 단면
  const deckW = num(p.deckW, 9000);
  const deckThk = num(p.deckThk, 250);
  const beamW = 400, beamH = num(p.beamH, 500);
  const abutH = num(p.pierH, 8000);
  const tType = ['warren', 'pratt', 'howe'].includes(String(p.trussType)) ? String(p.trussType) : 'warren';
  const panelL = span / nP;
  const zbc = abutH;               // 하현재 하면
  const zbcTop = zbc + cs;
  const ztcBot = zbc + H;          // 상현재 하면
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const yT = [0, deckW - cs];      // 트러스면 y(하현재 y 스트립)
  // 하현재(전장)·상현재(내부 상절점 구간 x1..x(n-1))
  for (const [ti, y] of yT.entries()) {
    P(`bchord_${ti + 1}`, 'box', { width: span, depth: cs, height: cs }, { tx: 0, ty: y, tz: zbc }, 'steel', 'chord');
    P(`tchord_${ti + 1}`, 'box', { width: span - 2 * panelL, depth: cs, height: cs }, { tx: panelL, ty: y, tz: ztcBot }, 'steel', 'chord');
    // 대각재: 회전 AABB 를 패널 클리어 사각형에 **정확 내접**시키는 (L,θ) 연립 역산
    //   (절점 접합=거셋 관례로 부재가 절점에 못 미침 — 상세 후속 명시):
    //   L·cosθ + ds·sinθ = Wx, L·sinθ + ds·cosθ = Hz → θ 부동점 반복(3회 수렴).
    // 형식별 방향: warren=지그재그 / pratt=끝기둥 상승·내측은 중앙향 하강(인장) /
    // howe=끝기둥 동일·내측은 지점향(압축 — pratt 반대). pratt/howe=내부 절점 수직재.
    const Hz = ztcBot - zbcTop;
    const dirOf = (k) => {
      if (tType === 'warren') return k % 2 === 0 ? +1 : -1;
      if (k === 0) return +1;
      if (k === nP - 1) return -1;
      const left = k < nP / 2;
      return tType === 'pratt' ? (left ? -1 : +1) : (left ? +1 : -1);
    };
    const hasVert = tType !== 'warren';
    for (let k = 0; k < nP; k++) {
      const xa = k * panelL, xb = (k + 1) * panelL;
      // 클리어 존: 좌측=가로보(+수직재는 절점 우측에 서므로 k≥1 패널의 좌측만 차지)
      const xL = xa + beamW / 2 + 1 + (hasVert && k >= 1 ? ds + 1 : 0);
      const xR = xb - beamW / 2 - 1;
      const Wx = xR - xL;
      let thD = Math.atan2(Hz, Wx);
      for (let it = 0; it < 4; it++) thD = Math.atan2(Hz - ds * Math.cos(thD), Wx - ds * Math.sin(thD));
      const Ld = (Hz - ds * Math.cos(thD)) / Math.sin(thD);
      if (!(Ld > ds * 2) || !(thD > 0.1)) {
        return { name: '트러스교', domain: 'bridge', parts: [], alignmentErrors: [`대각재 기하 퇴화(순높이 ${Math.round(Hz)}·순간격 ${Math.round(Wx)}) — 트러스 높이/패널 수 재조정 필요`] };
      }
      chordBoxX(P, `diag_${ti + 1}_${k + 1}`, (xL + xR) / 2, (zbcTop + ztcBot) / 2, dirOf(k) > 0 ? thD : -thD, Ld, ds, y + (cs - ds) / 2, ds, 'steel', 'diagonal');
    }
    // 수직재(pratt/howe — 내부 절점, 절점 우측 +beamW/2+1 오프셋: 가로보 회피 폐형)
    if (hasVert) {
      for (let k = 1; k < nP; k++) {
        P(`vert_${ti + 1}_${k}`, 'box', { width: ds, depth: ds, height: Hz }, { tx: k * panelL + beamW / 2 + 1, ty: y + (cs - ds) / 2, tz: zbcTop }, 'steel', 'vertical');
      }
    }
    // 정착 거셋(opt-in gusset:true — 260718b): 각 내부 절점의 트러스면 **외측**에 거셋 플레이트
    //   부착(현재 외면과 0겹침 버트 — 부재 간섭 없음). 상·하현 절점 각각. 두께 gt.
    if (String(p.gusset) === 'true' || p.gusset === true) {
      const gt = num(p.gussetThk, 16), gsz = Math.round(cs * 1.8);
      const outY = ti === 0 ? -gt : deckW; // 리브0=전면 외측(y<0)·리브1=후면 외측(y>deckW)
      for (let k = 0; k <= nP; k++) {
        const x = Math.min(Math.max(k * panelL - gsz / 2, 0), span - gsz);
        // 하현 절점(모든 k) + 상현 절점(내부 1..nP-1)
        P(`gusset_b_${ti + 1}_${k}`, 'box', { width: gsz, depth: gt, height: gsz }, { tx: x, ty: outY, tz: zbcTop - (gsz - cs) / 2 }, 'steel', 'gusset');
        if (k >= 1 && k <= nP - 1) {
          P(`gusset_t_${ti + 1}_${k}`, 'box', { width: gsz, depth: gt, height: gsz }, { tx: x, ty: outY, tz: ztcBot + cs - (gsz + cs) / 2 }, 'steel', 'gusset');
        }
      }
    }
  }
  // 가로보(내부 패널점, 하현재 상면 위 y 전폭) + 바닥판(가로보 위·트러스면 안쪽)
  for (let k = 1; k < nP; k++) {
    P(`fbeam_${k}`, 'box', { width: beamW, depth: deckW, height: beamH }, { tx: k * panelL - beamW / 2, ty: 0, tz: zbcTop }, 'steel', 'crossbeam');
  }
  P('deck', 'box', { width: span - 2 * (beamW / 2), depth: deckW - 2 * (cs + 50), height: deckThk }, { tx: beamW / 2, ty: cs + 50, tz: zbcTop + beamH }, 'concrete', 'deck');
  // 상부 수평 브레이싱(상현재 사이 — 홀수 절점 3개)
  const bracePts = [Math.floor(nP / 4), Math.floor(nP / 2), Math.floor((3 * nP) / 4)].filter((k, i, a) => a.indexOf(k) === i && k >= 1 && k <= nP - 1);
  for (const [bi, k] of bracePts.entries()) {
    P(`tbrace_${bi + 1}`, 'box', { width: 400, depth: deckW - cs - cs, height: 300 }, { tx: k * panelL - 200, ty: cs, tz: ztcBot + cs - 300 }, 'steel', 'bracing');
  }
  // 교대(양단 — 하현재 하면 지지)
  for (const [tag, x0] of [['A', -1500], ['B', span - 500]]) {
    P(`abut_${tag}`, 'box', { width: 2000, depth: deckW, height: abutH }, { tx: x0, ty: 0, tz: 0 }, 'concrete', 'abutment');
  }
  return {
    name: `${tType === 'warren' ? '워런' : tType === 'pratt' ? '프랫' : '하우'} 트러스교 ${span / 1000}m×${nP}패널`, domain: 'bridge', kind: 'assembly', parts,
    trussMeta: { span, panels: nP, trussH: H, chordS: cs, diagS: ds, deckW, abutH, trussType: tType, panelL },
    note: `${tType} 하로교(대각재=클리어 내접·거셋 상세 후속 명시)·구조검토=trussBridgeCheck 간이 체인(비법정) 별도`,
  };
}

/** 사장교(독립 마스트 + 팬/하프 스테이 — 260718 신설).
 *  스테이=클리어 사각형(마스트면~정착점 × 데크 상면~슬롯)에 **정확 내접**하는 경사 부재
 *  (트러스 대각재와 동일 연립 역산 — 회전 AABB 폐형: 데크 상면 접촉·마스트면 0겹침).
 *  마스트=데크 위 독립 기둥(실교 주탑-교각 일체는 간이화 명시). 구조검토 미포함. */
function cableStayedBridgeAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const mainSpan = num(p.mainSpan, 200000);
  const sideSpan = num(p.sideSpan, Math.round(mainSpan * 0.4));
  const pylonH = num(p.pylonH, Math.round(mainSpan * 0.25)); // 데크 위 마스트 높이
  const nStays = Math.max(3, Math.min(12, Math.round(num(p.nStays, 6)))); // 마스트당 편측
  const stayS = num(p.stayS, 250);
  const deckW = num(p.deckW, 14000), deckThk = num(p.deckThk, 350);
  const girderW = 800, girderH = num(p.girderH, 2200);
  const pierH = num(p.pierH, 15000), pierW = 5000, pierD = 2400, capH = 1500;
  const mastW = num(p.mastW, 2500);
  const harp = String(p.arrangement ?? 'fan') === 'harp';
  const L = 2 * sideSpan + mainSpan;
  const deckBot = pierH + capH + girderH;
  const deckTop = deckBot + deckThk;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 교각(양단 + 마스트 하부 2기) + 연단 거더 2본 + 상판
  const pylonXs = [sideSpan, sideSpan + mainSpan];
  for (const [i, x] of [0, ...pylonXs, L].entries()) {
    const big = i === 1 || i === 2;
    const w = big ? pierW * 1.5 : pierW, d2 = big ? pierD * 1.5 : pierD;
    const xc = Math.min(Math.max(x, w / 2), L - w / 2);
    P(`pier${i}_col`, 'box', { width: w, depth: d2, height: pierH }, { tx: xc - w / 2, ty: (deckW - d2) / 2, tz: 0 }, 'concrete', 'pier');
    P(`pier${i}_cap`, 'box', { width: w + 1600, depth: deckW - 1500, height: capH }, { tx: xc - (w + 1600) / 2, ty: 750, tz: pierH }, 'concrete', 'crossbeam');
  }
  const yEdge = [900, deckW - 900 - girderW]; // 연단 거더/마스트/스테이 y 스트립
  for (const [side, y] of [['L', yEdge[0]], ['R', yEdge[1]]]) {
    P(`girder_${side}`, 'box', { width: L, depth: girderW, height: girderH }, { tx: 0, ty: y, tz: pierH + capH }, 'steel', 'girder');
  }
  P('deck', 'box', { width: L, depth: deckW, height: deckThk }, { tx: 0, ty: 0, tz: deckBot }, 'concrete', 'deck');
  // 마스트(데크 위, 연단 스트립) + 마스트간 상부 크로스타이
  for (const [pi, xp] of pylonXs.entries()) {
    for (const [mi, y] of yEdge.entries()) {
      P(`mast_${pi + 1}_${mi + 1}`, 'box', { width: mastW, depth: girderW, height: pylonH }, { tx: xp - mastW / 2, ty: y, tz: deckTop }, 'steel', 'pylon');
    }
    P(`mtie_${pi + 1}`, 'box', { width: mastW, depth: yEdge[1] - yEdge[0] - girderW, height: 800 }, { tx: xp - mastW / 2, ty: yEdge[0] + girderW, tz: deckTop + pylonH - 800 }, 'steel', 'bracing');
  }
  // 스테이: 클리어 사각형 내접(연립 역산 — 트러스와 동일). 팬=슬롯 상부 밀집·하프=등분포.
  const anchor0 = mastW / 2 + 4000, dA = Math.max(4000, Math.round((harp ? 0.8 : 0.85) * (Math.min(sideSpan, mainSpan / 2) - anchor0) / nStays));
  const slotTop = deckTop + pylonH - 1200;
  // 세미-팬(260718): 급경사 이웃 스테이의 수직 슬롯 간격 × cos(이웃각) ≥ 단면이 되도록
  // 슬롯 간격을 키움(순수 팬의 마스트두부 밀집은 OBB 겹침 — 그리드 검출). 하프=0.6H 등분포.
  const slotStep = harp ? Math.round((pylonH * 0.6) / nStays) : Math.max(Math.round(stayS * 2.6), Math.round((pylonH * 0.35) / nStays));
  let stayGate = null;
  for (const [pi, xp] of pylonXs.entries()) {
    for (const [mi, y] of yEdge.entries()) {
      const ty = y + (girderW - stayS) / 2;
      for (let i = 0; i < nStays; i++) {
        const aX = anchor0 + i * dA;               // 마스트면 기준 정착 거리
        const zs = slotTop - (nStays - 1 - i) * slotStep; // 먼 정착=높은 슬롯(비교차 폐형)
        const Hz0 = zs - deckTop;
        if (Hz0 < stayS * 3) { stayGate = `슬롯 z(${Math.round(Hz0)}) 부족 — nStays/pylonH 재조정`; continue; }
        // 축 기반 폐형(내접 사각형은 급경사에서 전 스테이가 마스트면 수직선으로 퇴화 — 260718 검출):
        // 축선 = 슬롯(마스트면)→정착점. 끝점 당김: 상단 x+=(s/2)sinθ(마스트면 0겹침)·
        // 하단 z+=(s/2)cosθ(데크 상면 접촉) — θ 의존이라 부동점 3회.
        for (const dir of [+1, -1]) {
          const xFace = xp + dir * (mastW / 2 + 1);
          let th = Math.atan2(Hz0, aX);
          let xT = xFace, zB = deckTop, xB = xFace + dir * aX;
          for (let it = 0; it < 3; it++) {
            xT = xFace + dir * (stayS / 2) * Math.sin(th);
            zB = deckTop + (stayS / 2) * Math.cos(th);
            th = Math.atan2(zs - zB, Math.abs(xB - xT));
          }
          const Ls = Math.hypot(xB - xT, zs - zB);
          if (!(Ls > stayS * 2)) { stayGate = '스테이 기하 퇴화'; continue; }
          chordBoxX(P, `stay_${pi + 1}_${mi + 1}_${dir > 0 ? 'f' : 'b'}${i + 1}`, (xT + xB) / 2, (zs + zB) / 2, dir > 0 ? -th : th, Ls, stayS, ty, stayS, 'steel', 'stay');
        }
      }
    }
  }
  if (stayGate) return { name: '사장교', domain: 'bridge', parts: [], alignmentErrors: [stayGate] };
  return {
    name: `사장교 ${mainSpan / 1000}m(${harp ? '하프' : '팬'})`, domain: 'bridge', kind: 'assembly', parts,
    cableStayedMeta: { mainSpan, sideSpan, pylonH, nStays, deckW, arrangement: harp ? 'harp' : 'fan' },
    note: '독립 마스트(주탑-교각 일체 간이화 명시)·스테이=내접 폐형 box(실 케이블 원단면 아님)·구조검토 미포함(형상·물량·도서만)',
  };
}

/** 현수교(주케이블 포물선 + 행어 + 주탑 + 앵커리지 — 260718 신설).
 *  주케이블=아치 세그와 동일 코너 규약(간섭 0 검증식 재사용, 새그 하향)·타워 접속=새들
 *  x-면 접촉 폐형·행어=아치 chord-underside 컷 재사용. 측경간 행어 없음(백스테이만 — 명시). */
function suspensionBridgeAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const mainSpan = num(p.mainSpan, 300000);
  const sideSpan = num(p.sideSpan, Math.round(mainSpan * 0.35));
  const sag = num(p.sag, Math.round(mainSpan * 0.1));
  const towerAbove = num(p.towerAbove, sag + 12000); // 데크 위 케이블 정점 여유
  const cableS = num(p.cableS, 600);   // 등가 정사각 단면(실 케이블 원단면 아님 — 명시)
  const hangerSpacing = num(p.hangerSpacing, 8000), hangerS = num(p.hangerS, 150);
  const deckW = num(p.deckW, 16000), deckThk = num(p.deckThk, 300);
  const beamH = num(p.beamH, 1400), beamW = 600;
  const pierH = num(p.pierH, 20000);   // 상판 하면(보 상면) 높이
  const tw = num(p.towerW, 3000), td = 1800;
  const outW = td + 200;                // 보 아웃리거(타워/케이블 플레인이 데크 밖에 서도록)
  const nSeg = Math.max(16, Math.min(40, Math.round(num(p.cableSegments, 28))));
  const L = 2 * sideSpan + mainSpan;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const beamTop = pierH;
  const deckTop = beamTop + deckThk;
  const zTopCable = deckTop + towerAbove;
  const towerXs = [sideSpan, sideSpan + mainSpan];
  const yPlane = [-outW + 100, deckW + 100]; // 타워/케이블/행어 y 스트립(폭 td — 데크 y 완전 밖)
  // 상판(보 위) — 보는 y 전폭+아웃리거
  P('deck', 'box', { width: L, depth: deckW, height: deckThk }, { tx: 0, ty: 0, tz: beamTop }, 'concrete', 'deck');
  // 교대(양단 — 보 지지) + 플로어빔(행어 간격, 타워 근접 스킵)
  // 교대: 단부 보(ebeam) 밑을 실폭으로 받도록 x-겹침 배치(0폭 접촉은 bearing 불성립 — 260718)
  for (const [tag, x0] of [['A', -1400], ['B', L - 600]]) {
    P(`abut_${tag}`, 'box', { width: 2000, depth: deckW + 2 * outW, height: beamTop - beamH }, { tx: x0, ty: -outW, tz: 0 }, 'concrete', 'abutment');
  }
  // 플로어빔=주경간만(측경간 보는 백스테이 교차·행어 없음 부유 — 그리드 검출로 제외 명시)
  let nB = 0;
  const beamXs = [];
  for (let x = towerXs[0] + hangerSpacing; x < towerXs[1] - hangerSpacing / 2; x += hangerSpacing) {
    if (towerXs.some((xt) => Math.abs(x - xt) < tw + beamW / 2 + 200)) continue;
    beamXs.push(x);
    P(`fbeam_${++nB}`, 'box', { width: beamW, depth: deckW + 2 * outW, height: beamH }, { tx: x - beamW / 2, ty: -outW, tz: beamTop - beamH }, 'steel', 'crossbeam');
  }
  // 양단 보(교대 위 지지 — 상판 단부 지지 폐형)
  for (const [tag, x] of [['A', beamW / 2], ['B', L - beamW / 2]]) {
    P(`ebeam_${tag}`, 'box', { width: beamW, depth: deckW + 2 * outW, height: beamH }, { tx: x - beamW / 2, ty: -outW, tz: beamTop - beamH }, 'steel', 'crossbeam');
  }
  // 주케이블(포물선 새그 — 코너 규약 세그) + 타워 + 새들 + 행어 + 백스테이 + 앵커리지
  const zCable = (x) => {
    const u = (x - towerXs[0]) / mainSpan;
    return zTopCable - 4 * sag * u * (1 - u);
  };
  for (const [ci, yC] of yPlane.entries()) {
    // 주케이블: **중심 규약 + 미터 컷**(260718). 코너 규약은 오목(새그) 킥에서 인접 세그
    // 쐐기 겹침(그리드 20.7mm×27쌍 검출 — 볼록인 아치는 같은 규약이 갭이라 무사고였음).
    // 세그 축을 절점 사이 양끝 δ 씩 당김 — 0겹침·미세 갭(케이블 밴드 관례 명시).
    // δ = 킥 쐐기 상계(Δθ 2배 보수) + 1mm: 인접 세그 확정 갭(간섭 0). 갭(수 mm~cm)은
    // supportCheck 의 인장 체인 규칙(케이블 밴드 관례 — 선언 역할 한정)이 지지로 연결.
    const thMax = Math.atan((4 * sag) / mainSpan);
    const delta = (cableS / 2) * Math.tan((2 * thMax) / nSeg) + 1;
    const chord = [];
    for (let k = 0; k < nSeg; k++) {
      const x0 = towerXs[0] + (mainSpan * k) / nSeg, x1 = towerXs[0] + (mainSpan * (k + 1)) / nSeg;
      const z0 = zCable(x0), z1 = zCable(x1);
      const segL = Math.hypot(x1 - x0, z1 - z0);
      const th = Math.atan2(z1 - z0, x1 - x0);
      chord.push({ x0, x1, z0, z1, thRad: th });
      chordBoxX(P, `cable${ci + 1}_seg${k + 1}`, (x0 + x1) / 2, (z0 + z1) / 2, th, segL - 2 * delta, cableS, yC, td, 'steel', 'cable');
    }
    // 타워+새들: 세그1 끝면(중심 규약 AABB 경계 = 절점에서 δcosθ−(s/2)sinθ 안쪽)에
    // 새들 안쪽 면을 정확히 맞춤 — x-면 접촉 폐형(끝단면 z구간과 새들 z구간 겹침).
    const th1 = Math.abs(chord[0].thRad);
    const rcz1 = (cableS / 2) * Math.cos(th1);
    const endInX = delta * Math.cos(th1) - (cableS / 2) * Math.sin(th1);
    const towerTopZ = zTopCable - delta * Math.sin(th1) - rcz1;
    for (const [tiT, xt] of towerXs.entries()) {
      const faceX = tiT === 0 ? xt + endInX : xt - endInX;
      const tx0 = tiT === 0 ? faceX - tw : faceX;
      P(`tower_${tiT + 1}_${ci + 1}`, 'box', { width: tw, depth: td, height: towerTopZ }, { tx: tx0, ty: yC, tz: 0 }, 'concrete', 'tower');
      P(`saddle_${tiT + 1}_${ci + 1}`, 'box', { width: tw, depth: td, height: 2 * rcz1 + delta * Math.sin(th1) + 200 }, { tx: tx0, ty: yC, tz: towerTopZ }, 'steel', 'saddle');
    }
    // 행어(수직 — 케이블 현 하면 컷: 아치 검증식 재사용) — 주경간 보 위치만
    // 행어 x가 절점 컷백 구간에 걸리면 세그 내부로 넛지(스킵 금지 — 보 부유의 원인, 260718).
    // 넛지 최대 ≈ δ+행어폭 ≪ 보 반폭 → 행어는 여전히 보 위(지지 폐형 유지).
    const margin = delta + hangerS;
    const chordLow = (x) => {
      const s = chord.find((q) => x >= q.x0 - 1e-6 && x <= q.x1 + 1e-6);
      if (!s) return null;
      let xa = x;
      if (xa < s.x0 + margin) xa = s.x0 + margin;
      if (xa > s.x1 - margin) xa = s.x1 - margin;
      const zc = s.z0 + ((xa - s.x0) / Math.max(1e-9, s.x1 - s.x0)) * (s.z1 - s.z0);
      return { x: xa, z: zc - (cableS / 2) / Math.cos(s.thRad) - (hangerS / 2) * Math.abs(Math.tan(s.thRad)) };
    };
    let nH = 0;
    for (const x of beamXs) {
      if (x < towerXs[0] + hangerSpacing / 2 || x > towerXs[1] - hangerSpacing / 2) continue;
      const top = chordLow(x);
      if (top == null) continue;
      const Lh = top.z - beamTop;
      if (Lh < hangerS * 3) continue;
      P(`hang${ci + 1}_${++nH}`, 'box', { width: hangerS, depth: hangerS, height: Lh },
        { tx: top.x - hangerS / 2, ty: yC + (td - hangerS) / 2, tz: beamTop }, 'steel', 'hanger');
    }
    // 백스테이(내접 폐형 — 앵커 블록 상면~새들 하단) + 앵커리지
    for (const [tiT, xt] of towerXs.entries()) {
      const dir = tiT === 0 ? -1 : +1; // 측경간 방향
      const ax = xt + dir * (sideSpan * 0.85);
      const blockW = 12000, blockH = 10000;
      const bx = dir < 0 ? Math.max(ax - blockW / 2, 0) : Math.min(ax + blockW / 2, L) - blockW;
      if (ci === 0) P(`anchor_${tiT + 1}`, 'box', { width: blockW, depth: deckW + 2 * outW, height: blockH }, { tx: bx, ty: -outW, tz: 0 }, 'concrete', 'anchorage');
      // 내접 사각형 [타워 외측면−1 ↔ 앵커 중심] × [블록 상면, 새들 하단] — 하단 z-접촉이
      // 블록 x-범위와 양(+)의 폭으로 겹치도록 Wx=축선 전장(코너 점접촉 방지 폐형)
      const xInner = tiT === 0 ? (xt + endInX - tw) - 1 : (xt - endInX + tw) + 1;
      const Wx = Math.abs(ax - xInner);
      const Hz = towerTopZ - blockH;
      if (Wx < cableS || Hz < cableS * 2) continue;
      let thB = Math.atan2(Hz, Wx);
      for (let it = 0; it < 4; it++) thB = Math.atan2(Hz - cableS * Math.cos(thB), Wx - cableS * Math.sin(thB));
      const Lb = (Hz - cableS * Math.cos(thB)) / Math.sin(thB);
      const xm = xInner + dir * Wx / 2, zm = blockH + Hz / 2;
      chordBoxX(P, `backstay_${tiT + 1}_${ci + 1}`, xm, zm, dir < 0 ? thB : -thB, Lb, cableS, yC + (td - cableS) / 2, cableS, 'steel', 'cable');
    }
  }
  return {
    name: `현수교 ${mainSpan / 1000}m`, domain: 'bridge', kind: 'assembly', parts,
    suspensionMeta: { mainSpan, sideSpan, sag, towerAbove, deckW, hangerSpacing, nSeg },
    note: '주케이블=등가 사각 단면 세그(실 케이블 원단면·새그 캐터너리 대신 포물선 — 등분포 관례 명시)·측경간 행어 없음(백스테이만)·구조검토 미포함(형상·물량·도서만)',
  };
}

/** 모듈러 강구조 캐노피(박공 개방형 — 260717, 참고파일들 철골 마켓 코퍼스 대응).
 *  경사 서까래=rx 회전 box. 회전 AABB 과탐(아치교 보류 원인)을 **옆면 맞댐(0겹침)**으로
 *  원천 회피: 서까래 y구간=[이브빔 안쪽면, 릿지빔 옆면], 퍼린 하면=서까래 회전 AABB 상면.
 *  가새·지붕 패널·접합 상세=후속 명시. 구조검토=철골 계산기 체인 별도(형상·물량·도서). */
function steelCanopyAssembly(p = {}) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  const baysX = Math.max(1, Math.min(20, Math.round(num(p.baysX, 6))));
  const bayX = num(p.bayX, 6000);
  const W = num(p.spanY, 12000);
  const colH = num(p.colH, 4000);
  const pitch = Math.max(3, Math.min(30, num(p.pitchDeg, 12)));
  const colS = num(p.colSize, 250);
  const bw = num(p.beamW, 200), bh = num(p.beamH, 300);   // 이브·릿지빔
  const rw = num(p.rafterW, 150), rh = num(p.rafterH, 250);
  const purlinSp = num(p.purlinSpacing, 1500);
  const pw = num(p.purlinW, 100), ph = num(p.purlinH, 80);
  const L = baysX * bayX;
  const th = (pitch * Math.PI) / 180;
  const colC = colS / 2;                                   // 기둥 중심 y(전면)
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 기둥(전후 2열 × 프레임)
  for (let i = 0; i <= baysX; i++) {
    const x = i * bayX;
    P(`col_f_${i}`, 'box', { width: colS, depth: colS, height: colH }, { tx: x - colC, ty: 0, tz: 0 }, 'steel', 'column');
    P(`col_b_${i}`, 'box', { width: colS, depth: colS, height: colH }, { tx: x - colC, ty: W - colS, tz: 0 }, 'steel', 'column');
  }
  // 이브빔(전후 x 전장 — 기둥 상면 지지)
  P('eave_f', 'box', { width: L + colS, depth: bw, height: bh }, { tx: -colC, ty: colC - bw / 2, tz: colH }, 'steel', 'beam');
  P('eave_b', 'box', { width: L + colS, depth: bw, height: bh }, { tx: -colC, ty: W - colC - bw / 2, tz: colH }, 'steel', 'beam');
  // 서까래(프레임당 좌우 1쌍) — 옆면 맞댐: y ∈ [이브빔 안쪽면, 릿지빔 옆면]
  const y0L = colC + bw / 2;                 // 좌서까래 시작(이브빔 안쪽면)
  const y1L = W / 2 - bw / 2;                // 좌서까래 끝(릿지빔 좌측면)
  const runL = y1L - y0L;
  // 회전 AABB y-스팬 = depth·cosθ + rh·sinθ → 목표 스팬(runL)에 정확히 맞춤(양단 0겹침).
  // 실부재가 이상 경사장보다 rh·tanθ 짧아짐 = 모서리 컷 맞댐 시공 관례(명시).
  const slope = (runL - rh * Math.sin(th)) / Math.cos(th);
  const zc0 = colH + bh / 2;                 // 시점 중심 z(이브빔 중심과 동일)
  const zc1 = zc0 + runL * Math.tan(th);     // 릿지측 중심 z
  const cy = (rh / 2) * Math.sin(th), cz = (rh / 2) * Math.cos(th); // Rx 단면중심 보정
  for (let i = 0; i <= baysX; i++) {
    const x = i * bayX;
    // 좌: rx=+θ 회전 AABB 의 y-min = ty − rh·sinθ → 이브 안쪽면(y0L)과 0겹침이 되도록 +rh·sinθ
    P(`raf_L_${i}`, 'box', { width: rw, depth: slope, height: rh },
      { tx: x - rw / 2, ty: y0L + 2 * cy, tz: zc0 - cz, rx: +pitch }, 'steel', 'rafter');
    // 우: rx=−θ 회전 AABB 의 y-min = ty 정확 → 릿지 우측면에서 시작
    P(`raf_R_${i}`, 'box', { width: rw, depth: slope, height: rh },
      { tx: x - rw / 2, ty: W / 2 + bw / 2, tz: zc1 - cz, rx: -pitch }, 'steel', 'rafter');
  }
  // 릿지빔(정점 x 전장) — 좌우 서까래 끝과 y-맞댐(0겹침)
  P('ridge', 'box', { width: L + colS, depth: bw, height: bh }, { tx: -colC, ty: W / 2 - bw / 2, tz: zc1 - bh / 2 }, 'steel', 'beam');
  // 퍼린(x 전장 수평 — 정립 근사 명시): 하면 = 서까래 회전 AABB 상연(중심 z + 단면 z성분)
  const nP = Math.max(2, Math.floor(runL / purlinSp));
  // 퍼린 하연 = 서까래 경사 상면(폐형 유도, 0겹침 정확):
  //   좌 상면 z(y) = zc0 + (y−y0L)tanθ + cz · 우 상면 z(y) = zc1 − (y−T_R)tanθ + cz + rh·sinθ·tanθ
  //   퍼린 폭 구간 최고점 보정 = +(pw/2)tanθ (비회전 퍼린 하연은 수평 — 경사 상면의 높은 쪽 끝 기준)
  const tanT = Math.tan(th);
  const TR = W / 2 + bw / 2;
  for (let k = 1; k <= nP; k++) {
    const yc = y0L + (runL * k) / (nP + 1);
    const zL = zc0 + (yc - y0L) * tanT + cz + (pw / 2) * tanT;
    P(`purlin_L_${k}`, 'box', { width: L + colS, depth: pw, height: ph }, { tx: -colC, ty: yc - pw / 2, tz: zL }, 'steel', 'purlin');
    const yR = W - yc;
    const zR = zc1 - (yR - TR) * tanT + cz + rh * Math.sin(th) * tanT + (pw / 2) * tanT;
    P(`purlin_R_${k}`, 'box', { width: L + colS, depth: pw, height: ph }, { tx: -colC, ty: yR - pw / 2, tz: zR }, 'steel', 'purlin');
  }
  return {
    name: `강구조 캐노피 ${L / 1000}×${W / 1000}m`, domain: 'building', kind: 'assembly', parts,
    canopyMeta: { L, W, colH, pitchDeg: pitch, frames: baysX + 1, purlinsPerSide: nP },
    note: '개방형(지붕 패널·가새·접합 상세 후속) · 서까래=rx 경사 box(옆면 맞댐 접합) · 구조검토=철골 계산기 체인 별도',
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

// ══ 조경(landscape) 확충 5종 (260719) ══════════════════════════════════════
// 공통 규약: 부재는 맞댐(0겹침) 배치 — 지지는 ①얹힘(gap 0) ②측면 면접촉 체결(2축 ≥40mm)
// ③선언 부착(role='mount') 로만 성립시킨다. 매립 겹침을 쓰지 않으므로 확정 간섭 0.

/** 조경: 울타리/펜스 런 — 기둥(피치) + 가로대 N + 세로 판재(피켓).
 *  가로대는 기둥 배면 맞댐(볼트·피스 측면 체결), 피켓은 가로대 외면 맞댐. 기초(콘크리트
 *  근입)·철물(브래킷/피스)·도장은 미포함 — 부재 배치·물량 산출용 매싱. */
function fenceRunAssembly(p = {}) {
  const L = num(p.length, 12000);
  const pitch = num(p.postPitch, 2000);
  const H = num(p.height, 1200);              // 피켓 상단 높이(지상)
  const ps = num(p.postSize, 100);            // 기둥 ps×ps
  const nRail = Math.max(1, Math.min(4, Math.round(num(p.railCount, 2))));
  const railD = 40, railH = 90;               // 가로대 40(두께)×90(춤)
  const pw = num(p.picketWidth, 90), pt = 20;
  const pgap = num(p.picketGap, 30);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 기둥 — 피켓보다 100 높게(캡 없이 노출 마감). 마지막 기둥은 연장 내로 클램프.
  const nPost = Math.max(2, Math.floor(L / pitch) + 1);
  for (let i = 0; i < nPost; i++) {
    const x = Math.min(i * pitch, L - ps);
    P(`post_${i + 1}`, 'box', { width: ps, depth: ps, height: H + 100 }, { tx: x, ty: 0, tz: 0 }, 'timber', 'column');
  }
  // 가로대 — 기둥 배면(y=ps) 맞댐. 등분 높이(하단 최소 80 확보).
  const railZ = [];
  for (let k = 0; k < nRail; k++) {
    const z = Math.max(80, Math.round((H * (k + 1)) / (nRail + 1) - railH / 2));
    railZ.push(z);
    P(`rail_${k + 1}`, 'box', { width: L, depth: railD, height: railH }, { tx: 0, ty: ps, tz: z }, 'timber', 'beam');
  }
  // 피켓 — 가로대 외면(y=ps+railD) 맞댐, 지면에서 80 띄움(부식 방지 관례).
  const step = pw + pgap;
  const nPick = Math.max(1, Math.floor((L - pw) / step) + 1);
  for (let k = 0; k < nPick; k++) {
    P(`picket_${k + 1}`, 'box', { width: pw, depth: pt, height: H - 80 }, { tx: k * step, ty: ps + railD, tz: 80 }, 'timber', 'board');
  }
  return {
    name: `목재 울타리 ${L / 1000}m`, domain: 'landscape', kind: 'assembly', parts,
    fenceMeta: { length: L, postPitch: pitch, posts: nPost, height: H, rails: nRail, railZ, pickets: nPick, picketPitch: step },
    note: '울타리 매싱 — 기둥 기초(콘크리트 근입·베이스 플레이트)·체결 철물·도장/방부 사양은 미포함(입력 영역). 부재 배치와 재적 산출용이며 풍하중 검토는 별도 구조 체인.',
  };
}

/** 조경: 화단 옹벽(플랜터 월) — 버림 콘크리트 + 저판 + 벽체(신축이음 분절) + 캡 + 배수관.
 *  뒷채움 자갈·부직포·방수는 시공 명세(부재 아님)로 미포함 명시. */
function planterWallAssembly(p = {}) {
  const L = num(p.length, 6000);
  const H = num(p.height, 900);               // 저판 상면~벽체 상단
  const stemT = num(p.stemThk, 200);
  const baseW = num(p.baseWidth, 700);
  const baseT = num(p.baseThk, 250);
  const toe = Math.min(num(p.toeLength, 200), Math.max(0, baseW - stemT));
  const segLen = num(p.segLength, 3000);
  const drainD = num(p.drainDia, 100);
  const jGap = 20, leanT = 50, capT = 60, capOver = 40;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  P('lean_concrete', 'box', { width: L + 100, depth: baseW + 100, height: leanT }, { tx: -50, ty: -50, tz: 0 }, 'concrete', 'slab');
  P('footing', 'box', { width: L, depth: baseW, height: baseT }, { tx: 0, ty: 0, tz: leanT }, 'concrete', 'slab');
  // 벽체·캡 — 신축이음(20mm) 으로 분절. 캡은 벽체 양면 40 내밈(코핑).
  const nSeg = Math.max(1, Math.round(L / segLen));
  const sw = (L - (nSeg - 1) * jGap) / nSeg;
  const zStem = leanT + baseT;
  for (let s = 0; s < nSeg; s++) {
    const x = s * (sw + jGap);
    P(`stem_${s + 1}`, 'box', { width: sw, depth: stemT, height: H }, { tx: x, ty: toe, tz: zStem }, 'concrete', 'wall');
    P(`cap_${s + 1}`, 'box', { width: sw, depth: stemT + 2 * capOver, height: capT }, { tx: x, ty: toe - capOver, tz: zStem + H }, 'concrete', 'coping');
  }
  // 유공관(배수) — 벽체 배면 뒷굽 위. 축=x(ry 90), 저판 상면 안착.
  const heelY = toe + stemT;
  const heel = baseW - heelY;
  const drainY = heel >= drainD + 40 ? heelY + heel / 2 : baseW - drainD / 2 - 10;
  P('drain_pipe', 'cylinder', { diameter: drainD, length: L }, { tx: 0, ty: drainY, tz: zStem + drainD / 2, ry: 90 }, 'PVC', 'pipe');
  return {
    name: `화단 옹벽 ${L / 1000}m (H${H})`, domain: 'landscape', kind: 'assembly', parts,
    planterWallMeta: { length: L, height: H, stemThk: stemT, baseWidth: baseW, baseThk: baseT, toeLength: toe, segments: nSeg, segWidth: +sw.toFixed(1), jointGap: jGap, drainDia: drainD },
    note: '화단 옹벽 매싱 — 뒷채움 자갈·부직포·방수/방근 시트·배수공(weep hole)·식재토는 시공 명세라 부재 미포함 명시. 배근·전도/활동 안정은 civil 구조 체인(별도) 영역.',
  };
}

/** 조경: 주차장 포장 — 포장 3층(보조기층/기층/표층) + 경계석(1m 단위) + 주차대수별 휠스토퍼.
 *  구획선(도색)은 부재가 아니므로 미포함 — 주차 단위는 휠스토퍼 위치로만 표현. */
function parkingPavementAssembly(p = {}) {
  const stalls = Math.max(1, Math.min(24, Math.round(num(p.stalls, 6))));
  const sw = num(p.stallWidth, 2500), sl = num(p.stallLength, 5000);
  const aisle = num(p.aisleWidth, 6000);
  const subT = num(p.subbaseThk, 150), basT = num(p.baseThk, 100), surT = num(p.surfaceThk, 50);
  const curbH = num(p.curbHeight, 500), curbB = 150, curbU = 1000;
  const W = stalls * sw, D = sl + aisle;
  const topZ = subT + basT + surT;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  P('subbase', 'box', { width: W, depth: D, height: subT }, { tx: 0, ty: 0, tz: 0 }, 'concrete', 'pavement');
  P('base_course', 'box', { width: W, depth: D, height: basT }, { tx: 0, ty: 0, tz: subT }, 'concrete', 'pavement');
  P('surface_course', 'box', { width: W, depth: D, height: surT }, { tx: 0, ty: 0, tz: subT + basT }, 'concrete', 'pavement');
  // 경계석 — 배면(y=D)·좌우 2변. 진입면(y=0)은 개구라 미설치. 포장과 맞댐(0겹침).
  const nBack = Math.max(1, Math.round(W / curbU));
  for (let i = 0; i < nBack; i++) {
    const w = i === nBack - 1 ? W - i * curbU : curbU;
    P(`curb_back_${i + 1}`, 'box', { width: w, depth: curbB, height: curbH }, { tx: i * curbU, ty: D, tz: 0 }, 'concrete', 'curb');
  }
  const nSide = Math.max(1, Math.round(D / curbU));
  for (const [si, x0] of [[0, -curbB], [1, W]]) {
    for (let i = 0; i < nSide; i++) {
      const d = i === nSide - 1 ? D - i * curbU : curbU;
      P(`curb_side${si + 1}_${i + 1}`, 'box', { width: curbB, depth: d, height: curbH }, { tx: x0, ty: i * curbU, tz: 0 }, 'concrete', 'curb');
    }
  }
  // 휠스토퍼 — 주차 1면당 1기, 배면에서 900 이격(차량 오버행 관례). 표층 위 안착.
  for (let i = 0; i < stalls; i++) {
    P(`wheelstop_${i + 1}`, 'box', { width: 600, depth: 150, height: 100 }, { tx: i * sw + (sw - 600) / 2, ty: D - 900, tz: topZ }, 'concrete', 'wheelstop');
  }
  return {
    name: `주차장 포장 ${stalls}면`, domain: 'landscape', kind: 'assembly', parts,
    parkingMeta: { stalls, stallWidth: sw, stallLength: sl, aisleWidth: aisle, width: W, depth: D, pavementThk: topZ, layers: { subbase: subT, base: basT, surface: surT }, curbHeight: curbH, curbUnits: nBack + 2 * nSide, pavedAreaM2: +((W * D) / 1e6).toFixed(2) },
    note: '주차장 포장 매싱 — 구획선/장애인·경차 표시 도색, 우수받이·측구, 노상 다짐·동상방지층은 미포함(부재 아님/입력 영역). 층별 재료(쇄석·아스콘)는 밀도만 콘크리트로 근사하며 물량은 체적 기준 — 재료 단가는 BOQ 입력.',
  };
}

/** 조경: 정자/쉼터 — 기단 + 기둥4 + 처마도리2 + 박공 지붕판2 + 용마루 + 평상 벤치2.
 *  지붕판 기하는 검증된 박공 규약(하면 라인이 처마도리 상면·정점을 지나도록 tz 역산) 재사용. */
function pavilionAssembly(p = {}) {
  const W = num(p.width, 3000);               // x(용마루 방향)
  const D = num(p.depth, 3000);               // y(경사 방향)
  const H = num(p.postHeight, 2400);
  const ps = num(p.postSize, 150);
  const gh = num(p.girderHeight, 200);
  const pitch = Math.max(10, Math.min(45, num(p.pitchDeg, 30)));
  const padT = num(p.padThk, 150);
  const roofT = num(p.roofThk, 100);
  const th = (pitch * Math.PI) / 180;
  const halfD = D / 2;
  const eaveTop = padT + H + gh;              // 처마도리 상면 = 지붕 하면 기준선
  const apex = eaveTop + halfD * Math.tan(th);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  P('pad', 'box', { width: W + 1200, depth: D + 1200, height: padT }, { tx: -600, ty: -600, tz: 0 }, 'concrete', 'slab');
  for (const [i, xy] of [[0, [0, 0]], [1, [W - ps, 0]], [2, [0, D - ps]], [3, [W - ps, D - ps]]]) {
    P(`post_${i + 1}`, 'box', { width: ps, depth: ps, height: H }, { tx: xy[0], ty: xy[1], tz: padT }, 'timber', 'column');
  }
  // 처마도리 2 — 지붕 하면 기준선(y=0 / y=D) 안쪽으로만 배치(경사면 관통 회피)
  const ovhX = 300;
  for (const [i, y] of [[0, 0], [1, D - ps]]) {
    P(`girder_${i + 1}`, 'box', { width: W + 2 * ovhX, depth: ps, height: gh }, { tx: -ovhX, ty: y, tz: padT + H }, 'timber', 'beam');
  }
  // 박공 지붕판 2 — rx 회전=코너 기준(placedAabb 규약), 하면 라인 폐형 역산
  const ovh = 300;
  const cy = (roofT / 2) * Math.sin(th);
  const slopeLen = (halfD + ovh - roofT * Math.sin(th)) / Math.cos(th);
  P('roof_front', 'box', { width: W + 2 * ovhX, depth: slopeLen, height: roofT },
    { tx: -ovhX, ty: -ovh + 2 * cy, tz: eaveTop - (ovh - 2 * cy) * Math.tan(th), rx: +pitch }, 'timber', 'roof');
  P('roof_back', 'box', { width: W + 2 * ovhX, depth: slopeLen, height: roofT },
    { tx: -ovhX, ty: halfD, tz: apex, rx: -pitch }, 'timber', 'roof');
  // 용마루 — 상면이 양 판 하면 경사 안쪽에 들어가도록 컷(판·용마루 0겹침 폐형)
  P('ridge', 'box', { width: W + 2 * ovhX, depth: 100, height: 100 }, { tx: -ovhX, ty: halfD - 50, tz: apex - 50 * Math.tan(th) - 101 }, 'timber', 'beam');
  // 평상 벤치 2 — 기둥 사이 기단 위(구조 무관, 자립 착석부)
  const benchD = 400, benchH = 400;
  if (W - 2 * ps > 600 && D - 2 * ps > 2 * benchD + 200) {
    for (const [i, y] of [[0, ps + 100], [1, D - ps - 100 - benchD]]) {
      P(`bench_${i + 1}`, 'box', { width: W - 2 * ps, depth: benchD, height: benchH }, { tx: ps, ty: y, tz: padT }, 'timber', 'furniture');
    }
  }
  return {
    name: `정자/쉼터 ${W / 1000}×${D / 1000}m`, domain: 'landscape', kind: 'assembly', parts,
    pavilionMeta: { width: W, depth: D, postHeight: H, postSize: ps, pitchDeg: pitch, eaveTopMm: +eaveTop.toFixed(0), ridgeTopMm: +apex.toFixed(0), padThk: padT, roofAreaM2: +(((W + 2 * ovhX) * (halfD + ovh) * 2) / Math.cos(th) / 1e6).toFixed(2) },
    note: '정자 매싱 — 지붕은 경사 판 2매 근사(기와·서까래·평고대·처마 상세 미포함), 기둥-도리 접합은 맞댐 표현이며 장부/철물 상세는 입력 영역. 기초는 기단 슬래브 근사(독립기초 상세 미포함).',
  };
}

/** 조경: 식재 플랜 — 격자 배치 수목 N주. 수목=간이 프록시(줄기 원통 + 수관 구체 회전체).
 *  실수종 형상·근분(root ball)·지주목은 미표현 — 위치/이격/수량 검토용. */
function treePlantingAssembly(p = {}) {
  const rows = Math.max(1, Math.min(8, Math.round(num(p.rows, 2))));
  const cols = Math.max(1, Math.min(12, Math.round(num(p.cols, 4))));
  const sx = num(p.spacingX, 4000), sy = num(p.spacingY, 4000);
  const trunkD = num(p.trunkDia, 150);
  const trunkH = num(p.trunkHeight, 1800);
  const canD = Math.min(num(p.canopyDia, 3000), Math.min(sx, sy) - 200); // 수관 간섭 회피 클램프
  const R = canD / 2;
  // 수관 프로파일: 반원(회전체 → 구) — [r, z], 중심 z=0 기준이므로 AABB 하단 = tz - R
  const prof = [];
  for (let a = -90; a <= 90; a += 10) {
    const rad = (a * Math.PI) / 180;
    prof.push([+(R * Math.cos(rad)).toFixed(3), +(R * Math.sin(rad)).toFixed(3)]);
  }
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * sx, y = j * sy, n = j * cols + i + 1;
    P(`trunk_${n}`, 'cylinder', { diameter: trunkD, length: trunkH }, { tx: x, ty: y, tz: 0 }, 'timber', 'trunk');
    // 수관=표시 프록시 구체. massProxy=true → 질량 집계에서 제외(구체 체적×목재 밀도는
    // 실수목 중량과 무관 — 소비자가 "총 무게"로 오독하면 수십 t 오표기, 260719b).
    parts.push({ id: `canopy_${n}`, type: 'revolve', params: { profile: prof }, at: { tx: x, ty: y, tz: trunkH + R }, material: 'timber', role: 'canopy', massProxy: true });
  }
  const trees = rows * cols;
  return {
    name: `식재 플랜 ${trees}주`, domain: 'landscape', kind: 'assembly', parts,
    treePlantingMeta: { rows, cols, trees, spacingX: sx, spacingY: sy, trunkDia: trunkD, trunkHeight: trunkH, canopyDia: canD, plantedAreaM2: +(((cols - 1) * sx + canD) * ((rows - 1) * sy + canD) / 1e6).toFixed(2) },
    note: '수목은 간이 프록시(줄기=원통·수관=구체 회전체) — 실수종 수형/지엽/근분은 미표현. 질량·재적(BOQ)은 프록시 체적이므로 수목 물량 산출에 쓰지 말 것(수량·위치·이격만 유효). 객토·지주목·관수는 별도 명세.',
  };
}

// ══ 인테리어(interior) 확충 4종 (260719) ═══════════════════════════════════
// 가구/경량 부재는 자중 지지가 아닌 체결 부착이 많다 — 선반·문짝·행거·보드는
// role='mount'(다보/경첩/피스 부착) 로 선언해 "연결≠지지" 원칙을 우회하지 않고 통과시킨다.

/** 인테리어: 붙박이장 — 걸레받이 + 측판/칸막이 + 상판 + 선반(다보 부착) + 행거바 + 문짝(경첩).
 *  베이 1은 옷걸이 구간(행거바+상단 선반), 나머지 베이는 선반 구간. */
function builtInClosetAssembly(p = {}) {
  const W = num(p.width, 2400), D = num(p.depth, 600), H = num(p.height, 2400);
  const t = num(p.panelThk, 18);
  const plH = num(p.plinthHeight, 80);
  const bays = Math.max(1, Math.min(4, Math.round(num(p.bays, 2))));
  const nShelf = Math.max(0, Math.min(10, Math.round(num(p.shelfCount, 4))));
  const rodD = 32, plRecess = 50;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const sideH = H - plH - t;                 // 측판 높이(걸레받이 위 ~ 상판 아래)
  P('plinth', 'box', { width: W, depth: D - plRecess, height: plH }, { tx: 0, ty: plRecess, tz: 0 }, 'timber', 'plinth');
  // 측판 2 + 칸막이(bays-1) — 걸레받이 위 안착
  const panelX = [0, W - t];
  for (const [i, x] of [[0, panelX[0]], [1, panelX[1]]]) {
    P(`side_${i + 1}`, 'box', { width: t, depth: D, height: sideH }, { tx: x, ty: 0, tz: plH }, 'timber', 'panel');
  }
  const bayPitch = W / bays;
  for (let k = 1; k < bays; k++) {
    P(`divider_${k}`, 'box', { width: t, depth: D, height: sideH }, { tx: k * bayPitch - t / 2, ty: 0, tz: plH }, 'timber', 'panel');
  }
  P('top_panel', 'box', { width: W, depth: D, height: t }, { tx: 0, ty: 0, tz: plH + sideH }, 'timber', 'panel');
  // 선반/행거 — 베이 내측 폭에 맞춤. 측판/칸막이에 다보 부착(role='mount').
  for (let b = 0; b < bays; b++) {
    const xL = b === 0 ? t : b * bayPitch + t / 2;
    const xR = b === bays - 1 ? W - t : (b + 1) * bayPitch - t / 2;
    const inW = xR - xL;
    if (inW < 100) continue;
    if (b === 0) {
      const zS = plH + Math.round(sideH * 0.75);
      P('shelf_hang_top', 'box', { width: inW, depth: D - 20, height: t }, { tx: xL, ty: 0, tz: zS }, 'timber', 'mount');
      P('hanger_rod', 'cylinder', { diameter: rodD, length: inW }, { tx: xL, ty: D / 2, tz: zS - 100, ry: 90 }, 'steel', 'mount');
    } else {
      for (let k = 0; k < nShelf; k++) {
        const zS = plH + Math.round((sideH * (k + 1)) / (nShelf + 1));
        P(`shelf_b${b + 1}_${k + 1}`, 'box', { width: inW, depth: D - 20, height: t }, { tx: xL, ty: 0, tz: zS }, 'timber', 'mount');
      }
    }
  }
  // 문짝 — 전면(y<0) 경첩 부착. 베이당 1짝, 좌우 2mm 클리어런스.
  for (let b = 0; b < bays; b++) {
    P(`door_${b + 1}`, 'box', { width: bayPitch - 4, depth: t, height: H - plH - 20 },
      { tx: b * bayPitch + 2, ty: -t, tz: plH + 10 }, 'timber', 'mount');
  }
  return {
    name: `붙박이장 ${W / 1000}m (${bays}베이)`, domain: 'interior', kind: 'assembly', parts,
    closetMeta: { width: W, depth: D, height: H, bays, panelThk: t, shelvesPerBay: nShelf, hangerBays: 1, doors: bays, plinthHeight: plH },
    note: '붙박이장 매싱 — 선반/문짝/행거바는 부착 부재(role=mount: 다보·경첩·피스)로 선언. 하드웨어(경첩·레일·손잡이), 뒷판/등판, 마감(도장·필름), 벽체 고정 앵커는 미포함(입력 영역).',
  };
}

/** 인테리어: 카운터/바 — 걸레받이 + 하부장 몸체 + 상판(내밈) + 전면 문짝 + 풋레일(브래킷+환봉). */
function counterBarAssembly(p = {}) {
  const L = num(p.length, 2400), D = num(p.depth, 700), H = num(p.height, 1050);
  const topT = num(p.topThk, 40);
  const ovr = num(p.overhang, 250);          // 상판 전면 내밈(발/무릎 공간)
  const plH = 100, plRecess = 60, doorT = 18;
  const railD = num(p.footRailDia, 50);
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  const carH = H - plH - topT;
  P('plinth', 'box', { width: L, depth: D - plRecess, height: plH }, { tx: 0, ty: plRecess, tz: 0 }, 'timber', 'plinth');
  P('carcass', 'box', { width: L, depth: D, height: carH }, { tx: 0, ty: 0, tz: plH }, 'timber', 'cabinet');
  P('countertop', 'box', { width: L + 80, depth: D + ovr, height: topT }, { tx: -40, ty: -ovr, tz: plH + carH }, 'timber', 'countertop');
  // 문짝 — 서비스측(y=D, 바텐더 쪽) 경첩 부착. 손님측(y<0)은 풋레일 구간이라 문짝 없음.
  const nDoor = Math.max(1, Math.round(L / 600));
  const dw = L / nDoor;
  for (let i = 0; i < nDoor; i++) {
    P(`door_${i + 1}`, 'box', { width: dw - 4, depth: doorT, height: carH - 10 }, { tx: i * dw + 2, ty: D, tz: plH + 5 }, 'timber', 'mount');
  }
  // 풋레일 — 브래킷(하부장 손님측 면 부착) 위에 환봉 안착
  const brW = 60, brD = 180, brH = 40, brZ = num(p.footRailHeight, 200);
  const nBr = Math.max(2, Math.round(L / 900) + 1);
  for (let i = 0; i < nBr; i++) {
    const x = Math.min((i * L) / (nBr - 1), L - brW);
    P(`rail_bracket_${i + 1}`, 'box', { width: brW, depth: brD, height: brH }, { tx: x, ty: -brD, tz: brZ }, 'steel', 'mount');
  }
  P('foot_rail', 'cylinder', { diameter: railD, length: L }, { tx: 0, ty: -brD + railD / 2 + 10, tz: brZ + brH + railD / 2, ry: 90 }, 'steel', 'rail');
  return {
    name: `카운터/바 ${L / 1000}m`, domain: 'interior', kind: 'assembly', parts,
    counterMeta: { length: L, depth: D, height: H, topThk: topT, overhang: ovr, doors: nDoor, brackets: nBr, footRailDia: railD, footRailHeight: brZ + brH + railD / 2, seatsApprox: Math.max(1, Math.floor(L / 600)) },
    note: '카운터/바 매싱 — 상판은 단일 판재 근사(엣지·싱크/제빙기 타공·배관 미포함), 하부장은 단일 매스 근사(내부 선반/서랍·레일 미표현). 문짝·브래킷은 부착 부재(role=mount) 선언. 좌석 수는 600 모듈 개산.',
  };
}

/** 인테리어: 경량 파티션 — 하부/상부 러너 + 스터드 + 양면 마감보드, 개구(문틀) 옵션.
 *  개구가 있으면 러너를 분절하고 개구 양측에 보강 스터드 + 상부 헤더를 배치한다. */
function partitionWallAssembly(p = {}) {
  const L = num(p.length, 4000), H = num(p.height, 2700);
  const sw = num(p.studWidth, 65);           // 스터드 폭(=벽 두께 심재)
  const pitch = num(p.studPitch, 450);
  const bt = num(p.boardThk, 12.5);
  const trkH = 40, hdrH = 90;
  const openW = Math.max(0, num(p.openingWidth, 900));
  const openH = num(p.openingHeight, 2100);
  const hasOpen = openW >= 600 && openW <= L - 2 * pitch && openH < H - hdrH - 100;
  const openX = hasOpen ? Math.round((L - openW) / 2) : 0;
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 하부 러너 — 개구 구간은 생략(문턱 없음)
  const runSegs = hasOpen ? [[0, openX], [openX + openW, L - openX - openW]] : [[0, L]];
  for (const [si, seg] of runSegs.entries()) {
    if (seg[1] < 50) continue;
    P(`track_bot_${si + 1}`, 'box', { width: seg[1], depth: sw, height: trkH }, { tx: seg[0], ty: 0, tz: 0 }, 'steel', 'track');
  }
  // 스터드 — 등피치. 개구 구간은 제외하고 개구 양측 보강 스터드를 정위치에 배치.
  const studZ = trkH, studH = H - 2 * trkH;
  const xs = [];
  const nStud = Math.max(2, Math.floor((L - sw) / pitch) + 1);
  for (let i = 0; i < nStud; i++) {
    const x = Math.min(i * pitch, L - sw);
    if (hasOpen && x > openX - sw - 1 && x < openX + openW + 1) continue;
    xs.push(x);
  }
  if (hasOpen) xs.push(openX - sw, openX + openW);
  xs.sort((a, b) => a - b);
  for (const [i, x] of xs.entries()) {
    P(`stud_${i + 1}`, 'box', { width: sw, depth: sw, height: studH }, { tx: x, ty: 0, tz: studZ }, 'steel', 'stud');
  }
  P('track_top', 'box', { width: L, depth: sw, height: trkH }, { tx: 0, ty: 0, tz: H - trkH }, 'steel', 'track');
  // 개구 헤더 — 보강 스터드 사이 맞댐(측면 면접촉 체결)
  if (hasOpen) {
    P('opening_header', 'box', { width: openW, depth: sw, height: hdrH }, { tx: openX, ty: openH, tz: 0 }, 'steel', 'header');
  }
  // 마감보드 — 양면. 개구가 있으면 좌/우(보강 스터드 덮음) + 개구 상부(헤더 덮음) 3분할.
  const faces = [['a', -bt], ['b', sw]];
  for (const [fi, fy] of faces) {
    if (!hasOpen) {
      P(`board_${fi}`, 'box', { width: L, depth: bt, height: H }, { tx: 0, ty: fy, tz: 0 }, 'glass', 'mount');
      continue;
    }
    const xl = openX, xr = openX + openW;
    P(`board_${fi}_l`, 'box', { width: xl, depth: bt, height: H }, { tx: 0, ty: fy, tz: 0 }, 'glass', 'mount');
    P(`board_${fi}_r`, 'box', { width: L - xr, depth: bt, height: H }, { tx: xr, ty: fy, tz: 0 }, 'glass', 'mount');
    P(`board_${fi}_h`, 'box', { width: openW, depth: bt, height: H - openH }, { tx: xl, ty: fy, tz: openH }, 'glass', 'mount');
  }
  return {
    name: `경량 파티션 ${L / 1000}m${hasOpen ? ' (개구 1)' : ''}`, domain: 'interior', kind: 'assembly', parts,
    partitionMeta: { length: L, height: H, studWidth: sw, studPitch: pitch, studs: xs.length, boardThk: bt, wallThk: sw + 2 * bt, opening: hasOpen ? { width: openW, height: openH, x: openX } : null, boardAreaM2: +((2 * L * H) / 1e6).toFixed(2) },
    note: '경량 벽체 매싱 — 보드는 부착 부재(role=mount: 스터드 나사 고정) 선언이며 재료 밀도는 유리로 근사(석고보드 밀도 미보유 — 물량은 면적/체적 기준으로 쓸 것). 단열재·차음재·조인트 처리·문틀/문짝·전기 배선 박스는 미포함(입력 영역).',
  };
}

/** 인테리어: 천장 마감 그리드 — 메인 티바 + 크로스 티바 + 텍스 + 조명 개구(등기구) + 달대.
 *  원점 z=0 = 마감 천장면(그리드 레벨). 상부 슬래브/앵커는 미포함(달대 상단이 자유단). */
function ceilingGridAssembly(p = {}) {
  const W = num(p.width, 3600), D = num(p.depth, 3000);
  const tw = num(p.tileWidth, 600), td = num(p.tileDepth, 600);
  const teeW = 24, teeH = 38;
  const tileT = num(p.tileThk, 15);
  const lights = Math.max(0, Math.min(24, Math.round(num(p.lightCount, 4))));
  const hangH = num(p.hangerHeight, 400), hangS = teeW; // 달대 각재=티바 폭 이내(셀 침범 방지)
  const nX = Math.max(1, Math.round(W / tw)), nY = Math.max(1, Math.round(D / td));
  const parts = [];
  const P = (id, type, params, at, material, role) => parts.push({ id, type, params, at, material, role });
  // 메인 티바(x 방향) — y 격자선마다 1본
  for (let j = 0; j <= nY; j++) {
    P(`main_tee_${j + 1}`, 'box', { width: W, depth: teeW, height: teeH }, { tx: 0, ty: j * td - teeW / 2, tz: 0 }, 'steel', 'tee');
  }
  // 크로스 티바(y 방향) — 셀 행마다 x 격자선 위치에 메인 사이 맞댐
  for (let j = 0; j < nY; j++) for (let i = 0; i <= nX; i++) {
    P(`cross_tee_${j + 1}_${i + 1}`, 'box', { width: teeW, depth: td - teeW, height: teeH },
      { tx: i * tw - teeW / 2, ty: j * td + teeW / 2, tz: 0 }, 'steel', 'tee');
  }
  // 텍스/등기구 — 셀 내측(티바와 맞댐). 앞선 lights 개 셀은 등기구로 치환.
  let cell = 0;
  for (let j = 0; j < nY; j++) for (let i = 0; i < nX; i++) {
    const x = i * tw + teeW / 2, y = j * td + teeW / 2;
    const cw = tw - teeW, cd = td - teeW;
    cell++;
    if (cell <= lights) P(`light_${cell}`, 'box', { width: cw, depth: cd, height: 80 }, { tx: x, ty: y, tz: 0 }, 'aluminum', 'light');
    else P(`tile_${cell}`, 'box', { width: cw, depth: cd, height: tileT }, { tx: x, ty: y, tz: 0 }, 'timber', 'tile');
  }
  // 달대 — 메인 티바 상면, x 1200 피치(관례). 상단 앵커/슬래브는 미포함.
  const hPitch = 1200;
  let hang = 0;
  for (let j = 0; j <= nY; j++) {
    const nH = Math.max(2, Math.floor(W / hPitch) + 1);
    for (let i = 0; i < nH; i++) {
      const x = Math.min(i * hPitch, W - hangS);
      hang++;
      P(`hanger_${j + 1}_${i + 1}`, 'box', { width: hangS, depth: hangS, height: hangH },
        { tx: x, ty: j * td - hangS / 2, tz: teeH }, 'steel', 'hanger');
    }
  }
  return {
    name: `천장 그리드 ${W / 1000}×${D / 1000}m`, domain: 'interior', kind: 'assembly', parts,
    ceilingMeta: { width: W, depth: D, tileWidth: tw, tileDepth: td, cellsX: nX, cellsY: nY, cells: nX * nY, tiles: Math.max(0, nX * nY - lights), lights, mainTees: nY + 1, crossTees: nY * (nX + 1), hangers: hang, hangerHeight: hangH, ceilingAreaM2: +((W * D) / 1e6).toFixed(2) },
    note: '천장 그리드 매싱 — 원점 z=0 이 마감 천장면이며 상부 슬래브·앵커·인서트는 미포함(달대 상단 자유단). 티바는 각형 프록시(실단면 T형 플랜지 미표현), 텍스 밀도는 목재로 근사(미네랄울 밀도 미보유 — 물량은 매수/면적 기준). 등기구는 개구 위치 매스이며 기구 사양·배선은 입력 영역.',
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
      id: 'steel_canopy', labelKo: '강구조 캐노피 (박공 개방형)', labelEn: 'Modular steel canopy (gable, open)', build: steelCanopyAssembly,
      params: [
        { name: 'baysX', labelKo: '경간 수(길이)', unit: '', default: 6, min: 1, max: 20 },
        { name: 'bayX', labelKo: '경간장', unit: 'mm', default: 6000, min: 3000, max: 12000 },
        { name: 'spanY', labelKo: '스팬(폭)', unit: 'mm', default: 12000, min: 6000, max: 24000 },
        { name: 'colH', labelKo: '기둥 높이(처마)', unit: 'mm', default: 4000, min: 2500, max: 8000 },
        { name: 'pitchDeg', labelKo: '지붕 경사', unit: '°', default: 12, min: 3, max: 30 },
        { name: 'purlinSpacing', labelKo: '퍼린 간격', unit: 'mm', default: 1500, min: 800, max: 3000 },
      ],
    },
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
    {
      id: 'industrial_stair', labelKo: '산업용 강재 계단 (직선/U턴+난간)', labelEn: 'Industrial steel stair (straight/switchback)', build: industrialStairAssembly,
      params: [
        { name: 'totalRise', labelKo: '총 높이', unit: 'mm', default: 4000, min: 1000, max: 12000 },
        { name: 'flights', labelKo: '플라이트(2=U턴 중간참)', unit: '', default: 1, min: 1, max: 2 },
        { name: 'width', labelKo: '유효 폭', unit: 'mm', default: 900, min: 600, max: 2400 },
        { name: 'treadDepth', labelKo: '디딤판 깊이', unit: 'mm', default: 260, min: 220, max: 400 },
        { name: 'riserH', labelKo: '리저 목표', unit: 'mm', default: 180, min: 120, max: 220 },
        { name: 'handrailH', labelKo: '난간 높이', unit: 'mm', default: 1000, min: 900, max: 1200 },
      ],
    },
    {
      id: 'elevator_shaft', labelKo: '엘리베이터 샤프트+카 (직사각/반원)', labelEn: 'Elevator shaft (rect/semicircular)', build: elevatorShaftAssembly,
      params: [
        { name: 'floors', labelKo: '층수', unit: '', default: 4, min: 2, max: 30 },
        { name: 'shape', labelKo: '형상(rect/semicircular)', unit: '', default: 'rect', enum: ['rect', 'semicircular'] },
        { name: 'floorH', labelKo: '층고', unit: 'mm', default: 3300, min: 2600, max: 6000 },
        { name: 'carW', labelKo: '카 폭', unit: 'mm', default: 1600, min: 1000, max: 2800 },
        { name: 'carD', labelKo: '카 깊이', unit: 'mm', default: 1500, min: 1000, max: 3000 },
        { name: 'doorW', labelKo: '도어 폭', unit: 'mm', default: 900, min: 700, max: 1400 },
      ],
    },
    {
      id: 'duct_run', labelKo: 'HVAC 덕트런 (트렁크+분기)', labelEn: 'HVAC duct run (trunk + branches)', build: ductRunAssembly,
      params: [
        { name: 'length', labelKo: '트렁크 길이', unit: 'mm', default: 18000, min: 5000, max: 60000 },
        { name: 'trunkW', labelKo: '트렁크 폭', unit: 'mm', default: 800, min: 300, max: 2000 },
        { name: 'trunkH', labelKo: '트렁크 높이', unit: 'mm', default: 400, min: 200, max: 1200 },
        { name: 'branches', labelKo: '분기 수', unit: '', default: 4, min: 0, max: 12 },
        { name: 'ceilingH', labelKo: '천장고', unit: 'mm', default: 3600, min: 2800, max: 8000 },
      ],
    },
    {
      id: 'gable_house', labelKo: '박공지붕 주택 셸', labelEn: 'Gable-roof house shell', build: gableHouseAssembly,
      params: [
        { name: 'width', labelKo: '폭(용마루 방향)', unit: 'mm', default: 9000, min: 4000, max: 20000 },
        { name: 'depth', labelKo: '깊이(경사 방향)', unit: 'mm', default: 7000, min: 4000, max: 16000 },
        { name: 'wallH', labelKo: '처마 벽고', unit: 'mm', default: 2700, min: 2200, max: 4000 },
        { name: 'pitchDeg', labelKo: '지붕 경사', unit: '°', default: 30, min: 10, max: 45 },
      ],
    },
    {
      id: 'commercial_massing', labelKo: '상가 매스+입면 그리드 (평면/곡면)', labelEn: 'Commercial massing (flat/curved facade)', build: commercialMassingAssembly,
      params: [
        { name: 'width', labelKo: '전면 폭', unit: 'mm', default: 15000, min: 6000, max: 60000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 12000, min: 6000, max: 40000 },
        { name: 'floors', labelKo: '층수', unit: '', default: 4, min: 1, max: 20 },
        { name: 'facade', labelKo: '파사드(flat/curved)', unit: '', default: 'flat', enum: ['flat', 'curved'] },
        { name: 'balcony', labelKo: '발코니(true/false — 평면 전용)', unit: '', default: 'false', enum: ['false', 'true'] },
        { name: 'groundH', labelKo: '1층 층고', unit: 'mm', default: 4200, min: 3000, max: 6000 },
        { name: 'floorH', labelKo: '기준층 층고', unit: 'mm', default: 3600, min: 2800, max: 5000 },
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
    {
      id: 'fence_run', labelKo: '울타리/펜스 (기둥+가로대+판재)', labelEn: 'Fence run', build: fenceRunAssembly,
      params: [
        { name: 'length', labelKo: '울타리 연장', unit: 'mm', default: 12000, min: 2000, max: 100000 },
        { name: 'postPitch', labelKo: '기둥 간격', unit: 'mm', default: 2000, min: 1000, max: 3000 },
        { name: 'height', labelKo: '울타리 높이', unit: 'mm', default: 1200, min: 600, max: 2400 },
        { name: 'postSize', labelKo: '기둥 단면', unit: 'mm', default: 100, min: 75, max: 200 },
        { name: 'railCount', labelKo: '가로대 단수', unit: '', default: 2, min: 1, max: 4 },
        { name: 'picketWidth', labelKo: '판재(피켓) 폭', unit: 'mm', default: 90, min: 60, max: 200 },
        { name: 'picketGap', labelKo: '판재 사이 간격', unit: 'mm', default: 30, min: 0, max: 300 },
      ],
    },
    {
      id: 'planter_wall', labelKo: '화단 옹벽 (플랜터 월+배수)', labelEn: 'Planter retaining wall', build: planterWallAssembly,
      params: [
        { name: 'length', labelKo: '화단 연장', unit: 'mm', default: 6000, min: 1500, max: 60000 },
        { name: 'height', labelKo: '벽체 높이(저판 위)', unit: 'mm', default: 900, min: 300, max: 2500 },
        { name: 'stemThk', labelKo: '벽체 두께', unit: 'mm', default: 200, min: 150, max: 500 },
        { name: 'baseWidth', labelKo: '저판 폭', unit: 'mm', default: 700, min: 400, max: 2500 },
        { name: 'baseThk', labelKo: '저판 두께', unit: 'mm', default: 250, min: 150, max: 600 },
        { name: 'toeLength', labelKo: '앞굽 길이', unit: 'mm', default: 200, min: 0, max: 1500 },
        { name: 'segLength', labelKo: '신축이음 분절 길이', unit: 'mm', default: 3000, min: 1500, max: 10000 },
        { name: 'drainDia', labelKo: '유공관 관경', unit: 'mm', default: 100, min: 50, max: 250 },
      ],
    },
    {
      id: 'parking_pavement', labelKo: '주차장 포장 (포장층+경계석)', labelEn: 'Parking lot pavement', build: parkingPavementAssembly,
      params: [
        { name: 'stalls', labelKo: '주차 대수', unit: '대', default: 6, min: 1, max: 24 },
        { name: 'stallWidth', labelKo: '주차면 폭', unit: 'mm', default: 2500, min: 2300, max: 3500 },
        { name: 'stallLength', labelKo: '주차면 길이', unit: 'mm', default: 5000, min: 4500, max: 7000 },
        { name: 'aisleWidth', labelKo: '차로(통로) 폭', unit: 'mm', default: 6000, min: 3500, max: 12000 },
        { name: 'subbaseThk', labelKo: '보조기층 두께', unit: 'mm', default: 150, min: 100, max: 400 },
        { name: 'baseThk', labelKo: '기층 두께', unit: 'mm', default: 100, min: 50, max: 300 },
        { name: 'surfaceThk', labelKo: '표층 두께', unit: 'mm', default: 50, min: 30, max: 150 },
        { name: 'curbHeight', labelKo: '경계석 높이', unit: 'mm', default: 500, min: 300, max: 800 },
      ],
    },
    {
      id: 'pavilion', labelKo: '정자/쉼터 (기둥4+박공 지붕)', labelEn: 'Pavilion / shelter', build: pavilionAssembly,
      params: [
        { name: 'width', labelKo: '폭(용마루 방향)', unit: 'mm', default: 3000, min: 1800, max: 8000 },
        { name: 'depth', labelKo: '깊이(경사 방향)', unit: 'mm', default: 3000, min: 1800, max: 8000 },
        { name: 'postHeight', labelKo: '기둥 높이', unit: 'mm', default: 2400, min: 1800, max: 4000 },
        { name: 'postSize', labelKo: '기둥 단면', unit: 'mm', default: 150, min: 100, max: 300 },
        { name: 'girderHeight', labelKo: '처마도리 춤', unit: 'mm', default: 200, min: 120, max: 400 },
        { name: 'pitchDeg', labelKo: '지붕 경사', unit: '°', default: 30, min: 10, max: 45 },
        { name: 'padThk', labelKo: '기단 두께', unit: 'mm', default: 150, min: 100, max: 400 },
      ],
    },
    {
      id: 'tree_planting', labelKo: '식재 플랜 (수목 배치·수량)', labelEn: 'Tree planting plan', build: treePlantingAssembly,
      params: [
        { name: 'rows', labelKo: '열 수(깊이 방향)', unit: '', default: 2, min: 1, max: 8 },
        { name: 'cols', labelKo: '주 수(폭 방향)', unit: '', default: 4, min: 1, max: 12 },
        { name: 'spacingX', labelKo: '주간 거리(폭)', unit: 'mm', default: 4000, min: 1500, max: 12000 },
        { name: 'spacingY', labelKo: '열간 거리(깊이)', unit: 'mm', default: 4000, min: 1500, max: 12000 },
        { name: 'trunkDia', labelKo: '줄기 지름(근원경 근사)', unit: 'mm', default: 150, min: 50, max: 600 },
        { name: 'trunkHeight', labelKo: '지하고(가지 아래 높이)', unit: 'mm', default: 1800, min: 500, max: 6000 },
        { name: 'canopyDia', labelKo: '수관 폭', unit: 'mm', default: 3000, min: 800, max: 10000 },
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
        { name: 'hangerSpacing', labelKo: '행어 간격', unit: 'mm', default: 6000, min: 3000, max: 12000 },
      ],
    },
    {
      id: 'cable_stayed_bridge', labelKo: '사장교 (팬/하프)', labelEn: 'Cable-stayed bridge (fan/harp)', build: cableStayedBridgeAssembly,
      params: [
        { name: 'mainSpan', labelKo: '주경간', unit: 'mm', default: 200000, min: 80000, max: 500000 },
        { name: 'sideSpan', labelKo: '측경간', unit: 'mm', default: 80000, min: 30000, max: 250000 },
        { name: 'pylonH', labelKo: '마스트 높이(데크 위)', unit: 'mm', default: 50000, min: 15000, max: 150000 },
        { name: 'nStays', labelKo: '스테이 수(편측)', unit: '', default: 6, min: 3, max: 12 },
        { name: 'deckW', labelKo: '상판 폭', unit: 'mm', default: 14000, min: 8000, max: 30000 },
        { name: 'pierH', labelKo: '교각 높이', unit: 'mm', default: 15000, min: 5000, max: 50000 },
      ],
    },
    {
      id: 'suspension_bridge', labelKo: '현수교 (주케이블+행어)', labelEn: 'Suspension bridge', build: suspensionBridgeAssembly,
      params: [
        { name: 'mainSpan', labelKo: '주경간', unit: 'mm', default: 300000, min: 100000, max: 800000 },
        { name: 'sideSpan', labelKo: '측경간', unit: 'mm', default: 105000, min: 40000, max: 300000 },
        { name: 'sag', labelKo: '케이블 새그', unit: 'mm', default: 30000, min: 8000, max: 100000 },
        { name: 'hangerSpacing', labelKo: '행어 간격', unit: 'mm', default: 8000, min: 4000, max: 16000 },
        { name: 'deckW', labelKo: '상판 폭', unit: 'mm', default: 16000, min: 8000, max: 35000 },
        { name: 'pierH', labelKo: '상판 하면고', unit: 'mm', default: 20000, min: 8000, max: 60000 },
      ],
    },
    {
      id: 'truss_bridge', labelKo: '트러스교 (워런/프랫/하우, 하로)', labelEn: 'Through-truss bridge (Warren/Pratt/Howe)', build: trussBridgeAssembly,
      params: [
        { name: 'span', labelKo: '지간', unit: 'mm', default: 60000, min: 20000, max: 150000 },
        { name: 'trussType', labelKo: '형식(warren/pratt/howe)', unit: '', default: 'warren', enum: ['warren', 'pratt', 'howe'] },
        { name: 'panels', labelKo: '패널 수(짝수)', unit: '', default: 8, min: 4, max: 24 },
        { name: 'trussH', labelKo: '트러스 높이', unit: 'mm', default: 7500, min: 3000, max: 20000 },
        { name: 'deckW', labelKo: '상판 폭', unit: 'mm', default: 9000, min: 5000, max: 20000 },
        { name: 'pierH', labelKo: '교대 높이', unit: 'mm', default: 8000, min: 3000, max: 30000 },
        { name: 'gusset', labelKo: '정착 거셋 상세(true/false)', unit: '', default: 'false', enum: ['false', 'true'] },
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
    {
      id: 'built_in_closet', labelKo: '붙박이장 (측판·선반·문짝)', labelEn: 'Built-in closet', build: builtInClosetAssembly,
      params: [
        { name: 'width', labelKo: '전체 폭', unit: 'mm', default: 2400, min: 600, max: 6000 },
        { name: 'depth', labelKo: '깊이', unit: 'mm', default: 600, min: 300, max: 900 },
        { name: 'height', labelKo: '전체 높이', unit: 'mm', default: 2400, min: 1200, max: 3000 },
        { name: 'bays', labelKo: '칸 수(베이)', unit: '', default: 2, min: 1, max: 4 },
        { name: 'shelfCount', labelKo: '선반 단수(선반 칸)', unit: '', default: 4, min: 0, max: 10 },
        { name: 'panelThk', labelKo: '판재 두께', unit: 'mm', default: 18, min: 15, max: 30 },
        { name: 'plinthHeight', labelKo: '걸레받이 높이', unit: 'mm', default: 80, min: 50, max: 150 },
      ],
    },
    {
      id: 'counter_bar', labelKo: '카운터/바 (상판+하부장+발판)', labelEn: 'Counter / bar', build: counterBarAssembly,
      params: [
        { name: 'length', labelKo: '길이', unit: 'mm', default: 2400, min: 900, max: 8000 },
        { name: 'depth', labelKo: '하부장 깊이', unit: 'mm', default: 700, min: 400, max: 1200 },
        { name: 'height', labelKo: '상판 높이', unit: 'mm', default: 1050, min: 750, max: 1200 },
        { name: 'topThk', labelKo: '상판 두께', unit: 'mm', default: 40, min: 20, max: 100 },
        { name: 'overhang', labelKo: '상판 앞 내밈', unit: 'mm', default: 250, min: 0, max: 600 },
        { name: 'footRailDia', labelKo: '발판(풋레일) 지름', unit: 'mm', default: 50, min: 30, max: 80 },
        { name: 'footRailHeight', labelKo: '발판 브래킷 높이', unit: 'mm', default: 200, min: 120, max: 400 },
      ],
    },
    {
      id: 'partition_wall', labelKo: '경량 파티션 (스터드+마감판·개구)', labelEn: 'Stud partition wall', build: partitionWallAssembly,
      params: [
        { name: 'length', labelKo: '벽 길이', unit: 'mm', default: 4000, min: 1000, max: 30000 },
        { name: 'height', labelKo: '벽 높이', unit: 'mm', default: 2700, min: 2000, max: 5000 },
        { name: 'studWidth', labelKo: '스터드 폭(벽 심재 두께)', unit: 'mm', default: 65, min: 50, max: 150 },
        { name: 'studPitch', labelKo: '스터드 간격', unit: 'mm', default: 450, min: 300, max: 610 },
        { name: 'boardThk', labelKo: '마감보드 두께', unit: 'mm', default: 12.5, min: 9, max: 25 },
        { name: 'openingWidth', labelKo: '개구 폭(0=없음)', unit: 'mm', default: 900, min: 0, max: 3000 },
        { name: 'openingHeight', labelKo: '개구 높이', unit: 'mm', default: 2100, min: 1800, max: 2600 },
      ],
    },
    {
      id: 'ceiling_grid', labelKo: '천장 그리드 (티바+텍스·조명 개구)', labelEn: 'Suspended ceiling grid', build: ceilingGridAssembly,
      params: [
        { name: 'width', labelKo: '천장 폭', unit: 'mm', default: 3600, min: 1200, max: 20000 },
        { name: 'depth', labelKo: '천장 깊이', unit: 'mm', default: 3000, min: 1200, max: 20000 },
        { name: 'tileWidth', labelKo: '텍스 모듈 폭', unit: 'mm', default: 600, min: 300, max: 1200 },
        { name: 'tileDepth', labelKo: '텍스 모듈 깊이', unit: 'mm', default: 600, min: 300, max: 1200 },
        { name: 'tileThk', labelKo: '텍스 두께', unit: 'mm', default: 15, min: 9, max: 30 },
        { name: 'lightCount', labelKo: '조명 개구 수', unit: '', default: 4, min: 0, max: 24 },
        { name: 'hangerHeight', labelKo: '달대 길이(슬래브까지)', unit: 'mm', default: 400, min: 150, max: 2000 },
      ],
    },
  ],
  mech: [
    {
      id: 'tower_crane', labelKo: '타워 크레인 (마스트 격자+지브)', labelEn: 'Tower crane', build: towerCraneAssembly,
      params: [
        { name: 'mastH', labelKo: '마스트 높이', unit: 'mm', default: 30000, min: 8000, max: 80000 },
        { name: 'jibLen', labelKo: '지브 길이', unit: 'mm', default: 35000, min: 10000, max: 80000 },
        { name: 'mastW', labelKo: '마스트 폭', unit: 'mm', default: 1600, min: 900, max: 3500 },
        { name: 'hookDrop', labelKo: '훅 내림', unit: 'mm', default: 8000, min: 1000, max: 60000 },
      ],
    },
    {
      id: 'pump_unit', labelKo: '원심 펌프 유닛 (모터+볼루트)', labelEn: 'Centrifugal pump unit', build: pumpUnitAssembly,
      params: [
        { name: 'suctionDia', labelKo: '흡입경', unit: 'mm', default: 150, min: 40, max: 600 },
        { name: 'dischargeDia', labelKo: '토출경', unit: 'mm', default: 100, min: 25, max: 500 },
        { name: 'motorDia', labelKo: '모터 외경', unit: 'mm', default: 350, min: 120, max: 900 },
      ],
    },
    {
      id: 'gate_valve', labelKo: '게이트 밸브 (플랜지+핸드휠)', labelEn: 'Gate valve (flanged)', build: gateValveAssembly,
      params: [
        { name: 'dn', labelKo: '호칭경 DN', unit: 'mm', default: 150, min: 25, max: 600 },
        { name: 'standH', labelKo: '전시 스탠드 높이', unit: 'mm', default: 500, min: 200, max: 1200 },
      ],
    },
    {
      id: 'tank_silo', labelKo: '수직 사일로/탱크 (호퍼+지지 다리)', labelEn: 'Vertical silo/tank', build: tankSiloAssembly,
      params: [
        { name: 'diameter', labelKo: '직경', unit: 'mm', default: 3000, min: 800, max: 12000 },
        { name: 'shellH', labelKo: '셸 높이', unit: 'mm', default: 6000, min: 1500, max: 30000 },
        { name: 'hopper', labelKo: '호퍼(yes/no)', unit: '', default: 'yes', enum: ['yes', 'no'] },
        { name: 'wallThk', labelKo: '벽 두께', unit: 'mm', default: 6, min: 3, max: 30 },
        { name: 'legH', labelKo: '다리 높이', unit: 'mm', default: 2700, min: 500, max: 8000 },
      ],
    },
    {
      id: 'pressure_vessel', labelKo: '횡형 압력용기 (반타원 경판+새들)', labelEn: 'Horizontal pressure vessel', build: pressureVesselAssembly,
      params: [
        { name: 'diameter', labelKo: '직경', unit: 'mm', default: 1600, min: 400, max: 4000 },
        { name: 'shellLen', labelKo: '셸 길이', unit: 'mm', default: 4000, min: 1000, max: 15000 },
        { name: 'wallThk', labelKo: '벽 두께', unit: 'mm', default: 12, min: 4, max: 60 },
        { name: 'saddleH', labelKo: '새들 높이', unit: 'mm', default: 600, min: 300, max: 1500 },
      ],
    },
    {
      id: 'mold_cavity', labelKo: '금형 캐비티 블록 (블록−음형)', labelEn: 'Mold cavity block', build: moldCavityAssembly,
      params: [
        { name: 'blockW', labelKo: '블록 폭', unit: 'mm', default: 300, min: 50, max: 1500 },
        { name: 'blockD', labelKo: '블록 깊이', unit: 'mm', default: 250, min: 50, max: 1500 },
        { name: 'blockH', labelKo: '블록 높이', unit: 'mm', default: 120, min: 30, max: 800 },
        { name: 'cavityDia', labelKo: '기본 캐비티 지름(회전체 보울)', unit: 'mm', default: 160, min: 20, max: 1200 },
      ],
    },
    {
      id: 'gear_train', labelKo: '기어 트레인 (맞물림 폐형)', labelEn: 'Gear train (meshing verified)', build: gearTrainAssembly,
      params: [
        { name: 'module', labelKo: '모듈', unit: 'mm', default: 3, min: 1, max: 10 },
        { name: 'thickness', labelKo: '기어 두께', unit: 'mm', default: 25, min: 8, max: 80 },
        { name: 'shaftDia', labelKo: '축 지름', unit: 'mm', default: 15, min: 6, max: 60 },
      ],
    },
    {
      id: 'four_bar', labelKo: '4절 링크 (Freudenstein 포즈)', labelEn: 'Four-bar linkage (posed)', build: fourBarAssembly,
      params: [
        { name: 'ground', labelKo: '접지 링크', unit: 'mm', default: 400, min: 100, max: 2000 },
        { name: 'crank', labelKo: '크랭크', unit: 'mm', default: 120, min: 30, max: 1000 },
        { name: 'coupler', labelKo: '커플러', unit: 'mm', default: 350, min: 50, max: 2000 },
        { name: 'rocker', labelKo: '로커', unit: 'mm', default: 250, min: 50, max: 1500 },
        { name: 'inputDeg', labelKo: '입력각 θ₂', unit: '°', default: 60, min: 0, max: 359 },
      ],
    },
    {
      id: 'flanged_fitting', labelKo: '플랜지 피팅 (엘보/U벤드/티)', labelEn: 'Flanged fitting (elbow/U-bend/tee)', build: flangedFittingAssembly,
      params: [
        { name: 'kind', labelKo: '종류', unit: '', default: 'elbow90', enum: ['elbow90', 'ubend180', 'tee'] },
        { name: 'od', labelKo: '관 외경', unit: 'mm', default: 114.3, min: 21.7, max: 330 },
        { name: 'bendR', labelKo: '벤드 반경', unit: 'mm', default: 170, min: 30, max: 1000 },
        { name: 'wallThk', labelKo: '벽두께', unit: 'mm', default: 6, min: 2, max: 20 },
      ],
    },
    {
      id: 'heat_exchanger', labelKo: '셸튜브 열교환기 (TEMA AEL)', labelEn: 'Shell & tube heat exchanger (TEMA AEL)', build: heatExchangerAssembly,
      params: [
        { name: 'shellID', labelKo: '셸 내경', unit: 'mm', default: 600, min: 150, max: 2000 },
        { name: 'tubeLen', labelKo: '튜브 길이', unit: 'mm', default: 3000, min: 500, max: 12000 },
        { name: 'tubeOD', labelKo: '튜브 외경', unit: 'mm', default: 19, min: 10, max: 50 },
        { name: 'baffles', labelKo: '배플 수', unit: '', default: 4, min: 0, max: 12 },
        { name: 'nozzleOD', labelKo: '노즐 외경', unit: 'mm', default: 114.3, min: 34, max: 330 },
      ],
    },
    {
      id: 'propeller', labelKo: '프로펠러 (NACA 로프트)', labelEn: 'Propeller (NACA lofted blades)', build: propellerAssembly,
      params: [
        { name: 'diameter', labelKo: '직경', unit: 'mm', default: 800, min: 150, max: 4000 },
        { name: 'blades', labelKo: '블레이드 수', unit: '', default: 3, min: 2, max: 6 },
        { name: 'pitch', labelKo: '피치', unit: 'mm', default: 560, min: 80, max: 5000 },
        { name: 'hubDia', labelKo: '허브 직경', unit: 'mm', default: 144, min: 40, max: 800 },
        { name: 'naca', labelKo: 'NACA 4-digit', unit: '', default: '4412', enum: ['4412', '2412', '0012', '6409'] },
      ],
    },
    {
      id: 'robot_arm', labelKo: '다관절 로봇 암 (5-DOF 포즈)', labelEn: 'Articulated robot arm (5-DOF pose)', build: robotArmAssembly,
      params: [
        { name: 'upperArmLen', labelKo: '상완 길이', unit: 'mm', default: 700, min: 300, max: 2000 },
        { name: 'forearmLen', labelKo: '전완 길이', unit: 'mm', default: 600, min: 250, max: 1800 },
        { name: 'shoulderDeg', labelKo: '어깨각(수직 기준)', unit: '°', default: 35, min: -80, max: 80 },
        { name: 'elbowDeg', labelKo: '팔꿈치 상대각', unit: '°', default: 55, min: -120, max: 120 },
        { name: 'linkW', labelKo: '링크 폭', unit: 'mm', default: 120, min: 60, max: 300 },
      ],
    },
    {
      id: 'machine_line', labelKo: '산업기계 라인 (프레임+스테이션+컨베이어)', labelEn: 'Industrial machine line', build: machineLineAssembly,
      params: [
        { name: 'stations', labelKo: '스테이션 수', unit: '', default: 4, min: 1, max: 12 },
        { name: 'stationPitch', labelKo: '스테이션 피치', unit: 'mm', default: 1500, min: 800, max: 4000 },
        { name: 'conveyorW', labelKo: '컨베이어 폭', unit: 'mm', default: 500, min: 200, max: 1500 },
        { name: 'frameH', labelKo: '프레임 높이', unit: 'mm', default: 900, min: 500, max: 1500 },
        { name: 'guard', labelKo: '안전펜스(yes/no)', unit: '', default: 'yes', enum: ['yes', 'no'] },
      ],
    },
    {
      id: 'conveyor', labelKo: '벨트/롤러 컨베이어 (C찬넬 프레임)', labelEn: 'Belt/roller conveyor', build: conveyorAssembly,
      params: [
        { name: 'kind', labelKo: '형식(belt/roller)', unit: '', default: 'belt', enum: ['belt', 'roller'] },
        { name: 'length', labelKo: '전장', unit: 'mm', default: 6000, min: 1500, max: 30000 },
        { name: 'width', labelKo: '롤러면 폭', unit: 'mm', default: 600, min: 300, max: 1500 },
        { name: 'frameH', labelKo: '롤러 상면고', unit: 'mm', default: 750, min: 400, max: 1500 },
        { name: 'legPitch', labelKo: '다리 피치', unit: 'mm', default: 1500, min: 800, max: 3000 },
        { name: 'rollerPitch', labelKo: '롤러 피치', unit: 'mm', default: 300, min: 75, max: 1200 },
      ],
    },
    {
      id: 'transmission_tower', labelKo: '송전탑 (angle 격자)', labelEn: 'Transmission tower (angle lattice)', build: towerAssembly,
      params: [
        { name: 'height', labelKo: '전고', unit: 'mm', default: 30000, min: 10000, max: 80000 },
        { name: 'baseW', labelKo: '기부 폭', unit: 'mm', default: 6000, min: 2000, max: 15000 },
        { name: 'topW', labelKo: '정부 폭', unit: 'mm', default: 1500, min: 800, max: 5000 },
        { name: 'panels', labelKo: '패널 수', unit: '', default: 6, min: 3, max: 12 },
        { name: 'legSize', labelKo: '주주재 앵글', unit: 'mm', default: 120, min: 65, max: 250 },
        { name: 'braceSize', labelKo: '브레이스 앵글', unit: 'mm', default: 75, min: 40, max: 150 },
        { name: 'armLen', labelKo: '크로스암 돌출', unit: 'mm', default: 2500, min: 1000, max: 6000 },
      ],
    },
    {
      id: 'excavator_bucket', labelKo: '굴착기 버킷 (판금 셸)', labelEn: 'Excavator bucket (sheet-metal shell)', build: excavatorBucketAssembly,
      params: [
        { name: 'width', labelKo: '버킷 폭', unit: 'mm', default: 1500, min: 600, max: 3200 },
        { name: 'depth', labelKo: '개구 깊이', unit: 'mm', default: 1200, min: 500, max: 2500 },
        { name: 'height', labelKo: '높이', unit: 'mm', default: 1100, min: 400, max: 2200 },
        { name: 'teeth', labelKo: '투스 수', unit: '', default: 5, min: 3, max: 7 },
        { name: 'shellThk', labelKo: '셸 두께', unit: 'mm', default: 25, min: 10, max: 60 },
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
