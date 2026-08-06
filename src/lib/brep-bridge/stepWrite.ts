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

import type { ExtrudeFeature } from "@/lib/cad/extrudeProfile";

// ─── constants ────────────────────────────────────────────────────────────

/** Application string baked into FILE_NAME(originating_system). */
const NEXYFAB_APPLICATION = "NEXYFAB-PRO";

/** AP214 schema string — same FILE_SCHEMA value used by existing imports. */
const AP214_SCHEMA = "AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 1 }";

/**
 * Numeric formatting matches OCCT / NX style for STEP / AP214 REAL literals.
 *
 * Output rules:
 *   - Integers (whole numbers): emit `N.` with a single trailing dot to mark
 *     the literal as REAL — e.g. `1` → `'1.'`, `-2` → `'-2.'`, `100` → `'100.'`.
 *     (Without the dot, conformant parsers may interpret the token as INTEGER.)
 *   - Non-integers: emit the decimal form with trailing zeros trimmed and a
 *     single embedded `.` — e.g. `1.5` → `'1.5'`, `-0.529999` → `'-0.529999'`.
 *     There must NOT be a stray dot at the end after the trailing-zero trim
 *     (the previous implementation produced `'-0.529999.'`, which `stepImport`
 *     had to strip defensively — see `stepImport.parseSingleArg`).
 *   - Zero (incl. `-0`): emit `'0.'`.
 *   - Sub-resolution magnitudes that would collapse to `'0.'` under 6-decimal
 *     fixed formatting (|n| < 5e-7) are emitted in STEP exponential form,
 *     e.g. `1e-7` → `'1.E-7'`. STEP's Part 21 grammar accepts this and the
 *     existing UNCERTAINTY_MEASURE_WITH_UNIT row uses the same notation.
 *   - Values whose magnitude is too large for plain decimal at 6 decimals
 *     (|n| ≥ 1e15) also use exponential form for the same reason.
 *   - NaN / ±Infinity throw.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`stepWrite: non-finite number ${n}`);
  if (n === 0) return "0.";
  const abs = Math.abs(n);

  // Sub-resolution: 6-decimal toFixed would round to 0 and silently lose the
  // value. Fall back to STEP exponential form so the literal survives a
  // round-trip. (Threshold = 0.5 ULP at 6 decimals.)
  if (abs < 5e-7 || abs >= 1e15) {
    return toStepExponential(n);
  }

  const fixed = n.toFixed(6);
  if (!fixed.includes(".")) {
    // Defensive: toFixed(6) always includes a '.', but guard anyway so a
    // future refactor can't reintroduce the missing-dot regression.
    return `${fixed}.`;
  }
  // Strip trailing zeros from the fractional part.
  const trimmed = fixed.replace(/0+$/, "");
  // If everything after the '.' was zero, `trimmed` now ends with '.' — the
  // value is an integer and we keep the single trailing dot (REAL marker).
  // Otherwise (genuine fractional component) `trimmed` already ends in a
  // non-zero digit and MUST NOT have any dot appended.
  return trimmed;
}

/**
 * Convert a number to STEP Part 21 exponential REAL literal, e.g.
 * `1.E-7`, `-3.5E+12`. Mantissa always contains exactly one `.` and the
 * trailing-dot REAL marker, matching the existing `1.E-7` literal hard-
 * coded in the uncertainty entity.
 */
function toStepExponential(n: number): string {
  // toExponential always emits "d[.ddd]e±dd".
  const e = n.toExponential();
  const [mantRaw, expRaw] = e.split("e");
  const exp = Number.parseInt(expRaw!, 10);
  let mant = mantRaw!;
  if (!mant.includes(".")) {
    // Single-digit mantissa (e.g. "1"): append '.' so the literal is
    // unambiguously REAL ("1.E-7", not "1E-7").
    mant = `${mant}.`;
  } else {
    // Multi-digit mantissa (e.g. "1.5"): strip trailing fractional zeros —
    // a bare trailing '.' is fine as a REAL marker.
    mant = mant.replace(/0+$/, "");
  }
  return `${mant}E${exp >= 0 ? "+" : ""}${exp}`;
}

