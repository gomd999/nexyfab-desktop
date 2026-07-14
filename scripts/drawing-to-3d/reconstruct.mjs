/**
 * 2D→3D — 결정론 재구성 (어휘 14종): intent JSON → OpenSCAD + 해석적 재투영.
 * AI 산출물은 기하 게이트 통과 후에만 형상화 — "LLM=이해, 결정론=형상·검증".
 *
 * 어휘확장 #3 (2026-07-14): spur_gear(인벌류트 스퍼기어) · hex_bolt(육각볼트, ISO 4017
 * 머리치수 표) · sheet_profile(다단 절곡 판금 — 세그먼트+각도 열로 Z/햇/채널 임의 단면).
 * 프로파일 생성기(gearPoly/hexPts/sheetPoly)는 export — assembly(STEP)·BOQ·프리셋 공용.
 */
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const RAD = Math.PI / 180;

// ─── 공유 프로파일 생성기 (결정론 — SCAD·STEP·물량이 같은 폴리곤을 쓴다) ────────

/** 인벌류트 스퍼기어 외형 폴리곤 (CCW, 원점 중심). 표준 치형: ha=m, hf=1.25m. */
export function gearPoly({ module: m, teeth: z, pressureAngleDeg = 20 }) {
  const a = pressureAngleDeg * RAD;
  const rp = (m * z) / 2, rb = rp * Math.cos(a), ra = rp + m, rf = Math.max(rp - 1.25 * m, m * 0.2);
  const inv = (x) => Math.tan(x) - x;
  const beta = Math.PI / (2 * z) + inv(a); // rb에서의 플랭크 반각
  const psi = (r) => { const x = Math.acos(Math.min(1, rb / r)); return Math.tan(x) - x; };
  const r0 = Math.max(rb, rf);
  const N = 6;
  const flank = []; // [r, 중심으로부터의 각오프셋] — r 오름차순
  for (let k = 0; k <= N; k++) {
    const r = r0 + (ra - r0) * (k / N);
    flank.push([r, beta - psi(r)]);
  }
  const half = Math.PI / z;
  const pts = [];
  for (let j = 0; j < z; j++) {
    const A = ((2 * Math.PI) / z) * j;
    const P = (r, o) => pts.push([r * Math.cos(A + o), r * Math.sin(A + o)]);
    P(rf, -half);                                     // 스페이스 중앙(루트)
    if (rf < rb - 1e-9) P(rf, -beta);                 // 루트→플랭크 기저(radial)
    for (const [r, o] of flank) P(r, -o);             // 우측 플랭크 상승
    for (let k = flank.length - 1; k >= 0; k--) P(flank[k][0], flank[k][1]); // 팁 → 좌측 하강
    if (rf < rb - 1e-9) P(rf, beta);
  }
  return pts;
}

/** 정육각형 꼭짓점 6점 (across-flats 기준, 꼭짓점이 +X축). */
export function hexPts(acrossFlats) {
  const R = acrossFlats / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return [R * Math.cos(a), R * Math.sin(a)];
  });
}

/** ISO 4017/4014 육각볼트 표준 치수 (호칭경 → across-flats·머리높이·피치). */
export const BOLT_TABLE = {
  3: { af: 5.5, h: 2, p: 0.5 }, 4: { af: 7, h: 2.8, p: 0.7 }, 5: { af: 8, h: 3.5, p: 0.8 },
  6: { af: 10, h: 4, p: 1 }, 8: { af: 13, h: 5.3, p: 1.25 }, 10: { af: 16, h: 6.4, p: 1.5 },
  12: { af: 18, h: 7.5, p: 1.75 }, 16: { af: 24, h: 10, p: 2 }, 20: { af: 30, h: 12.5, p: 2.5 },
  24: { af: 36, h: 15, p: 3 }, 30: { af: 46, h: 18.7, p: 3.5 }, 36: { af: 55, h: 22.5, p: 4 },
};
/** 볼트 머리 치수 해석: 명시값 우선, 없으면 표준표. 없으면 null 필드. */
export function boltDims(i) {
  const std = BOLT_TABLE[i.threadDia];
  return { af: i.headFlats ?? std?.af ?? null, hh: i.headHeight ?? std?.h ?? null, pitch: i.pitch ?? std?.p ?? null };
}

