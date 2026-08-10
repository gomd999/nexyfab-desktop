/**
 * emitScadFromProgram — the PRECISE (expert) executor. Turns the LLM's ordered
 * feature program (from /api/nexyfab/cad-feature-program) into exact,
 * parametric BOSL2 OpenSCAD with Customizer annotations, so it renders in the
 * same chat Studio with dimension sliders. Dimensions are reproduced EXACTLY
 * from the program (engineering CAD); fillets/chamfers are best-effort in
 * OpenSCAD (the modeler's B-rep kernel does them precisely on STEP handoff).
 */

export interface ProgramFeature {
  id: string;
  type: string;
  // sketchExtrude
  shape?: 'rect' | 'circle';
  width?: number; depth?: number; height?: number;
  /** P-1b(260808b) — 임의 폐다각 프로파일 [x,y][] (챗 intent extrude 핸드오프).
   *  존재 시 shape보다 우선. 점들은 고정값으로 방출(슬라이더 비대상). */
  profile?: [number, number][];
  // hole
  diameter?: number; posX?: number; posY?: number; holeType?: number;
  // pattern
  feature?: string; count?: number; pcd?: number; spacing?: number; axis?: string;
  // rib
  length?: number; alongY?: boolean;
  // fillet / chamfer / shell
  radius?: number; distance?: number; where?: string; wallThickness?: number; openFace?: string;
}
export interface FeatureProgram {
  part?: string;
  features: ProgramFeature[];
  verificationContext?: ManufacturingVerificationContext;
  /** F-6(260808g) — 멀티바디 핸드오프 전용(모델러 setAssemblyParts 시드,
   *  모델러 좌표계). SCAD 방출기는 무시한다 — 어셈블리는 SCAD 단일 바디
   *  프로그램이 아니라 배치 파트 목록으로 전달된다. */
  assemblyParts?: Array<{
    shapeId: string;
    params: Record<string, number>;
    name?: string;
    position: [number, number, number];
    rotation: [number, number, number];
  }>;
}

export type FeatureProgramParameterBindingVisitor = (
  parameterName: string,
  applyValue: (value: number) => void,
) => void;

const n = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);

/** Range that comfortably brackets a value, for a Customizer slider. */
function around(v: number, min = 1): [number, number, number] {
  const lo = Math.max(min, Math.floor(v / 2));
  const hi = Math.max(lo + 1, Math.ceil(v * 2));
  const step = v < 5 ? 0.5 : 1;
  return [lo, hi, step];
}