/** Escape a STEP string literal — single quote doubled, control chars stripped. */
function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/[\x00-\x1f]/g, " ");
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
  const author = esc(opts.authorName ?? "");
  const org = esc(opts.organization ?? "");
  const desc = esc(opts.description ?? "NexyFab Pro feature export");
  const filename = esc(opts.filename ?? "nexyfab.step");
  const ts = esc(opts.timestamp ?? new Date().toISOString());

  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('${desc}'),'2;1');`,
    `FILE_NAME('${filename}','${ts}',('${author}'),('${org}'),` +
      `'${NEXYFAB_APPLICATION}','${NEXYFAB_APPLICATION}','');`,
    `FILE_SCHEMA(('${AP214_SCHEMA}'));`,
    "ENDSEC;",
    "",
  ].join("\n");
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
    return this.lines.join("\n") + "\n";
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
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 0 }, // bottom
    { a: 4, b: 5 },
    { a: 5, b: 6 },
    { a: 6, b: 7 },
    { a: 7, b: 4 }, // top
    { a: 0, b: 4 },
    { a: 1, b: 5 },
    { a: 2, b: 6 },
    { a: 3, b: 7 }, // risers
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
    const ecRef = b.add(
      `EDGE_CURVE('',${vp[e.a]!},${vp[e.b]!},${lineRef},.T.)`,
    );
    edgeCurves.push(ecRef);
  }

  // Per face: 4 ORIENTED_EDGEs in CCW order (viewed from outside), wrapped
  // in EDGE_LOOP → FACE_OUTER_BOUND → ADVANCED_FACE w/ PLANE surface.
  //
  // Face index → edge index list (signed: positive means .T., negative .F.).
  // Edge index 0..11 maps to `edges[]` above.
  const faceEdgeSpecs: ReadonlyArray<ReadonlyArray<number>> = [
    [0, 9, -4, -8], // -Y face (y=y0): v0→v1→v5→v4→v0  (outward normal -Y)
    [1, 10, -5, -9], // +X face (x=x1): v1→v2→v6→v5→v1
    [2, 11, -6, -10], // +Y face (y=y1): v2→v3→v7→v6→v2
    [3, 8, -7, -11], // -X face (x=x0): v3→v0→v4→v7→v3
    [-3, -2, -1, -0], // -Z bottom (z=z0): v0→v3→v2→v1→v0 (outward normal -Z)
    [4, 5, 6, 7], // +Z top (z=z1): v4→v5→v6→v7→v4
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
      return b.add(`ORIENTED_EDGE('',*,*,${ec},.${isNegative ? "F" : "T"}.)`);
    });
    const loopList = orientedEdges.join(",");
    const loop = b.add(`EDGE_LOOP('',(${loopList}))`);
    const outerBound = b.add(`FACE_OUTER_BOUND('',${loop},.T.)`);

    const normal = faceNormals[f]!;
    const refDir = faceRefDirs[f]!;
    const pIdx = facePointIndex[f]!;

    const planeNormalDir = b.add(
      `DIRECTION('',(${fmt(normal[0])},${fmt(normal[1])},${fmt(normal[2])}))`,
    );
    const planeRefDir = b.add(
      `DIRECTION('',(${fmt(refDir[0])},${fmt(refDir[1])},${fmt(refDir[2])}))`,
    );
    const planeAxis = b.add(
      `AXIS2_PLACEMENT_3D('',${cp[pIdx]!},${planeNormalDir},${planeRefDir})`,
    );
    const plane = b.add(`PLANE('',${planeAxis})`);
    const face = b.add(`ADVANCED_FACE('',(${outerBound}),${plane},.T.)`);
    faceRefs.push(face);
  }

  const shell = b.add(`CLOSED_SHELL('',(${faceRefs.join(",")}))`);
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
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
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
  b.add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${appCtx})`,
  );
  const prodCtx = b.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prodDefCtx = b.add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`,
  );
  const product = b.add(
    `PRODUCT('${esc(productName)}','${esc(productName)}','',(${prodCtx}))`,
  );
  b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${product}))`);
  const formation = b.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${product},.NOT_KNOWN.)`,
  );
  const productDef = b.add(
    `PRODUCT_DEFINITION(' ','',${formation},${prodDefCtx})`,
  );
  const productDefShape = b.add(
    `PRODUCT_DEFINITION_SHAPE('','',${productDef})`,
  );

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
    x0: number;
    y0: number;
    z0: number;
    x1: number;
    y1: number;
    z1: number;
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
    throw new Error("writeStepEntities: at least one box is required");
  }
  const b = new StepBuilder();
  for (const box of input.boxes) {
    validateBoxNonDegenerate(box);
    const geom = emitBox(b, box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
    emitProductForSolid(b, box.name, geom);
  }
  return ["DATA;", b.serialize() + "ENDSEC;", ""].join("\n");
}

function validateBoxNonDegenerate(box: {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}): void {
  if (box.x1 - box.x0 <= 0)
    throw new Error(`stepWrite: degenerate box X (x0=${box.x0}, x1=${box.x1})`);
  if (box.y1 - box.y0 <= 0)
    throw new Error(`stepWrite: degenerate box Y (y0=${box.y0}, y1=${box.y1})`);
  if (box.z1 - box.z0 <= 0)
    throw new Error(`stepWrite: degenerate box Z (z0=${box.z0}, z1=${box.z1})`);
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
  if (feature.kind !== "extrude") {
    throw new Error(
      `writeExtrudeAsStep: expected kind='extrude', got '${(feature as { kind: string }).kind}'`,
    );
  }
  if (feature.loop.length < 3) {
    throw new Error(
      `writeExtrudeAsStep: loop must have at least 3 points, got ${feature.loop.length}`,
    );
  }
  if (!(feature.depth > 0) || !Number.isFinite(feature.depth)) {
    throw new Error(
      `writeExtrudeAsStep: depth must be positive, got ${feature.depth}`,
    );
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
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
        name: opts.productName ?? "extrude",
        x0: minX,
        y0: minY,
        z0: 0,
        x1: maxX,
        y1: maxY,
        z1: feature.depth,
      },
    ],
  });
  return `${header}${data}END-ISO-10303-21;\n`;
}

// ─── Polygon-profile extrude (Phase 5.1) ──────────────────────────────────
//
// Extension of the BOX-only writer to handle arbitrary CONVEX polygon
// profiles (any vertex count N ≥ 3). The emitted entity graph follows the
// same AP214 envelope as `emitBox`, but topology scales with N:
//
//     - 2N VERTEX_POINTs            (N bottom @ z=0, N top @ z=depth)
//     - 3N EDGE_CURVEs              (N bottom ring + N top ring + N risers)
//     - N + 2 ADVANCED_FACEs        (N rectangular sides + 1 top + 1 bottom)
//
// Each side face is the strip bounded by 2 vertical riser edges and the
// matching bottom/top polygon edge — its surface PLANE is normal to
// `edgeDir × Z` (outward when the loop is CCW). Top/bottom faces use the
// usual +Z / -Z plane normals.
//
// Phase 1 limit: concave loops (interior angle > 180° at any vertex) and
// self-intersecting loops fall back to bbox via `writeExtrudeAsStep`.
// Holes (multi-loop) still require Phase 2 OCCT.

/** Signed area of a 2D polygon (CCW positive, CW negative). */
function signedArea2D(loop: ReadonlyArray<{ x: number; y: number }>): number {
  let s = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Convexity test: a polygon is convex when every consecutive cross product
 * (edge_i × edge_{i+1}) shares the same sign. A sign flip means an interior
 * angle exceeded 180° (i.e. a reflex/concave vertex).
 */
function isConvexLoop(loop: ReadonlyArray<{ x: number; y: number }>): boolean {
  const n = loop.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    const c = loop[(i + 2) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-12) continue; // collinear vertex — ignore
    if (sign === 0) sign = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

/**
 * Cheap self-intersection check: O(N^2) pairwise segment-segment test on
 * non-adjacent edges. Fine for small N (typical sketch polygons < 64 verts).
 * Returns true iff any two non-adjacent edges properly cross.
 */
function hasSelfIntersection(
  loop: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a1 = loop[i]!;
    const a2 = loop[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Skip the same edge and the two edges adjacent to edge i (they share
      // an endpoint, so they "touch" but don't cross).
      if (j === i) continue;
      if ((j + 1) % n === i) continue;
      if ((i + 1) % n === j) continue;
      const b1 = loop[j]!;
      const b2 = loop[(j + 1) % n]!;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Proper segment-segment intersection (excludes touching endpoints). */
function segmentsCross(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

function orient(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Classification of a sketch loop for the polygon writer. */
export type PolygonLoopClassification =
  | { kind: "convex" }
  | { kind: "concave"; reason: "reflex vertex" }
  | { kind: "self_intersecting" }
  | { kind: "degenerate"; reason: string };

/**
 * Inspect a loop and decide whether the polygon writer can render it as-is
 * or whether the caller should fall back to the bounding-box writer.
 *
 * Caller contract: `convex` → safe for `emitPolygonExtrude`. Anything else
 * is the bbox-fallback path.
 */
export function classifyPolygonLoop(
  loop: ReadonlyArray<{ x: number; y: number }>,
): PolygonLoopClassification {
  if (loop.length < 3)
    return { kind: "degenerate", reason: "fewer than 3 points" };
  // Self-intersection check first: a bowtie has zero signed area but should
  // be reported as crossing edges (its actual failure mode), not "degenerate".
  if (hasSelfIntersection(loop)) return { kind: "self_intersecting" };
  const area = signedArea2D(loop);
  if (Math.abs(area) < 1e-9) return { kind: "degenerate", reason: "zero area" };
  if (!isConvexLoop(loop)) return { kind: "concave", reason: "reflex vertex" };
  return { kind: "convex" };
}

/**
 * Emit all entity rows needed to describe a prismatic polygon extrude
 * (CCW convex loop, depth in +Z). Returns refs that mirror `emitBox`.
 *
 * Pre-conditions (caller-enforced):
 *   - `loop` is convex, non-self-intersecting, has ≥ 3 distinct vertices
 *   - vertices are CCW (positive signed area)
 *   - depth > 0
 */
function emitPolygonExtrude(
  b: StepBuilder,
  loop: ReadonlyArray<{ x: number; y: number }>,
  depth: number,
): BoxGeometryRefs {
  const n = loop.length;

  // 2N CARTESIAN_POINTs: bottom ring [0..n) then top ring [n..2n).
  const cp: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i]!;
    cp.push(b.add(`CARTESIAN_POINT('',(${fmt(p.x)},${fmt(p.y)},${fmt(0)}))`));
  }
  for (let i = 0; i < n; i++) {
    const p = loop[i]!;
    cp.push(
      b.add(`CARTESIAN_POINT('',(${fmt(p.x)},${fmt(p.y)},${fmt(depth)}))`),
    );
  }

  const vp = cp.map((p) => b.add(`VERTEX_POINT('',${p})`));

  // 3N edges:
  //   bottom[i] = vertex i  → vertex (i+1) mod n          (indices 0..n-1)
  //   top[i]    = vertex n+i → vertex n+((i+1) mod n)     (indices n..2n-1)
  //   riser[i]  = vertex i  → vertex n+i                  (indices 2n..3n-1)
  type Edge = { a: number; b: number };
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) edges.push({ a: i, b: (i + 1) % n });
  for (let i = 0; i < n; i++) edges.push({ a: n + i, b: n + ((i + 1) % n) });
  for (let i = 0; i < n; i++) edges.push({ a: i, b: n + i });

  const edgeCurves: string[] = [];
  for (const e of edges) {
    const pStart = cp[e.a]!;
    const startCoords = vertexCoords(e.a, loop, depth);
    const endCoords = vertexCoords(e.b, loop, depth);
    const ux = endCoords[0] - startCoords[0];
    const uy = endCoords[1] - startCoords[1];
    const uz = endCoords[2] - startCoords[2];
    const length = Math.hypot(ux, uy, uz);
    if (length <= 0) throw new Error("emitPolygonExtrude: zero-length edge");
    const dxN = ux / length;
    const dyN = uy / length;
    const dzN = uz / length;
    const dirRef = b.add(`DIRECTION('',(${fmt(dxN)},${fmt(dyN)},${fmt(dzN)}))`);
    const vecRef = b.add(`VECTOR('',${dirRef},${fmt(length)})`);
    const lineRef = b.add(`LINE('',${pStart},${vecRef})`);
    const ecRef = b.add(
      `EDGE_CURVE('',${vp[e.a]!},${vp[e.b]!},${lineRef},.T.)`,
    );
    edgeCurves.push(ecRef);
  }

  // Edge index helpers.
  const botEdge = (i: number) => i; // 0..n-1
  const topEdge = (i: number) => n + i; // n..2n-1
  const riserEdge = (i: number) => 2 * n + i; // 2n..3n-1

  const faceRefs: string[] = [];

  // ─── Side faces ────────────────────────────────────────────────────────
  // For side i (between vertex i and vertex (i+1)%n), the outward edge loop
  // (viewed from outside the solid, CCW) is:
  //
  //     bot[i] (+)  →  riser[(i+1)%n] (+)  →  top[i] (-)  →  riser[i] (-)
  //
  // Surface normal = (edgeDir2D × Z) for a CCW polygon — outward-pointing.
  for (let i = 0; i < n; i++) {
    const iNext = (i + 1) % n;
    const orientedEdges = [
      b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[botEdge(i)]!},.T.)`),
      b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[riserEdge(iNext)]!},.T.)`),
      b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[topEdge(i)]!},.F.)`),
      b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[riserEdge(i)]!},.F.)`),
    ];
    const loopRef = b.add(`EDGE_LOOP('',(${orientedEdges.join(",")}))`);
    const outerBound = b.add(`FACE_OUTER_BOUND('',${loopRef},.T.)`);

    const a = loop[i]!;
    const c = loop[iNext]!;
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const eLen = Math.hypot(ex, ey);
    // Outward normal for CCW loop = edgeDir × +Z = (ey, -ex, 0) / |edge|.
    const nx = ey / eLen;
    const ny = -ex / eLen;
    // In-plane reference direction = the edge direction itself (unit).
    const rx = ex / eLen;
    const ry = ey / eLen;

    const planeNormalDir = b.add(
      `DIRECTION('',(${fmt(nx)},${fmt(ny)},${fmt(0)}))`,
    );
    const planeRefDir = b.add(
      `DIRECTION('',(${fmt(rx)},${fmt(ry)},${fmt(0)}))`,
    );
    const planeAxis = b.add(
      `AXIS2_PLACEMENT_3D('',${cp[i]!},${planeNormalDir},${planeRefDir})`,
    );
    const plane = b.add(`PLANE('',${planeAxis})`);
    const face = b.add(`ADVANCED_FACE('',(${outerBound}),${plane},.T.)`);
    faceRefs.push(face);
  }

  // ─── Bottom face (z=0, outward normal -Z) ──────────────────────────────
  // Walk the bottom ring CW (i.e. reversed) so the loop is CCW from below.
  {
    const orientedEdges: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      orientedEdges.push(
        b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[botEdge(i)]!},.F.)`),
      );
    }
    const loopRef = b.add(`EDGE_LOOP('',(${orientedEdges.join(",")}))`);
    const outerBound = b.add(`FACE_OUTER_BOUND('',${loopRef},.T.)`);
    const planeNormalDir = b.add(
      `DIRECTION('',(${fmt(0)},${fmt(0)},${fmt(-1)}))`,
    );
    const planeRefDir = b.add(`DIRECTION('',(${fmt(1)},${fmt(0)},${fmt(0)}))`);
    const planeAxis = b.add(
      `AXIS2_PLACEMENT_3D('',${cp[0]!},${planeNormalDir},${planeRefDir})`,
    );
    const plane = b.add(`PLANE('',${planeAxis})`);
    const face = b.add(`ADVANCED_FACE('',(${outerBound}),${plane},.T.)`);
    faceRefs.push(face);
  }

  // ─── Top face (z=depth, outward normal +Z) ─────────────────────────────
  // Walk the top ring CCW.
  {
    const orientedEdges: string[] = [];
    for (let i = 0; i < n; i++) {
      orientedEdges.push(
        b.add(`ORIENTED_EDGE('',*,*,${edgeCurves[topEdge(i)]!},.T.)`),
      );
    }
    const loopRef = b.add(`EDGE_LOOP('',(${orientedEdges.join(",")}))`);
    const outerBound = b.add(`FACE_OUTER_BOUND('',${loopRef},.T.)`);
    const planeNormalDir = b.add(
      `DIRECTION('',(${fmt(0)},${fmt(0)},${fmt(1)}))`,
    );
    const planeRefDir = b.add(`DIRECTION('',(${fmt(1)},${fmt(0)},${fmt(0)}))`);
    const planeAxis = b.add(
      `AXIS2_PLACEMENT_3D('',${cp[n]!},${planeNormalDir},${planeRefDir})`,
    );
    const plane = b.add(`PLANE('',${planeAxis})`);
    const face = b.add(`ADVANCED_FACE('',(${outerBound}),${plane},.T.)`);
    faceRefs.push(face);
  }

  const shell = b.add(`CLOSED_SHELL('',(${faceRefs.join(",")}))`);
  const solid = b.add(`MANIFOLD_SOLID_BREP('',${shell})`);

  // Geometric representation context (mirrors emitBox).
  const originPt = b.add(`CARTESIAN_POINT('',(${fmt(0)},${fmt(0)},${fmt(0)}))`);
  const zDir = b.add(`DIRECTION('',(${fmt(0)},${fmt(0)},${fmt(1)}))`);
  const xDir = b.add(`DIRECTION('',(${fmt(1)},${fmt(0)},${fmt(0)}))`);
  const worldAxis = b.add(`AXIS2_PLACEMENT_3D('',${originPt},${zDir},${xDir})`);

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

