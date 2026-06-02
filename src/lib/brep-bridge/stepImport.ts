/**
 * stepImport — Phase 5.2 PURE-TS STEP (ISO 10303-21) reader for NexyFab Pro.
 *
 * SCOPE
 * -----
 * Inverse of `stepWrite.ts`. Given a STEP AP214 / AP203 / AP242 source string,
 * walks the entity graph and reconstructs a `FeatureTree` whose nodes are
 * `ExtrudeFeature` IRs. The Phase 1 scope mirrors what `stepWrite.ts` is able
 * to emit:
 *
 *   1. Axis-aligned BOX  →  rectangular 4-vertex `ExtrudeFeature` (the loop is
 *      the bbox in XY, depth = Z extent).
 *   2. Convex polygon PRISM (N side faces + 2 cap faces with ±Z normals)  →
 *      N-vertex `ExtrudeFeature` (loop = bottom cap polygon, depth = z1 - z0).
 *
 * Any other solid (curved surfaces, revolutions, lofts, swept profiles,
 * fillets, drafts, multi-loop faces with inner bounds, non-planar caps) is
 * SKIPPED and reported via the `unsupported` channel — it does NOT abort the
 * whole import. The caller can surface those in the UI ("3 of 5 solids
 * imported; 2 require Phase 2 OCCT B-rep round-trip").
 *
 * PIPELINE
 * --------
 *   source
 *     ↓  healStepSource             (encoding, line endings, missing END-ISO)
 *     ↓  parseEntities              (regex tokenize → Map<id, Entity>)
 *     ↓  for each MANIFOLD_SOLID_BREP
 *         ↓  collect CLOSED_SHELL → ADVANCED_FACE[]
 *         ↓  classify (box | polygon_prism | unsupported)
 *         ↓  emit ExtrudeFeature  +  FeatureNode
 *   FeatureTree
 *
 * DESIGN
 * ------
 * - No worker calls, no native deps. Pure regex + graph walk.
 * - Best-effort: an unparseable solid never aborts the entire file; it ends
 *   up on `unsupported` with a human-readable reason.
 * - Tolerances: vertex deduplication and axis-alignment checks use absolute
 *   tolerances tuned for mm-scale models (`POINT_EPS = 1e-6 mm`,
 *   `AXIS_EPS = 1e-4` for unit-vector components). Reasonable for hand-edited
 *   or round-tripped files; insufficient for sub-micron precision parts.
 *
 * PHASE 2 WISHLIST (NOT implemented in this module)
 * -------------------------------------------------
 *   - BSPLINE_SURFACE_WITH_KNOTS / RATIONAL_B_SPLINE_SURFACE
 *   - CYLINDRICAL_SURFACE / CONICAL_SURFACE / SPHERICAL_SURFACE /
 *     TOROIDAL_SURFACE (parametric primitives)
 *   - SURFACE_OF_REVOLUTION / SURFACE_OF_LINEAR_EXTRUSION when the basis
 *     curve is non-trivial
 *   - REVOLVED_AREA_SOLID / SWEPT_AREA_SOLID / SWEPT_DISK_SOLID (revolve /
 *     sweep IRs in `revolveProfile.ts` / `sweepLoft.ts`)
 *   - FACE_BOUND with inner-loop holes (HOLE feature IR exists)
 *   - FILLETED_EDGE / CHAMFERED_EDGE annotations  →  fillet/chamfer IRs
 *   - Concave polygon prisms (Phase 1 only verifies cap == cap; concave caps
 *     work geometrically but our writer only emits convex, so import treats
 *     them as best-effort polygon prisms)
 *   - Instance placement via NEXT_ASSEMBLY_USAGE_OCCURRENCE +
 *     ITEM_DEFINED_TRANSFORMATION (currently every solid lands at world
 *     origin regardless of any transform chain)
 *   - Units other than mm — the importer reads geometry as-is; callers
 *     should pre-scale using `detectStepUnits` if a non-mm file is involved
 *
 * Spec reference: ISO 10303-21 (clear-text encoding) and the Part 42 /
 * Part 514 application objects used by AP214 / AP242.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import { healStepSource } from './stepRead';

// ─── tolerances ───────────────────────────────────────────────────────────

/** Two CARTESIAN_POINTs are considered equal within this absolute distance (mm). */
const POINT_EPS = 1e-6;
/** A unit-vector component is considered "0" or "±1" within this tolerance. */
const AXIS_EPS = 1e-4;

// ─── public API ───────────────────────────────────────────────────────────

