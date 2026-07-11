// Pilot #2 v2: desalination skid GA concept — visual-fidelity upgrade.
//
// v1 → v2 (사용자 피드백: AI 렌더 대비 격차):
//   ① catalog stubs are now COMPOUND machines (pump = base+motor+head,
//      RO housing = tube+end caps+clamp bands, vessels get dished heads,
//      panel gets HMI+buttons, casters get wheel+plate)
//   ② orthogonal pipe ROUTES with sphere corner joints + valves + gauges —
//      feed→filter→UF→LP→HP→membrane manifold→permeate manifold→calcite→
//      chlorination, plus brine drop. Real units read as "pipes+gauges";
//      this is what closes most of the visual gap.
//
// Source dims: 담수화_스키드_설계개념도.html Rev.A (1400×750×1600, casters
// 150, 4040 housings ~1100). Scope honesty (§12.6): still a GA concept —
// stubs have correct envelopes, not manufacturing detail.
//
// Gates:
//   G1 envelope containment (every stub)
//   G2 MACHINE-level AABB disjointness (intra-machine overlap is intended;
//      pipe group excluded — pipe/equipment contact IS the weld)
//   G3 door-pass width < 800
//   G4 membrane housing (incl. end caps) fits the rail clear span

import type { AssemblyIntent, ComponentIntent, IntentFeature } from './schema';
import { rectSection } from './sections';

export const SKID = {
  L: 1400, W: 750, H: 1600,
  doorClear: 800,
  casterH: 150,
  bar: 40,
  membrane: { dia: 135, len: 1100, capDia: 150, capLen: 50, count: 4, zLevels: [1020, 1180, 1340, 1500] },
} as const;

type V3 = [number, number, number];
interface Aabb { min: V3; max: V3 }

interface Stub {
  feature: IntentFeature;
  aabb: Aabb;
  group: 'frame' | 'equipment' | 'pipe';
  machine?: string; // G2 unit for equipment
  label: string;
}

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

// ─── Primitive stub builders (feature + exact AABB) ─────────────────────────

function boxStub(label: string, group: Stub['group'], machine: string | undefined, cx: number, cy: number, z0: number, w: number, d: number, h: number): Stub {
  return {
    label, group, machine,
    feature: {
      id: nid(label), kind: 'extrude',
      profile: rectSection(`${label}-sec`, w, d), height: h,
      at: { translate: [cx - w / 2, cy - d / 2, z0] },
    },
    aabb: { min: [cx - w / 2, cy - d / 2, z0], max: [cx + w / 2, cy + d / 2, z0 + h] },
  };
}

function vCyl(label: string, group: Stub['group'], machine: string | undefined, cx: number, cy: number, z0: number, dia: number, h: number): Stub {
  const r = dia / 2;
  return {
    label, group, machine,
    feature: { id: nid(label), kind: 'cylinder', diameter: dia, height: h, at: { translate: [cx, cy, z0] } },
    aabb: { min: [cx - r, cy - r, z0], max: [cx + r, cy + r, z0 + h] },
  };
}

/** Cylinder along +X (rotate [0,90,0]), centered at (cx,cy,cz). */
function xCyl(label: string, group: Stub['group'], machine: string | undefined, cx: number, cy: number, cz: number, dia: number, len: number): Stub {
  const r = dia / 2;
  return {
    label, group, machine,
    feature: {
      id: nid(label), kind: 'cylinder', diameter: dia, height: len,
      at: { rotateDeg: [0, 90, 0], translate: [cx - len / 2, cy, cz] },
    },
    aabb: { min: [cx - len / 2, cy - r, cz - r], max: [cx + len / 2, cy + r, cz + r] },
  };
}

