/**
 * stepWrite — Phase 5 minimal STEP (ISO 10303-21) writer for NexyFab Pro.
 *
 * BOX-ONLY LIMITATION (Phase 1):
 * --------------------------------
 * This module emits a syntactically valid AP214 / AUTOMOTIVE_DESIGN STEP file
 * but the geometry is intentionally restricted to AXIS-ALIGNED BOXES. For an
 * ExtrudeFeature input, the writer computes the loop's bounding box and
 * extrudes that box in +Z by `feature.depth`, ignoring:
 *
 *   - the actual polygon shape (non-rectangular loops are flattened to bbox)
 *   - holes / inner loops
 *   - draft angle (taper is dropped)
 *   - midplane / two_sided direction (always treated as one_sided +Z)
 *   - extrude mode ('cut' is not boolean-subtracted; output is the body only)
 *
 * Real B-rep export (preserving the actual sketch profile, OCCT-quality
 * surfaces, booleans, fillets, etc.) is Phase 2, gated on the
 * BREP_WORKER_URL OCCT-backed worker (see processBrepStep.ts).
 *
 * What IS real here:
 *   - Header is a well-formed ISO 10303-21 Part 21 clear-text header.
 *   - The DATA section uses the full canonical entity set for a closed-shell
 *     manifold solid: MANIFOLD_SOLID_BREP → CLOSED_SHELL → 6× ADVANCED_FACE
 *     → FACE_OUTER_BOUND → EDGE_LOOP → 4× ORIENTED_EDGE → EDGE_CURVE →
 *     (LINE / VECTOR / DIRECTION + 2× VERTEX_POINT → CARTESIAN_POINT).
 *   - Each entity instance uses a unique `#N` identifier and is referenced
 *     consistently — a Part 21 parser should round-trip the file.
 *
 * Why this exists now (before full B-rep export):
 *   - Unlocks "export FeatureTree → STEP" for downstream CAM / supplier
 *     handoff in cases where bounding-box accuracy is acceptable
 *     (e.g. shipping/quote dimensioning, fixture envelope checks).
 *   - Validates the Part 21 serialization machinery (id allocation, escape
 *     handling, line wrapping) so Phase 2 can plug real geometry into the
 *     same envelope.
 *
 * Spec reference: ISO 10303-21 (Industrial automation systems — Product
 * data representation and exchange — Part 21: Implementation methods:
 * Clear text encoding of the exchange structure).
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

// ─── constants ────────────────────────────────────────────────────────────

/** Application string baked into FILE_NAME(originating_system). */
const NEXYFAB_APPLICATION = 'NEXYFAB-PRO';

/** AP214 schema string — same FILE_SCHEMA value used by existing imports. */
const AP214_SCHEMA = 'AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }';

/** Numeric formatting matches OCCT / NX style: trailing `.` on whole numbers. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`stepWrite: non-finite number ${n}`);
  if (n === 0) return '0.';
  // Up to 6 significant decimals; strip trailing zeros but keep a trailing '.'
  // so STEP parsers recognize the REAL literal (e.g. "10." not "10").
  const fixed = n.toFixed(6);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '.');
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

/** Escape a STEP string literal — single quote doubled, control chars stripped. */
function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/[\x00-\x1f]/g, ' ');
}

// ─── header ───────────────────────────────────────────────────────────────

export interface StepHeaderOptions {
  authorName?: string;
  organization?: string;
  description?: string;
  /** Override timestamp (ISO 8601). Defaults to `new Date().toISOString()`. */
  timestamp?: string;
  /** Optional filename to embed in FILE_NAME (default 'nexyfab.step'). */
  filename?: string;
}

/**
 * Emit the ISO 10303-21 HEADER section: the `ISO-10303-21;` start marker,
 * the `HEADER;` block (FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA), and the
 * `ENDSEC;` terminator. The caller is responsible for appending the DATA
 * section and the trailing `END-ISO-10303-21;` marker.
 */