export interface StepImportResult {
  /** Reconstructed feature tree; one FeatureNode per MANIFOLD_SOLID_BREP we
   *  could classify (box / convex polygon prism). Empty when no solids
   *  were recognised. */
  tree: FeatureTree;
  /** Non-fatal advisories surfaced during parsing or healing (e.g. line
   *  endings normalised, missing END-ISO appended, CLOSED_SHELL not found). */
  warnings: string[];
  /** Per-solid skips: one entry per MANIFOLD_SOLID_BREP whose geometry the
   *  Phase 1 importer cannot represent (curved surfaces, revolves, holes,
   *  etc). Format: `"#<solid_id>: <reason>"`. */
  unsupported: string[];
}

export interface ImportStepOptions {
  /** Override naming prefix for the FeatureNode id / display name. */
  namePrefix?: string;
}

/**
 * Read a STEP source string and reconstruct a FeatureTree of supported
 * extrude features. Returns `{ tree, warnings, unsupported }`; throws only
 * when the source is unparseable (empty, missing DATA section, malformed
 * entity table) — recoverable per-solid issues are routed to `unsupported`.
 */
export function importStep(
  source: string,
  opts: ImportStepOptions = {},
): StepImportResult {
  if (typeof source !== 'string' || source.length === 0) {
    throw new StepImportError('empty_source: STEP source is empty');
  }

  const warnings: string[] = [];
  const unsupported: string[] = [];

  // Run the same pre-processor the writer pipeline uses. Surface any auto-
  // fixes as warnings so the caller can decide whether to log / show them.
  const heal = healStepSource(source);
  for (const fix of heal.appliedFixes) {
    warnings.push(`heal:${fix}`);
  }
  const healed = heal.healed;

  // Slice out the DATA section. Without it there's nothing to parse.
  const dataIdx = healed.search(/\bDATA\s*;/i);
  if (dataIdx < 0) {
    throw new StepImportError('no_data_section: missing DATA; section');
  }
  const endIdx = healed.indexOf('END-ISO-10303-21');
  const dataBlock = healed.slice(
    dataIdx,
    endIdx >= 0 ? endIdx : undefined,
  );

  const entities = parseEntities(dataBlock);
  if (entities.size === 0) {
    warnings.push('parse:no_entities');
    return { tree: { nodes: [] }, warnings, unsupported };
  }

  // Find every MANIFOLD_SOLID_BREP — each becomes a candidate FeatureNode.
  const solidIds: number[] = [];
  for (const [id, ent] of entities) {
    if (ent.name === 'MANIFOLD_SOLID_BREP' || ent.name === 'BREP_WITH_VOIDS') {
      solidIds.push(id);
    }
  }
  if (solidIds.length === 0) {
    warnings.push('parse:no_manifold_solid_brep');
  }
  // Sort by id for deterministic node ordering across runs / serialisations.
  solidIds.sort((a, b) => a - b);

  const prefix = opts.namePrefix ?? 'imported';
  const nodes: FeatureNode[] = [];

  for (let idx = 0; idx < solidIds.length; idx++) {
    const solidId = solidIds[idx]!;
    let feature: ExtrudeFeature | null = null;
    let reason: string | null = null;
    try {
      const result = solidToExtrude(solidId, entities);
      if (result.kind === 'ok') {
        feature = result.feature;
      } else {
        reason = result.reason;
      }
    } catch (err) {
      reason = `parse_error: ${(err as Error).message}`;
    }
    if (!feature) {
      unsupported.push(`#${solidId}: ${reason ?? 'unknown'}`);
      continue;
    }
    nodes.push({
      id: `${prefix}_${idx}`,
      name: `Imported Solid ${idx + 1}`,
      dependencies: [],
      payload: feature,
    });
  }

  // CLOSED_SHELL not referenced by any MANIFOLD_SOLID_BREP is a common
  // "headless" case (some viewers strip the BREP wrapper). Surface it so
  // the caller can hint at the issue.
  if (solidIds.length === 0) {
    let shellCount = 0;
    for (const ent of entities.values()) {
      if (ent.name === 'CLOSED_SHELL' || ent.name === 'OPEN_SHELL') shellCount++;
    }
    if (shellCount === 0) {
      warnings.push('parse:no_closed_shell');
    } else {
      warnings.push(`parse:closed_shell_without_manifold_solid_brep (${shellCount} shell(s))`);
    }
  }

  return { tree: { nodes }, warnings, unsupported };
}

// ─── errors ───────────────────────────────────────────────────────────────

export class StepImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepImportError';
  }
}

// ─── entity table ─────────────────────────────────────────────────────────