function vertexCoords(
  i: number,
  loop: ReadonlyArray<{ x: number; y: number }>,
  depth: number,
): [number, number, number] {
  const n = loop.length;
  const isTop = i >= n;
  const idx = isTop ? i - n : i;
  const p = loop[idx]!;
  return [p.x, p.y, isTop ? depth : 0];
}

// ─── Polygon writer public API ────────────────────────────────────────────

export interface PolygonExtrudeOptions extends ExtrudeToStepOptions {
  /**
   * Hook for callers that want to observe (or fail loudly on) bbox fallback.
   * Default: log to console.warn.
   */
  onFallback?: (info: {
    reason: PolygonLoopClassification["kind"];
    detail: string;
  }) => void;
}

/**
 * Phase 5.1 polygon extrude writer. Emits a STEP file whose B-rep matches
 * the actual N-vertex CCW convex profile (not the bounding box).
 *
 * Fallback policy:
 *   - concave (reflex vertex) → bbox fallback via `writeExtrudeAsStep`
 *   - self-intersecting       → bbox fallback
 *   - degenerate (<3 pts, 0 area) → throws (same as the box writer)
 *
 * Fallbacks trigger `opts.onFallback` (defaults to console.warn) so callers
 * can detect when geometry was downgraded.
 */
export function writeExtrudePolygonAsStep(
  feature: ExtrudeFeature,
  opts: PolygonExtrudeOptions = {},
): string {
  if (feature.kind !== "extrude") {
    throw new Error(
      `writeExtrudePolygonAsStep: expected kind='extrude', got '${(feature as { kind: string }).kind}'`,
    );
  }
  if (feature.loop.length < 3) {
    throw new Error(
      `writeExtrudePolygonAsStep: loop must have at least 3 points, got ${feature.loop.length}`,
    );
  }
  if (!(feature.depth > 0) || !Number.isFinite(feature.depth)) {
    throw new Error(
      `writeExtrudePolygonAsStep: depth must be positive, got ${feature.depth}`,
    );
  }

  const classification = classifyPolygonLoop(feature.loop);
  if (classification.kind !== "convex") {
    const reason = classification.kind;
    const detail =
      classification.kind === "concave"
        ? classification.reason
        : classification.kind === "degenerate"
          ? classification.reason
          : "edges cross";
    const onFallback = opts.onFallback ?? defaultFallbackWarn;
    onFallback({ reason, detail });
    return writeExtrudeAsStep(feature, opts);
  }

  // Ensure CCW (positive signed area). If input is CW, reverse so emit*
  // sees the canonical orientation it expects.
  const loop: ReadonlyArray<{ x: number; y: number }> =
    signedArea2D(feature.loop) >= 0
      ? feature.loop
      : [...feature.loop].reverse();

  const b = new StepBuilder();
  const geom = emitPolygonExtrude(b, loop, feature.depth);
  emitProductForSolid(b, opts.productName ?? "extrude", geom);

  const header = writeStepHeader(opts);
  const data = ["DATA;", b.serialize() + "ENDSEC;", ""].join("\n");
  return `${header}${data}END-ISO-10303-21;\n`;
}