/**
 * 다단 절곡 판금 단면 폴리곤 — 세그먼트 길이열 + 절곡각열(중심선)을 두께 t로
 * 마이터 오프셋(±t/2)해 닫힌 단면을 만든다. Z형·햇채널·복잡 브래킷 단면 임의 표현.
 * ⚠️ 치수는 중심선 기준(전개장과 일치) — 외형치수 필요 시 t/2 보정은 호출측.
 */
export function sheetPoly({ thickness: t, segments, angles = [] }) {
  const pts = [[0, 0]];
  const dirs = [];
  let ang = 0;
  for (let k = 0; k < segments.length; k++) {
    if (k) ang += (angles[k - 1] ?? 0) * RAD;
    dirs.push(ang);
    const p = pts[pts.length - 1];
    pts.push([p[0] + segments[k] * Math.cos(ang), p[1] + segments[k] * Math.sin(ang)]);
  }
  const left = [], right = [];
  for (let k = 0; k < pts.length; k++) {
    const dPrev = dirs[Math.max(0, k - 1)], dNext = dirs[Math.min(dirs.length - 1, k)];
    const bis = Math.atan2((Math.sin(dPrev) + Math.sin(dNext)) / 2, (Math.cos(dPrev) + Math.cos(dNext)) / 2);
    const halfTurn = (dNext - dPrev) / 2;
    const miter = (t / 2) / Math.max(0.35, Math.cos(halfTurn)); // 게이트가 |각|≤120° 보장(cos≥0.5)
    const nx = -Math.sin(bis), ny = Math.cos(bis);
    left.push([pts[k][0] + nx * miter, pts[k][1] + ny * miter]);
    right.push([pts[k][0] - nx * miter, pts[k][1] - ny * miter]);
  }
  return left.concat(right.reverse());
}

/** 폴리곤 면적(shoelace, 절대값) / 둘레. */
export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
export function polyPerimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
}
function polyBbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
// 단순(자기교차 없는) 폴리곤 검사 — compose.mjs 게이트와 동일 사상(로컬 사본, 순환의존 회피).
function segInt(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  const e = 1e-9; return t > e && t < 1 - e && u > e && u < 1 - e;
}
function polySimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
    if (segInt(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
  }
  return true;
}
const r4 = (n) => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? 0 : r; };
const polyScad = (pts) => `polygon(points=[${pts.map((p) => `[${r4(p[0])},${r4(p[1])}]`).join(',')}]);`;