/** Atomic argument value pulled out of an entity body. */
export type StepArg =
  | { kind: 'ref'; id: number }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'enum'; value: string }     // .T. / .F. / .UNSPECIFIED. / etc
  | { kind: 'wildcard' }                // *
  | { kind: 'null' }                    // $
  | { kind: 'list'; items: StepArg[] }
  | { kind: 'typed'; name: string; args: StepArg[] }; // e.g. LENGTH_MEASURE(...)

export interface StepEntity {
  /** ENTITY name in uppercase. Empty string for composite ("complex") types
   *  like `( SUB_A() SUB_B() )` where the name lives on each sub-entity. */
  name: string;
  /** Parsed top-level argument list. */
  args: StepArg[];
  /** For complex types: the list of sub-entities `[ {name, args}, ... ]`. */
  subEntities?: Array<{ name: string; args: StepArg[] }>;
}

/**
 * Split the DATA block into a `Map<id, Entity>`. Tolerant of multi-line
 * entity bodies (parens balanced across newlines), nested parens, and
 * single-quoted string literals (incl. `''` escape).
 *
 * Exported for tests; not stable API.
 */
export function parseEntities(dataBlock: string): Map<number, StepEntity> {
  const out = new Map<number, StepEntity>();
  const n = dataBlock.length;
  let i = 0;
  while (i < n) {
    // Skip whitespace + comments. STEP comments are /* ... */.
    while (i < n) {
      const ch = dataBlock[i]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '/' && dataBlock[i + 1] === '*') {
        const close = dataBlock.indexOf('*/', i + 2);
        if (close < 0) {
          i = n;
          break;
        }
        i = close + 2;
        continue;
      }
      break;
    }
    if (i >= n) break;
    if (dataBlock[i] !== '#') {
      // Skip a single non-# character (could be inside ENDSEC; or noise);
      // advancing one prevents infinite loops on malformed input.
      i++;
      continue;
    }
    // #N = BODY ;
    const idStart = i + 1;
    let idEnd = idStart;
    while (idEnd < n && dataBlock[idEnd]! >= '0' && dataBlock[idEnd]! <= '9') idEnd++;
    if (idEnd === idStart) {
      i++;
      continue;
    }
    const id = Number.parseInt(dataBlock.slice(idStart, idEnd), 10);
    let j = idEnd;
    while (j < n && (dataBlock[j] === ' ' || dataBlock[j] === '\t')) j++;
    if (dataBlock[j] !== '=') {
      i = j;
      continue;
    }
    j++;
    while (j < n && (dataBlock[j] === ' ' || dataBlock[j] === '\t' || dataBlock[j] === '\n' || dataBlock[j] === '\r')) j++;

    // Read body up to a SEMICOLON that's outside strings/parens.
    const bodyStart = j;
    let depth = 0;
    let inString = false;
    let semiPos = -1;
    while (j < n) {
      const ch = dataBlock[j]!;
      if (ch === "'") {
        if (inString && dataBlock[j + 1] === "'") {
          j += 2;
          continue;
        }
        inString = !inString;
        j++;
        continue;
      }
      if (inString) {
        j++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ';' && depth === 0) {
        semiPos = j;
        break;
      }
      j++;
    }
    if (semiPos < 0) {
      // Truncated body → bail; everything from here is suspect.
      throw new StepImportError(
        `malformed_entity: #${id} has no terminating ';' (unbalanced parens?)`,
      );
    }
    const body = dataBlock.slice(bodyStart, semiPos).trim();
    const parsed = parseEntityBody(body, id);
    out.set(id, parsed);
    i = semiPos + 1;
  }
  return out;
}

/**
 * Split an entity body into `{ name, args }`. Handles both regular
 * `ENTITY_NAME(arg, arg, ...)` and composite
 * `( SUB_A(arg) SUB_B(arg) )` (no name prefix, space-separated sub-entities).
 */
function parseEntityBody(body: string, id: number): StepEntity {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new StepImportError(`malformed_entity: #${id} body is empty`);
  }
  if (trimmed.startsWith('(')) {
    // Composite (complex) type — the outer parens wrap a space-separated
    // list of sub-entities like `( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(...) )`.
    if (!trimmed.endsWith(')')) {
      throw new StepImportError(`malformed_entity: #${id} composite body not paren-wrapped`);
    }
    const inner = trimmed.slice(1, -1).trim();
    const subEntities = parseSubEntities(inner, id);
    // Promote a synthetic name for downstream filters: the first sub-entity
    // wins (mirrors how OCCT names complex types in some readers). The
    // sub-entity list is also preserved for callers that need it.
    return {
      name: '',
      args: [],
      subEntities,
    };
  }
  // Regular form: NAME ( args ).
  const openParen = trimmed.indexOf('(');
  if (openParen < 0) {
    throw new StepImportError(`malformed_entity: #${id} has no '('`);
  }
  if (!trimmed.endsWith(')')) {
    throw new StepImportError(`malformed_entity: #${id} body does not end with ')'`);
  }
  const name = trimmed.slice(0, openParen).trim().toUpperCase();
  const argText = trimmed.slice(openParen + 1, trimmed.length - 1);
  const args = parseArgList(argText);
  return { name, args };
}