export function writeStepHeader(opts: StepHeaderOptions = {}): string {
  const author = esc(opts.authorName ?? '');
  const org = esc(opts.organization ?? '');
  const desc = esc(opts.description ?? 'NexyFab Pro feature export');
  const filename = esc(opts.filename ?? 'nexyfab.step');
  const ts = esc(opts.timestamp ?? new Date().toISOString());

  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${desc}'),'2;1');`,
    `FILE_NAME('${filename}','${ts}',('${author}'),('${org}'),` +
      `'${NEXYFAB_APPLICATION}','${NEXYFAB_APPLICATION}','');`,
    `FILE_SCHEMA(('${AP214_SCHEMA}'));`,
    'ENDSEC;',
    '',
  ].join('\n');
}

// ─── id allocator + buffer ────────────────────────────────────────────────

/**
 * Allocates unique `#N` identifiers and accumulates entity lines.
 *
 * Each `add()` returns the ref string (`#42`) so callers can wire entities
 * together without manual bookkeeping. Numbering starts at 10 to leave room
 * for any header-tied refs callers might want to reserve manually.
 */
class StepBuilder {
  private next = 10;
  private lines: string[] = [];

  add(body: string): string {
    const id = this.next++;
    this.lines.push(`#${id}=${body};`);
    return `#${id}`;
  }

  /** All entity lines as a single newline-terminated string. */
  serialize(): string {
    return this.lines.join('\n') + '\n';
  }
}

// ─── DATA section primitives ──────────────────────────────────────────────

/** Cartesian point + line-curve + axis placements + 6 faces for a box. */
interface BoxGeometryRefs {
  /** MANIFOLD_SOLID_BREP ref — final geometry handle. */
  solid: string;
  /** SHAPE_REPRESENTATION-style geometric coordinate context. */
  geomContext: string;
  /** AXIS2_PLACEMENT_3D used for the SHAPE_REPRESENTATION origin. */
  worldAxis: string;
}

/** Emit all entity rows needed to describe an axis-aligned box from
 *  `(x0,y0,z0)` to `(x1,y1,z1)` and return the top-level refs to the solid
 *  and the geometric_representation_context it lives in. */