/** Cylinder along +Y (rotate [-90,0,0]), from y0, length len. */
function yCyl(label: string, group: Stub['group'], machine: string | undefined, cx: number, y0: number, cz: number, dia: number, len: number): Stub {
  const r = dia / 2;
  return {
    label, group, machine,
    feature: {
      id: nid(label), kind: 'cylinder', diameter: dia, height: len,
      at: { rotateDeg: [-90, 0, 0], translate: [cx, y0, cz] },
    },
    aabb: { min: [cx - r, y0, cz - r], max: [cx + r, y0 + len, cz + r] },
  };
}

function sphereStub(label: string, group: Stub['group'], machine: string | undefined, c: V3, dia: number): Stub {
  const r = dia / 2;
  return {
    label, group, machine,
    feature: { id: nid(label), kind: 'sphere', diameter: dia, at: { translate: c } },
    aabb: { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] },
  };
}

function railX(yc: number, z0: number, x0: number, len: number): Stub {
  const b = SKID.bar;
  return {
    label: 'railX', group: 'frame',
    feature: {
      id: nid('railX'), kind: 'extrude', profile: rectSection('bar-sec', b, b), height: len,
      at: { rotateDeg: [0, 90, 0], translate: [x0, yc - b / 2, z0 + b] },
    },
    aabb: { min: [x0, yc - b / 2, z0], max: [x0 + len, yc + b / 2, z0 + b] },
  };
}

function railY(xc: number, z0: number, y0: number, len: number): Stub {
  const b = SKID.bar;
  return {
    label: 'railY', group: 'frame',
    feature: {
      id: nid('railY'), kind: 'extrude', profile: rectSection('bar-sec', b, b), height: len,
      at: { rotateDeg: [-90, 0, 0], translate: [xc - b / 2, y0, z0 + b] },
    },
    aabb: { min: [xc - b / 2, y0, z0], max: [xc + b / 2, y0 + len, z0 + b] },
  };
}

// ─── Pipe router: orthogonal waypoints → segments + corner spheres ──────────

function route(label: string, dia: number, pts: V3[]): Stub[] {
  const out: Stub[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const moving = delta.map((d, k) => (Math.abs(d) > 1e-9 ? k : -1)).filter((k) => k >= 0);
    if (moving.length !== 1) throw new Error(`route ${label}: segment ${i} is not axis-aligned.`);
    const axis = moving[0];
    const len = Math.abs(delta[axis]);
    const lo: V3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (axis === 0) out.push(xCyl(`${label}-seg${i}`, 'pipe', undefined, mid[0], mid[1], mid[2], dia, len));
    else if (axis === 1) out.push(yCyl(`${label}-seg${i}`, 'pipe', undefined, mid[0], lo[1], mid[2], dia, len));
    else out.push(vCyl(`${label}-seg${i}`, 'pipe', undefined, mid[0], mid[1], lo[2], dia, len));
    if (i < pts.length - 2) out.push(sphereStub(`${label}-joint${i}`, 'pipe', undefined, pts[i + 1], dia * 1.4));
  }
  return out;
}

/** Hand valve: body sphere + stem + handwheel disc (placed on a pipe run). */
function valve(label: string, c: V3, pipeDia: number): Stub[] {
  return [
    sphereStub(`${label}-body`, 'pipe', undefined, c, pipeDia * 1.9),
    vCyl(`${label}-stem`, 'pipe', undefined, c[0], c[1], c[2], 14, 58),
    vCyl(`${label}-wheel`, 'pipe', undefined, c[0], c[1], c[2] + 54, 68, 12),
  ];
}

/** Pressure gauge: stem + round dial facing sideways. */
function gauge(label: string, c: V3): Stub[] {
  return [
    vCyl(`${label}-stem`, 'pipe', undefined, c[0], c[1], c[2], 10, 42),
    xCyl(`${label}-dial`, 'pipe', undefined, c[0], c[1], c[2] + 58, 60, 18),
  ];
}

// ─── Gates ───────────────────────────────────────────────────────────────────