/**
 * Split a composite-type body into sub-entities. Each sub-entity has its
 * own paren block; sub-entities are separated by whitespace (no commas).
 */
function parseSubEntities(
  text: string,
  id: number,
): Array<{ name: string; args: StepArg[] }> {
  const subs: Array<{ name: string; args: StepArg[] }> = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    // Skip whitespace.
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
    if (i >= n) break;
    // Read sub-entity name (uppercase identifier).
    const nameStart = i;
    while (i < n && text[i] !== '(' && text[i] !== ' ' && text[i] !== '\t') i++;
    const subName = text.slice(nameStart, i).trim().toUpperCase();
    if (subName.length === 0) {
      throw new StepImportError(`malformed_entity: #${id} composite sub-entity missing name`);
    }
    // Whitespace between name and `(` is tolerated.
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
    if (text[i] !== '(') {
      throw new StepImportError(`malformed_entity: #${id} composite sub-entity ${subName} missing '('`);
    }
    // Find matching close paren.
    let depth = 0;
    let j = i;
    let inString = false;
    while (j < n) {
      const ch = text[j]!;
      if (ch === "'") {
        if (inString && text[j + 1] === "'") {
          j += 2;
          continue;
        }
        inString = !inString;
        j++;
        continue;
      }
      if (inString) {
        j++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (j >= n) {
      throw new StepImportError(`malformed_entity: #${id} composite sub-entity ${subName} unterminated`);
    }
    const argText = text.slice(i + 1, j);
    subs.push({ name: subName, args: parseArgList(argText) });
    i = j + 1;
  }
  return subs;
}

/**
 * Parse a comma-separated STEP argument list (the content between the
 * outer parens of an entity body). Respects nested parens, string literals,
 * `(...)` typed values, and the special tokens `*` / `$`.
 */
export function parseArgList(text: string): StepArg[] {
  const args: StepArg[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    // Skip whitespace.
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
    if (i >= n) break;
    // Find next top-level comma.
    const start = i;
    let depth = 0;
    let inString = false;
    while (i < n) {
      const ch = text[i]!;
      if (ch === "'") {
        if (inString && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = !inString;
        i++;
        continue;
      }
      if (inString) {
        i++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) break;
      i++;
    }
    const piece = text.slice(start, i).trim();
    if (piece.length > 0) {
      args.push(parseSingleArg(piece));
    }
    if (i < n && text[i] === ',') i++;
  }
  return args;
}

function parseSingleArg(s: string): StepArg {
  if (s === '*') return { kind: 'wildcard' };
  if (s === '$') return { kind: 'null' };
  if (s.startsWith('#')) {
    const id = Number.parseInt(s.slice(1), 10);
    if (!Number.isFinite(id)) {
      throw new StepImportError(`malformed_arg: bad ref '${s}'`);
    }
    return { kind: 'ref', id };
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return { kind: 'string', value: s.slice(1, -1).replace(/''/g, "'") };
  }
  if (s.startsWith('.') && s.endsWith('.')) {
    return { kind: 'enum', value: s.slice(1, -1) };
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    return { kind: 'list', items: parseArgList(s.slice(1, -1)) };
  }
  // Typed value: NAME(...).
  const openParen = s.indexOf('(');
  if (openParen > 0 && s.endsWith(')')) {
    const name = s.slice(0, openParen).trim().toUpperCase();
    if (/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
      return {
        kind: 'typed',
        name,
        args: parseArgList(s.slice(openParen + 1, -1)),
      };
    }
  }
  // Numeric: integer or REAL (STEP numbers allow trailing '.' and 'E'
  // notation). Note: stepWrite.ts emits some REAL values with a stray
  // trailing dot after the decimal mantissa (e.g. `-0.529999.`). Strip a
  // single trailing dot when the body already contains one so we round-
  // trip our own output cleanly.
  let numText = s;
  if (numText.endsWith('.') && (numText.slice(0, -1).includes('.') ||
      numText.toLowerCase().includes('e'))) {
    numText = numText.slice(0, -1);
  }
  const num = Number(numText);
  if (Number.isFinite(num)) {
    return { kind: 'number', value: num };
  }
  // Unrecognised — fall back to a string-like enum to avoid throwing on
  // exotic syntactic features we don't model (binary literals etc).
  return { kind: 'enum', value: s };
}

// ─── solid → feature classification ───────────────────────────────────────

type SolidParseResult =
  | { kind: 'ok'; feature: ExtrudeFeature }
  | { kind: 'unsupported'; reason: string };

/**
 * Classify a MANIFOLD_SOLID_BREP and convert to an ExtrudeFeature. Phase 1
 * supports two shapes: an axis-aligned box and a convex polygon prism with
 * planar caps at constant ±Z. Anything else returns `{ kind: 'unsupported' }`.
 */
function solidToExtrude(
  solidId: number,
  entities: Map<number, StepEntity>,
): SolidParseResult {
  const solid = entities.get(solidId);
  if (!solid) {
    return { kind: 'unsupported', reason: `solid #${solidId} not found in entity table` };
  }
  // MANIFOLD_SOLID_BREP('', #shell) — second arg is the CLOSED_SHELL ref.
  const shellRef = solid.args[1];
  if (!shellRef || shellRef.kind !== 'ref') {
    return { kind: 'unsupported', reason: 'MANIFOLD_SOLID_BREP missing shell ref' };
  }
  const shell = entities.get(shellRef.id);
  if (!shell || (shell.name !== 'CLOSED_SHELL' && shell.name !== 'OPEN_SHELL')) {
    return { kind: 'unsupported', reason: 'shell ref does not point to CLOSED_SHELL' };
  }
  // CLOSED_SHELL('', (#face, #face, ...))
  const facesArg = shell.args[1];
  if (!facesArg || facesArg.kind !== 'list') {
    return { kind: 'unsupported', reason: 'CLOSED_SHELL missing face list' };
  }
  const faceRefs: number[] = [];
  for (const item of facesArg.items) {
    if (item.kind === 'ref') faceRefs.push(item.id);
  }
  if (faceRefs.length === 0) {
    return { kind: 'unsupported', reason: 'CLOSED_SHELL has zero faces' };
  }

  // Decode every face into a planar face descriptor. Any non-planar surface
  // (BSPLINE / cylinder / cone / sphere / torus / revolution / extrusion of
  // a non-line curve) trips a single "unsupported" reason for the whole
  // solid — Phase 2 may relax this once we have a non-planar IR.
  const faces: PlaneFace[] = [];
  for (const fr of faceRefs) {
    const decoded = decodeFace(fr, entities);
    if (decoded.kind === 'unsupported') {
      return { kind: 'unsupported', reason: `${faces.length + 1}/${faceRefs.length} faces decoded — face #${fr}: ${decoded.reason}` };
    }
    faces.push(decoded.face);
  }

  // ─── try box detection first ─────────────────────────────────────────────
  if (faces.length === 6 && faces.every((f) => isAxisAligned(f.normal))) {
    const box = facesToBox(faces);
    if (box) {
      const { x0, y0, x1, y1, z0, z1 } = box;
      return {
        kind: 'ok',
        feature: {
          kind: 'extrude',
          loop: [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
          depth: z1 - z0,
          direction: 'one_sided',
          mode: 'add',
        },
      };
    }
  }

  // ─── polygon prism: 2 ±Z caps + N vertical sides ─────────────────────────
  const caps: PlaneFace[] = [];
  const sides: PlaneFace[] = [];
  for (const f of faces) {
    if (isZAxisNormal(f.normal)) caps.push(f);
    else if (isHorizontalNormal(f.normal)) sides.push(f);
    else {
      return {
        kind: 'unsupported',
        reason: `${faces.length} faces, non-axis-aligned normals — likely curved surface`,
      };
    }
  }
  if (caps.length === 2 && sides.length === faces.length - 2 && sides.length >= 3) {
    const prism = capsToPrism(caps, sides);
    if (prism.kind === 'ok') {
      return {
        kind: 'ok',
        feature: {
          kind: 'extrude',
          loop: prism.loop,
          depth: prism.depth,
          direction: 'one_sided',
          mode: 'add',
        },
      };
    }
    return { kind: 'unsupported', reason: `prism: ${prism.reason}` };
  }

  return {
    kind: 'unsupported',
    reason:
      `${faces.length} faces (${caps.length} Z-cap, ${sides.length} horizontal-side` +
      `, ${faces.length - caps.length - sides.length} other) — does not match Phase 1 box or polygon prism`,
  };
}

// ─── face decoding ────────────────────────────────────────────────────────

interface PlaneFace {
  /** Plane normal (unit-length, but we don't enforce — we only test signs). */
  normal: [number, number, number];
  /** Ordered ring of XYZ vertex coordinates around the outer loop. */
  loop: Array<[number, number, number]>;
}

type FaceDecodeResult =
  | { kind: 'ok'; face: PlaneFace }
  | { kind: 'unsupported'; reason: string };

/**
 * Walk one ADVANCED_FACE down to:
 *   - the plane normal (from PLANE → AXIS2_PLACEMENT_3D → DIRECTION)
 *   - the ordered ring of vertex coords (from FACE_OUTER_BOUND → EDGE_LOOP
 *     → ORIENTED_EDGE chain)
 *
 * Returns `{ kind: 'unsupported', reason }` for any of:
 *   - non-PLANE surface
 *   - inner-loop bounds (`FACE_BOUND` instead of `FACE_OUTER_BOUND`)
 *   - missing intermediate entities
 *   - non-linear edges (CIRCLE / ELLIPSE / B_SPLINE_CURVE)
 */
function decodeFace(
  faceId: number,
  entities: Map<number, StepEntity>,
): FaceDecodeResult {
  const face = entities.get(faceId);
  if (!face || face.name !== 'ADVANCED_FACE') {
    return { kind: 'unsupported', reason: `not an ADVANCED_FACE` };
  }
  // ADVANCED_FACE('', (#bound, ...), #surface, .T.)
  const boundsArg = face.args[1];
  const surfaceArg = face.args[2];
  if (!boundsArg || boundsArg.kind !== 'list' || !surfaceArg || surfaceArg.kind !== 'ref') {
    return { kind: 'unsupported', reason: `ADVANCED_FACE missing bounds/surface` };
  }
  const surface = entities.get(surfaceArg.id);
  if (!surface || surface.name !== 'PLANE') {
    return { kind: 'unsupported', reason: `surface is ${surface?.name ?? 'unknown'} (Phase 2)` };
  }
  // PLANE('', #axis2placement)
  const axisRef = surface.args[1];
  if (!axisRef || axisRef.kind !== 'ref') {
    return { kind: 'unsupported', reason: `PLANE missing AXIS2_PLACEMENT_3D ref` };
  }
  const axis = entities.get(axisRef.id);
  if (!axis || axis.name !== 'AXIS2_PLACEMENT_3D') {
    return { kind: 'unsupported', reason: `PLANE axis is not AXIS2_PLACEMENT_3D` };
  }
  // AXIS2_PLACEMENT_3D('', #point, #zdir, #refdir)
  const normalRef = axis.args[2];
  if (!normalRef || normalRef.kind !== 'ref') {
    return { kind: 'unsupported', reason: `AXIS2_PLACEMENT_3D missing normal direction` };
  }
  const normal = readDirection(normalRef.id, entities);
  if (!normal) return { kind: 'unsupported', reason: `bad DIRECTION entity` };

  // Find FACE_OUTER_BOUND (skip inner FACE_BOUND rings for now).
  let outerBoundRef: number | null = null;
  for (const item of boundsArg.items) {
    if (item.kind !== 'ref') continue;
    const b = entities.get(item.id);
    if (!b) continue;
    if (b.name === 'FACE_OUTER_BOUND') {
      outerBoundRef = item.id;
      break;
    }
  }
  if (outerBoundRef === null) {
    return { kind: 'unsupported', reason: `no FACE_OUTER_BOUND` };
  }
  const bound = entities.get(outerBoundRef)!;
  // FACE_OUTER_BOUND('', #loop, .T.)
  const loopRef = bound.args[1];
  if (!loopRef || loopRef.kind !== 'ref') {
    return { kind: 'unsupported', reason: `FACE_OUTER_BOUND missing loop ref` };
  }
  const loop = entities.get(loopRef.id);
  if (!loop || loop.name !== 'EDGE_LOOP') {
    return { kind: 'unsupported', reason: `loop is ${loop?.name ?? 'unknown'}, expected EDGE_LOOP` };
  }
  // EDGE_LOOP('', (#oe, #oe, ...))
  const oeArg = loop.args[1];
  if (!oeArg || oeArg.kind !== 'list') {
    return { kind: 'unsupported', reason: `EDGE_LOOP missing edge list` };
  }

  // Walk the ORIENTED_EDGE chain. Each ORIENTED_EDGE
  //   ORIENTED_EDGE('', *, *, #edge_curve, .T.|.F.)
  // wraps an EDGE_CURVE
  //   EDGE_CURVE('', #v_start, #v_end, #line, .T.|.F.)
  // and its directional flag (the trailing .T./.F.) tells us whether to
  // walk start→end or end→start. Vertices are collected in chain order; we
  // ignore the curve type beyond verifying it's a LINE (non-line edges
  // mean we can't represent the face as a planar polygon).
  const ring: Array<[number, number, number]> = [];
  for (const item of oeArg.items) {
    if (item.kind !== 'ref') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE non-ref in loop list` };
    }
    const oe = entities.get(item.id);
    if (!oe || oe.name !== 'ORIENTED_EDGE') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE missing` };
    }
    const ecRef = oe.args[3];
    const oeFlag = oe.args[4];
    if (!ecRef || ecRef.kind !== 'ref') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE missing EDGE_CURVE ref` };
    }
    const forwardOe = oeFlag?.kind === 'enum' ? oeFlag.value !== 'F' : true;
    const ec = entities.get(ecRef.id);
    if (!ec || ec.name !== 'EDGE_CURVE') {
      return { kind: 'unsupported', reason: `EDGE_CURVE missing` };
    }
    // EDGE_CURVE('', #vstart, #vend, #curve, .T.|.F.)
    const vStartRef = ec.args[1];
    const vEndRef = ec.args[2];
    const curveRef = ec.args[3];
    if (!vStartRef || vStartRef.kind !== 'ref' || !vEndRef || vEndRef.kind !== 'ref') {
      return { kind: 'unsupported', reason: `EDGE_CURVE missing vertex refs` };
    }
    if (curveRef && curveRef.kind === 'ref') {
      const curve = entities.get(curveRef.id);
      if (curve && curve.name && curve.name !== 'LINE' && curve.name !== 'POLYLINE') {
        return {
          kind: 'unsupported',
          reason: `non-linear edge (${curve.name}) — likely curved surface`,
        };
      }
    }
    const start = readVertexPoint(vStartRef.id, entities);
    const end = readVertexPoint(vEndRef.id, entities);
    if (!start || !end) {
      return { kind: 'unsupported', reason: `VERTEX_POINT decode failed` };
    }
    const first = forwardOe ? start : end;
    if (ring.length === 0 || !pointEq(ring[ring.length - 1]!, first)) {
      ring.push(first);
    }
  }
  if (ring.length < 3) {
    return { kind: 'unsupported', reason: `loop has ${ring.length} distinct vertices, need ≥ 3` };
  }
  // Drop a closing duplicate vertex if present (some writers repeat v0 at end).
  if (ring.length > 3 && pointEq(ring[0]!, ring[ring.length - 1]!)) {
    ring.pop();
  }
  return { kind: 'ok', face: { normal, loop: ring } };
}

function readDirection(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'DIRECTION') return null;
  // DIRECTION('', (x, y, z))
  const listArg = ent.args[1];
  if (!listArg || listArg.kind !== 'list') return null;
  const xs: number[] = [];
  for (const item of listArg.items) {
    if (item.kind !== 'number') return null;
    xs.push(item.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

function readVertexPoint(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const vp = entities.get(id);
  if (!vp || vp.name !== 'VERTEX_POINT') return null;
  // VERTEX_POINT('', #cartesian_point)
  const cpRef = vp.args[1];
  if (!cpRef || cpRef.kind !== 'ref') return null;
  const cp = entities.get(cpRef.id);
  if (!cp || cp.name !== 'CARTESIAN_POINT') return null;
  const coords = cp.args[1];
  if (!coords || coords.kind !== 'list') return null;
  const xs: number[] = [];
  for (const item of coords.items) {
    if (item.kind !== 'number') return null;
    xs.push(item.value);
  }
  if (xs.length !== 3) return null;
  return [xs[0]!, xs[1]!, xs[2]!];
}

// ─── geometric helpers ────────────────────────────────────────────────────

function pointEq(a: [number, number, number], b: [number, number, number]): boolean {
  return (
    Math.abs(a[0] - b[0]) <= POINT_EPS &&
    Math.abs(a[1] - b[1]) <= POINT_EPS &&
    Math.abs(a[2] - b[2]) <= POINT_EPS
  );
}

function isAxisAligned(n: [number, number, number]): boolean {
  return isZAxisNormal(n) || isHorizontalAxisNormal(n);
}

function isZAxisNormal(n: [number, number, number]): boolean {
  return Math.abs(n[0]) <= AXIS_EPS && Math.abs(n[1]) <= AXIS_EPS && Math.abs(Math.abs(n[2]) - 1) <= AXIS_EPS;
}

/** Normal lies in the XY plane (z component ~ 0) — required for prism sides. */
function isHorizontalNormal(n: [number, number, number]): boolean {
  return Math.abs(n[2]) <= AXIS_EPS;
}

/** Axis-aligned ±X or ±Y normal — used by the box detector. */
function isHorizontalAxisNormal(n: [number, number, number]): boolean {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (az > AXIS_EPS) return false;
  return (Math.abs(ax - 1) <= AXIS_EPS && ay <= AXIS_EPS) ||
         (Math.abs(ay - 1) <= AXIS_EPS && ax <= AXIS_EPS);
}

// ─── box reconstruction ───────────────────────────────────────────────────

function facesToBox(
  faces: PlaneFace[],
): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null {
  // Collect every vertex; the 8 unique corners give us the bbox.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of faces) {
    for (const v of f.loop) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX) || maxX - minX <= POINT_EPS) return null;
  if (maxY - minY <= POINT_EPS) return null;
  if (maxZ - minZ <= POINT_EPS) return null;
  // Sanity: every face should be a 4-vertex rectangle aligned with the bbox.
  // (We don't reject if not — the bbox is still the right ExtrudeFeature
  // since stepWrite uses bbox for the loop anyway.)
  return { x0: minX, y0: minY, z0: minZ, x1: maxX, y1: maxY, z1: maxZ };
}

// ─── polygon prism reconstruction ─────────────────────────────────────────

type PrismResult =
  | { kind: 'ok'; loop: Array<{ x: number; y: number }>; depth: number }
  | { kind: 'unsupported'; reason: string };

function capsToPrism(caps: PlaneFace[], sides: PlaneFace[]): PrismResult {
  // Assign bottom (-Z normal) and top (+Z normal).
  let bottom: PlaneFace | null = null;
  let top: PlaneFace | null = null;
  for (const c of caps) {
    if (c.normal[2] < -0.5) bottom = c;
    else if (c.normal[2] > 0.5) top = c;
  }
  if (!bottom || !top) {
    return { kind: 'unsupported', reason: 'caps not assignable to ±Z' };
  }
  if (bottom.loop.length !== top.loop.length) {
    return {
      kind: 'unsupported',
      reason: `cap vertex counts differ (bottom=${bottom.loop.length}, top=${top.loop.length})`,
    };
  }
  if (bottom.loop.length !== sides.length) {
    return {
      kind: 'unsupported',
      reason: `side count ${sides.length} != cap vertex count ${bottom.loop.length}`,
    };
  }
  // All bottom vertices must share a common z, and all top vertices another.
  const z0 = bottom.loop[0]![2];
  const z1 = top.loop[0]![2];
  for (const v of bottom.loop) {
    if (Math.abs(v[2] - z0) > POINT_EPS) {
      return { kind: 'unsupported', reason: 'bottom cap not planar in Z' };
    }
  }
  for (const v of top.loop) {
    if (Math.abs(v[2] - z1) > POINT_EPS) {
      return { kind: 'unsupported', reason: 'top cap not planar in Z' };
    }
  }
  const depth = z1 - z0;
  if (!(depth > POINT_EPS)) {
    return { kind: 'unsupported', reason: `non-positive depth ${depth}` };
  }
  // Project bottom cap to XY. The bottom cap is wound CW (when viewed from
  // below it's CCW), so reverse it to recover the CCW XY loop the
  // ExtrudeFeature IR expects.
  const xy: Array<{ x: number; y: number }> = [];
  for (let i = bottom.loop.length - 1; i >= 0; i--) {
    const v = bottom.loop[i]!;
    xy.push({ x: v[0], y: v[1] });
  }
  // Verify top cap matches bottom cap in XY (any rotation / reflection ok
  // as long as the vertex set agrees within POINT_EPS).
  if (!xyVertexSetsMatch(bottom.loop, top.loop)) {
    return { kind: 'unsupported', reason: 'top cap XY vertices do not match bottom cap' };
  }
  // Drop a closing duplicate if the writer included one.
  if (xy.length > 3 && Math.abs(xy[0]!.x - xy[xy.length - 1]!.x) <= POINT_EPS && Math.abs(xy[0]!.y - xy[xy.length - 1]!.y) <= POINT_EPS) {
    xy.pop();
  }
  return { kind: 'ok', loop: xy, depth };
}

function xyVertexSetsMatch(
  a: Array<[number, number, number]>,
  b: Array<[number, number, number]>,
): boolean {
  if (a.length !== b.length) return false;
  const used = new Array<boolean>(b.length).fill(false);
  for (const va of a) {
    let matched = false;
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      const vb = b[j]!;
      if (Math.abs(va[0] - vb[0]) <= POINT_EPS && Math.abs(va[1] - vb[1]) <= POINT_EPS) {
        used[j] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

// ─── internal exports for tests ───────────────────────────────────────────

/** Exposed for unit tests; not stable API. */
export const __internal = {
  parseEntities,
  parseArgList,
  POINT_EPS,
  AXIS_EPS,
};
