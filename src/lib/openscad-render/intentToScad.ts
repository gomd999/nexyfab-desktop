/**
 * Deterministic JSON-intent → OpenSCAD source converter.
 *
 * This is the "deterministic" half of NexyFab's NL→JSON→OpenSCAD→STL pipeline.
 * shape-chat produces a JSON intent (mode=single with shapeId+params+features);
 * this module turns that intent into reproducible OpenSCAD source code that
 * /api/nexyfab/openscad-render can compile to STL.
 *
 * Why deterministic instead of "ask the AI to write SCAD"? Because:
 *   - Same intent → same SCAD → same STL → cacheable, reproducible.
 *   - No risk of hallucinated syntax that breaks the OpenSCAD CLI.
 *   - We can reason about correctness (e.g. wall thickness invariants).
 *
 * Coverage:
 *   Primitives — box, cylinder, sphere, cone, torus, wedge, pipe, disk
 *   Standard parts — hexNut, washer, iBeam, lBracket, flange, bolt
 *   BOSL2-backed   — gear (involute spur), threadedRod, roundedBox, screw (ISO)
 *   Plain helix    — springCoil
 *   Features   — hole, fillet (approximated), chamfer (approximated), mirror,
 *                linearPattern, circularPattern, scale, shell
 *
 * Anything outside this set returns { ok:false, reason } so the caller can fall
 * back to the JSCAD path or surface a clear "not supported via SCAD" message.
 *
 * BOSL2 dependency:
 *   gear / threadedRod / roundedBox / screw require the BOSL2 library to be
 *   on OPENSCADPATH. The Dockerfile installs it at /opt/openscad-libs/BOSL2.
 *   When any BOSL2 shape is used we auto-prepend `include <BOSL2/std.scad>`.
 */

export interface IntentFeature {
  type: string;
  params?: Record<string, number>;
  enabled?: boolean;
}

export interface IntentInput {
  shapeId: string;
  params: Record<string, number>;
  features?: IntentFeature[];
  /** $fn — facet resolution for circles/spheres. Default 64. */
  facets?: number;
}

export type IntentToScadResult =
  | { ok: true; scad: string; warnings: string[]; stage2?: Stage2Summary }
  | { ok: false; reason: string };

export interface Stage2Summary {
  /** Bounds + pattern + constraint diagnostics from scadStage2.runStage2. */
  diagnostics: { severity: 'info' | 'warn' | 'error'; code: string; message: string }[];
  /** Top suggested design pattern, if any score > 0.4. */
  suggestedPattern?: { id: string; title: string; score: number };
  /** Constraint adjustments applied silently (e.g. fillet capped to 0.4×t). */
  adjustments: { field: string; from: unknown; to: unknown; reason: string }[];
}

// Single source of truth for the deterministic shape vocabulary. The scad-agent
// gate (intentSchema.KNOWN_SHAPE_IDS) imports this so the LLM allow-list can
// never drift below what the compiler can actually emit (the drift previously
// stranded ~18 compiler-supported parts behind the agent gate).
export const SUPPORTED_SHAPES = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  'gear', 'threadedRod', 'roundedBox', 'screw', 'springCoil',
  'sweep', 'loft', 'fanBlade',
  'heatsink', 'manifold', 'turbine',
  'enclosure', 'tBeam', 'uChannel', 'zPurlin',
  'rackUnit', 'shelfBracket', 'hingedBracket', 'motorMount',
  'nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot',
]);

const BOSL2_SHAPES = new Set([
  'gear', 'threadedRod', 'roundedBox', 'screw',
  'sweep', 'loft', 'fanBlade',
  'turbine',
]);

// Single source of truth for the deterministic feature vocabulary — imported by
// the scad-agent gate so its allow-list can't drift below the compiler.
export const SUPPORTED_FEATURES = new Set([
  'hole', 'fillet', 'chamfer', 'mirror', 'linearPattern', 'circularPattern',
  'scale', 'shell', 'thread', 'draft', 'twist', 'rotate',
]);

const BOSL2_FEATURES = new Set(['thread']);

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Stage-2 accuracy: validate the JSON intent for structural problems before
 * we emit SCAD. Returns hard errors (intent rejected) separately from soft
 * warnings (emit anyway, but surface the issue to the caller).
 *
 * Why pre-validate instead of letting OpenSCAD CLI fail:
 *   - SCAD compile errors are slow (process spawn + parse) and produce cryptic
 *     messages that don't map to user input.
 *   - The LLM occasionally returns negative dimensions or pipe inner/outer
 *     swapped; catching that here gives a concrete "innerDiameter must be <
 *     outerDiameter" message instead of an empty-mesh STL.
 *   - Lets us track *accuracy* (validateIntent error rate) as a metric.
 *
 * Soft cases stay as warnings so a slightly-out-of-range value doesn't block
 * a usable model; hard cases (negative width, hole bigger than parent) reject.
 */
export interface IntentValidation {
  errors: string[];
  warnings: string[];
}

const POSITIVE_DIM_KEYS = [
  'width', 'height', 'depth', 'length', 'diameter', 'radius', 'innerDiameter',
  'outerDiameter', 'wallThickness', 'thickness', 'wall', 'thread', 'pitch',
];