function emitBox(
  b: StepBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): BoxGeometryRefs {
  // 8 corners — index map for the 6 faces below.
  //
  //       v6───────v7
  //      /│       /│
  //     v4───────v5│
  //     │ v2─────│─v3
  //     │/       │/
  //     v0───────v1
  //
  // v0..v3 are the bottom (z=z0) ring CCW from (x0,y0), v4..v7 the top (z=z1).
  const cp = [
    b.add(`CARTESIAN_POINT('',(${fmt(x0)},${fmt(y0)},${fmt(z0)}))`), // v0
    b.add(`CARTESIAN_POINT('',(${fmt(x1)},${fmt(y0)},${fmt(z0)}))`), // v1
    b.add(`CARTESIAN_POINT('',(${fmt(x1)},${fmt(y1)},${fmt(z0)}))`), // v2
    b.add(`CARTESIAN_POINT('',(${fmt(x0)},${fmt(y1)},${fmt(z0)}))`), // v3
    b.add(`CARTESIAN_POINT('',(${fmt(x0)},${fmt(y0)},${fmt(z1)}))`), // v4
    b.add(`CARTESIAN_POINT('',(${fmt(x1)},${fmt(y0)},${fmt(z1)}))`), // v5
    b.add(`CARTESIAN_POINT('',(${fmt(x1)},${fmt(y1)},${fmt(z1)}))`), // v6
    b.add(`CARTESIAN_POINT('',(${fmt(x0)},${fmt(y1)},${fmt(z1)}))`), // v7
  ];

  const vp = cp.map((p) => b.add(`VERTEX_POINT('',${p})`));

  // 12 edges, each represented as EDGE_CURVE + LINE + VECTOR + DIRECTION +
  // start CARTESIAN_POINT (re-use the corner points). Edge index order:
  //   0..3 bottom ring, 4..7 top ring, 8..11 vertical risers.
  type Edge = { a: number; b: number };
  const edges: Edge[] = [
    { a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }, // bottom
    { a: 4, b: 5 }, { a: 5, b: 6 }, { a: 6, b: 7 }, { a: 7, b: 4 }, // top
    { a: 0, b: 4 }, { a: 1, b: 5 }, { a: 2, b: 6 }, { a: 3, b: 7 }, // risers
  ];

  const edgeCurves: string[] = [];
  for (const e of edges) {
    const pStart = cp[e.a]!;
    // Compute the start→end unit vector from the actual corner coords;
    // length > 0 is guaranteed because the bounding box is non-degenerate.
    const startCoords = corner(e.a, x0, y0, z0, x1, y1, z1);
    const endCoords = corner(e.b, x0, y0, z0, x1, y1, z1);
    const ux = endCoords[0] - startCoords[0];
    const uy = endCoords[1] - startCoords[1];
    const uz = endCoords[2] - startCoords[2];
    const length = Math.hypot(ux, uy, uz);
    const dxN = ux / length;
    const dyN = uy / length;
    const dzN = uz / length;
    const dirRef = b.add(`DIRECTION('',(${fmt(dxN)},${fmt(dyN)},${fmt(dzN)}))`);
    const vecRef = b.add(`VECTOR('',${dirRef},${fmt(length)})`);
    const lineRef = b.add(`LINE('',${pStart},${vecRef})`);
    const ecRef = b.add(`EDGE_CURVE('',${vp[e.a]!},${vp[e.b]!},${lineRef},.T.)`);
    edgeCurves.push(ecRef);
  }

  // Per face: 4 ORIENTED_EDGEs in CCW order (viewed from outside), wrapped
  // in EDGE_LOOP → FACE_OUTER_BOUND → ADVANCED_FACE w/ PLANE surface.
  //
  // Face index → edge index list (signed: positive means .T., negative .F.).
  // Edge index 0..11 maps to `edges[]` above.
  const faceEdgeSpecs: ReadonlyArray<ReadonlyArray<number>> = [
    [0, 9, -4, -8],   // -Y face (y=y0): v0→v1→v5→v4→v0  (outward normal -Y)
    [1, 10, -5, -9],  // +X face (x=x1): v1→v2→v6→v5→v1
    [2, 11, -6, -10], // +Y face (y=y1): v2→v3→v7→v6→v2
    [3, 8, -7, -11],  // -X face (x=x0): v3→v0→v4→v7→v3
    [-3, -2, -1, -0], // -Z bottom (z=z0): v0→v3→v2→v1→v0 (outward normal -Z)
    [4, 5, 6, 7],     // +Z top (z=z1): v4→v5→v6→v7→v4
  ];

  const faceNormals: ReadonlyArray<[number, number, number]> = [
    [0, -1, 0],
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, 0, -1],
    [0, 0, 1],
  ];

  // Each face needs an in-plane reference direction (the ref_direction of
  // AXIS2_PLACEMENT_3D). Pick any unit vector orthogonal to the normal.
  const faceRefDirs: ReadonlyArray<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ];

  // Each plane needs a point on it — pick the appropriate corner.
  const facePointIndex: ReadonlyArray<number> = [0, 1, 2, 3, 0, 4];

  const faceRefs: string[] = [];
  for (let f = 0; f < 6; f++) {
    const orientedEdges = faceEdgeSpecs[f]!.map((spec) => {
      // Distinguish 0 vs -0 by encoding sign with index 0 separately:
      // we use `spec === -0` test via Object.is.
      const isNegative = Object.is(spec, -0) || spec < 0;
      const idx = Math.abs(spec);
      const ec = edgeCurves[idx]!;
      return b.add(`ORIENTED_EDGE('',*,*,${ec},.${isNegative ? 'F' : 'T'}.)`);
    });
    const loopList = orientedEdges.join(',');
    const loop = b.add(`EDGE_LOOP('',(${loopList}))`);
    const outerBound = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);

    const normal = faceNormals[f]!;
    const refDir = faceRefDirs[f]!;
    const pIdx = facePointIndex[f]!;

    const planeNormalDir = b.add(`DIRECTION('',(${fmt(normal[0])},${fmt(normal[1])},${fmt(normal[2])}))`);
    const planeRefDir = b.add(`DIRECTION('',(${fmt(refDir[0])},${fmt(refDir[1])},${fmt(refDir[2])}))`);
    const planeAxis = b.add(`AXIS2_PLACEMENT_3D('',${cp[pIdx]!},${planeNormalDir},${planeRefDir})`);
    const plane = b.add(`PLANE('',${planeAxis})`);
    const face = b.add(`ADVANCED_FACE('',(${outerBound}),${plane},.T.)`);
    faceRefs.push(face);
  }

  const shell = b.add(`CLOSED_SHELL('',(${faceRefs.join(',')}))`);
  const solid = b.add(`MANIFOLD_SOLID_BREP('',${shell})`);

  // Global coordinate context for the shape representation.
  const originPt = b.add(`CARTESIAN_POINT('',(${fmt(0)},${fmt(0)},${fmt(0)}))`);
  const zDir = b.add(`DIRECTION('',(${fmt(0)},${fmt(0)},${fmt(1)}))`);
  const xDir = b.add(`DIRECTION('',(${fmt(1)},${fmt(0)},${fmt(0)}))`);
  const worldAxis = b.add(`AXIS2_PLACEMENT_3D('',${originPt},${zDir},${xDir})`);

  // Geometric representation context (length unit + angle unit + uncertainty).
  const lenUnit = b.add(
    `( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`,
  );
  const angUnit = b.add(
    `( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`,
  );
  const solidAngUnit = b.add(
    `( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )`,
  );
  const uncMag = b.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),${lenUnit},'distance_accuracy_value','confusion accuracy')`,
  );
  const geomContext = b.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) ` +
      `GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncMag})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenUnit},${angUnit},${solidAngUnit})) ` +
      `REPRESENTATION_CONTEXT('Context','3D') )`,
  );

  return { solid, geomContext, worldAxis };
}