function defaultFallbackWarn(info: { reason: string; detail: string }): void {
  console.warn(
    `[stepWrite] polygon writer fallback → bbox: ${info.reason} (${info.detail})`,
  );
}

// ─── Assembly writer (Phase 2 hook) ───────────────────────────────────────

/**
 * Minimal-input descriptor for the assembly writer. Each part is either a
 * Phase 1 axis-aligned box OR (Phase 5.1) a polygon-profile extrude.
 *
 * For Phase 2 worker integration these will be replaced by real B-rep refs.
 */
export type AssemblyPart =
  | {
      kind?: "box";
      /** Stable id used as the NAUO id and the PRODUCT name. */
      id: string;
      /** Human-readable display name (UI label). */
      name: string;
      x0: number;
      y0: number;
      z0: number;
      x1: number;
      y1: number;
      z1: number;
    }
  | {
      kind: "polygon";
      id: string;
      name: string;
      /** CCW (or CW — auto-corrected) profile loop. */
      loop: ReadonlyArray<{ x: number; y: number }>;
      /** Extrude depth in +Z (mm). */
      depth: number;
    }
  | {
      kind: "multi_body";
      id: string;
      name: string;
      bodies: ReadonlyArray<{
        x0: number;
        y0: number;
        z0: number;
        x1: number;
        y1: number;
        z1: number;
      }>;
    };