function inside(a: Aabb, env: Aabb): boolean {
  return a.min.every((v, i) => v >= env.min[i] - 1e-6) && a.max.every((v, i) => v <= env.max[i] + 1e-6);
}
function disjoint(a: Aabb, b: Aabb): boolean {
  return a.max[0] <= b.min[0] || b.max[0] <= a.min[0]
    || a.max[1] <= b.min[1] || b.max[1] <= a.min[1]
    || a.max[2] <= b.min[2] || b.max[2] <= a.min[2];
}
function unionAabb(list: Aabb[]): Aabb {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const a of list) for (let k = 0; k < 3; k++) {
    if (a.min[k] < min[k]) min[k] = a.min[k];
    if (a.max[k] > max[k]) max[k] = a.max[k];
  }
  return { min, max };
}

export interface SkidBuild {
  assembly: AssemblyIntent;
  derived: {
    envelope: { L: number; W: number; H: number };
    stubCount: number;
    machineCount: number;
    pipeStubCount: number;
    railClearSpanMm: number;
  };
}

export function buildDesalSkid(): SkidBuild {
  seq = 0;
  const { L, W, H, bar, casterH } = SKID;
  const hx = L / 2, hy = W / 2;
  const postX = hx - bar / 2, postY = hy - bar / 2;
  const railSpan = L - 2 * bar;
  const zb = casterH + 40; // equipment base level (on bottom rails)

  const stubs: Stub[] = [];

  // ── Frame ───────────────────────────────────────────────────────────────────
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    stubs.push(boxStub('post', 'frame', undefined, sx * postX, sy * postY, casterH, bar, bar, H - casterH));
  }
  for (const z of [casterH, 860, H - bar]) {
    for (const sy of [-1, 1]) stubs.push(railX(sy * postY, z, -railSpan / 2 - 20, railSpan + 40)); // +20 overlap into posts (no kissing faces)
    for (const sx of [-1, 1]) stubs.push(railY(sx * postX, z, -(hy - bar) - 20, W - 2 * bar + 40));
    stubs.push(railY(0, z, -(hy - bar) - 20, W - 2 * bar + 40));
  }

  // ── Casters: wheel + mount plate ×4 ─────────────────────────────────────────
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const m = `caster${sx > 0 ? 'R' : 'L'}${sy > 0 ? 'B' : 'F'}`;
    stubs.push(xCyl('wheel', 'equipment', m, sx * 600, sy * 280, 60, 120, 40));
    stubs.push(boxStub('caster-plate', 'equipment', m, sx * 600, sy * 280, 118, 120, 120, 34));
  }

  // ── #1 Cartridge filter: body + dished head ─────────────────────────────────
  stubs.push(vCyl('filter-body', 'equipment', 'filter', -480, -160, zb, 180, 550));
  stubs.push(sphereStub('filter-dome', 'equipment', 'filter', [-480, -160, zb + 550], 180));

  // ── #2 UF module: body + dished head ────────────────────────────────────────
  stubs.push(vCyl('uf-body', 'equipment', 'uf', -480, 170, zb, 160, 700));
  stubs.push(sphereStub('uf-dome', 'equipment', 'uf', [-480, 170, zb + 700], 160));

  // ── #3 LP pump: base + motor + head ─────────────────────────────────────────
  stubs.push(boxStub('lp-base', 'equipment', 'lp-pump', -120, -180, zb, 300, 250, 40));
  stubs.push(xCyl('lp-motor', 'equipment', 'lp-pump', -150, -180, 295, 140, 240)); // 5mm into base — tangent contact is non-manifold
  stubs.push(boxStub('lp-head', 'equipment', 'lp-pump', -30, -180, 215, 100, 160, 170));

  // ── #4 HP pump: base + motor + head ─────────────────────────────────────────
  stubs.push(boxStub('hp-base', 'equipment', 'hp-pump', 230, -180, zb, 400, 300, 40));
  stubs.push(xCyl('hp-motor', 'equipment', 'hp-pump', 180, -180, 320, 160, 280));
  stubs.push(boxStub('hp-head', 'equipment', 'hp-pump', 350, -180, 220, 140, 200, 200));

  // ── #5 Piston ERD: body + end flanges ───────────────────────────────────────
  stubs.push(xCyl('erd-body', 'equipment', 'erd', 50, 200, 350, 150, 600));
  stubs.push(xCyl('erd-flange-a', 'equipment', 'erd', -245, 200, 350, 190, 25));
  stubs.push(xCyl('erd-flange-b', 'equipment', 'erd', 345, 200, 350, 190, 25));

  // ── #6–#7 RO housings ×4: tube + end caps + clamp bands ─────────────────────
  const mem = SKID.membrane;
  for (let i = 0; i < mem.count; i++) {
    const zl = mem.zLevels[i];
    const m = `housing-${i + 1}`;
    stubs.push(xCyl('ro-tube', 'equipment', m, 0, 0, zl, mem.dia, mem.len));
    stubs.push(xCyl('ro-cap-a', 'equipment', m, -(mem.len / 2 + mem.capLen / 2 - 5), 0, zl, mem.capDia, mem.capLen));
    stubs.push(xCyl('ro-cap-b', 'equipment', m, mem.len / 2 + mem.capLen / 2 - 5, 0, zl, mem.capDia, mem.capLen));
    stubs.push(xCyl('ro-clamp-a', 'equipment', m, -275, 0, zl, mem.dia + 12, 30));
    stubs.push(xCyl('ro-clamp-b', 'equipment', m, 275, 0, zl, mem.dia + 12, 30));
  }

  // ── #8 Calcite contactor: vessel + dished head ──────────────────────────────
  stubs.push(vCyl('calcite-vessel', 'equipment', 'calcite', 520, 210, zb, 250, 650));
  stubs.push(sphereStub('calcite-dome', 'equipment', 'calcite', [520, 210, zb + 650], 250));

  // ── #8b Chlorine doser: cabinet + pump head ─────────────────────────────────
  stubs.push(boxStub('cl-cabinet', 'equipment', 'chlorine', 520, -230, zb, 150, 150, 180));
  stubs.push(vCyl('cl-head', 'equipment', 'chlorine', 520, -230, zb + 175, 60, 55));

  // ── #9 Control panel: cabinet + HMI + buttons (inner face) ──────────────────
  stubs.push(boxStub('panel-cab', 'equipment', 'panel', -150, -285, 950, 400, 180, 500));
  stubs.push(boxStub('panel-hmi', 'equipment', 'panel', -150, -188, 1200, 220, 16, 160));
  for (const bx of [-230, -150, -70]) {
    stubs.push(yCyl('panel-btn', 'equipment', 'panel', bx, -197, 1100, 24, 18));
  }

  // ── #10 Instrument stack: cabinet + 3 dials ─────────────────────────────────
  stubs.push(boxStub('inst-cab', 'equipment', 'instruments', 150, -285, 950, 200, 150, 300));
  for (const gx of [95, 150, 205]) {
    stubs.push(yCyl('inst-dial', 'equipment', 'instruments', gx, -212, 1150, 56, 22));
  }

  // ── Piping (orthogonal routes + corner spheres + valves + gauges) ───────────
  const Lz = mem.zLevels;
  stubs.push(...route('feed-in', 25, [[-640, -160, 250], [-560, -160, 250]]));
  stubs.push(...route('filter-uf', 25, [[-480, -160, 820], [-480, -160, 910], [-480, 170, 910]]));
  stubs.push(...route('uf-lp', 25, [[-480, 170, 300], [-480, -180, 300], [-260, -180, 300]]));
  stubs.push(...route('lp-hp', 25, [[-150, -180, 360], [-150, -180, 520], [230, -180, 520], [230, -180, 380]]));
  stubs.push(...route('hp-manifold', 25, [[350, -180, 400], [350, -180, 880], [-630, -180, 880], [-630, 0, 880], [-630, 0, Lz[0]]]));
  stubs.push(...route('feed-manifold', 32, [[-630, 0, Lz[0]], [-630, 0, Lz[3]]]));
  for (const zl of Lz) stubs.push(...route(`mstub-f${zl}`, 25, [[-630, 0, zl], [-570, 0, zl]]));
  stubs.push(...route('perm-manifold', 32, [[630, 0, Lz[0]], [630, 0, Lz[3]]]));
  for (const zl of Lz) stubs.push(...route(`mstub-p${zl}`, 25, [[570, 0, zl], [630, 0, zl]]));
  stubs.push(...route('perm-calcite', 25, [[630, 0, Lz[0]], [630, 0, 890], [630, 210, 890], [570, 210, 890]]));
  stubs.push(...route('brine-drop', 25, [[360, 200, 420], [360, 200, 180]]));
  stubs.push(...route('calcite-cl', 25, [[520, 90, 300], [520, -160, 300]]));
  stubs.push(...valve('valve-feed', [-370, -180, 300], 25));
  stubs.push(...valve('valve-hp', [-150, -180, 880], 25));
  stubs.push(...valve('valve-prod', [520, -50, 300], 25));
  stubs.push(...gauge('gauge-hp', [300, -180, 410]));
  stubs.push(...gauge('gauge-mf', [-630, 0, 1490]));
  stubs.push(...gauge('gauge-mp', [630, 0, 1490]));

  // ── Gates ───────────────────────────────────────────────────────────────────
  const env: Aabb = { min: [-hx, -hy, 0], max: [hx, hy, H] };
  for (const s of stubs) {
    if (!inside(s.aabb, env)) {
      throw new Error(`buildDesalSkid G1: ${s.label} leaves the ${L}×${W}×${H} envelope ` +
        `(aabb ${JSON.stringify(s.aabb)}).`);
    }
  }
  const machines = new Map<string, Aabb[]>();
  for (const s of stubs) if (s.group === 'equipment' && s.machine) {
    (machines.get(s.machine) ?? machines.set(s.machine, []).get(s.machine)!).push(s.aabb);
  }
  const machineBoxes = [...machines.entries()].map(([name, boxes]) => ({ name, box: unionAabb(boxes) }));
  for (let i = 0; i < machineBoxes.length; i++) for (let j = i + 1; j < machineBoxes.length; j++) {
    if (!disjoint(machineBoxes[i].box, machineBoxes[j].box)) {
      throw new Error(`buildDesalSkid G2: machine ${machineBoxes[i].name} collides with ${machineBoxes[j].name}.`);
    }
  }
  if (!(W < SKID.doorClear)) throw new Error('buildDesalSkid G3: skid width blocks a standard door.');
  const housingOverall = mem.len + 2 * mem.capLen;
  if (!(housingOverall <= railSpan)) {
    throw new Error(`buildDesalSkid G4: housing overall ${housingOverall} exceeds rail span ${railSpan}.`);
  }

  // ── Components ──────────────────────────────────────────────────────────────
  const pick = (g: Stub['group']) => stubs.filter((s) => s.group === g).map((s) => s.feature);
  const assembly: AssemblyIntent = {
    id: 'desal-skid',
    name: '담수화 이동식 스키드 — GA concept v2',
    components: [
      { component: { id: 'frame', name: 'skid frame 40sq', shapeClass: 'frame', features: pick('frame'), material: { grade: 'SS275', thicknessMm: bar } } },
      { component: { id: 'equipment', name: 'process equipment (compound catalog stubs)', shapeClass: 'prismatic', features: pick('equipment') } },
      { component: { id: 'piping', name: 'process piping + valves + gauges', shapeClass: 'frame', features: pick('pipe') } },
    ],
    joints: [
      { type: 'rigid', a: 'frame', b: 'equipment' },
      { type: 'weld', a: 'equipment', b: 'piping' },
    ],
  };

  return {
    assembly,
    derived: {
      envelope: { L, W, H },
      stubCount: stubs.length,
      machineCount: machineBoxes.length,
      pipeStubCount: stubs.filter((s) => s.group === 'pipe').length,
      railClearSpanMm: railSpan,
    },
  };
}