const GATES = {
  plate_with_holes(i, e) {
    for (const k of ['width', 'depth', 'thickness']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
    if (i.thickness >= Math.min(i.width, i.depth)) e.push('thickness ≥ min(w,d) — 판재 아님');
    for (const [n, h] of (i.holes ?? []).entries()) {
      if (!pos(h.d) || h.d >= Math.min(i.width, i.depth)) e.push(`hole[${n}] d invalid`);
      if (!(h.x - h.d / 2 >= 0 && h.x + h.d / 2 <= i.width)) e.push(`hole[${n}] x outside`);
      if (!(h.y - h.d / 2 >= 0 && h.y + h.d / 2 <= i.depth)) e.push(`hole[${n}] y outside`);
    }
  },
  stepped_plate(i, e) {
    for (const k of ['width', 'depth', 'thickness', 'stepWidth', 'stepThickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.stepWidth >= i.width) e.push('stepWidth ≥ width');
    if (i.stepThickness >= i.thickness) e.push('stepThickness ≥ thickness');
  },
  l_bracket(i, e) {
    for (const k of ['legA', 'legB', 'width', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.thickness >= Math.min(i.legA, i.legB)) e.push('thickness ≥ min(legA,legB)');
  },
  flange(i, e) {
    for (const k of ['outerDia', 'boreDia', 'thickness', 'bcd', 'boltHoleD', 'boltCount']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.boreDia >= i.outerDia) e.push('bore ≥ OD');
    if (!(i.bcd > i.boreDia && i.bcd < i.outerDia)) e.push('BCD not between bore and OD');
    if (i.bcd + i.boltHoleD >= i.outerDia) e.push('bolt holes break OD rim');
    if (i.bcd - i.boltHoleD <= i.boreDia) e.push('bolt holes break bore rim');
    if (!Number.isInteger(i.boltCount) || i.boltCount < 2 || i.boltCount > 36) e.push('boltCount invalid');
  },
  bent_sheet(i, e) {
    for (const k of ['webWidth', 'flangeHeight', 'length', 'thickness']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (2 * i.thickness >= i.webWidth) e.push('2t ≥ webWidth');
    if (i.thickness >= i.flangeHeight) e.push('t ≥ flangeHeight');
  },
  tube(i, e) {
    for (const k of ['outerDia', 'innerDia', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (i.innerDia >= i.outerDia) e.push('innerDia ≥ outerDia — 중공 아님');
  },
  rect_tube(i, e) {
    for (const k of ['width', 'height', 'wallThk', 'length']) if (!pos(i[k])) e.push(`${k} invalid`);
    if (2 * i.wallThk >= i.width) e.push('2·wallThk ≥ width');
    if (2 * i.wallThk >= i.height) e.push('2·wallThk ≥ height');
  },
  box(i, e) {
    // 상한 60m — 건축 다베이 슬래브(4베이×12m+기둥여유)까지 허용 (#6, 감사 260714)
    for (const k of ['width', 'depth', 'height']) if (!pos(i[k]) || i[k] > 60000) e.push(`${k} invalid`);
  },
  cylinder(i, e) {
    for (const k of ['diameter', 'length']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
  },
  gusset(i, e) {
    for (const k of ['legA', 'legB', 'thickness']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
  },
  base_plate(i, e) {
    for (const k of ['width', 'depth', 'thickness', 'boltDia']) if (!pos(i[k]) || i[k] > 5000) e.push(`${k} invalid`);
    if (i.boltDia >= Math.min(i.width, i.depth) / 2) e.push('boltDia too large');
  },
  spur_gear(i, e) {
    if (!pos(i.module) || i.module < 0.3 || i.module > 50) e.push('module invalid (0.3~50)');
    if (!Number.isInteger(i.teeth) || i.teeth < 6 || i.teeth > 200) e.push('teeth invalid (정수 6~200)');
    if (!pos(i.thickness) || i.thickness > 1000) e.push('thickness invalid');
    const pa = i.pressureAngleDeg ?? 20;
    if (!(pa >= 14 && pa <= 25)) e.push('pressureAngleDeg 14~25');
    if (i.boreDia !== undefined && i.boreDia !== 0 && !pos(i.boreDia)) e.push('boreDia invalid');
    if (e.length) return;
    const m = i.module, z = i.teeth, a = pa * RAD;
    const rp = (m * z) / 2, rb = rp * Math.cos(a), ra = rp + m, rf = rp - 1.25 * m;
    const inv = (x) => Math.tan(x) - x;
    const beta = Math.PI / (2 * z) + inv(a);
    const psiRa = inv(Math.acos(Math.min(1, rb / ra)));
    if (beta - psiRa <= 0.004) e.push('이끝 폭 소멸 — teeth 늘리거나 pressureAngle 조정');
    if (Math.PI / z - beta <= 0.004) e.push('이뿌리 갭 소멸 — 치형 성립 불가');
    if ((i.boreDia ?? 0) / 2 > rf - m) e.push('boreDia가 이뿌리 림 침범 (bore/2 ≤ rf − m)');
  },
  hex_bolt(i, e) {
    if (!pos(i.threadDia) || i.threadDia > 100) e.push('threadDia invalid');
    else {
      if (!pos(i.length) || i.length > 60 * i.threadDia) e.push('length invalid (≤60d)');
      const { af, hh } = boltDims(i);
      if (!pos(af) || !pos(hh)) e.push(`비표준 호칭 — headFlats·headHeight 명시 필요 (표준: M${Object.keys(BOLT_TABLE).join('/M')})`);
      else if (af <= i.threadDia) e.push('headFlats ≤ threadDia');
    }
  },
  wall_with_openings(i, e) {
    // 인테리어/건축 벽체 — X방향 길이·Y두께·Z높이, openings=[{x,w,h,sill}] (문 sill=0, 창 sill>0)
    if (!pos(i.length) || i.length > 30000) e.push('length invalid');
    if (!pos(i.thickness) || i.thickness > 600) e.push('thickness invalid');
    if (!pos(i.height) || i.height > 8000) e.push('height invalid');
    for (const [n, o] of (i.openings ?? []).entries()) {
      if (!pos(o.w) || !pos(o.h)) { e.push(`opening[${n}] w/h invalid`); continue; }
      const sill = o.sill ?? 0;
      if (!(o.x >= 0 && o.x + o.w <= i.length)) e.push(`opening[${n}] x 범위 밖`);
      if (!(sill >= 0 && sill + o.h <= i.height)) e.push(`opening[${n}] 높이 범위 밖`);
      if (o.w >= i.length) e.push(`opening[${n}] 폭 ≥ 벽 길이`);
    }
    // 개구 겹침 검사 (v1: X구간 겹침 금지)
    const ops = (i.openings ?? []).slice().sort((a, b) => a.x - b.x);
    for (let k = 1; k < ops.length; k++) if (ops[k].x < ops[k - 1].x + ops[k - 1].w) { e.push('openings X구간 겹침'); break; }
  },
  sheet_profile(i, e) {
    if (!pos(i.thickness) || i.thickness > 30) e.push('thickness invalid (판금 ≤30)');
    if (!pos(i.width) || i.width > 6000) e.push('width invalid');
    if (!Array.isArray(i.segments) || i.segments.length < 2 || i.segments.length > 12) { e.push('segments 2~12개 필요'); return; }
    if (i.segments.some((s) => !pos(s))) { e.push('segment 길이 invalid'); return; }
    const angles = i.angles ?? [];
    if (!Array.isArray(angles) || angles.length !== i.segments.length - 1) { e.push(`angles는 segments−1개(${i.segments.length - 1})`); return; }
    if (angles.some((a) => !Number.isFinite(a) || Math.abs(a) > 120)) { e.push('절곡각 |a| ≤ 120°'); return; }
    if (!e.length && i.segments.some((s) => s < 3 * i.thickness)) e.push('세그먼트 < 3t (최소 플랜지 폭)');
    if (!e.length && !polySimple(sheetPoly(i))) e.push('절곡 단면 자기교차 — 각도/길이 조정');
  },
};

export function gate(intent) {
  const errs = [];
  const g = GATES[intent.type];
  if (!g) { errs.push(`unsupported type '${intent.type}'`); return errs; }
  g(intent, errs);
  return errs;
}

const SCAD = {
  plate_with_holes(i) {
    const holes = (i.holes ?? []).map((h) => `    translate([${h.x}, ${h.y}, -1]) cylinder(h=${i.thickness + 2}, d=${h.d}, $fn=64);`).join('\n');
    return `difference() {\n  cube([${i.width}, ${i.depth}, ${i.thickness}]);\n${holes}\n}`;
  },
  stepped_plate(i) {
    return `union() {\n  cube([${i.stepWidth}, ${i.depth}, ${i.stepThickness}]);\n  translate([${i.stepWidth}, 0, 0]) cube([${i.width - i.stepWidth}, ${i.depth}, ${i.thickness}]);\n}`;
  },
  l_bracket(i) {
    return `union() {\n  cube([${i.legA}, ${i.width}, ${i.thickness}]);\n  cube([${i.thickness}, ${i.width}, ${i.legB}]);\n}`;
  },
  flange(i) {
    const bolts = Array.from({ length: i.boltCount }, (_, k) => {
      const a = (360 / i.boltCount) * k;
      return `    rotate([0,0,${a}]) translate([${i.bcd / 2}, 0, -1]) cylinder(h=${i.thickness + 2}, d=${i.boltHoleD}, $fn=48);`;
    }).join('\n');
    return `difference() {\n  cylinder(h=${i.thickness}, d=${i.outerDia}, $fn=128);\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=96);\n${bolts}\n}`;
  },
  bent_sheet(i) {
    return `union() {\n  cube([${i.length}, ${i.webWidth}, ${i.thickness}]);\n  cube([${i.length}, ${i.thickness}, ${i.flangeHeight}]);\n  translate([0, ${i.webWidth - i.thickness}, 0]) cube([${i.length}, ${i.thickness}, ${i.flangeHeight}]);\n}`;
  },
  tube(i) {
    return `difference() {\n  cylinder(h=${i.length}, d=${i.outerDia}, $fn=96);\n  translate([0,0,-1]) cylinder(h=${i.length + 2}, d=${i.innerDia}, $fn=96);\n}`;
  },
  rect_tube(i) {
    return `difference() {\n  cube([${i.length}, ${i.width}, ${i.height}]);\n  translate([-1, ${i.wallThk}, ${i.wallThk}]) cube([${i.length + 2}, ${i.width - 2 * i.wallThk}, ${i.height - 2 * i.wallThk}]);\n}`;
  },
  box(i) {
    return `cube([${i.width}, ${i.depth}, ${i.height}]);`;
  },
  cylinder(i) {
    return `cylinder(h=${i.length}, d=${i.diameter}, $fn=96);`;
  },
  gusset(i) {
    return `linear_extrude(height=${i.thickness}) polygon(points=[[0,0],[${i.legA},0],[0,${i.legB}]]);`;
  },
  base_plate(i) {
    const m = i.edgeMargin ?? Math.max(12, i.boltDia * 1.5);
    const holes = [[m, m], [i.width - m, m], [m, i.depth - m], [i.width - m, i.depth - m]]
      .map(([x, y]) => `  translate([${x}, ${y}, -1]) cylinder(h=${i.thickness + 2}, d=${i.boltDia}, $fn=48);`).join('\n');
    return `difference() {\n  cube([${i.width}, ${i.depth}, ${i.thickness}]);\n${holes}\n}`;
  },
  spur_gear(i) {
    const body = `linear_extrude(height=${i.thickness}) ${polyScad(gearPoly(i))}`;
    if (!(i.boreDia > 0)) return body;
    return `difference() {\n  ${body}\n  translate([0,0,-1]) cylinder(h=${i.thickness + 2}, d=${i.boreDia}, $fn=64);\n}`;
  },
  hex_bolt(i) {
    const { af, hh } = boltDims(i);
    return `union() {\n  cylinder(h=${i.length}, d=${i.threadDia}, $fn=64);\n  translate([0,0,${i.length}]) linear_extrude(height=${hh}) ${polyScad(hexPts(af))}\n}`;
  },
  sheet_profile(i) {
    return `linear_extrude(height=${i.width}) ${polyScad(sheetPoly(i))}`;
  },
  wall_with_openings(i) {
    const ops = (i.openings ?? []).map((o) => `    translate([${o.x}, -1, ${o.sill ?? 0}]) cube([${o.w}, ${i.thickness + 2}, ${o.h}]);`).join('\n');
    if (!ops) return `cube([${i.length}, ${i.thickness}, ${i.height}]);`;
    return `difference() {\n  cube([${i.length}, ${i.thickness}, ${i.height}]);\n${ops}\n}`;
  },
};

export function toOpenScad(intent) {
  const errs = gate(intent);
  if (errs.length) throw new Error('geometry gate: ' + errs.join('; '));
  return `// generated by drawing-to-3d v2 (deterministic reconstruction)\n// intent: ${JSON.stringify(intent)}\n${SCAD[intent.type](intent)}\n`;
}

/** 게이트 통과 후 부품 SCAD 본체만 반환(헤더 없음) — 어셈블리 배치용. */
export function scadBody(intent) {
  const errs = gate(intent);
  if (errs.length) throw new Error('geometry gate: ' + errs.join('; '));
  return SCAD[intent.type](intent);
}

/** 부품의 로컬 AABB(배치 전) — 어셈블리 간섭검사용. {min:[x,y,z], max:[x,y,z]} */
export function partAabb(i) {
  switch (i.type) {
    case 'plate_with_holes':
    case 'stepped_plate':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.thickness] };
    case 'l_bracket':
      return { min: [0, 0, 0], max: [i.legA, i.width, i.legB] };
    case 'flange':
      return { min: [-i.outerDia / 2, -i.outerDia / 2, 0], max: [i.outerDia / 2, i.outerDia / 2, i.thickness] };
    case 'bent_sheet':
      return { min: [0, 0, 0], max: [i.length, i.webWidth, i.flangeHeight] };
    case 'tube':
      return { min: [-i.outerDia / 2, -i.outerDia / 2, 0], max: [i.outerDia / 2, i.outerDia / 2, i.length] };
    case 'rect_tube':
      return { min: [0, 0, 0], max: [i.length, i.width, i.height] };
    case 'box':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.height] };
    case 'cylinder':
      return { min: [-i.diameter / 2, -i.diameter / 2, 0], max: [i.diameter / 2, i.diameter / 2, i.length] };
    case 'gusset':
      return { min: [0, 0, 0], max: [i.legA, i.legB, i.thickness] };
    case 'base_plate':
      return { min: [0, 0, 0], max: [i.width, i.depth, i.thickness] };
    case 'spur_gear': {
      const ra = (i.module * (i.teeth + 2)) / 2;
      return { min: [-ra, -ra, 0], max: [ra, ra, i.thickness] };
    }
    case 'hex_bolt': {
      const { af, hh } = boltDims(i);
      const R = af / Math.sqrt(3);
      return { min: [-R, -af / 2, 0], max: [R, af / 2, i.length + hh] };
    }
    case 'sheet_profile': {
      const b = polyBbox(sheetPoly(i));
      return { min: [b.x0, b.y0, 0], max: [b.x1, b.y1, i.width] };
    }
    case 'wall_with_openings':
      return { min: [0, 0, 0], max: [i.length, i.thickness, i.height] };
    default:
      throw new Error(`partAabb: unsupported type '${i.type}'`);
  }
}

/** 채점·재투영용 파라미터 목록 (타입별) */
export const PARAMS = {
  plate_with_holes: ['width', 'depth', 'thickness'],
  stepped_plate: ['width', 'depth', 'thickness', 'stepWidth', 'stepThickness'],
  l_bracket: ['legA', 'legB', 'width', 'thickness'],
  flange: ['outerDia', 'boreDia', 'thickness', 'bcd', 'boltHoleD', 'boltCount'],
  bent_sheet: ['webWidth', 'flangeHeight', 'length', 'thickness'],
  tube: ['outerDia', 'innerDia', 'length'],
  rect_tube: ['width', 'height', 'wallThk', 'length'],
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'length'],
  gusset: ['legA', 'legB', 'thickness'],
  base_plate: ['width', 'depth', 'thickness', 'boltDia'],
  spur_gear: ['module', 'teeth', 'thickness', 'boreDia'],
  hex_bolt: ['threadDia', 'length'],
  sheet_profile: ['thickness', 'width'], // segments[]·angles[]는 배열 — 스키마 특례
  wall_with_openings: ['length', 'thickness', 'height'], // openings[]는 배열 — 스키마 특례
};