export interface AssemblyStepInput {
  /** Display name of the root assembly PRODUCT. */
  assemblyName: string;
  /** Child parts. Each becomes its own PRODUCT + MANIFOLD_SOLID_BREP plus
   *  a NEXT_ASSEMBLY_USAGE_OCCURRENCE tying it to the root assembly. */
  parts: ReadonlyArray<AssemblyPart>;
}

/**
 * Phase 1 / 5.1 assembly writer. Emits a STEP file that contains:
 *   - one root PRODUCT + PRODUCT_DEFINITION for the assembly itself
 *   - one PRODUCT + PRODUCT_DEFINITION + MANIFOLD_SOLID_BREP per part
 *   - one NEXT_ASSEMBLY_USAGE_OCCURRENCE per (assembly, part) pair
 *
 * Each part may be either an axis-aligned BOX (Phase 1) or a polygon-
 * profile extrude (Phase 5.1 — convex CCW loops only; concave / self-
 * intersecting loops fall back to bbox with `opts.onFallback`).
 *
 * Phase 2 will add ITEM_DEFINED_TRANSFORMATION + CONTEXT_DEPENDENT_SHAPE_REPRESENTATION
 * so each instance can carry its world-frame placement. For now every
 * child sits at world origin — the assembly is structural only.
 */