/** Compute (x,y,z) coords of a box corner index 0..7. */
function corner(
  i: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): [number, number, number] {
  // Match emitBox's v0..v7 ordering above.
  const mapping: ReadonlyArray<[number, number, number]> = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  return mapping[i]!;
}

// ─── product / shape representation scaffolding ──────────────────────────

/**
 * Add the product-definition entities required by AP214 around a single
 * MANIFOLD_SOLID_BREP body, and return the top-level
 * ADVANCED_BREP_SHAPE_REPRESENTATION reference.
 */
function emitProductForSolid(
  b: StepBuilder,
  productName: string,
  refs: BoxGeometryRefs,
): { brepRep: string; productDef: string } {
  const appCtx = b.add(
    `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`,
  );
  b.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${appCtx})`);
  const prodCtx = b.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prodDefCtx = b.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const product = b.add(`PRODUCT('${esc(productName)}','${esc(productName)}','',(${prodCtx}))`);
  b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${product}))`);
  const formation = b.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${product},.NOT_KNOWN.)`,
  );
  const productDef = b.add(`PRODUCT_DEFINITION(' ','',${formation},${prodDefCtx})`);
  const productDefShape = b.add(`PRODUCT_DEFINITION_SHAPE('','',${productDef})`);

  const brepRep = b.add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(productName)}',(${refs.worldAxis},${refs.solid}),${refs.geomContext})`,
  );
  b.add(`SHAPE_DEFINITION_REPRESENTATION(${productDefShape},${brepRep})`);

  return { brepRep, productDef };
}

// ─── DATA section public API ──────────────────────────────────────────────

export interface StepEntitiesInput {
  /** One axis-aligned box per part. Coordinates in mm. */
  boxes: ReadonlyArray<{
    name: string;
    x0: number; y0: number; z0: number;
    x1: number; y1: number; z1: number;
  }>;
}