export function emitScadFromProgram(
  program: FeatureProgram,
  visitBinding?: FeatureProgramParameterBindingVisitor,
): string {
  const feats = program.features ?? [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return 'cube([10,10,10]);';

  const patterns = feats.filter(f => f.type === 'circularPattern' || f.type === 'linearPattern');
  const patternedIds = new Set(patterns.map(p => p.feature));
  const holes = feats.filter(f => f.type === 'hole');
  const bosses = feats.filter(f => f.type === 'boss');
  const ribs = feats.filter(f => f.type === 'rib');
  const chamfer = feats.find(f => f.type === 'chamfer');
  const fillet = feats.find(f => f.type === 'fillet');

  const params: string[] = [];
  const body: string[] = [];
  let pi = 0;
  const used = new Set<string>();
  // Emit a labelled Customizer slider; returns the variable name to reference.
  const P = (label: string, val: number, lo: number, hi: number, st: number, applyValue?: (value: number) => void): string => {
    let name = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `p${pi}`;
    while (used.has(name)) name = `${name}_${pi}`;
    used.add(name); pi++;
    const v = Math.round(val * 100) / 100;
    params.push(`// ${label}\n${name} = ${v}; // [${lo}:${st}:${hi}]`);
    if (applyValue) visitBinding?.(name, applyValue);
    return name;
  };

  // ── base ───────────────────────────────────────────────────────────────
  params.push('/* [Base] */');
  let baseGeom: string;
  let baseHVar = '0';
  const basePoly = Array.isArray(base.profile) && base.profile.length >= 3 ? base.profile : null;
  const isCircle = !basePoly && base.shape === 'circle';
  let baseW = '0', baseD = '0', baseDia = '0'; // captured for the shell cavity
  if (basePoly) {
    // P-1b — 폴리라인 몸체: 점은 고정, 두께만 슬라이더.
    const h = P('Extrude height', n(base.height, 8), ...around(n(base.height, 8)), value => { base.height = value; });
    baseHVar = h;
    const pts = basePoly.map(([x, y]) => `[${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}]`).join(',');
    baseGeom = `linear_extrude(height=${h}) polygon(points=[${pts}]);`;
  } else if (isCircle) {
    const dia = P('Disc diameter', n(base.width, 50), ...around(n(base.width, 50)), value => { base.width = value; });
    baseDia = dia;
    baseHVar = P('Thickness', n(base.height, 5), ...around(n(base.height, 5)), value => { base.height = value; });
    const ch = chamfer ? `, chamfer=${P('Edge chamfer', n(chamfer.distance, 1), 0.5, 10, 0.5, value => { chamfer.distance = value; })}` : '';
    baseGeom = `cyl(d=${dia}, h=${baseHVar}, anchor=BOTTOM${ch})`;
  } else {
    const w = P('Base length', n(base.width, 100), ...around(n(base.width, 100)), value => { base.width = value; });
    const d = P('Base width', n(base.depth, 80), ...around(n(base.depth, 80)), value => { base.depth = value; });
    baseW = w; baseD = d;
    baseHVar = P('Base thickness', n(base.height, 8), ...around(n(base.height, 8)), value => { base.height = value; });
    const ch = chamfer ? `, chamfer=${P('Edge chamfer', n(chamfer.distance, 1), 0.5, 10, 0.5, value => { chamfer.distance = value; })}, except=BOTTOM` : '';
    baseGeom = `cuboid([${w}, ${d}, ${baseHVar}], anchor=BOTTOM${ch})`;
  }

  // ── shell (hollow cavity, open at top or bottom) ─────────────────────────
  const shell = feats.find(f => f.type === 'shell');
  const shellGeoms: string[] = [];
  if (shell) {
    params.push('/* [Shell] */');
    const wt = P('Wall thickness', n(shell.wallThickness, 2), 0.5, 10, 0.5, value => { shell.wallThickness = value; });
    const openBottom = shell.openFace === 'bottom';
    // Cavity is taller than the base so it breaks through the open face.
    // open top  → cavity sits from z=wt upward (bottom wall = wt).
    // open bottom → cavity top lands at h-wt (top wall = wt).
    const zoff = openBottom ? `-(${wt})-20` : `${wt}`;
    const inner = isCircle
      ? `cyl(d=${baseDia}-2*${wt}, h=${baseHVar}+20, anchor=BOTTOM)`
      : `cuboid([${baseW}-2*${wt}, ${baseD}-2*${wt}, ${baseHVar}+20], anchor=BOTTOM)`;
    shellGeoms.push(`translate([0, 0, ${zoff}]) ${inner};`);
  }

  // ── ribs (union'd onto the base, with a proper concave base fillet weld) ──
  const ribGeoms: string[] = [];
  if (ribs.length) params.push('/* [Ribs] */');
  for (const r of ribs) {
    const t = P('Rib thickness', n(r.width, 8), ...around(n(r.width, 8)), value => { r.width = value; });
    const h = P('Rib height', n(r.height, 40), ...around(n(r.height, 40)), value => { r.height = value; });
    const L = P('Rib length', n(r.length, n(base.depth, 80)), ...around(n(r.length, 80)), value => { r.length = value; });
    const x = n(r.posX, 0), y = n(r.posY, 0);
    const dims = r.alongY ? `[${t}, ${L}, ${h}]` : `[${L}, ${t}, ${h}]`;
    ribGeoms.push(`translate([${x}, ${y}, 0]) cuboid(${dims}, anchor=BOTTOM)`);
    if (fillet) {
      const fr = P('Rib base fillet', n(fillet.radius, 3), 0.5, 12, 0.5, value => { fillet.radius = value; });
      // concave quarter-round weld in the re-entrant corner where the rib meets
      // the base top (z=baseHVar), on both rib faces, run along the rib length.
      const rot = r.alongY ? '[90,0,0]' : '[90,0,90]';
      const offs = r.alongY ? `[${x}+s*${t}/2, ${y}, ${baseHVar}]` : `[${x}, ${y}+s*${t}/2, ${baseHVar}]`;
      ribGeoms.push(`for (s=[-1,1]) translate(${offs}) rotate(${rot}) linear_extrude(${L}, center=true) scale([s,1]) difference() { square([${fr},${fr}]); translate([${fr},${fr}]) circle(r=${fr}, $fn=24); }`);
    }
  }

  // ── bosses (F-1 — union'd cylinders standing on the base top face) ───────
  // posX/posY 는 베이스 중심 기준(chatCadHandoff 가 −w/2, −d/2 이동을 이미
  // 적용해 방출) — 중심 배치 cuboid 와 좌표계가 일치한다.
  const bossGeoms: string[] = [];
  if (bosses.length) params.push('/* [Bosses] */');
  for (const b of bosses) {
    const dia = P('Boss diameter', n(b.diameter, 12), ...around(n(b.diameter, 12)), value => { b.diameter = value; });
    const bh = P('Boss height', n(b.height, 10), ...around(n(b.height, 10)), value => { b.height = value; });
    bossGeoms.push(`translate([${n(b.posX, 0)}, ${n(b.posY, 0)}, ${baseHVar}]) cyl(d=${dia}, h=${bh}, anchor=BOTTOM)`);
  }

  // ── holes (difference'd, patterns expanded) ──────────────────────────────
  const holeGeoms: string[] = [];
  if (holes.length) params.push('/* [Holes] */');
  for (const hole of holes) {
    const dia = P('Hole diameter', n(hole.diameter, 6), ...around(n(hole.diameter, 6)), value => { hole.diameter = value; });
    const pat = patterns.find(p => p.feature === hole.id);
    if (pat && pat.type === 'circularPattern') {
      const cnt = Math.max(2, Math.round(n(pat.count, 4)));
      const r = n(pat.pcd, Math.hypot(n(hole.posX), n(hole.posY)) * 2) / 2;
      const rp = P('Bolt circle radius', r, ...around(r), value => { pat.pcd = value * 2; });
      holeGeoms.push(`for (a = [0:360/${cnt}:359]) rotate([0,0,a]) translate([${rp}, 0, -1]) cylinder(d=${dia}, h=H_THRU);`);
    } else if (pat && pat.type === 'linearPattern') {
      const cnt = Math.max(2, Math.round(n(pat.count, 3)));
      const sp = P('Hole spacing', n(pat.spacing, 20), ...around(n(pat.spacing, 20)), value => { pat.spacing = value; });
      const ax = pat.axis === 'y' ? '[0,1,0]' : '[1,0,0]';
      holeGeoms.push(`for (i = [0:${cnt - 1}]) translate(${ax}*((i-(${cnt}-1)/2)*${sp}) + [${n(hole.posX)},${n(hole.posY)},-1]) cylinder(d=${dia}, h=H_THRU);`);
    } else if (!patternedIds.has(hole.id)) {
      const x = n(hole.posX, 0), y = n(hole.posY, 0);
      holeGeoms.push(`translate([${x}, ${y}, -1]) cylinder(d=${dia}, h=H_THRU);`);
    }
    // a hole that IS a pattern's source is emitted by the pattern, skip standalone
  }

  // ── assemble ─────────────────────────────────────────────────────────────
  body.push('H_THRU = 1000; // large through-cut');
  body.push('$fn = 64;');
  body.push('difference() {');
  body.push('  union() {');
  body.push(`    ${baseGeom};`);
  for (const g of ribGeoms) body.push(`    ${g};`);
  for (const g of bossGeoms) body.push(`    ${g};`);
  body.push('  }');
  for (const g of holeGeoms) body.push(`  ${g}`);
  for (const g of shellGeoms) body.push(`  ${g}`);
  body.push('}');

  return `include <BOSL2/std.scad>\n\n${params.join('\n')}\n\n${body.join('\n')}\n`;
}

/**
 * Applies an exact numeric Studio customizer change back to the structured
 * feature program. This keeps manual AI-Studio edits when the same design is
 * handed to the expert feature-tree workspace.
 */
export function applyFeatureProgramCustomizerValue(
  program: FeatureProgram,
  parameterName: string,
  value: number,
): { program: FeatureProgram; updated: boolean } {
  const next = JSON.parse(JSON.stringify(program)) as FeatureProgram;
  let updated = false;
  emitScadFromProgram(next, (name, applyValue) => {
    if (name !== parameterName || updated) return;
    applyValue(value);
    updated = true;
  });
  return { program: next, updated };
}
import type { ManufacturingVerificationContext } from '@/lib/ai/manufacturingContext';