export interface AssemblyStepOptions extends StepHeaderOptions {
  /**
   * Optional hook fired when a polygon-part falls back to bbox geometry.
   * Defaults to `console.warn`.
   */
  onFallback?: (info: {
    partId: string;
    reason: PolygonLoopClassification["kind"];
    detail: string;
  }) => void;
}

export function writeAssemblyAsStep(
  input: AssemblyStepInput,
  opts: AssemblyStepOptions = {},
): string {
  if (input.parts.length === 0) {
    throw new Error("writeAssemblyAsStep: at least one part is required");
  }
  // Detect duplicate ids early — NAUOs require uniqueness per assembly.
  const seen = new Set<string>();
  for (const p of input.parts) {
    if (seen.has(p.id))
      throw new Error(`writeAssemblyAsStep: duplicate part id '${p.id}'`);
    seen.add(p.id);
  }

  const b = new StepBuilder();

  // Shared application/context entities (one set for the whole file).
  const appCtx = b.add(
    `APPLICATION_CONTEXT('core data for automotive mechanical design processes')`,
  );
  b.add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${appCtx})`,
  );
  const prodCtx = b.add(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const prodDefCtx = b.add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`,
  );

  // Root assembly product (no geometry — pure container).
  const asmName = esc(input.assemblyName);
  const asmProduct = b.add(
    `PRODUCT('${asmName}','${asmName}','',(${prodCtx}))`,
  );
  b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('assembly','',(${asmProduct}))`);
  const asmFormation = b.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${asmProduct},.NOT_KNOWN.)`,
  );
  const asmDef = b.add(
    `PRODUCT_DEFINITION(' ','',${asmFormation},${prodDefCtx})`,
  );

  // Per-part: geometry + product chain + NAUO.
  for (const part of input.parts) {
    const geometries =
      part.kind === "multi_body"
        ? part.bodies.map((body) =>
            emitBox(b, body.x0, body.y0, body.z0, body.x1, body.y1, body.z1),
          )
        : [emitGeometryForPart(b, part, opts)];
    if (geometries.length < 2 && part.kind === "multi_body") {
      throw new Error(
        `writeAssemblyAsStep: multi-body part '${part.id}' requires at least two bodies`,
      );
    }
    const geom = geometries[0]!;

    const partName = esc(part.name);
    const partProduct = b.add(
      `PRODUCT('${esc(part.id)}','${partName}','',(${prodCtx}))`,
    );
    b.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(${partProduct}))`);
    const partFormation = b.add(
      `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',${partProduct},.NOT_KNOWN.)`,
    );
    const partDef = b.add(
      `PRODUCT_DEFINITION(' ','',${partFormation},${prodDefCtx})`,
    );
    const partDefShape = b.add(`PRODUCT_DEFINITION_SHAPE('','',${partDef})`);
    const partRep = b.add(
      `ADVANCED_BREP_SHAPE_REPRESENTATION('${partName}',(${geom.worldAxis},${geometries.map((item) => item.solid).join(",")}),${geom.geomContext})`,
    );
    b.add(`SHAPE_DEFINITION_REPRESENTATION(${partDefShape},${partRep})`);

    b.add(
      `NEXT_ASSEMBLY_USAGE_OCCURRENCE('${esc(part.id)}','${esc(part.id)}','',${asmDef},${partDef},$)`,
    );
  }

  const header = writeStepHeader(opts);
  const data = ["DATA;", b.serialize() + "ENDSEC;", ""].join("\n");
  return `${header}${data}END-ISO-10303-21;\n`;
}