/**
 * Emit the `DATA;` section (entities + `ENDSEC;`) for a list of axis-aligned
 * boxes. Each box becomes a fully-wired MANIFOLD_SOLID_BREP with its own
 * PRODUCT / ADVANCED_BREP_SHAPE_REPRESENTATION envelope so that downstream
 * readers can pick them out as separate parts.
 *
 * Returns ONLY the DATA block — combine with `writeStepHeader` and the
 * trailing `END-ISO-10303-21;` marker to form a complete STEP file.
 */
export function writeStepEntities(input: StepEntitiesInput): string {
  if (input.boxes.length === 0) {
    throw new Error('writeStepEntities: at least one box is required');
  }
  const b = new StepBuilder();
  for (const box of input.boxes) {
    validateBoxNonDegenerate(box);
    const geom = emitBox(b, box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
    emitProductForSolid(b, box.name, geom);
  }
  return ['DATA;', b.serialize() + 'ENDSEC;', ''].join('\n');
}

function validateBoxNonDegenerate(box: {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}): void {
  if (box.x1 - box.x0 <= 0) throw new Error(`stepWrite: degenerate box X (x0=${box.x0}, x1=${box.x1})`);
  if (box.y1 - box.y0 <= 0) throw new Error(`stepWrite: degenerate box Y (y0=${box.y0}, y1=${box.y1})`);
  if (box.z1 - box.z0 <= 0) throw new Error(`stepWrite: degenerate box Z (z0=${box.z0}, z1=${box.z1})`);
}

// ─── ExtrudeFeature convenience ───────────────────────────────────────────

export interface ExtrudeToStepOptions extends StepHeaderOptions {
  /** Logical part name for the PRODUCT entity. Defaults to 'extrude'. */
  productName?: string;
}

/**
 * **BOX-ONLY** Phase 1 convenience: convert a single `ExtrudeFeature` into a
 * complete STEP file string.
 *
 * Approximation: the writer computes the loop's bounding box (minX,minY) →
 * (maxX,maxY) and extrudes that rectangle in +Z by `feature.depth`. The
 * actual sketch polygon is **not** preserved — see module-level JSDoc for
 * the full list of dropped features. Use this for envelope handoff only.
 */
export function writeExtrudeAsStep(
  feature: ExtrudeFeature,
  opts: ExtrudeToStepOptions = {},
): string {
  if (feature.kind !== 'extrude') {
    throw new Error(`writeExtrudeAsStep: expected kind='extrude', got '${(feature as { kind: string }).kind}'`);
  }
  if (feature.loop.length < 3) {
    throw new Error(`writeExtrudeAsStep: loop must have at least 3 points, got ${feature.loop.length}`);
  }
  if (!(feature.depth > 0) || !Number.isFinite(feature.depth)) {
    throw new Error(`writeExtrudeAsStep: depth must be positive, got ${feature.depth}`);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of feature.loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const header = writeStepHeader(opts);
  const data = writeStepEntities({
    boxes: [
      {
        name: opts.productName ?? 'extrude',
        x0: minX, y0: minY, z0: 0,
        x1: maxX, y1: maxY, z1: feature.depth,
      },
    ],
  });
  return `${header}${data}END-ISO-10303-21;\n`;
}

// ─── Assembly writer (Phase 2 hook) ───────────────────────────────────────

/**
 * Minimal-input descriptor for the assembly writer. Each part is still a
 * Phase 1 axis-aligned box (BOX-only limitation applies). For the Phase 2
 * worker integration these box bounds will be replaced by real B-rep refs.
 */
export interface AssemblyStepInput {
  /** Display name of the root assembly PRODUCT. */
  assemblyName: string;
  /** Child parts. Each becomes its own PRODUCT + MANIFOLD_SOLID_BREP plus
   *  a NEXT_ASSEMBLY_USAGE_OCCURRENCE tying it to the root assembly. */
  parts: ReadonlyArray<{
    /** Stable id used as the NAUO id and the PRODUCT name. */
    id: string;
    /** Human-readable display name (UI label). */
    name: string;
    x0: number; y0: number; z0: number;
    x1: number; y1: number; z1: number;
  }>;
}

/**
 * **BOX-ONLY** Phase 1 assembly writer. Emits a STEP file that contains:
 *   - one root PRODUCT + PRODUCT_DEFINITION for the assembly itself
 *   - one PRODUCT + PRODUCT_DEFINITION + MANIFOLD_SOLID_BREP per part
 *   - one NEXT_ASSEMBLY_USAGE_OCCURRENCE per (assembly, part) pair
 *
 * Phase 2 will add ITEM_DEFINED_TRANSFORMATION + CONTEXT_DEPENDENT_SHAPE_REPRESENTATION
 * so each instance can carry its world-frame placement. For Phase 1 every
 * child sits at world origin — the assembly is structural only.
 */
export function writeAssemblyAsStep(
  input: AssemblyStepInput,
  opts: StepHeaderOptions = {},
): string {
  if (input.parts.length === 0) {
    throw new Error('writeAssemblyAsStep: at least one part is required');
  }
  // Detect duplicate ids early — NAUOs require uniqueness per assembly.
  const seen = new Set<string>();
  for (const p of input.parts) {
    if (seen.has(p.id)) throw new Error(`writeAssemblyAsStep: duplicate part id '${p.id}'`);
    seen.add(p.id);
  }

  const b = new StepBuilder();

  // Shared application/context entities (one set for the whole file).
  const appCtx = b.add(
    `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`,
  );
  b.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${appCtx})`);
  const prodCtx = b.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prodDefCtx = b.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);

  // Root assembly product (no geometry — pure container).
  const asmName = esc(input.assemblyName);
  const asmProduct = b.add(`PRODUCT('${asmName}','${asmName}','',(${prodCtx}))`);
  b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('assembly','',(${asmProduct}))`);
  const asmFormation = b.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${asmProduct},.NOT_KNOWN.)`,
  );
  const asmDef = b.add(`PRODUCT_DEFINITION(' ','',${asmFormation},${prodDefCtx})`);

  // Per-part: geometry + product chain + NAUO.
  for (const part of input.parts) {
    validateBoxNonDegenerate(part);
    const geom = emitBox(b, part.x0, part.y0, part.z0, part.x1, part.y1, part.z1);

    const partName = esc(part.name);
    const partProduct = b.add(`PRODUCT('${esc(part.id)}','${partName}','',(${prodCtx}))`);
    b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${partProduct}))`);
    const partFormation = b.add(
      `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${partProduct},.NOT_KNOWN.)`,
    );
    const partDef = b.add(`PRODUCT_DEFINITION(' ','',${partFormation},${prodDefCtx})`);
    const partDefShape = b.add(`PRODUCT_DEFINITION_SHAPE('','',${partDef})`);
    const partRep = b.add(
      `ADVANCED_BREP_SHAPE_REPRESENTATION('${partName}',(${geom.worldAxis},${geom.solid}),${geom.geomContext})`,
    );
    b.add(`SHAPE_DEFINITION_REPRESENTATION(${partDefShape},${partRep})`);

    b.add(
      `NEXT_ASSEMBLY_USAGE_OCCURRENCE('${esc(part.id)}','${esc(part.id)}','',${asmDef},${partDef},$)`,
    );
  }

  const header = writeStepHeader(opts);
  const data = ['DATA;', b.serialize() + 'ENDSEC;', ''].join('\n');
  return `${header}${data}END-ISO-10303-21;\n`;
}

// ─── escape-hatch exports for tests / Phase 2 ────────────────────────────

/** Exposed for assembly writer / tests. Internal API; not stable. */
export const __internal = {
  StepBuilder,
  emitBox,
  emitProductForSolid,
  fmt,
  esc,
  AP214_SCHEMA,
  NEXYFAB_APPLICATION,
};