export function validateIntent(intent: IntentInput): IntentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!intent || typeof intent !== 'object') {
    errors.push('intent payload is missing or not an object');
    return { errors, warnings };
  }
  if (!intent.shapeId) {
    errors.push('shapeId is required');
    return { errors, warnings };
  }

  const p = intent.params ?? {};

  // Reject any explicitly-numeric dimension that's <= 0 or NaN. The `num()`
  // fallback would silently substitute a default, but here we want the LLM
  // (or upstream user) to see the mistake rather than build a phantom shape.
  for (const k of POSITIVE_DIM_KEYS) {
    const v = p[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`param "${k}" is not a finite number (${String(v)})`);
    } else if (v <= 0) {
      errors.push(`param "${k}" must be > 0 (got ${v})`);
    }
  }

  // Pipe-class shapes: inner must be strictly less than outer.
  if (intent.shapeId === 'pipe') {
    const od = num(p.outerDiameter, 0);
    const id = num(p.innerDiameter, 0);
    if (od > 0 && id > 0 && id >= od) {
      errors.push(`pipe innerDiameter (${id}) must be < outerDiameter (${od})`);
    }
  }
  // washer / hexNut similar: hole < outer.
  if (intent.shapeId === 'washer' || intent.shapeId === 'hexNut') {
    const od = num(p.outerDiameter ?? p.outer, 0);
    const id = num(p.innerDiameter ?? p.bore ?? p.inner, 0);
    if (od > 0 && id > 0 && id >= od) {
      errors.push(`${intent.shapeId} bore (${id}) must be < outer (${od})`);
    }
  }

  // Shell thickness sanity: shell > min(footprint) / 2 leaves no interior.
  for (const f of intent.features ?? []) {
    if (f.enabled === false) continue;
    if (f.type === 'shell') {
      const t = num(f.params?.thickness, 0);
      const w = num(p.width ?? p.diameter ?? p.length, 50);
      const h = num(p.height, 50);
      const d = num(p.depth ?? p.length, 50);
      const minFootprint = Math.min(w, h, d);
      if (t > 0 && t >= minFootprint / 2) {
        warnings.push(
          `shell thickness ${t}mm leaves no interior cavity (min footprint=${minFootprint}mm). Consider thickness < ${(minFootprint / 2).toFixed(1)}mm.`,
        );
      }
    }
    if (f.type === 'hole') {
      const dia = num(f.params?.diameter, 0);
      const w = num(p.width ?? p.diameter, 0);
      const d = num(p.depth ?? p.length, 0);
      if (dia > 0 && w > 0 && dia >= w) {
        warnings.push(
          `hole diameter ${dia}mm ≥ parent width ${w}mm — feature will obliterate the parent body.`,
        );
      }
      if (dia > 0 && d > 0 && dia >= d) {
        warnings.push(
          `hole diameter ${dia}mm ≥ parent depth ${d}mm — feature will obliterate the parent body.`,
        );
      }
    }
  }

  return { errors, warnings };
}