/**
 * Dispatch a single AssemblyPart to the appropriate geometry emitter, with
 * the polygon → bbox fallback policy applied in-line so the assembly
 * remains a single STEP file (no partial output on fallback).
 */
function emitGeometryForPart(
  b: StepBuilder,
  part: AssemblyPart,
  opts: AssemblyStepOptions,
): BoxGeometryRefs {
  if (part.kind === "multi_body") {
    throw new Error(
      "writeAssemblyAsStep: multi-body geometry must be emitted as a group",
    );
  }
  if (part.kind === "polygon") {
    if (part.loop.length < 3) {
      throw new Error(
        `writeAssemblyAsStep: polygon part '${part.id}' loop must have ≥ 3 points`,
      );
    }
    if (!(part.depth > 0) || !Number.isFinite(part.depth)) {
      throw new Error(
        `writeAssemblyAsStep: polygon part '${part.id}' depth must be positive`,
      );
    }
    const cls = classifyPolygonLoop(part.loop);
    if (cls.kind === "convex") {
      const loop =
        signedArea2D(part.loop) >= 0 ? part.loop : [...part.loop].reverse();
      return emitPolygonExtrude(b, loop, part.depth);
    }
    if (cls.kind === "degenerate") {
      throw new Error(
        `writeAssemblyAsStep: polygon part '${part.id}' is degenerate (${cls.reason})`,
      );
    }
    // Concave or self-intersecting → bbox fallback.
    const detail = cls.kind === "concave" ? cls.reason : "edges cross";
    const onFallback =
      opts.onFallback ??
      ((info) =>
        console.warn(
          `[stepWrite] assembly part '${info.partId}' polygon → bbox fallback: ${info.reason} (${info.detail})`,
        ));
    onFallback({ partId: part.id, reason: cls.kind, detail });
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of part.loop) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return emitBox(b, minX, minY, 0, maxX, maxY, part.depth);
  }
  validateBoxNonDegenerate(part);
  return emitBox(b, part.x0, part.y0, part.z0, part.x1, part.y1, part.z1);
}

// ─── escape-hatch exports for tests / Phase 2 ────────────────────────────

/** Exposed for assembly writer / tests. Internal API; not stable. */
export const __internal = {
  StepBuilder,
  emitBox,
  emitPolygonExtrude,
  emitProductForSolid,
  fmt,
  esc,
  signedArea2D,
  isConvexLoop,
  hasSelfIntersection,
  AP214_SCHEMA,
  NEXYFAB_APPLICATION,
};
