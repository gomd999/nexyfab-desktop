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
  // hole
  diameter?: number; posX?: number; posY?: number; holeType?: number;
  // pattern
  feature?: string; count?: number; pcd?: number; spacing?: number; axis?: string;
  // rib
  length?: number; alongY?: boolean;
  // fillet / chamfer / shell
  radius?: number; distance?: number; where?: string; wallThickness?: number; openFace?: string;
}
export interface FeatureProgram { part?: string; features: ProgramFeature[] }

const n = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);

/** Range that comfortably brackets a value, for a Customizer slider. */
function around(v: number, min = 1): [number, number, number] {
  const lo = Math.max(min, Math.floor(v / 2));
  const hi = Math.max(lo + 1, Math.ceil(v * 2));
  const step = v < 5 ? 0.5 : 1;
  return [lo, hi, step];
}

export function emitScadFromProgram(program: FeatureProgram): string {
  const feats = program.features ?? [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return 'cube([10,10,10]);';

  const patterns = feats.filter(f => f.type === 'circularPattern' || f.type === 'linearPattern');
  const patternedIds = new Set(patterns.map(p => p.feature));
  const holes = feats.filter(f => f.type === 'hole');
  const ribs = feats.filter(f => f.type === 'rib');
  const chamfer = feats.find(f => f.type === 'chamfer');
  const fillet = feats.find(f => f.type === 'fillet');

  const params: string[] = [];
  const body: string[] = [];
  let pi = 0;
  const used = new Set<string>();
  // Emit a labelled Customizer slider; returns the variable name to reference.
  const P = (label: string, val: number, lo: number, hi: number, st: number): string => {
    let name = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `p${pi}`;
    while (used.has(name)) name = `${name}_${pi}`;
    used.add(name); pi++;
    const v = Math.round(val * 100) / 100;
    params.push(`// ${label}\n${name} = ${v}; // [${lo}:${st}:${hi}]`);
    return name;
  };

  // ── base ───────────────────────────────────────────────────────────────
  params.push('/* [Base] */');
  let baseGeom: string;
  let baseHVar = '0';
  const isCircle = base.shape === 'circle';
  let baseW = '0', baseD = '0', baseDia = '0'; // captured for the shell cavity
  if (isCircle) {
    const dia = P('Disc diameter', n(base.width, 50), ...around(n(base.width, 50)));
    baseDia = dia;
    baseHVar = P('Thickness', n(base.height, 5), ...around(n(base.height, 5)));
    const ch = chamfer ? `, chamfer=${P('Edge chamfer', n(chamfer.distance, 1), 0.5, 10, 0.5)}` : '';
    baseGeom = `cyl(d=${dia}, h=${baseHVar}, anchor=BOTTOM${ch})`;
  } else {
    const w = P('Base length', n(base.width, 100), ...around(n(base.width, 100)));
    const d = P('Base width', n(base.depth, 80), ...around(n(base.depth, 80)));
    baseW = w; baseD = d;
    baseHVar = P('Base thickness', n(base.height, 8), ...around(n(base.height, 8)));
    const ch = chamfer ? `, chamfer=${P('Edge chamfer', n(chamfer.distance, 1), 0.5, 10, 0.5)}, except=BOTTOM` : '';
    baseGeom = `cuboid([${w}, ${d}, ${baseHVar}], anchor=BOTTOM${ch})`;
  }

  // ── shell (hollow cavity, open at top or bottom) ─────────────────────────
  const shell = feats.find(f => f.type === 'shell');
  const shellGeoms: string[] = [];
  if (shell) {
    params.push('/* [Shell] */');
    const wt = P('Wall thickness', n(shell.wallThickness, 2), 0.5, 10, 0.5);
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
    const t = P('Rib thickness', n(r.width, 8), ...around(n(r.width, 8)));
    const h = P('Rib height', n(r.height, 40), ...around(n(r.height, 40)));
    const L = P('Rib length', n(r.length, n(base.depth, 80)), ...around(n(r.length, 80)));
    const x = n(r.posX, 0), y = n(r.posY, 0);
    const dims = r.alongY ? `[${t}, ${L}, ${h}]` : `[${L}, ${t}, ${h}]`;
    ribGeoms.push(`translate([${x}, ${y}, 0]) cuboid(${dims}, anchor=BOTTOM)`);
    if (fillet) {
      const fr = P('Rib base fillet', n(fillet.radius, 3), 0.5, 12, 0.5);
      // concave quarter-round weld in the re-entrant corner where the rib meets
      // the base top (z=baseHVar), on both rib faces, run along the rib length.
      const rot = r.alongY ? '[90,0,0]' : '[90,0,90]';
      const offs = r.alongY ? `[${x}+s*${t}/2, ${y}, ${baseHVar}]` : `[${x}, ${y}+s*${t}/2, ${baseHVar}]`;
      ribGeoms.push(`for (s=[-1,1]) translate(${offs}) rotate(${rot}) linear_extrude(${L}, center=true) scale([s,1]) difference() { square([${fr},${fr}]); translate([${fr},${fr}]) circle(r=${fr}, $fn=24); }`);
    }
  }

  // ── holes (difference'd, patterns expanded) ──────────────────────────────
  const holeGeoms: string[] = [];
  if (holes.length) params.push('/* [Holes] */');
  for (const hole of holes) {
    const dia = P('Hole diameter', n(hole.diameter, 6), ...around(n(hole.diameter, 6)));
    const pat = patterns.find(p => p.feature === hole.id);
    if (pat && pat.type === 'circularPattern') {
      const cnt = Math.max(2, Math.round(n(pat.count, 4)));
      const r = n(pat.pcd, Math.hypot(n(hole.posX), n(hole.posY)) * 2) / 2;
      const rp = P('Bolt circle radius', r, ...around(r));
      holeGeoms.push(`for (a = [0:360/${cnt}:359]) rotate([0,0,a]) translate([${rp}, 0, -1]) cylinder(d=${dia}, h=H_THRU);`);
    } else if (pat && pat.type === 'linearPattern') {
      const cnt = Math.max(2, Math.round(n(pat.count, 3)));
      const sp = P('Hole spacing', n(pat.spacing, 20), ...around(n(pat.spacing, 20)));
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
  body.push('  }');
  for (const g of holeGeoms) body.push(`  ${g}`);
  for (const g of shellGeoms) body.push(`  ${g}`);
  body.push('}');

  return `include <BOSL2/std.scad>\n\n${params.join('\n')}\n\n${body.join('\n')}\n`;
}