function emitBaseShape(shapeId: string, p: Record<string, number>): string {
  switch (shapeId) {
    case 'box': {
      const w = num(p.width ?? p.w, 50);
      const h = num(p.height ?? p.h, 50);
      const d = num(p.depth ?? p.d, 50);
      return `cube([${w}, ${h}, ${d}], center=true);`;
    }
    case 'cylinder': {
      const r = num(p.diameter ?? p.outerDiameter, 30) / 2;
      const h = num(p.height ?? p.length, 50);
      return `cylinder(h=${h}, r=${r}, center=true);`;
    }
    case 'sphere': {
      const r = num(p.diameter, 30) / 2;
      return `sphere(r=${r});`;
    }
    case 'cone': {
      const r1 = num(p.bottomDiameter ?? p.diameter, 40) / 2;
      const r2 = num(p.topDiameter, 0) / 2;
      const h = num(p.height, 50);
      return `cylinder(h=${h}, r1=${r1}, r2=${r2}, center=true);`;
    }
    case 'torus': {
      const major = num(p.majorDiameter, 60) / 2;
      const tube = num(p.tubeDiameter ?? p.minorDiameter, 10) / 2;
      return `rotate_extrude() translate([${major}, 0, 0]) circle(r=${tube});`;
    }
    case 'wedge': {
      const w = num(p.width, 50);
      const h = num(p.height, 50);
      const d = num(p.depth, 50);
      return `polyhedron(\n  points=[[0,0,0],[${w},0,0],[0,${h},0],[0,0,${d}],[${w},0,${d}],[0,${h},${d}]],\n  faces=[[0,1,2],[3,5,4],[0,2,5,3],[0,3,4,1],[1,4,5,2]]\n);`;
    }
    case 'pipe': {
      const od = num(p.outerDiameter, 30);
      const id = num(p.innerDiameter, 20);
      const h = num(p.length ?? p.height, 50);
      return `difference() {\n  cylinder(h=${h}, r=${od / 2}, center=true);\n  cylinder(h=${h + 0.2}, r=${id / 2}, center=true);\n}`;
    }
    case 'disk': {
      const r = num(p.diameter, 60) / 2;
      const t = num(p.thickness, 5);
      return `cylinder(h=${t}, r=${r}, center=true);`;
    }
    case 'hexNut': {
      // Across-flats → corner-radius for $fn=6 cylinder is afs / cos(30°).
      const afs = num(p.acrossFlats, 13);
      const cornerR = afs / Math.cos(Math.PI / 6) / 2;
      const thickness = num(p.thickness ?? p.nutThickness, 8);
      const boreR = num(p.nominalDiameter ?? p.boreDiameter, 8) / 2;
      return `difference() {\n  cylinder(h=${thickness}, r=${cornerR.toFixed(4)}, center=true, $fn=6);\n  cylinder(h=${thickness + 0.2}, r=${boreR}, center=true);\n}`;
    }
    case 'washer': {
      const od = num(p.outerDiameter, 20);
      const id = num(p.innerDiameter, 8);
      const t = num(p.thickness, 1.6);
      return `difference() {\n  cylinder(h=${t}, r=${od / 2}, center=true);\n  cylinder(h=${t + 0.2}, r=${id / 2}, center=true);\n}`;
    }
    case 'iBeam': {
      // 2D I-section then linear_extrude. Cross-section centered on origin.
      const H = num(p.beamHeight ?? p.height, 100);
      const W = num(p.flangeWidth ?? p.width, 60);
      const tw = num(p.webThickness ?? p.webThick, 5);
      const tf = num(p.flangeThickness ?? p.flangeThick, 8);
      const L = num(p.length, 200);
      const halfH = H / 2, halfW = W / 2, halfTw = tw / 2, halfTfBlock = halfH - tf;
      const pts = [
        `[${-halfW}, ${-halfH}]`, `[${halfW}, ${-halfH}]`,
        `[${halfW}, ${-halfTfBlock}]`, `[${halfTw}, ${-halfTfBlock}]`,
        `[${halfTw}, ${halfTfBlock}]`, `[${halfW}, ${halfTfBlock}]`,
        `[${halfW}, ${halfH}]`, `[${-halfW}, ${halfH}]`,
        `[${-halfW}, ${halfTfBlock}]`, `[${-halfTw}, ${halfTfBlock}]`,
        `[${-halfTw}, ${-halfTfBlock}]`, `[${-halfW}, ${-halfTfBlock}]`,
      ].join(', ');
      return `linear_extrude(height=${L}, center=true) polygon(points=[${pts}]);`;
    }
    case 'lBracket': {
      // Two flanges joined at an inner corner.
      const W = num(p.width, 50);
      const H = num(p.height, 50);
      const D = num(p.depth ?? p.length, 50);
      const t = num(p.thickness, 4);
      return `union() {\n  translate([0, 0, 0]) cube([${W}, ${t}, ${D}]);\n  translate([0, 0, 0]) cube([${t}, ${H}, ${D}]);\n}`;
    }
    case 'flange': {
      // Thick disk with circular bolt-hole pattern.
      const od = num(p.outerDiameter, 100);
      const id = num(p.innerDiameter ?? p.boreDiameter, 30);
      const t = num(p.thickness, 12);
      const pcd = num(p.pcd ?? p.boltCircleDiameter, 70);
      const boltCount = Math.max(2, Math.round(num(p.boltCount, 4)));
      const boltDia = num(p.boltDiameter ?? p.boltHoleDiameter, 8);
      const boltR = boltDia / 2;
      const r = pcd / 2;
      const boltLoop = `for (i = [0 : ${boltCount - 1}]) rotate([0, 0, 360 * i / ${boltCount}]) translate([${r}, 0, 0]) cylinder(h=${t + 0.2}, r=${boltR}, center=true);`;
      return `difference() {\n  cylinder(h=${t}, r=${od / 2}, center=true);\n  cylinder(h=${t + 0.2}, r=${id / 2}, center=true);\n  ${boltLoop}\n}`;
    }
    case 'bolt': {
      // Hex-head + cylindrical shaft. Origin at shaft-base; head sits below z=0.
      const shaftDia = num(p.shaftDiameter ?? p.diameter, 8);
      const shaftLen = num(p.shaftLength ?? p.length, 30);
      const headHeight = num(p.headHeight, 5);
      const headFlats = num(p.headFlats ?? p.acrossFlats, 13);
      const headR = headFlats / Math.cos(Math.PI / 6) / 2;
      return `union() {\n  // Hex head\n  translate([0, 0, ${-headHeight / 2}]) cylinder(h=${headHeight}, r=${headR.toFixed(4)}, center=true, $fn=6);\n  // Shaft\n  translate([0, 0, ${shaftLen / 2}]) cylinder(h=${shaftLen}, r=${shaftDia / 2}, center=true);\n}`;
    }
    case 'gear': {
      // Involute spur gear via BOSL2's `spur_gear()`.
      const teeth = Math.max(8, Math.round(num(p.teeth, 20)));
      const mod = num(p.module, 2);
      const thickness = num(p.thickness ?? p.height, 8);
      const pressureAngle = num(p.pressureAngle, 20);
      const helical = num(p.helical, 0);
      return `spur_gear(\n  mod=${mod},\n  teeth=${teeth},\n  thickness=${thickness},\n  pressure_angle=${pressureAngle},\n  helical=${helical}\n);`;
    }
    case 'threadedRod': {
      // ISO metric threaded rod via BOSL2's `threaded_rod()`.
      const dia = num(p.diameter ?? p.nominalDiameter, 8);
      const length = num(p.length, 40);
      const pitch = num(p.pitch, 1.25);
      return `threaded_rod(d=${dia}, l=${length}, pitch=${pitch});`;
    }
    case 'roundedBox': {
      // BOSL2 cuboid with rounding on all edges.
      const w = num(p.width, 50);
      const h = num(p.height, 50);
      const d = num(p.depth, 50);
      const r = Math.max(0.1, num(p.rounding ?? p.cornerRadius, 3));
      return `cuboid([${w}, ${h}, ${d}], rounding=${r});`;
    }
    case 'screw': {
      // ISO standard hex-head screw via BOSL2's `screw()` — accurate threads.
      const spec = String(p.spec ?? '').trim();
      const length = num(p.length ?? p.shaftLength, 30);
      // BOSL2 accepts spec like "M8x1.25,30" or numeric (diameter, length).
      // Default to "M{dia}" so users can pass diameter without worrying about pitch.
      const specStr = spec.length > 0 ? spec : `M${num(p.diameter ?? p.shaftDiameter, 8)}`;
      const headType = String(p.headType ?? 'hex').replace(/[^a-z]/gi, '');
      return `screw("${specStr}", length=${length}, head="${headType || 'hex'}");`;
    }
    case 'springCoil': {
      // Helical coil spring via linear_extrude+twist — pure OpenSCAD, no BOSL2.
      // mesh density grows with turns × 32 slices to keep resolution bounded.
      const coilDia = num(p.coilDiameter, 20);
      const wireDia = num(p.wireDiameter, 2);
      const turns = Math.max(1, num(p.turns ?? p.numCoils, 8));
      const freeLen = num(p.freeLength ?? p.length, 60);
      const slices = Math.min(2048, Math.max(32, Math.round(turns * 32)));
      const coilR = coilDia / 2;
      const wireR = wireDia / 2;
      return `linear_extrude(height=${freeLen}, twist=${(turns * 360).toFixed(2)}, slices=${slices}, $fn=24)\n  translate([${coilR}, 0, 0]) circle(r=${wireR});`;
    }
    case 'sweep': {
      // Circular profile swept along a parametric sinusoidal path via BOSL2.
      // Path: (x, sin(x*freq)*amp, 0) — a wave-shaped centerline, common for
      // hose runs, handrails, and cable trays. Resolution scales with length.
      // profileRadius is taken as-is; tubeDiameter alias gets halved.
      const profileR = typeof p.profileRadius === 'number' && Number.isFinite(p.profileRadius)
        ? p.profileRadius
        : num(p.tubeDiameter, 12) / 2;
      const length = Math.max(10, num(p.pathLength ?? p.length, 100));
      const amp = num(p.pathAmplitude ?? p.amplitude, 20);
      const freq = num(p.pathFrequency ?? p.frequency, 1);
      const samples = Math.min(400, Math.max(20, Math.round(length / 2)));
      return `path_sweep(\n  circle(r=${profileR}),\n  [for (i = [0 : ${samples}]) let (x = ${length} * i / ${samples}) [x, ${amp} * sin(x * ${freq * 360 / Math.max(length, 1)}), 0]]\n);`;
    }
    case 'loft': {
      // Loft (skin) between two profiles stacked along Z. bottomRadius/topRadius
      // are taken as-is; bottomDiameter/topDiameter aliases get halved.
      const r1 = typeof p.bottomRadius === 'number' && Number.isFinite(p.bottomRadius)
        ? p.bottomRadius
        : num(p.bottomDiameter, 60) / 2;
      const r2 = typeof p.topRadius === 'number' && Number.isFinite(p.topRadius)
        ? p.topRadius
        : num(p.topDiameter, 30) / 2;
      const h = num(p.height ?? p.length, 50);
      const sides = Math.max(16, Math.min(128, Math.round(num(p.sides, 48))));
      return `skin([\n  path3d(circle(r=${r1}, $fn=${sides})),\n  path3d(circle(r=${r2}, $fn=${sides}), ${h})\n]);`;
    }
    case 'fanBlade': {
      // Approximate axial fan: hub + radially-arrayed twisted blades.
      // Each blade is a skinned loft between root and tip airfoil-like rectangles.
      const hubDia = num(p.hubDiameter, 30);
      const hubH = num(p.hubHeight ?? p.thickness, 20);
      const bladeCount = Math.max(2, Math.min(24, Math.round(num(p.bladeCount, 5))));
      const bladeLen = num(p.bladeLength ?? p.bladeRadius, 60);
      const rootChord = num(p.rootChord ?? p.bladeWidth, 25);
      const tipChord = num(p.tipChord, rootChord * 0.6);
      const pitchAng = num(p.pitchAngle, 25);
      const hubR = hubDia / 2;
      // One blade in local coords, then array via for-rotate.
      const blade =
        `translate([${hubR}, 0, 0]) rotate([0, ${pitchAng}, 0])\n` +
        `      skin([\n` +
        `        path3d(rect([${rootChord}, ${hubH * 0.6}], rounding=1)),\n` +
        `        path3d(rect([${tipChord}, ${hubH * 0.4}], rounding=1), ${bladeLen})\n` +
        `      ], slices=12);`;
      return `union() {\n  // Hub\n  cylinder(h=${hubH}, d=${hubDia}, center=true);\n  // Blades\n  for (i = [0 : ${bladeCount - 1}]) rotate([0, 0, 360 * i / ${bladeCount}])\n    ${blade}\n}`;
    }
    case 'heatsink': {
      // Pin-grid heatsink: a base plate + an N×M array of cylindrical pins.
      // Common in electronics cooling; param-driven so AI can size for a chip.
      const baseW = num(p.baseWidth ?? p.width, 60);
      const baseD = num(p.baseDepth ?? p.depth, 60);
      const baseH = num(p.baseHeight ?? p.baseThickness, 4);
      const pinDia = num(p.pinDiameter, 3);
      const pinH = num(p.pinHeight, 25);
      const pinRows = Math.max(2, Math.min(40, Math.round(num(p.pinRows, 8))));
      const pinCols = Math.max(2, Math.min(40, Math.round(num(p.pinCols, 8))));
      const margin = num(p.margin, 4);
      // Pin grid spacing fits within (baseW − 2*margin) × (baseD − 2*margin).
      const dx = (baseW - 2 * margin) / Math.max(1, pinCols - 1);
      const dz = (baseD - 2 * margin) / Math.max(1, pinRows - 1);
      const x0 = -baseW / 2 + margin;
      const z0 = -baseD / 2 + margin;
      const pins =
        `for (i = [0 : ${pinCols - 1}]) for (j = [0 : ${pinRows - 1}])\n` +
        `    translate([${x0.toFixed(3)} + ${dx.toFixed(3)} * i, ${baseH / 2 + pinH / 2}, ${z0.toFixed(3)} + ${dz.toFixed(3)} * j])\n` +
        `      cylinder(h=${pinH}, d=${pinDia}, center=true);`;
      return `union() {\n  // Base plate\n  cube([${baseW}, ${baseH}, ${baseD}], center=true);\n  // Pin grid\n  ${pins}\n}`;
    }
    case 'manifold': {
      // Multi-port fluid/pneumatic manifold: rectangular block with N ports
      // along one face plus a central bore. Common for hydraulic/pneumatic distribution.
      const W = num(p.width, 80);
      const H = num(p.height, 30);
      const D = num(p.depth, 30);
      const portCount = Math.max(2, Math.min(20, Math.round(num(p.portCount, 4))));
      const portDia = num(p.portDiameter, 6);
      const portDepth = Math.max(H * 0.6, num(p.portDepth, H * 0.7));
      const boreDia = num(p.boreDiameter, 8);
      const margin = num(p.portMargin, 10);
      const span = W - 2 * margin;
      const spacing = span / Math.max(1, portCount - 1);
      const x0 = -W / 2 + margin;
      const ports =
        `for (i = [0 : ${portCount - 1}])\n` +
        `    translate([${x0.toFixed(3)} + ${spacing.toFixed(3)} * i, ${H / 2 + 0.1}, 0])\n` +
        `      cylinder(h=${portDepth + 0.2}, d=${portDia}, center=false, $fn=32);`;
      return `difference() {\n  // Block\n  cube([${W}, ${H}, ${D}], center=true);\n  // Center bore (axial through-hole along X)\n  rotate([0, 0, 90]) cylinder(h=${W + 0.2}, d=${boreDia}, center=true, $fn=48);\n  // Inlet ports\n  ${ports}\n}`;
    }
    case 'rackUnit': {
      // 19" rack-mount face with mounting ear holes. Standard rack U = 44.45mm.
      const widthIn = num(p.widthInches, 19);
      const u = Math.max(1, Math.min(12, Math.round(num(p.units ?? p.uHeight, 1))));
      const earWidth = num(p.earWidth, 15.875);  // EIA-310 standard
      const totalH = u * 44.45;
      const earOpeningH = totalH - 1.0;
      const totalW = widthIn * 25.4;
      const thickness = num(p.faceThickness ?? p.thickness, 3);
      const holeDia = num(p.holeDiameter, 6.35);
      // Two ears: each has 2 holes per U at standard EIA-310 spacing.
      // Hole pattern: from rack opening top, spacing 12.7-15.875-15.875 then repeats.
      const holeY1 = (totalH / 2) - 6.35;     // top hole
      const holeY2 = (totalH / 2) - 28.575;   // bottom hole within U
      const earX = -(totalW / 2) + (earWidth / 2);
      const holes =
        `// Mounting holes (standard EIA-310 spacing per U)\n` +
        `  for (i = [0 : ${u - 1}]) {\n` +
        `    yOff = -i * 44.45;\n` +
        `    translate([${earX}, ${holeY1} + yOff, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${earX}, ${holeY2} + yOff, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${-earX}, ${holeY1} + yOff, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${-earX}, ${holeY2} + yOff, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `  }`;
      // Note: OpenSCAD doesn't support `let` outside expressions, so we set yOff via assign() or computed.
      // Replace yOff with explicit (-i * 44.45):
      const holesFixed =
        `for (i = [0 : ${u - 1}]) {\n` +
        `    translate([${earX}, ${holeY1} - i * 44.45, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${earX}, ${holeY2} - i * 44.45, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${-earX}, ${holeY1} - i * 44.45, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `    translate([${-earX}, ${holeY2} - i * 44.45, 0]) cylinder(h=${thickness + 0.4}, d=${holeDia}, center=true, $fn=24);\n` +
        `  }`;
      void holes; void earOpeningH;
      return `difference() {\n  cube([${totalW}, ${totalH}, ${thickness}], center=true);\n  ${holesFixed}\n}`;
    }
    case 'shelfBracket': {
      // L-shape with diagonal gusset. Common wall shelf bracket.
      const armW = num(p.armWidth ?? p.width, 200);
      const armH = num(p.armHeight ?? p.height, 200);
      const t = num(p.thickness, 4);
      const D = num(p.depth, 20);
      const gussetWidth = num(p.gussetWidth, 6);
      // Two perpendicular arms at origin + diagonal triangular gusset along the inner corner.
      const gussetPts = [
        `[${t}, ${t}]`,
        `[${armW * 0.7}, ${t}]`,
        `[${t}, ${armH * 0.7}]`,
      ].join(', ');
      return `union() {\n  // Horizontal arm\n  translate([${armW / 2}, ${t / 2}, 0]) cube([${armW}, ${t}, ${D}], center=true);\n  // Vertical arm\n  translate([${t / 2}, ${armH / 2}, 0]) cube([${t}, ${armH}, ${D}], center=true);\n  // Gusset (triangular brace, ${gussetWidth}mm thick into +Z)\n  linear_extrude(height=${gussetWidth}) polygon(points=[${gussetPts}]);\n}`;
    }
    case 'hingedBracket': {
      // Two L-bracket halves joined by a barrel hinge. Knuckle along Z axis.
      const armW = num(p.armWidth, 60);
      const armT = num(p.armThickness ?? p.thickness, 4);
      const knuckleD = num(p.knuckleDiameter, 12);
      const knuckleH = num(p.knuckleHeight ?? p.height, 40);
      const pinD = num(p.pinDiameter, 5);
      // Two flat plates with cylindrical knuckles offset half a knuckle so they interleave.
      return `union() {\n  // Plate A\n  translate([${-armW / 2 - knuckleD / 4}, 0, 0]) cube([${armW}, ${armT}, ${knuckleH}], center=true);\n  // Plate B (mirrored across YZ)\n  translate([${armW / 2 + knuckleD / 4}, 0, 0]) cube([${armW}, ${armT}, ${knuckleH}], center=true);\n  // Knuckle (single barrel for simplicity — real hinges interleave)\n  difference() {\n    cylinder(h=${knuckleH}, d=${knuckleD}, center=true, $fn=32);\n    cylinder(h=${knuckleH + 0.4}, d=${pinD}, center=true, $fn=24);\n  }\n}`;
    }
    case 'motorMount': {
      // NEMA-style motor mount face: square plate with center bore + 4-corner bolt holes.
      // NEMA 17 default: 42×42mm, 31mm bolt circle, M3 bolts.
      const plateSize = num(p.plateSize ?? p.width, 42);
      const plateT = num(p.thickness, 5);
      const boltCircle = num(p.boltCirclePitch ?? p.bolts, 31);
      const boltDia = num(p.boltDiameter, 3.4);
      const centerBore = num(p.centerBoreDiameter, 22);
      const off = boltCircle / 2;
      const positions = [`[${off}, ${off}]`, `[${-off}, ${off}]`, `[${off}, ${-off}]`, `[${-off}, ${-off}]`];
      const bolts = positions
        .map(p2 => `translate([${p2.slice(1, -1)}, 0]) cylinder(h=${plateT + 0.4}, d=${boltDia}, center=true, $fn=24);`)
        .join('\n  ');
      return `difference() {\n  cube([${plateSize}, ${plateSize}, ${plateT}], center=true);\n  // Shaft bore\n  cylinder(h=${plateT + 0.4}, d=${centerBore}, center=true, $fn=48);\n  // Mounting bolt holes (NEMA pattern)\n  ${bolts}\n}`;
    }
    case 'enclosure': {
      // Hollow PCB / project box: outer cuboid minus inner cavity, plus an
      // optional lid lip. Fits common electronics enclosure geometry.
      const W = num(p.width, 100);
      const H = num(p.height, 40);
      const D = num(p.depth, 60);
      const wall = Math.max(0.5, num(p.wallThickness, 2.5));
      const lipH = num(p.lipHeight, 4);
      const lipInset = num(p.lipInset, wall * 0.5);
      const innerW = Math.max(1, W - 2 * wall);
      const innerH = Math.max(1, H - wall);  // open top
      const innerD = Math.max(1, D - 2 * wall);
      // Lip is a small ring inset from the inner top — engages a lid.
      const lip =
        `translate([0, ${H / 2 - lipH / 2}, 0])\n` +
        `    difference() {\n` +
        `      cube([${innerW}, ${lipH}, ${innerD}], center=true);\n` +
        `      cube([${innerW - 2 * lipInset}, ${lipH + 0.2}, ${innerD - 2 * lipInset}], center=true);\n` +
        `    }`;
      return `union() {\n  difference() {\n    cube([${W}, ${H}, ${D}], center=true);\n    translate([0, ${wall / 2}, 0]) cube([${innerW}, ${innerH + 0.1}, ${innerD}], center=true);\n  }\n  ${lip}\n}`;
    }
    case 'tBeam': {
      // T-beam cross section extruded along Z. Mirror of iBeam emit pattern.
      const W = num(p.flangeWidth ?? p.width, 80);
      const H = num(p.beamHeight ?? p.height, 100);
      const tw = num(p.webThickness ?? p.webThick, 8);
      const tf = num(p.flangeThickness ?? p.flangeThick, 10);
      const L = num(p.length, 200);
      const halfH = H / 2, halfW = W / 2, halfTw = tw / 2;
      const flangeBottomY = halfH - tf;
      const pts = [
        `[${-halfW}, ${halfH}]`, `[${halfW}, ${halfH}]`,
        `[${halfW}, ${flangeBottomY}]`, `[${halfTw}, ${flangeBottomY}]`,
        `[${halfTw}, ${-halfH}]`, `[${-halfTw}, ${-halfH}]`,
        `[${-halfTw}, ${flangeBottomY}]`, `[${-halfW}, ${flangeBottomY}]`,
      ].join(', ');
      return `linear_extrude(height=${L}, center=true) polygon(points=[${pts}]);`;
    }
    case 'uChannel': {
      // U-channel (channel beam): three-sided open profile extruded along Z.
      const W = num(p.width, 50);
      const H = num(p.height, 80);
      const tw = num(p.webThickness ?? p.webThick, 6);
      const tf = num(p.flangeThickness ?? p.flangeThick, 8);
      const L = num(p.length, 200);
      // Profile: outer rectangle [W×H] minus inner pocket leaving bottom flange + two side flanges.
      const innerW = Math.max(1, W - 2 * tf);
      const innerH = Math.max(1, H - tw);  // tw is the bottom web here
      const pts = [
        `[0, 0]`, `[${W}, 0]`,
        `[${W}, ${H}]`, `[${W - tf}, ${H}]`,
        `[${W - tf}, ${tw}]`, `[${tf}, ${tw}]`,
        `[${tf}, ${H}]`, `[0, ${H}]`,
      ].join(', ');
      // Hint to suppress unused-var lint — innerW/innerH are documentation aids.
      void innerW; void innerH;
      return `linear_extrude(height=${L}, center=true) polygon(points=[${pts}]);`;
    }
    case 'zPurlin': {
      // Z-purlin (cold-formed Z section) — staggered top/bottom flanges.
      const W = num(p.flangeWidth ?? p.width, 60);
      const H = num(p.beamHeight ?? p.height, 150);
      const t = num(p.thickness, 2.5);
      const L = num(p.length, 200);
      const halfH = H / 2;
      // Top flange runs +X direction, bottom flange runs -X direction.
      const pts = [
        `[0, ${halfH}]`, `[${W}, ${halfH}]`,
        `[${W}, ${halfH - t}]`, `[${t}, ${halfH - t}]`,
        `[${t}, ${-halfH + t}]`, `[${-W + t}, ${-halfH + t}]`,
        `[${-W + t}, ${-halfH}]`, `[0, ${-halfH}]`,
      ].join(', ');
      return `linear_extrude(height=${L}, center=true) polygon(points=[${pts}]);`;
    }
    case 'turbine': {
      // Centrifugal/axial turbine impeller — hub with N curved blades.
      // Uses BOSL2 path_sweep so each blade follows a logarithmic-spiral path.
      const hubDia = num(p.hubDiameter, 40);
      const hubH = num(p.hubHeight ?? p.thickness, 30);
      const bladeCount = Math.max(3, Math.min(36, Math.round(num(p.bladeCount, 8))));
      const outerR = num(p.outerRadius ?? p.tipRadius, 60);
      const inletAng = num(p.inletAngle, 25);
      const outletAng = num(p.outletAngle, 50);
      const bladeThick = num(p.bladeThickness, 2);
      const innerR = hubDia / 2;
      const samples = 24;
      // Curved blade path from inner radius to outer, with angle that sweeps
      // from inletAng (relative to radial) to outletAng. Linear interpolation
      // is plenty for a visual model.
      const blade =
        `path_sweep(\n` +
        `      rect([${bladeThick}, ${hubH}], rounding=${Math.min(bladeThick, hubH) * 0.3}),\n` +
        `      [for (t = [0 : ${samples}])\n` +
        `        let (\n` +
        `          r = ${innerR} + (${outerR} - ${innerR}) * t / ${samples},\n` +
        `          ang = ${inletAng} + (${outletAng} - ${inletAng}) * t / ${samples}\n` +
        `        )\n` +
        `        [r * cos(ang * t / ${samples} * 2), r * sin(ang * t / ${samples} * 2), 0]\n` +
        `      ]\n` +
        `    );`;
      return `union() {\n  // Hub disc\n  cylinder(h=${hubH}, d=${hubDia}, center=true);\n  // Curved blades\n  for (i = [0 : ${bladeCount - 1}]) rotate([0, 0, 360 * i / ${bladeCount}])\n    ${blade}\n}`;
    }
    // ── Everyday consumer products (lay-user designs) ─────────────────────
    case 'nameplate': {
      // Desk/door nameplate: flat base plate with a raised border frame that
      // leaves a recessed center for engraving a name.
      const W = num(p.width, 120);
      const D = num(p.depth, 45);
      const t = num(p.thickness, 6);
      const border = num(p.border ?? p.borderWidth, 4);
      const borderH = num(p.borderHeight, 2);
      const innerW = Math.max(1, W - 2 * border);
      const innerD = Math.max(1, D - 2 * border);
      return `union() {\n  // Base plate\n  translate([0, 0, ${t / 2}]) cube([${W}, ${D}, ${t}], center=true);\n  // Raised engraving border\n  translate([0, 0, ${t + borderH / 2}]) difference() {\n    cube([${W}, ${D}, ${borderH}], center=true);\n    cube([${innerW}, ${innerD}, ${borderH + 0.2}], center=true);\n  }\n}`;
    }
    case 'phoneStand': {
      // Cradle phone stand: base + vertical back rest + front lip, with a slot
      // gap between the lip and the back wall for the phone to rest in.
      const PW = num(p.width ?? p.phoneWidth, 85);
      const t = num(p.thickness ?? p.wallThickness, 6);
      const baseDepth = num(p.baseDepth ?? p.depth, 65);
      const backHeight = num(p.backHeight ?? p.height, 90);
      const frontHeight = num(p.frontHeight ?? p.lipHeight, 22);
      const slotGap = num(p.slotGap, 12);
      return `union() {\n  // Base\n  translate([${-PW / 2}, ${-baseDepth / 2}, 0]) cube([${PW}, ${baseDepth}, ${t}]);\n  // Back rest\n  translate([${-PW / 2}, ${baseDepth / 2 - t}, 0]) cube([${PW}, ${t}, ${backHeight}]);\n  // Front lip\n  translate([${-PW / 2}, ${baseDepth / 2 - 2 * t - slotGap}, 0]) cube([${PW}, ${t}, ${frontHeight}]);\n}`;
    }
    case 'coaster': {
      // Drink coaster: a disk base with a raised rim to catch condensation.
      const dia = num(p.diameter, 90);
      const t = num(p.thickness, 4);
      const rimH = num(p.rimHeight, 3);
      const rimW = num(p.rimWidth, 4);
      const innerDia = Math.max(1, dia - 2 * rimW);
      return `union() {\n  // Base\n  cylinder(h=${t}, d=${dia});\n  // Raised rim\n  translate([0, 0, ${t}]) difference() {\n    cylinder(h=${rimH}, d=${dia});\n    translate([0, 0, -0.1]) cylinder(h=${rimH + 0.2}, d=${innerDia});\n  }\n}`;
    }
    case 'wallHook': {
      // Wall-mounted J-hook: a back plate with two screw holes + a forward arm
      // with an upturned tip to keep items from sliding off.
      const plateW = num(p.plateWidth ?? p.width, 32);
      const plateH = num(p.plateHeight ?? p.height, 55);
      const plateT = num(p.plateThickness ?? p.thickness, 6);
      const screwDia = num(p.screwHoleDiameter ?? p.screwDiameter, 5);
      const hookLen = num(p.hookLength, 40);
      const hookDia = num(p.hookDiameter, 10);
      const hookUp = num(p.hookTipHeight ?? p.hookDrop, 18);
      const holeOff = plateH / 2 - hookDia;
      const armZ = -plateH / 2 + hookDia / 2;
      return `union() {\n  // Wall plate with two screw holes\n  difference() {\n    cube([${plateW}, ${plateT}, ${plateH}], center=true);\n    translate([0, 0, ${holeOff}]) rotate([90, 0, 0]) cylinder(h=${plateT + 0.4}, d=${screwDia}, center=true);\n    translate([0, 0, ${-holeOff}]) rotate([90, 0, 0]) cylinder(h=${plateT + 0.4}, d=${screwDia}, center=true);\n  }\n  // Forward arm\n  translate([0, ${plateT / 2}, ${armZ}]) rotate([-90, 0, 0]) cylinder(h=${hookLen}, d=${hookDia});\n  // Upturned tip\n  translate([0, ${plateT / 2 + hookLen}, ${armZ}]) cylinder(h=${hookUp}, d=${hookDia});\n}`;
    }
    case 'drawerKnob': {
      // Cabinet/drawer knob: a flattened spherical knob on a cylindrical stem,
      // with a screw bore up from the base for mounting.
      const knobDia = num(p.knobDiameter ?? p.diameter, 30);
      const stemDia = num(p.stemDiameter, 10);
      const stemH = num(p.stemHeight, 12);
      const boreDia = num(p.boreDiameter ?? p.screwDiameter, 4);
      const flatten = 0.7;
      const knobZ = stemH + (knobDia / 2) * flatten * 0.6;
      return `difference() {\n  union() {\n    // Stem\n    cylinder(h=${stemH}, d=${stemDia});\n    // Knob (flattened sphere)\n    translate([0, 0, ${knobZ.toFixed(3)}]) scale([1, 1, ${flatten}]) sphere(d=${knobDia});\n  }\n  // Screw bore from the base\n  translate([0, 0, -0.1]) cylinder(h=${(stemH + 2).toFixed(3)}, d=${boreDia});\n}`;
    }
    case 'planterPot': {
      // Tapered planter pot: a frustum shell (open top) with a floor and a
      // central drainage hole through the bottom.
      const topDia = num(p.topDiameter ?? p.diameter, 100);
      const botDia = num(p.bottomDiameter, 75);
      const h = num(p.height, 90);
      const wall = Math.max(0.8, num(p.wallThickness ?? p.wall, 4));
      const drainDia = num(p.drainDiameter, 12);
      const innerTop = Math.max(1, topDia - 2 * wall);
      const innerBot = Math.max(1, botDia - 2 * wall);
      return `difference() {\n  // Outer tapered body\n  cylinder(h=${h}, d1=${botDia}, d2=${topDia});\n  // Inner cavity (leaves a ${wall}mm floor)\n  translate([0, 0, ${wall}]) cylinder(h=${h}, d1=${innerBot}, d2=${innerTop});\n  // Drainage hole\n  translate([0, 0, -0.1]) cylinder(h=${wall + 0.2}, d=${drainDia});\n}`;
    }
    default:
      throw new Error(`Unsupported shape: ${shapeId}`);
  }
}

function applyHole(body: string, params: Record<string, number>): string {
  const dia = num(params.diameter ?? params.holeDiameter, 6);
  const x = num(params.x ?? params.posX, 0);
  const y = num(params.y ?? params.posY, 0);
  const z = num(params.z ?? params.posZ, 0);
  // Through-hole by default — make the cutter generously taller than any plausible body.
  const depth = num(params.depth, 1000);
  return `difference() {\n${indent(body)}\n  translate([${x}, ${y}, ${z}]) cylinder(h=${depth}, r=${dia / 2}, center=true);\n}`;
}

function applyFillet(body: string, params: Record<string, number>): string {
  // Minkowski-with-sphere is the classic Manifold-friendly fillet approximation.
  const r = num(params.radius, 2);
  if (r <= 0) return body;
  return `minkowski() {\n  difference() {\n${indent(body, 4)}\n    sphere(r=${r});\n  }\n  sphere(r=${r});\n}`;
}

function applyChamfer(body: string, params: Record<string, number>): string {
  // Same approximation as fillet but with a small cube — visually closer to chamfer.
  const d = num(params.distance ?? params.size, 1.5);
  if (d <= 0) return body;
  return `minkowski() {\n  difference() {\n${indent(body, 4)}\n    cube(${d * 2}, center=true);\n  }\n  cube(${d * 2}, center=true);\n}`;
}

function applyMirror(body: string, params: Record<string, number>): string {
  const ax = num(params.axisX, 0);
  const ay = num(params.axisY, 0);
  const az = num(params.axisZ, 1);
  return `union() {\n${indent(body)}\n  mirror([${ax}, ${ay}, ${az}]) {\n${indent(body, 4)}\n  }\n}`;
}

function applyLinearPattern(body: string, params: Record<string, number>): string {
  const count = Math.max(2, Math.round(num(params.count, 3)));
  const dx = num(params.spacingX ?? params.spacing, 20);
  const dy = num(params.spacingY, 0);
  const dz = num(params.spacingZ, 0);
  return `union() {\n  for (i = [0 : ${count - 1}]) {\n    translate([${dx} * i, ${dy} * i, ${dz} * i]) {\n${indent(body, 6)}\n    }\n  }\n}`;
}

function applyCircularPattern(body: string, params: Record<string, number>): string {
  const count = Math.max(2, Math.round(num(params.count, 4)));
  const total = num(params.totalAngle, 360);
  return `union() {\n  for (i = [0 : ${count - 1}]) {\n    rotate([0, 0, ${total} * i / ${count}]) {\n${indent(body, 6)}\n    }\n  }\n}`;
}

function applyScale(body: string, params: Record<string, number>): string {
  const sx = num(params.scaleX ?? params.scale, 1);
  const sy = num(params.scaleY ?? params.scale, 1);
  const sz = num(params.scaleZ ?? params.scale, 1);
  return `scale([${sx}, ${sy}, ${sz}]) {\n${indent(body)}\n}`;
}

function applyShell(body: string, params: Record<string, number>): string {
  // Hollow body: outer minus inner shrunk by `thickness`. Approximate via offset.
  const t = num(params.thickness, 2);
  if (t <= 0) return body;
  return `difference() {\n${indent(body)}\n  offset(delta=${-t}) {\n${indent(body, 4)}\n  }\n}`;
}

function applyThread(body: string, params: Record<string, number>): string {
  // Cut an external thread bore into the body (BOSL2 threaded_rod).
  // Used to add a screw hole bored through the part. The thread cuts the body
  // rather than adds material — most common case (tapped hole).
  const dia = num(params.diameter ?? params.nominalDiameter, 8);
  const length = Math.max(1, num(params.length ?? params.depth, 1000));
  const pitch = num(params.pitch, dia >= 6 ? 1.0 : 0.5);
  const x = num(params.x, 0);
  const y = num(params.y, 0);
  const z = num(params.z, 0);
  return `difference() {\n${indent(body)}\n  translate([${x}, ${y}, ${z}]) threaded_rod(d=${dia}, l=${length}, pitch=${pitch}, internal=true);\n}`;
}

function applyDraft(body: string, params: Record<string, number>): string {
  // Apply a draft taper by re-extruding the body's silhouette with scale.
  // We can't apply true draft to an arbitrary 3D body without a 2D profile, so
  // we emit a `scale` along the draft axis as a first-order approximation.
  // This is good enough for visualization / DfM hint; real draft happens at
  // the feature-tree level.
  const angle = num(params.angle, 1);
  const height = Math.max(1, num(params.height, 50));
  const taper = Math.tan((angle * Math.PI) / 180) * height;
  const factor = Math.max(0.05, 1 - taper / Math.max(1, num(params.referenceWidth, 50)));
  return `scale([${factor.toFixed(4)}, ${factor.toFixed(4)}, 1]) {\n${indent(body)}\n}`;
}

function applyTwist(body: string, params: Record<string, number>): string {
  // Whole-body rotation about a chosen axis. Different from circularPattern
  // (which arrays copies); this just orients the body in space.
  const ax = num(params.angleX, 0);
  const ay = num(params.angleY, 0);
  const az = num(params.angleZ ?? params.angle, 90);
  return `rotate([${ax}, ${ay}, ${az}]) {\n${indent(body)}\n}`;
}

function indent(s: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map(line => pad + line).join('\n');
}

export function intentToScad(intent: IntentInput): IntentToScadResult {
  if (!intent || typeof intent !== 'object') {
    return { ok: false, reason: 'intent payload is missing' };
  }
  if (!intent.shapeId || !SUPPORTED_SHAPES.has(intent.shapeId)) {
    return {
      ok: false,
      reason: `shape "${intent.shapeId}" is not yet supported by the deterministic SCAD converter; use JSCAD path instead`,
    };
  }

  // Stage-2 pre-validation: hard errors short-circuit the emit path so the
  // caller gets a concrete message (instead of an empty/garbled STL).
  const v = validateIntent(intent);
  if (v.errors.length > 0) {
    return { ok: false, reason: v.errors.join('; ') };
  }
  const warnings: string[] = [...v.warnings];

  // SCAD pipeline Stage 2 — accuracy layer. Folds bounds checks + design
  // pattern suggestions + constraint propagation into the result so the
  // chat agent and Inspector can surface inline diagnostics.
  let stage2: Stage2Summary | undefined;
  try {
    // Lazy require to keep the deterministic emit path side-effect-free for
    // callers that don't ship the agent bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/lib/ai/scad-agent/scadStage2') as typeof import('@/lib/ai/scad-agent/scadStage2');
    const res = mod.runStage2(intent);
    stage2 = {
      diagnostics: res.diagnostics,
      suggestedPattern: res.patterns[0] && res.patterns[0].score > 0.4
        ? { id: res.patterns[0].pattern.id, title: res.patterns[0].pattern.title, score: res.patterns[0].score }
        : undefined,
      adjustments: res.constraintChanges.map(c => ({ field: c.field, from: c.from, to: c.to, reason: c.reason })),
    };
    for (const d of res.diagnostics) {
      if (d.severity === 'warn' || d.severity === 'error') {
        warnings.push(`[stage2:${d.code}] ${d.message}`);
      }
    }
  } catch {
    // scadStage2 unavailable — degrade silently. Caller still gets the
    // deterministic SCAD output without the accuracy diagnostics.
  }
  const params = intent.params ?? {};
  const facets = Math.max(8, Math.min(256, num(intent.facets, 64)));

  let body: string;
  try {
    body = emitBaseShape(intent.shapeId, params);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'base shape emit failed' };
  }

  for (const f of intent.features ?? []) {
    if (f.enabled === false) continue;
    if (!SUPPORTED_FEATURES.has(f.type)) {
      warnings.push(`feature "${f.type}" skipped — not supported in deterministic SCAD path`);
      continue;
    }
    const fp = f.params ?? {};
    switch (f.type) {
      case 'hole': body = applyHole(body, fp); break;
      case 'fillet': body = applyFillet(body, fp); break;
      case 'chamfer': body = applyChamfer(body, fp); break;
      case 'mirror': body = applyMirror(body, fp); break;
      case 'linearPattern': body = applyLinearPattern(body, fp); break;
      case 'circularPattern': body = applyCircularPattern(body, fp); break;
      case 'scale': body = applyScale(body, fp); break;
      case 'shell': body = applyShell(body, fp); break;
      case 'thread': body = applyThread(body, fp); break;
      case 'draft': body = applyDraft(body, fp); break;
      case 'twist': // alias for rotate (single-shot orient)
      case 'rotate': body = applyTwist(body, fp); break;
    }
  }

  const usesBosl2Feature = (intent.features ?? []).some(
    f => f.enabled !== false && BOSL2_FEATURES.has(f.type),
  );
  const usesBosl2 = BOSL2_SHAPES.has(intent.shapeId) || usesBosl2Feature;
  const header = usesBosl2 ? `include <BOSL2/std.scad>\n` : '';
  const scad = `// Generated by NexyFab intentToScad — shape=${intent.shapeId}\n${header}$fn = ${facets};\n\n${body}\n`;
  return { ok: true, scad, warnings, ...(stage2 ? { stage2 } : {}) };
}
