/**
 * stepImport — Phase 5.2 PURE-TS STEP (ISO 10303-21) reader for NexyFab Pro.
 *
 * SCOPE
 * -----
 * Inverse of `stepWrite.ts`. Given a STEP AP214 / AP203 / AP242 source string,
 * walks the entity graph and reconstructs a `FeatureTree` whose nodes are
 * `ExtrudeFeature` or `RevolveFeature` IRs.
 *
 * Phase 1 (BREP planar prisms):
 *   1. Axis-aligned BOX  →  rectangular 4-vertex `ExtrudeFeature` (the loop is
 *      the bbox in XY, depth = Z extent).
 *   2. Convex polygon PRISM (N side faces + 2 cap faces with ±Z normals)  →
 *      N-vertex `ExtrudeFeature` (loop = bottom cap polygon, depth = z1 - z0).
 *
 * Phase 2 (axis-aligned revolves):
 *   3. REVOLVED_AREA_SOLID with planar profile + axis aligned to ±X / ±Y / ±Z
 *      →  `RevolveFeature` (profile transformed into the canonical
 *      rotate_extrude frame: axis = +Y, profile in X ≥ 0 half).
 *   4. BREP cylinder — exactly 1 CYLINDRICAL_SURFACE side face + 2 PLANE caps
 *      with cap normals parallel to the cylinder axis  →  `RevolveFeature`
 *      whose loop is the rectangle `[(0,0), (r,0), (r,h), (0,h)]` (axis-Y
 *      canonical).
 *
 * Phase 3 (axis-aligned linear sweeps — this module):
 *   5. SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID with planar profile + extrusion
 *      direction aligned to ±X / ±Y / ±Z  →  `SweepFeature` whose path is the
 *      2-point polyline `[[0,0,0], extrusion_axis * depth]`. The profile is
 *      kept in its native 2D coordinates (no canonical re-frame — sweep
 *      preserves the source plane for path-perpendicular sliding).
 *   6. BREP SURFACE_OF_LINEAR_EXTRUSION — exactly 1 SURFACE_OF_LINEAR_EXTRUSION
 *      side face + 2 PLANE cap faces with cap normals parallel to the
 *      extrusion direction  →  `SweepFeature` (rectangle profile reconstructed
 *      from the cap geometry, path = cap-centre-to-cap-centre).
 *
 * Any other solid (BSPLINE / CONICAL / SPHERICAL / TOROIDAL surfaces,
 * non-axis-aligned revolution / extrusion axes, lofts, swept-disk pipes,
 * non-linear spine sweeps, fillets, drafts, multi-loop faces with inner
 * bounds) is SKIPPED and reported via the `unsupported` channel — it does
 * NOT abort the whole import. The caller can surface those in the UI
 * ("3 of 5 solids imported; 2 require Phase 4 OCCT B-rep round-trip").
 *
 * PIPELINE
 * --------
 *   source
 *     ↓  healStepSource             (encoding, line endings, missing END-ISO)
 *     ↓  parseEntities              (regex tokenize → Map<id, Entity>)
 *     ↓  for each MANIFOLD_SOLID_BREP / BREP_WITH_VOIDS
 *         ↓  collect CLOSED_SHELL → ADVANCED_FACE[]
 *         ↓  classify (box | polygon_prism | cylinder | unsupported)
 *         ↓  emit ExtrudeFeature | RevolveFeature  +  FeatureNode
 *     ↓  for each REVOLVED_AREA_SOLID (direct revolve entity)
 *         ↓  read swept_area profile + AXIS1_PLACEMENT
 *         ↓  classify axis → 'x' | 'y' | 'z' | unsupported
 *         ↓  emit RevolveFeature  +  FeatureNode
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
 * - Phase 2 limit: revolve axis MUST be one of ±X, ±Y, ±Z (within AXIS_EPS).
 *   Arbitrary (e.g. diagonal) axes are routed to `unsupported` with an
 *   `axis not axis-aligned` reason — Phase 3 will compose a sketch-plane
 *   basis to recover the world-space axis.
 *
 * PHASE 4 WISHLIST (NOT implemented in this module)
 * -------------------------------------------------
 *   - BSPLINE_SURFACE_WITH_KNOTS / RATIONAL_B_SPLINE_SURFACE
 *   - CONICAL_SURFACE / SPHERICAL_SURFACE / TOROIDAL_SURFACE (parametric
 *     primitives beyond cylinder)
 *   - SURFACE_OF_REVOLUTION with non-linear basis curve (Phase 2/3 only
 *     handles cylinders + linear extrusions directly)
 *   - REVOLVED_AREA_SOLID / SWEPT_AREA_SOLID with non-axis-aligned axis
 *     (composed sketch transform → world axis)
 *   - SWEPT_DISK_SOLID (pipe / hose primitive) — recognised by name but
 *     intentionally routed to `unsupported` until Phase 4 adds path solver
 *   - Sweeps along non-linear (spline / arc) directrix curves — current
 *     SweepFeature path is a polyline; arc paths need an extra IR layer
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
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { SweepFeature } from '@/lib/cad/sweepLoft';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import { healStepSource } from './stepRead';

// ─── tolerances ───────────────────────────────────────────────────────────

/** Two CARTESIAN_POINTs are considered equal within this absolute distance (mm). */
const POINT_EPS = 1e-6;
/** A unit-vector component is considered "0" or "±1" within this tolerance. */
const AXIS_EPS = 1e-4;

// ─── public API ───────────────────────────────────────────────────────────

/** Axis-aligned bounding box in world coordinates. */
export interface WorldBBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Per-solid world placement, aligned 1:1 with `StepImportResult.tree.nodes`.
 *
 * The feature IRs the importer emits are, by convention, expressed in a LOCAL
 * frame (an extrude starts at z=0; a cylinder revolve is canonicalised to
 * axis=+Y at the origin). That convention discards the solid's world position,
 * which is harmless for a single body but STACKS multi-body parts on top of one
 * another when they are meshed and combined. `worldBBox` preserves the true
 * world-space axis-aligned extent (measured from the raw CARTESIAN_POINTs before
 * canonicalisation) so a downstream mesher can translate each body back to its
 * real position before measuring the combined bbox / centroid.
 *
 * `worldBBox` is `null` when the world extent could not be recovered (e.g. a
 * direct REVOLVED_AREA_SOLID whose swept extent we do not reconstruct) — the
 * caller must then treat that body's placement as unknown (approximate), never
 * as faithful.
 */
export interface SolidPlacement {
  /** True world-space AABB of this solid, or null when not recoverable. */
  worldBBox: WorldBBox | null;
}

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
  /** Per-node world placement, aligned 1:1 (same order) with `tree.nodes`. Lets
   *  a mesher move each body to its true world position before combining. */
  placements: SolidPlacement[];
  /** True when the source uses MAPPED_ITEM instancing (a shared representation
   *  placed via a transform). The pure-TS reader measures the base geometry
   *  ONCE at its authored coordinates and does NOT expand instance transforms,
   *  so any combined extent is approximate — never presented as faithful. */
  hasUnexpandedInstances: boolean;
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
    return { tree: { nodes: [] }, warnings, unsupported, placements: [], hasUnexpandedInstances: false };
  }

  // MAPPED_ITEM instancing: a shared representation placed via a transform. The
  // pure-TS reader measures the referenced geometry ONCE at its authored coords
  // and does not expand the instance transform chain, so any resulting extent is
  // approximate. Record it so the caller never presents it as faithful.
  let mappedItemCount = 0;
  for (const ent of entities.values()) {
    if (ent.name === 'MAPPED_ITEM') mappedItemCount++;
  }
  const hasUnexpandedInstances = mappedItemCount > 0;
  if (hasUnexpandedInstances) {
    warnings.push(
      `mapped_item_instancing_not_expanded: ${mappedItemCount} MAPPED_ITEM(s) — ` +
        `pure-TS reader measures base geometry only; instanced placement/extent is approximate`,
    );
  }

  // Find every MANIFOLD_SOLID_BREP — each becomes a candidate FeatureNode.
  const solidIds: number[] = [];
  // Find every REVOLVED_AREA_SOLID — Phase 2 direct-revolve entities.
  const revolveSolidIds: number[] = [];
  // Find every SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID — Phase 3 direct-sweep
  // entities. Both share the same swept_area + extrusion_direction shape.
  const sweptAreaSolidIds: number[] = [];
  // Find every SWEPT_DISK_SOLID — Phase 4 wishlist (recognised, not converted).
  const sweptDiskSolidIds: number[] = [];
  for (const [id, ent] of entities) {
    if (ent.name === 'MANIFOLD_SOLID_BREP' || ent.name === 'BREP_WITH_VOIDS') {
      solidIds.push(id);
    } else if (ent.name === 'REVOLVED_AREA_SOLID') {
      revolveSolidIds.push(id);
    } else if (ent.name === 'SWEPT_AREA_SOLID' || ent.name === 'EXTRUDED_AREA_SOLID') {
      sweptAreaSolidIds.push(id);
    } else if (ent.name === 'SWEPT_DISK_SOLID') {
      sweptDiskSolidIds.push(id);
    }
  }
  if (
    solidIds.length === 0 &&
    revolveSolidIds.length === 0 &&
    sweptAreaSolidIds.length === 0 &&
    sweptDiskSolidIds.length === 0
  ) {
    warnings.push('parse:no_manifold_solid_brep');
  }
  // Sort by id for deterministic node ordering across runs / serialisations.
  solidIds.sort((a, b) => a - b);
  revolveSolidIds.sort((a, b) => a - b);
  sweptAreaSolidIds.sort((a, b) => a - b);
  sweptDiskSolidIds.sort((a, b) => a - b);

  const prefix = opts.namePrefix ?? 'imported';
  const nodes: FeatureNode[] = [];
  // Per-node world placement, kept in lock-step with `nodes` (one push each).
  const placements: SolidPlacement[] = [];

  // ─── pass 1: BREP solids (boxes / polygon prisms / cylinders / sweeps) ──
  let extrudeIdx = 0;
  let cylinderRevolveIdx = 0;
  let sweepIdx = 0;
  for (const solidId of solidIds) {
    let feature: ExtrudeFeature | RevolveFeature | SweepFeature | null = null;
    let placement: WorldBBox | null = null;
    let reason: string | null = null;
    try {
      const result = solidToFeature(solidId, entities);
      if (result.kind === 'ok') {
        feature = result.feature;
        placement = result.worldBBox ?? null;
        if (result.holesUnrepresented) {
          const h = result.holesUnrepresented;
          warnings.push(
            `#${solidId}: 판재 외곽·두께는 받았으나 **원통 홀 ${h.count}개(반경 `
            + `${h.radiiMm.slice(0, 4).map((r) => r.toFixed(1)).join('/')}mm)를 형상에 반영하지 `
            + `못했습니다** — 부피가 약 ${h.volumeOverPct}% 과대합니다(IR 프로파일이 단일 루프라 `
            + '내부 루프를 담을 수 없습니다). 정확 복원이 아닙니다.',
          );
        }
        if (result.arcApprox) {
          // 「정확 복원」이라 말하지 않는다 — 근사 엣지 수와 오차를 수치로 고지한다.
          warnings.push(
            `#${solidId}: 원호 엣지 ${result.arcApprox.edges}개를 현으로 근사했습니다 — `
            + `최대 오차(새그) ${result.arcApprox.maxSagittaMm}mm. 정확 복원이 아닙니다.`,
          );
        }
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
    placements.push({ worldBBox: placement });
    if (feature.kind === 'extrude') {
      nodes.push({
        id: `${prefix}_${extrudeIdx}`,
        name: `Imported Solid ${extrudeIdx + 1}`,
        dependencies: [],
        payload: feature,
      });
      extrudeIdx += 1;
    } else if (feature.kind === 'revolve') {
      // BREP-derived revolve (cylinder primitive).
      nodes.push({
        id: `${prefix}_revolve_${cylinderRevolveIdx}`,
        name: `Imported Revolved Solid ${cylinderRevolveIdx + 1}`,
        dependencies: [],
        payload: feature,
      });
      cylinderRevolveIdx += 1;
    } else {
      // BREP-derived sweep (SURFACE_OF_LINEAR_EXTRUSION primitive).
      nodes.push({
        id: `${prefix}_sweep_${sweepIdx}`,
        name: `Imported Swept Solid ${sweepIdx + 1}`,
        dependencies: [],
        payload: feature,
      });
      sweepIdx += 1;
    }
  }

  // ─── pass 2: direct REVOLVED_AREA_SOLID entities ────────────────────────
  for (const revolveId of revolveSolidIds) {
    let feature: RevolveFeature | null = null;
    let placement: WorldBBox | null = null;
    let reason: string | null = null;
    try {
      const result = revolvedAreaSolidToRevolve(revolveId, entities);
      if (result.kind === 'ok') {
        feature = result.feature;
        placement = result.worldBBox ?? null;
      } else {
        reason = result.reason;
      }
    } catch (err) {
      reason = `parse_error: ${(err as Error).message}`;
    }
    if (!feature) {
      unsupported.push(`#${revolveId}: ${reason ?? 'unknown'}`);
      continue;
    }
    placements.push({ worldBBox: placement });
    nodes.push({
      id: `${prefix}_revolve_${cylinderRevolveIdx}`,
      name: `Imported Revolved Solid ${cylinderRevolveIdx + 1}`,
      dependencies: [],
      payload: feature,
    });
    cylinderRevolveIdx += 1;
  }

  // ─── pass 3: direct SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID entities ────
  for (const sweptId of sweptAreaSolidIds) {
    let feature: SweepFeature | null = null;
    let placement: WorldBBox | null = null;
    let reason: string | null = null;
    try {
      const result = sweptAreaSolidToSweep(sweptId, entities);
      if (result.kind === 'ok') {
        feature = result.feature;
        placement = result.worldBBox ?? null;
      } else {
        reason = result.reason;
      }
    } catch (err) {
      reason = `parse_error: ${(err as Error).message}`;
    }
    if (!feature) {
      unsupported.push(`#${sweptId}: ${reason ?? 'unknown'}`);
      continue;
    }
    placements.push({ worldBBox: placement });
    nodes.push({
      id: `${prefix}_sweep_${sweepIdx}`,
      name: `Imported Swept Solid ${sweepIdx + 1}`,
      dependencies: [],
      payload: feature,
    });
    sweepIdx += 1;
  }

  // ─── pass 4: SWEPT_DISK_SOLID — Phase 4 wishlist, surface a warning ────
  for (const diskId of sweptDiskSolidIds) {
    unsupported.push(
      `#${diskId}: SWEPT_DISK_SOLID (pipe / hose primitive) — ` +
        `Phase 4 wishlist (low frequency; needs path solver)`,
    );
  }

  // CLOSED_SHELL not referenced by any MANIFOLD_SOLID_BREP is a common
  // "headless" case (some viewers strip the BREP wrapper). Surface it so
  // the caller can hint at the issue.
  if (
    solidIds.length === 0 &&
    revolveSolidIds.length === 0 &&
    sweptAreaSolidIds.length === 0 &&
    sweptDiskSolidIds.length === 0
  ) {
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

  return { tree: { nodes }, warnings, unsupported, placements, hasUnexpandedInstances };
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
  | {
    kind: 'ok'; feature: ExtrudeFeature | RevolveFeature | SweepFeature; worldBBox?: WorldBBox | null;
    /** 원호를 현으로 근사한 엣지 수·최대 새그(mm) — **있으면 이 솔리드는 근사다** (260801). */
    arcApprox?: { edges: number; maxSagittaMm: number };
    /**
     * 원통 홀을 **형상에 반영하지 못한 채** 외곽만 받은 경우 (260801c).
     * IR 의 프로파일이 단일 루프라 내부 루프(홀)를 담을 수 없고, 소비부는 노드마다
     * 독립 바디로 배치해 노드 간 부울을 하지 않는다 — 홀을 별 노드로 내면 「구멍」이
     * 아니라 **별개 원통 바디**가 된다. 그래서 외곽만 받고 **손실을 수치로 고지**한다.
     */
    holesUnrepresented?: { count: number; radiiMm: number[]; volumeOverPct: number };
  }
  | { kind: 'unsupported'; reason: string };

/**
 * Classify a MANIFOLD_SOLID_BREP and convert to either an ExtrudeFeature
 * (box / polygon prism) or a RevolveFeature (cylinder primitive: exactly 1
 * CYLINDRICAL_SURFACE face + 2 PLANE cap faces). Anything else returns
 * `{ kind: 'unsupported' }`.
 */
function solidToFeature(
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

  // Decode every face. Surface type is captured so the classifier can route
  // mixed planar + cylindrical / extrusion solids to the appropriate branch.
  const planeFaces: PlaneFace[] = [];
  const cylinderFaces: CylinderFace[] = [];
  const extrusionFaces: LinearExtrusionFace[] = [];
  const otherSurfaces: string[] = [];
  for (const fr of faceRefs) {
    const decoded = decodeFace(fr, entities);
    if (decoded.kind === 'plane') {
      planeFaces.push(decoded.face);
    } else if (decoded.kind === 'cylinder') {
      cylinderFaces.push(decoded.face);
    } else if (decoded.kind === 'linear_extrusion') {
      extrusionFaces.push(decoded.face);
    } else if (decoded.kind === 'other_surface') {
      // Record but keep going — a single BSPLINE among 7 faces still aborts,
      // but we want the reason to name the surface kind exactly.
      otherSurfaces.push(decoded.surfaceName);
    } else {
      // Hard parse error (missing entity / bad loop) — abort whole solid.
      return {
        kind: 'unsupported',
        reason: `face #${fr}: ${decoded.reason}`,
      };
    }
  }

  if (otherSurfaces.length > 0) {
    // Phase 2/3 only handles plane + cylinder + linear-extrusion; cone /
    // sphere / torus / spline / NURBS remain unsupported. Surface the FIRST
    // exotic surface name so callers can hint at the actual blocker (helps
    // debugging mixed-geometry STEP files).
    const uniq = Array.from(new Set(otherSurfaces));
    return {
      kind: 'unsupported',
      reason: `${faceRefs.length} faces include unsupported surface(s): ${uniq.join(', ')}`,
    };
  }

  // World-space extent of this solid from its raw plane-face vertices (before any
  // local-frame canonicalisation). Lets the mesher restore multi-body placement.
  const solidWorldBBox = bboxOfPlaneFaces(planeFaces);
  /**
   * ⚠ 원호 근사를 **솔리드까지 올린다** (260801). 면에만 두면 소비자가 모른다 —
   * 근사한 형상을 정확한 것으로 읽는 것이 이 세션에서 가장 여러 번 막은 오류다.
   */
  const arcEdgeTotal = planeFaces.reduce((n, f) => n + (f.arcEdges ?? 0), 0);
  const arcSagMax = planeFaces.reduce((m, f) => Math.max(m, f.arcSagittaMm ?? 0), 0);
  const arcApprox = arcEdgeTotal > 0
    ? { arcApprox: { edges: arcEdgeTotal, maxSagittaMm: +arcSagMax.toFixed(4) } }
    : {};

  // ─── try box detection first (6 planar axis-aligned faces) ──────────────
  if (
    cylinderFaces.length === 0 &&
    planeFaces.length === 6 &&
    planeFaces.every((f) => isAxisAligned(f.normal))
  ) {
    const box = facesToBox(planeFaces);
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
        worldBBox: solidWorldBBox,
        ...arcApprox,
      };
    }
  }

  // ─── cylinder primitive: 1 CYLINDRICAL + 2 PLANE caps + nothing else ────
  if (
    cylinderFaces.length === 1 &&
    planeFaces.length === 2 &&
    faceRefs.length === 3
  ) {
    const cyl = cylinderFaces[0]!;
    const result = cylinderToRevolve(cyl, planeFaces);
    if (result.kind === 'ok') {
      return { kind: 'ok', feature: result.feature, worldBBox: solidWorldBBox, ...arcApprox };
    }
    return { kind: 'unsupported', reason: `cylinder: ${result.reason}` };
  }

  if (cylinderFaces.length > 0) {
    /**
     * ★ 260801c — **구멍 뚫린 판**을 받는다.
     *
     * 원호 근사(260801) 후 코퍼스 미지원 사유 **1위가 이 조합 22건**이었다:
     *   `(N CYLINDRICAL_SURFACE, N PLANE) — cylinder detector wants 1 cylinder + 2 caps`.
     * 실물에서 이건 거의 항상 **판재 + 원형 홀**이다(볼트홀·보스·경량화 구멍).
     * 종전에는 솔리드를 통째로 버렸다 — 외곽과 두께는 읽을 수 있는데도.
     *
     * ⚠ **홀을 형상으로 넣지는 못한다.** IR 프로파일이 단일 루프라 내부 루프를 담을 수
     *   없고, 소비부(`ingestStep`)는 노드마다 **독립 바디**로 min-corner 정렬해 배치하며
     *   노드 간 부울을 하지 않는다. 홀을 별 노드(`cut`)로 내면 「구멍」이 아니라
     *   **별개 원통 바디**가 생겨 형상이 더 틀린다.
     * → 외곽·두께는 **정확히** 받고, 홀은 **개수·반경·부피 과대율을 수치로 고지**한다.
     *   「정확 복원」이라 말하지 않는다(`stepFileBounds` 전례).
     */
    const withHoles = prismWithCylindricalHoles(planeFaces, cylinderFaces, entities);
    if (withHoles) {
      return {
        kind: 'ok', feature: withHoles.feature, worldBBox: solidWorldBBox,
        ...arcApprox, holesUnrepresented: withHoles.holes,
      };
    }
    // 판+홀 패턴이 아니면 종전대로 거부한다 — 추측해서 받지 않는다.
    return {
      kind: 'unsupported',
      reason:
        `${faceRefs.length} faces (${cylinderFaces.length} CYLINDRICAL_SURFACE, ` +
        `${planeFaces.length} PLANE) — 1 cylinder + 2 caps 도 아니고 「판재+원통 홀」 패턴도 아니다`,
    };
  }

  // ─── linear extrusion primitive: 1 SURFACE_OF_LINEAR_EXTRUSION + 2 PLANE
  //     caps + nothing else ─────────────────────────────────────────────────
  if (
    extrusionFaces.length === 1 &&
    planeFaces.length === 2 &&
    faceRefs.length === 3
  ) {
    const ext = extrusionFaces[0]!;
    const result = linearExtrusionToSweep(ext, planeFaces);
    if (result.kind === 'ok') {
      return { kind: 'ok', feature: result.feature, worldBBox: solidWorldBBox, ...arcApprox };
    }
    return { kind: 'unsupported', reason: `linear extrusion: ${result.reason}` };
  }

  if (extrusionFaces.length > 0) {
    // SURFACE_OF_LINEAR_EXTRUSION present but doesn't match the clean 1+2
    // pattern (multiple extrusion surfaces, mixed extrusion + cylinder, etc.).
    // Phase 4 will handle these via OCCT round-trip.
    return {
      kind: 'unsupported',
      reason:
        `${faceRefs.length} faces (${extrusionFaces.length} SURFACE_OF_LINEAR_EXTRUSION, ` +
        `${planeFaces.length} PLANE) — extrusion detector wants exactly 1 extrusion + 2 caps`,
    };
  }

  // ─── polygon prism: 2 caps normal to a principal axis + N sides ──────────
  /**
   * ⚠ 260801 — 종전에는 **캡이 ±Z 일 때만** 프리즘으로 인정했다(`isZAxisNormal`).
   *
   * 실물 CAD 는 부품을 임의 방향으로 배치한다 — 같은 형상이 X 나 Y 로 압출돼 있으면
   * 종전 분류기는 「does not match Phase 1 box or polygon prism」으로 **버렸다.**
   * 형상이 표현 가능한데 축 하나 때문에 못 읽은 것이다.
   *
   * 세 주축을 모두 시도한다: 캡 법선이 놓인 축을 찾아 그 축을 Z 로 **좌표 재매핑**한 뒤
   * 기존 `capsToPrism` 을 그대로 돌리고, 결과에 `at.rotateDeg` 를 붙여 **원래 방향으로
   * 되돌린다**. 회전을 붙이지 않고 내보내면 형상은 맞고 자리는 틀리는, 더 나쁜 결과가 된다.
   */
  const AXIS_REMAP: Array<{
    axis: 'x' | 'y' | 'z';
    /** 이 축이 캡 법선인가 */
    isCap: (n: [number, number, number]) => boolean;
    /**
     * ⚠ 측면은 **캡축 성분이 0**이면 된다 — 주축 정렬을 요구하면 안 된다.
     * 처음 `isAxisAligned` 로 걸렀더니 삼각·오각·육각 프리즘의 **비스듬한 측면**이
     * 전부 탈락해 기존 Z 프리즘 회귀 7건이 깨졌다(실측). 프리즘의 정의는
     * 「캡에 수직인 측면」이고 측면이 주축을 향할 이유가 없다.
     */
    isSide: (n: [number, number, number]) => boolean;
    /** 월드 → 로컬(캡축이 Z) */
    toLocal: (v: [number, number, number]) => [number, number, number];
    /** 로컬에서 그린 형상을 월드로 되돌리는 회전(OpenSCAD X→Y→Z 순) */
    rotateDeg: [number, number, number] | null;
  }> = [
    { axis: 'z', isCap: (n) => isZAxisNormal(n), isSide: (n) => Math.abs(n[2]) <= AXIS_EPS, toLocal: (v) => v, rotateDeg: null },
    // 캡이 ±X → 로컬 Z = 월드 X. (y,z,x) 순환이 곧 rotate([90,0,90]) 의 역이다.
    { axis: 'x', isCap: (n) => Math.abs(Math.abs(n[0]) - 1) <= AXIS_EPS && Math.abs(n[1]) <= AXIS_EPS && Math.abs(n[2]) <= AXIS_EPS,
      isSide: (n) => Math.abs(n[0]) <= AXIS_EPS,
      toLocal: (v) => [v[1], v[2], v[0]], rotateDeg: [90, 0, 90] },
    // 캡이 ±Y → 로컬 Z = 월드 Y.
    { axis: 'y', isCap: (n) => Math.abs(Math.abs(n[1]) - 1) <= AXIS_EPS && Math.abs(n[0]) <= AXIS_EPS && Math.abs(n[2]) <= AXIS_EPS,
      isSide: (n) => Math.abs(n[1]) <= AXIS_EPS,
      toLocal: (v) => [v[2], v[0], v[1]], rotateDeg: [90, 0, 0] },
  ];

  let lastPrismReason: string | null = null;
  for (const cand of AXIS_REMAP) {
    const caps: PlaneFace[] = [];
    const sides: PlaneFace[] = [];
    let bad = false;
    for (const f of planeFaces) {
      if (cand.isCap(f.normal)) caps.push(f);
      else if (cand.isSide(f.normal)) sides.push(f);
      else { bad = true; break; }
    }
    // ⚠ 이 후보 축에서 분류가 안 된다고 **바로 실패로 단정하지 않는다** — 다른 축에서는
    //   맞을 수 있다. 처음 여기서 즉시 return 하는 바람에 X·Y 후보가 시도조차 되지 않았다.
    if (bad) continue;
    if (!(caps.length === 2 && sides.length === planeFaces.length - 2 && sides.length >= 3)) continue;
    // 재매핑된 좌표로 기존 검출기를 그대로 쓴다 — 로직을 복제하지 않는다(복제하면 갈린다).
    const remap = (f: PlaneFace): PlaneFace => ({
      normal: cand.toLocal(f.normal),
      loop: f.loop.map((v) => cand.toLocal(v)),
    });
    const prism = capsToPrism(caps.map(remap), sides.map(remap));
    if (prism.kind === 'ok') {
      return {
        kind: 'ok',
        feature: {
          kind: 'extrude',
          loop: prism.loop,
          depth: prism.depth,
          direction: 'one_sided',
          mode: 'add',
          ...(cand.rotateDeg ? { at: { rotateDeg: cand.rotateDeg } } : {}),
        },
        worldBBox: solidWorldBBox,
        ...arcApprox,
      };
    }
    lastPrismReason = `${cand.axis}축 프리즘: ${prism.reason}`;
  }
  if (lastPrismReason) return { kind: 'unsupported', reason: `prism: ${lastPrismReason}` };

  return {
    kind: 'unsupported',
    reason:
      `${planeFaces.length} planar faces — 세 주축(X·Y·Z) 어느 쪽으로도 「캡 2 + 측면 N(N≥3)」 `
      + '패턴이 아니다(박스·다각프리즘 모두 불일치)',
  };
}

// ─── face decoding ────────────────────────────────────────────────────────

interface PlaneFace {
  /** Plane normal (unit-length, but we don't enforce — we only test signs). */
  normal: [number, number, number];
  /** Ordered ring of XYZ vertex coordinates around the outer loop. */
  loop: Array<[number, number, number]>;
  /** 원호를 현으로 근사한 엣지 수 (260801) — 있으면 이 면은 **근사**다. */
  arcEdges?: number;
  /** 근사 최대 새그(mm) = R(1−cos(Δθ/2)). 「정확」이라 말하지 않기 위한 수치. */
  arcSagittaMm?: number;
}

interface CylinderFace {
  /** Axis direction of the cylinder (the AXIS2_PLACEMENT_3D's local +Z). */
  axisDir: [number, number, number];
  /** Origin of the cylinder axis in world coords. */
  axisOrigin: [number, number, number];
  /** Cylinder radius (from CYLINDRICAL_SURFACE(_, _, R)). */
  radius: number;
}

interface LinearExtrusionFace {
  /** Extrusion direction (world-space, unit-normalised). Sourced from the
   *  underlying VECTOR's DIRECTION component. */
  extrusionDir: [number, number, number];
  /** Magnitude of the underlying VECTOR (defaults to 1 if unset / 0). The
   *  effective sweep length is recomputed from the cap centres in the
   *  classifier; this is recorded only for diagnostics. */
  magnitude: number;
}

type FaceDecodeResult =
  /** Planar face with outer-bound loop decoded. */
  | { kind: 'plane'; face: PlaneFace }
  /** CYLINDRICAL_SURFACE face — outer-bound loop intentionally NOT decoded
   *  (would contain CIRCLE edges, which the linear-edge path rejects). */
  | { kind: 'cylinder'; face: CylinderFace }
  /** SURFACE_OF_LINEAR_EXTRUSION face — outer-bound loop intentionally NOT
   *  decoded; cap-plane geometry is used to reconstruct the rectangle. */
  | { kind: 'linear_extrusion'; face: LinearExtrusionFace }
  /** Non-planar, non-cylinder, non-extrusion surface we recognise but can't
   *  import yet (BSPLINE / NURBS / CONICAL / SPHERICAL / TOROIDAL /
   *  SURFACE_OF_REVOLUTION). */
  | { kind: 'other_surface'; surfaceName: string }
  /** Hard parse failure (missing entity, malformed loop, non-linear edge on
   *  a PLANE face) — aborts the entire solid with a specific reason. */
  | { kind: 'unsupported'; reason: string };

/**
 * Walk one ADVANCED_FACE and return one of:
 *   - `plane`           — PLANE surface + linear-edge outer loop
 *   - `cylinder`        — CYLINDRICAL_SURFACE (loop NOT decoded; the solid
 *                         classifier reconstructs (r, h) from the cap planes)
 *   - `other_surface`   — recognised but non-importable (BSPLINE / cone /
 *                         sphere / torus / etc); reason names the surface
 *   - `unsupported`     — hard parse error (missing entity, bad loop)
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
  const surfaceName = surface?.name ?? 'unknown';

  // ─── CYLINDRICAL_SURFACE branch ─────────────────────────────────────────
  // CYLINDRICAL_SURFACE('', #axis2_placement_3d, radius)
  if (surface && surface.name === 'CYLINDRICAL_SURFACE') {
    const axisRef = surface.args[1];
    const radiusArg = surface.args[2];
    if (!axisRef || axisRef.kind !== 'ref') {
      return { kind: 'unsupported', reason: `CYLINDRICAL_SURFACE missing axis ref` };
    }
    if (!radiusArg || radiusArg.kind !== 'number' || !(radiusArg.value > 0)) {
      return { kind: 'unsupported', reason: `CYLINDRICAL_SURFACE has non-positive radius` };
    }
    const axisPlacement = readAxisPlacement(axisRef.id, entities);
    if (!axisPlacement) {
      return { kind: 'unsupported', reason: `CYLINDRICAL_SURFACE bad AXIS2_PLACEMENT_3D` };
    }
    return {
      kind: 'cylinder',
      face: {
        axisDir: axisPlacement.zDir,
        axisOrigin: axisPlacement.origin,
        radius: radiusArg.value,
      },
    };
  }

  // ─── SURFACE_OF_LINEAR_EXTRUSION branch ─────────────────────────────────
  // SURFACE_OF_LINEAR_EXTRUSION('', #swept_curve, #extrusion_axis_vector)
  // where #extrusion_axis_vector is typically VECTOR('', #direction, magnitude).
  // We only record the direction + magnitude; the cap planes provide the
  // actual sweep length.
  if (surface && surface.name === 'SURFACE_OF_LINEAR_EXTRUSION') {
    const vecRef = surface.args[2];
    if (!vecRef || vecRef.kind !== 'ref') {
      return { kind: 'unsupported', reason: `SURFACE_OF_LINEAR_EXTRUSION missing vector ref` };
    }
    const decoded = readExtrusionVector(vecRef.id, entities);
    if (!decoded) {
      return { kind: 'unsupported', reason: `SURFACE_OF_LINEAR_EXTRUSION bad VECTOR/DIRECTION` };
    }
    return {
      kind: 'linear_extrusion',
      face: { extrusionDir: decoded.direction, magnitude: decoded.magnitude },
    };
  }

  // ─── non-planar, non-cylinder, non-extrusion surfaces ───────────────────
  // Surface kinds that Phase 2/3 explicitly recognises but cannot import.
  // Phase 4 will add BSPLINE / NURBS / cone / sphere / torus /
  // surface-of-revolution with a non-trivial profile.
  if (surface && surface.name !== 'PLANE') {
    return { kind: 'other_surface', surfaceName };
  }

  if (!surface || surface.name !== 'PLANE') {
    return { kind: 'unsupported', reason: `surface is ${surfaceName} (unknown)` };
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
  // 원호 근사 누적 — 이 면에서 근사한 엣지 수와 최대 새그(mm).
  let arcSagittaMm = 0;
  let arcEdges = 0;
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
    let arcCurve: StepEntity | null = null;
    if (curveRef && curveRef.kind === 'ref') {
      const curve = entities.get(curveRef.id);
      if (curve && curve.name && curve.name !== 'LINE' && curve.name !== 'POLYLINE') {
        /**
         * ⚠ 260801 — **원호 엣지가 임포트의 실제 병목이었다.**
         *
         * 코퍼스 STEP 전수 측정: 미지원 사유 1위가 `non-linear edge (CIRCLE)` **61건**
         * (2위 `no FACE_OUTER_BOUND` 9 · 3위 B_SPLINE 6 · 축 제약은 1건).
         * 필렛·모서리 라운드가 하나라도 있으면 **면 전체를 버렸다.**
         *
         * CIRCLE 은 **현(chord) 분할로 근사**해서 받는다. 그 대신:
         *  · 근사임을 노드까지 전파한다(`arcApprox`) — 「정확 복원」이라 말하지 않는다.
         *  · 오차를 **수치로** 낸다(새그 = R(1−cos(Δθ/2))). 못 내면 근사하지 않는다.
         * 앞서 `stepFileBounds` 를 「OCCT 정확 경계」로 적어 놓고 실제로 최대 +73% 부풀던
         * 전례가 있다 — 근사를 정확이라 적는 것이 그때의 결함이었다.
         *
         * B_SPLINE·기타 곡선은 **그대로 거부한다** — 제어점 없이 현 분할을 하면
         * 그건 근사가 아니라 지어내기다.
         */
        if (curve.name === 'CIRCLE') arcCurve = curve;
        else {
          return {
            kind: 'unsupported',
            reason: `non-linear edge (${curve.name}) — likely curved surface`,
          };
        }
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
    if (arcCurve) {
      const arc = arcChordPoints(arcCurve, forwardOe ? start : end, forwardOe ? end : start, entities);
      if (!arc) {
        return { kind: 'unsupported', reason: 'CIRCLE 엣지의 중심·반경을 읽지 못해 근사하지 않았다' };
      }
      for (const q of arc.points) if (!pointEq(ring[ring.length - 1]!, q)) ring.push(q);
      arcSagittaMm = Math.max(arcSagittaMm, arc.sagittaMm);
      arcEdges += 1;
    }
  }
  if (ring.length < 3) {
    return { kind: 'unsupported', reason: `loop has ${ring.length} distinct vertices, need ≥ 3` };
  }
  // Drop a closing duplicate vertex if present (some writers repeat v0 at end).
  if (ring.length > 3 && pointEq(ring[0]!, ring[ring.length - 1]!)) {
    ring.pop();
  }
  return {
    kind: 'plane',
    face: { normal, loop: ring, ...(arcEdges ? { arcEdges, arcSagittaMm } : {}) },
  };
}

/**
 * CIRCLE 엣지를 **현(chord) 분할**로 근사한다 (260801).
 *
 * CIRCLE('', #axis2_placement_3d, R) — 중심·법선·반경을 읽고, 시작·끝 정점의 각도를 구해
 * 그 사이를 등분한다. 분할 수는 **허용 새그**에서 정한다(임의 개수가 아니다):
 *   새그 = R(1 − cos(Δθ/2)) ≤ TOL  →  Δθ ≤ 2·acos(1 − TOL/R)
 *
 * ⚠ 중심·반경·법선 중 하나라도 못 읽으면 **null** 을 돌려 근사하지 않는다.
 *   추정한 중심으로 현을 만들면 그건 근사가 아니라 지어내기다.
 * ⚠ 정점이 일치(완전한 원)하면 시작=끝이라 각도 구간이 정해지지 않는다 — 전원(360°)으로
 *   보고 등분한다(원형 개구·보스의 실제 형태다).
 */
const ARC_CHORD_TOL_MM = 0.2;
function arcChordPoints(
  circle: StepEntity,
  start: [number, number, number],
  end: [number, number, number],
  entities: Map<number, StepEntity>,
): { points: Array<[number, number, number]>; sagittaMm: number } | null {
  const placeRef = circle.args[1];
  const radArg = circle.args[2];
  if (!placeRef || placeRef.kind !== 'ref') return null;
  const R = radArg?.kind === 'number' ? radArg.value : NaN;
  if (!Number.isFinite(R) || !(R > 0)) return null;
  const ent = entities.get(placeRef.id);
  if (!ent || ent.name !== 'AXIS2_PLACEMENT_3D') return null;
  const originRef = ent.args[1];
  const zRef = ent.args[2];
  const xRef = ent.args[3];
  if (!originRef || originRef.kind !== 'ref') return null;
  const C = readCartesianPoint(originRef.id, entities);
  if (!C) return null;
  const zDir = zRef && zRef.kind === 'ref' ? readDirection(zRef.id, entities) : null;
  const xDir = xRef && xRef.kind === 'ref' ? readDirection(xRef.id, entities) : null;
  if (!zDir || !xDir) return null;
  const z = unitVec(zDir);
  // X 축을 법선에 직교화(STEP 의 refdir 은 직교 보장이 없다)
  const dotXZ = xDir[0] * z[0] + xDir[1] * z[1] + xDir[2] * z[2];
  const xRaw: [number, number, number] = [xDir[0] - dotXZ * z[0], xDir[1] - dotXZ * z[1], xDir[2] - dotXZ * z[2]];
  const x = unitVec(xRaw);
  if (!(Math.hypot(x[0], x[1], x[2]) > 0.5)) return null;
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0],
  ];
  const ang = (p: [number, number, number]) => {
    const d: [number, number, number] = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
    return Math.atan2(d[0] * y[0] + d[1] * y[1] + d[2] * y[2], d[0] * x[0] + d[1] * x[1] + d[2] * x[2]);
  };
  const a0 = ang(start);
  let sweep = ang(end) - a0;
  while (sweep <= 1e-9) sweep += 2 * Math.PI;      // 반시계 기준 정규화
  if (pointEq(start, end)) sweep = 2 * Math.PI;    // 완전한 원
  const ratio = Math.max(-1, Math.min(1, 1 - ARC_CHORD_TOL_MM / R));
  const dMax = 2 * Math.acos(ratio);
  const n = Math.max(1, Math.min(64, Math.ceil(sweep / Math.max(1e-6, dMax))));
  const dth = sweep / n;
  const points: Array<[number, number, number]> = [];
  // 끝점은 다음 엣지가 넣으므로 **중간점만** 넣는다(중복 정점 방지).
  for (let i = 1; i < n; i++) {
    const t = a0 + dth * i;
    const c = Math.cos(t), sn = Math.sin(t);
    points.push([
      C[0] + R * (c * x[0] + sn * y[0]),
      C[1] + R * (c * x[1] + sn * y[1]),
      C[2] + R * (c * x[2] + sn * y[2]),
    ]);
  }
  return { points, sagittaMm: R * (1 - Math.cos(dth / 2)) };
}

/**
 * Decode an AXIS2_PLACEMENT_3D entity into `{ origin, zDir }`. Returns null
 * if any sub-entity is missing or malformed. The refdir (X axis) is parsed
 * but not returned — Phase 2 only uses the Z axis for cylinder / revolve
 * axis-alignment checks.
 */
function readAxisPlacement(
  id: number,
  entities: Map<number, StepEntity>,
): { origin: [number, number, number]; zDir: [number, number, number] } | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'AXIS2_PLACEMENT_3D') return null;
  // AXIS2_PLACEMENT_3D('', #cartesian_point, #zdir, #refdir)
  const originRef = ent.args[1];
  const zDirRef = ent.args[2];
  if (!originRef || originRef.kind !== 'ref') return null;
  if (!zDirRef || zDirRef.kind !== 'ref') return null;
  const origin = readCartesianPoint(originRef.id, entities);
  const zDir = readDirection(zDirRef.id, entities);
  if (!origin || !zDir) return null;
  return { origin, zDir };
}

/** Decode an AXIS1_PLACEMENT entity (used by REVOLVED_AREA_SOLID). */
function readAxis1Placement(
  id: number,
  entities: Map<number, StepEntity>,
): { origin: [number, number, number]; direction: [number, number, number] } | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'AXIS1_PLACEMENT') return null;
  // AXIS1_PLACEMENT('', #cartesian_point, #direction)
  const originRef = ent.args[1];
  const dirRef = ent.args[2];
  if (!originRef || originRef.kind !== 'ref') return null;
  if (!dirRef || dirRef.kind !== 'ref') return null;
  const origin = readCartesianPoint(originRef.id, entities);
  const direction = readDirection(dirRef.id, entities);
  if (!origin || !direction) return null;
  return { origin, direction };
}

function readCartesianPoint(
  id: number,
  entities: Map<number, StepEntity>,
): [number, number, number] | null {
  const cp = entities.get(id);
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

/**
 * Decode a VECTOR entity (`VECTOR('', #direction, magnitude)`) into
 * `{ direction (unit-normalised), magnitude }`. Returns null if any
 * sub-entity is missing or malformed. The direction is normalised here so
 * callers can use it directly as a unit vector; the magnitude is preserved
 * for traceability (cap planes are still the authoritative sweep length).
 */
function readExtrusionVector(
  id: number,
  entities: Map<number, StepEntity>,
): { direction: [number, number, number]; magnitude: number } | null {
  const ent = entities.get(id);
  if (!ent || ent.name !== 'VECTOR') return null;
  const dirRef = ent.args[1];
  const magArg = ent.args[2];
  if (!dirRef || dirRef.kind !== 'ref') return null;
  const dir = readDirection(dirRef.id, entities);
  if (!dir) return null;
  // Magnitude defaults to 1 when missing / non-numeric / 0 (some writers
  // emit `$` because the cap planes carry the true length).
  let magnitude = 1;
  if (magArg && magArg.kind === 'number' && Number.isFinite(magArg.value) && magArg.value > 0) {
    magnitude = magArg.value;
  }
  // Normalise the direction so callers can treat it as a unit vector.
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const unit: [number, number, number] =
    len > 1e-12 ? [dir[0] / len, dir[1] / len, dir[2] / len] : [dir[0], dir[1], dir[2]];
  return { direction: unit, magnitude };
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

/**
 * **판재 + 원통 홀** 검출 (260801c).
 *
 * 조건 — 하나라도 어긋나면 **null**(추측해서 받지 않는다):
 *  ① 세 주축 중 하나에 대해 캡 평면 2장(법선 ∥ 축) + 측면 N장(법선 ⊥ 축)
 *  ② **모든** 원통면의 축이 그 축과 평행 — 비평행 원통은 홀이 아니라 다른 형상이다
 *  ③ 원통 축이 캡 외곽 **안쪽**에 있다 — 밖/경계면 그건 모서리 라운드(외부 필렛)이지 홀이 아니다
 *  ④ 기존 `capsToPrism` 이 통과 — 외곽 폴리곤·두께 산출 로직을 **재사용**한다(복제하면 갈린다)
 *
 * 반환: 외곽 프리즘 `ExtrudeFeature` + **미반영 홀 고지**(개수·반경·부피 과대율).
 */
function prismWithCylindricalHoles(
  planeFaces: PlaneFace[],
  cylinderFaces: CylinderFace[],
  entities: Map<number, StepEntity>,
): { feature: ExtrudeFeature; holes: { count: number; radiiMm: number[]; volumeOverPct: number } } | null {
  void entities;
  const AXES: Array<{
    axis: 0 | 1 | 2;
    isCap: (n: [number, number, number]) => boolean;
    toLocal: (v: [number, number, number]) => [number, number, number];
    rotateDeg: [number, number, number] | null;
  }> = [
    { axis: 2, isCap: (n) => isZAxisNormal(n), toLocal: (v) => v, rotateDeg: null },
    { axis: 0,
      isCap: (n) => Math.abs(Math.abs(n[0]) - 1) <= AXIS_EPS && Math.abs(n[1]) <= AXIS_EPS && Math.abs(n[2]) <= AXIS_EPS,
      toLocal: (v) => [v[1], v[2], v[0]], rotateDeg: [90, 0, 90] },
    { axis: 1,
      isCap: (n) => Math.abs(Math.abs(n[1]) - 1) <= AXIS_EPS && Math.abs(n[0]) <= AXIS_EPS && Math.abs(n[2]) <= AXIS_EPS,
      toLocal: (v) => [v[2], v[0], v[1]], rotateDeg: [90, 0, 0] },
  ];
  for (const cand of AXES) {
    const caps: PlaneFace[] = [];
    const sides: PlaneFace[] = [];
    let bad = false;
    for (const f of planeFaces) {
      if (cand.isCap(f.normal)) caps.push(f);
      else if (Math.abs(f.normal[cand.axis]) <= AXIS_EPS) sides.push(f);
      else { bad = true; break; }
    }
    if (bad || caps.length !== 2 || sides.length < 3) continue;
    // ② 모든 원통 축이 캡 축과 평행해야 홀이다.
    const axisDir: [number, number, number] = [0, 0, 0];
    axisDir[cand.axis] = 1;
    if (!cylinderFaces.every((c) => directionsParallel(c.axisDir, axisDir))) continue;
    const remap = (f: PlaneFace): PlaneFace => ({
      normal: cand.toLocal(f.normal),
      loop: f.loop.map((v) => cand.toLocal(v)),
    });
    /**
     * ⚠ `capsToPrism` 을 쓰지 않는다 — 그 함수는 **「캡 정점 수 = 측면 수」**를 요구한다.
     *   원호 근사(260801)로 캡 루프에 현 점이 들어간 뒤로 그 등식은 성립하지 않는다.
     *   실측: 판재 18면(원통 8 + 평면 10)에서 캡 루프는 현 점을 포함해 훨씬 길고 측면은 8장이라
     *   전부 탈락했다. 프리즘 판정에 필요한 것은 **캡 2장이 평행·평면**이라는 사실뿐이다.
     */
    const prism = capsToOutline(caps.map(remap));
    if (!prism) continue;
    /**
     * ③ 원통을 **홀**과 **모서리 라운드**로 나눈다 — 둘 다 축이 판 축과 평행해서 구별이 필요하다.
     *
     * 실측한 구조: 판재 18면 = 캡 2 + 외곽 평면 측면 8 + 원통 8. 그 원통은 **모서리 라운드**와
     * **홀**이 섞여 있었다. 둘을 뭉개면 라운드를 홀로 세어 「부피 과대율」이 거짓이 된다.
     *
     * 판정: 중심에서 외곽까지의 거리 d 와 반경 r 을 비교한다.
     *   · d ≥ r − tol  → 원이 외곽 **안쪽에 온전히** 들어간다 → **홀**
     *   · 그 밖        → 외곽에 접하거나 걸친다 → **모서리 라운드**(이미 캡 루프의 현으로 표현됨)
     * 라운드는 세지 않는다 — 이미 형상에 있으므로 손실이 아니다.
     */
    const TOL = 1e-3;
    const holesFound: Array<{ x: number; y: number; r: number }> = [];
    let rounds = 0;
    for (const c of cylinderFaces) {
      const q = cand.toLocal(c.axisOrigin);
      const inside = pointInPolygon(q[0], q[1], prism.loop);
      const dEdge = distancePointToLoop(q[0], q[1], prism.loop);
      if (inside && dEdge >= c.radius - TOL) {
        // 같은 홀의 반쪽 원통면이 2장으로 쪼개져 오는 경우가 흔하다 — 중심·반경으로 병합.
        if (!holesFound.some((u) => Math.hypot(u.x - q[0], u.y - q[1]) < TOL && Math.abs(u.r - c.radius) < 1e-6)) {
          holesFound.push({ x: q[0], y: q[1], r: c.radius });
        }
      } else rounds += 1;
    }
    const uniq = holesFound;
    const outerArea = Math.abs(polygonSignedArea(prism.loop));
    const holeArea = uniq.reduce((sum, u) => sum + Math.PI * u.r * u.r, 0);
    if (!(outerArea > 0) || holeArea >= outerArea) continue;   // 홀이 외곽을 다 먹으면 판이 아니다
    return {
      feature: {
        kind: 'extrude',
        loop: prism.loop,
        depth: prism.depth,
        direction: 'one_sided',
        mode: 'add',
        ...(cand.rotateDeg ? { at: { rotateDeg: cand.rotateDeg } } : {}),
      } as ExtrudeFeature,
      holes: {
        count: uniq.length,
        radiiMm: uniq.map((u) => +u.r.toFixed(4)),
        volumeOverPct: +((holeArea / outerArea) * 100).toFixed(2),
      },
    };
  }
  return null;
}

/**
 * 캡 2장 → **외곽 폴리곤 + 두께** (260801c).
 *
 * `capsToPrism` 과 달리 **측면 수를 요구하지 않는다** — 원호 근사 후 캡 루프에 현 점이
 * 들어가면 「캡 정점 수 = 측면 수」가 성립하지 않는다(실측으로 확인). 프리즘 판정에
 * 필요한 것은 캡 2장이 각각 평면이고 서로 다른 축 위치에 있다는 사실이다.
 * 로컬 프레임(캡 축 = Z)으로 재매핑된 입력을 받는다.
 */
function capsToOutline(caps: PlaneFace[]): { loop: Array<{ x: number; y: number }>; depth: number } | null {
  let bottom: PlaneFace | null = null;
  let top: PlaneFace | null = null;
  for (const c of caps) {
    if (c.normal[2] < -0.5) bottom = c;
    else if (c.normal[2] > 0.5) top = c;
  }
  if (!bottom || !top || bottom.loop.length < 3) return null;
  const z0 = bottom.loop[0]![2];
  const z1 = top.loop[0]![2];
  for (const v of bottom.loop) if (Math.abs(v[2] - z0) > POINT_EPS) return null;
  for (const v of top.loop) if (Math.abs(v[2] - z1) > POINT_EPS) return null;
  const depth = Math.abs(z1 - z0);
  if (!(depth > POINT_EPS)) return null;
  // 아래 캡은 아래에서 보면 CCW 라 뒤집어야 IR 이 기대하는 CCW XY 루프가 된다.
  const xy = bottom.loop.slice().reverse().map((v) => ({ x: v[0], y: v[1] }));
  if (polygonSignedArea(xy) <= 0) xy.reverse();
  return { loop: xy, depth };
}

/** 점에서 폴리곤 **경계**까지의 최단거리(세그먼트 기준). */
function distancePointToLoop(px: number, py: number, loop: ReadonlyArray<{ x: number; y: number }>): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)));
  }
  return best;
}

/** 폴리곤 부호면적(CCW=+). */
function polygonSignedArea(loop: ReadonlyArray<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!, q = loop[(i + 1) % loop.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 점이 폴리곤 내부인가 — ray casting. 경계 위는 **내부로 보지 않는다**(홀이 아니라 라운드다). */
function pointInPolygon(px: number, py: number, loop: ReadonlyArray<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!, b = loop[j]!;
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ─── cylinder primitive → RevolveFeature ──────────────────────────────────

type CylinderRevolveResult =
  | { kind: 'ok'; feature: RevolveFeature }
  | { kind: 'unsupported'; reason: string };

/**
 * Reconstruct a `RevolveFeature` from a BREP cylinder: 1 CYLINDRICAL_SURFACE
 * side face + 2 PLANE cap faces.
 *
 * Requirements (Phase 2):
 *   - Cylinder axis direction MUST be ±X / ±Y / ±Z (axis-aligned).
 *   - Both cap normals must be parallel (within AXIS_EPS) to the cylinder
 *     axis, and the two caps must lie on opposite sides of the cylinder
 *     origin along the axis.
 *
 * Output: a `RevolveFeature` whose loop is the rectangle
 *   `[(0,0), (r,0), (r,h), (0,h)]`
 * in the canonical rotate_extrude frame (axis = +Y, profile in X ≥ 0 half).
 * Height `h = distance between the two cap centres along the cylinder axis`.
 *
 * Note: this representation discards the original world-space axis. The
 * Phase 3 follow-up will store the axis classifier (`'x' | 'y' | 'z'`) on
 * a side-channel so the editor can re-orient the part in the viewport
 * without rebuilding the IR.
 */
function cylinderToRevolve(
  cyl: CylinderFace,
  caps: PlaneFace[],
): CylinderRevolveResult {
  const axisKind = classifyAxisAlignment(cyl.axisDir);
  if (axisKind === null) {
    return {
      kind: 'unsupported',
      reason:
        `cylinder axis (${formatDir(cyl.axisDir)}) is not axis-aligned ` +
        `(Phase 2 limit: only ±X/±Y/±Z)`,
    };
  }
  if (caps.length !== 2) {
    return { kind: 'unsupported', reason: `expected 2 cap planes, got ${caps.length}` };
  }
  // Both cap normals must be parallel to the cylinder axis.
  for (const cap of caps) {
    if (!directionsParallel(cap.normal, cyl.axisDir)) {
      return {
        kind: 'unsupported',
        reason:
          `cap plane normal (${formatDir(cap.normal)}) not parallel to cylinder axis ` +
          `(${formatDir(cyl.axisDir)})`,
      };
    }
  }
  // Compute cap centroids and project onto the cylinder axis.
  const axisU = unitVec(cyl.axisDir);
  const projs: number[] = [];
  for (const cap of caps) {
    const c = centroid(cap.loop);
    const dx = c[0] - cyl.axisOrigin[0];
    const dy = c[1] - cyl.axisOrigin[1];
    const dz = c[2] - cyl.axisOrigin[2];
    projs.push(dx * axisU[0] + dy * axisU[1] + dz * axisU[2]);
  }
  const height = Math.abs(projs[1]! - projs[0]!);
  if (!(height > POINT_EPS)) {
    return { kind: 'unsupported', reason: `degenerate cylinder height: ${height}` };
  }
  // Build the canonical revolve loop: rectangle (radius × height) in the
  // X≥0 half-plane, axis = +Y. Loop walks CCW.
  const r = cyl.radius;
  const feature: RevolveFeature = {
    kind: 'revolve',
    loop: [
      { x: 0, y: 0 },
      { x: r, y: 0 },
      { x: r, y: height },
      { x: 0, y: height },
    ],
    angleDegrees: 360,
    mode: 'add',
  };
  return { kind: 'ok', feature };
}

// ─── linear extrusion primitive → SweepFeature ────────────────────────────

type LinearExtrusionSweepResult =
  | { kind: 'ok'; feature: SweepFeature }
  | { kind: 'unsupported'; reason: string };

/**
 * Reconstruct a `SweepFeature` from a BREP linear-extrusion primitive: 1
 * SURFACE_OF_LINEAR_EXTRUSION side face + 2 PLANE cap faces.
 *
 * Requirements (Phase 3):
 *   - Extrusion direction MUST be ±X / ±Y / ±Z (axis-aligned).
 *   - Both cap normals must be parallel (within AXIS_EPS) to the extrusion
 *     direction, and the two caps must lie on opposite sides of the
 *     swept-curve origin along the extrusion direction.
 *   - The two cap planes must share the same vertex set (in the plane
 *     perpendicular to the extrusion axis), so the rectangle / polygon
 *     profile is well-defined.
 *
 * Output: a `SweepFeature` whose:
 *   - `profile` is the bottom cap polygon projected into 2D (XY when
 *     extruded along Z; XZ along Y; YZ along X);
 *   - `path` is the 2-point polyline `[bottomCentre, topCentre]` in world
 *     coordinates.
 *
 * Phase 3 limit: this branch fires only when the side face is a single
 * SURFACE_OF_LINEAR_EXTRUSION — multiple extrusion surfaces or mixed
 * extrusion + cylinder bodies (common for filleted prisms) are routed to
 * `unsupported`.
 */
function linearExtrusionToSweep(
  ext: LinearExtrusionFace,
  caps: PlaneFace[],
): LinearExtrusionSweepResult {
  const axisKind = classifyAxisAlignment(ext.extrusionDir);
  if (axisKind === null) {
    return {
      kind: 'unsupported',
      reason:
        `extrusion direction (${formatDir(ext.extrusionDir)}) is not axis-aligned ` +
        `(Phase 3 limit: only ±X/±Y/±Z)`,
    };
  }
  if (caps.length !== 2) {
    return { kind: 'unsupported', reason: `expected 2 cap planes, got ${caps.length}` };
  }
  // Both cap normals must be parallel to the extrusion direction.
  for (const cap of caps) {
    if (!directionsParallel(cap.normal, ext.extrusionDir)) {
      return {
        kind: 'unsupported',
        reason:
          `cap plane normal (${formatDir(cap.normal)}) not parallel to extrusion direction ` +
          `(${formatDir(ext.extrusionDir)})`,
      };
    }
  }
  // Sanity: caps must have matching vertex counts (the profile is uniform
  // along the sweep — different counts mean it's actually a loft).
  if (caps[0]!.loop.length !== caps[1]!.loop.length) {
    return {
      kind: 'unsupported',
      reason:
        `cap vertex counts differ (${caps[0]!.loop.length} vs ${caps[1]!.loop.length}) — ` +
        `non-uniform profile (likely loft, Phase 4)`,
    };
  }
  if (caps[0]!.loop.length < 3) {
    return { kind: 'unsupported', reason: `cap has ${caps[0]!.loop.length} vertices, need ≥ 3` };
  }
  // Compute cap centroids and order: project along the extrusion axis and
  // use the smaller projection as the bottom (path start).
  const axisU = unitVec(ext.extrusionDir);
  const projs: number[] = [];
  const centres: Array<[number, number, number]> = [];
  for (const cap of caps) {
    const c = centroid(cap.loop);
    centres.push(c);
    projs.push(c[0] * axisU[0] + c[1] * axisU[1] + c[2] * axisU[2]);
  }
  const bottomIdx = projs[0]! <= projs[1]! ? 0 : 1;
  const topIdx = 1 - bottomIdx;
  const bottom = caps[bottomIdx]!;
  const top = caps[topIdx]!;
  const sweepLen = Math.abs(projs[topIdx]! - projs[bottomIdx]!);
  if (!(sweepLen > POINT_EPS)) {
    return { kind: 'unsupported', reason: `degenerate extrusion length: ${sweepLen}` };
  }
  // Verify the top cap's vertex set matches the bottom in the perpendicular
  // plane (it's the same profile, just translated along the axis).
  if (!vertexSetsMatchInPerpPlane(bottom.loop, top.loop, axisKind)) {
    return {
      kind: 'unsupported',
      reason: `cap vertex sets do not match in plane perpendicular to ${axisKind.toUpperCase()} axis`,
    };
  }
  // Project the bottom cap into the 2D plane perpendicular to the axis.
  const profile2D: Array<{ x: number; y: number }> = [];
  for (const v of bottom.loop) {
    profile2D.push(perpProject(v, axisKind));
  }
  // Drop closing duplicate if present.
  if (
    profile2D.length > 3 &&
    Math.abs(profile2D[0]!.x - profile2D[profile2D.length - 1]!.x) <= POINT_EPS &&
    Math.abs(profile2D[0]!.y - profile2D[profile2D.length - 1]!.y) <= POINT_EPS
  ) {
    profile2D.pop();
  }
  return {
    kind: 'ok',
    feature: {
      kind: 'sweep',
      profile: { points: profile2D },
      path: [
        { x: centres[bottomIdx]![0], y: centres[bottomIdx]![1], z: centres[bottomIdx]![2] },
        { x: centres[topIdx]![0], y: centres[topIdx]![1], z: centres[topIdx]![2] },
      ],
      mode: 'add',
    },
  };
}

/**
 * Project a 3D point into 2D by dropping the axis component:
 *   - X axis → (Y, Z)
 *   - Y axis → (X, Z)
 *   - Z axis → (X, Y)
 */
function perpProject(
  v: [number, number, number],
  axisKind: 'x' | 'y' | 'z',
): { x: number; y: number } {
  if (axisKind === 'x') return { x: v[1], y: v[2] };
  if (axisKind === 'y') return { x: v[0], y: v[2] };
  return { x: v[0], y: v[1] };
}

/**
 * Verify two loops have the same vertex set in the plane perpendicular to
 * the extrusion axis (any rotation / reflection is fine — order will be
 * fixed downstream by the loop walker). Equivalent to `xyVertexSetsMatch`
 * but parameterised on which 2 components to compare.
 */
function vertexSetsMatchInPerpPlane(
  a: Array<[number, number, number]>,
  b: Array<[number, number, number]>,
  axisKind: 'x' | 'y' | 'z',
): boolean {
  if (a.length !== b.length) return false;
  const used = new Array<boolean>(b.length).fill(false);
  for (const va of a) {
    const va2 = perpProject(va, axisKind);
    let matched = false;
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue;
      const vb2 = perpProject(b[j]!, axisKind);
      if (Math.abs(va2.x - vb2.x) <= POINT_EPS && Math.abs(va2.y - vb2.y) <= POINT_EPS) {
        used[j] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

// ─── SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID → SweepFeature ────────────────

type SweptAreaSolidResult =
  | { kind: 'ok'; feature: SweepFeature; worldBBox?: WorldBBox | null }
  | { kind: 'unsupported'; reason: string };

/**
 * Parse a SWEPT_AREA_SOLID or EXTRUDED_AREA_SOLID entity directly into a
 * `SweepFeature`.
 *
 * Entity shapes (ISO 10303-42 Part 4 §4.3.5):
 *   EXTRUDED_AREA_SOLID('', #swept_area, #extruded_direction, depth)
 *   SWEPT_AREA_SOLID   ('', #swept_area, #extrusion_axis)
 *
 * The arity differs by one (EXTRUDED has an explicit `depth` scalar after
 * the direction; SWEPT_AREA_SOLID's "extrusion_axis" is sometimes a
 * DIRECTION + magnitude-1, sometimes a VECTOR). We accept either: if arg[2]
 * resolves to a DIRECTION we expect a depth in arg[3]; if it resolves to a
 * VECTOR we take depth = |vector|.
 *
 * Where `#swept_area` is typically `PLANAR_FACE` referencing a
 * `FACE_OUTER_BOUND` → `EDGE_LOOP` with linear `EDGE_CURVE`s (the same
 * subset the revolve reader supports).
 *
 * Extrusion direction MUST be ±X / ±Y / ±Z. Arbitrary directions are
 * routed to `unsupported` with a `not axis-aligned` reason.
 *
 * Output: a `SweepFeature` whose:
 *   - `profile` is the swept_area's outer-loop vertex ring projected into
 *     2D by dropping the extrusion-axis component (this preserves the
 *     source-plane coordinates since axis-aligned extrusions fully
 *     decouple);
 *   - `path` is the 2-point polyline `[origin, origin + depth * axis]` in
 *     world coordinates.
 */
function sweptAreaSolidToSweep(
  sweptId: number,
  entities: Map<number, StepEntity>,
): SweptAreaSolidResult {
  const ent = entities.get(sweptId);
  if (!ent || (ent.name !== 'SWEPT_AREA_SOLID' && ent.name !== 'EXTRUDED_AREA_SOLID')) {
    return { kind: 'unsupported', reason: `not a SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID` };
  }
  // args[0]=name, args[1]=swept_area, args[2]=direction-or-vector, args[3?]=depth.
  const sweptAreaArg = ent.args[1];
  const dirArg = ent.args[2];
  const depthArg = ent.args[3];
  if (!sweptAreaArg || sweptAreaArg.kind !== 'ref') {
    return { kind: 'unsupported', reason: `${ent.name} missing swept_area ref` };
  }
  if (!dirArg || dirArg.kind !== 'ref') {
    return { kind: 'unsupported', reason: `${ent.name} missing extrusion direction/vector ref` };
  }
  // Resolve the direction reference: it could point at either a DIRECTION
  // (with depth in arg[3]) or a VECTOR (with magnitude = depth and arg[3]
  // unused). Try DIRECTION first, then fall back to VECTOR.
  let extrusionDir: [number, number, number] | null = null;
  let depth = 0;
  const dirEnt = entities.get(dirArg.id);
  if (dirEnt && dirEnt.name === 'DIRECTION') {
    extrusionDir = readDirection(dirArg.id, entities);
    if (depthArg && depthArg.kind === 'number') {
      // Honour the explicit depth, including 0 (which we reject below as
      // degenerate). This is important for round-tripping SWEPT_AREA_SOLID
      // files where depth=0 indicates "the producer wrote a malformed
      // entity"; we should surface that, not silently default to 1.
      depth = depthArg.value;
    } else if (!depthArg || depthArg.kind === 'null') {
      // No depth given: default to magnitude 1 — some viewers emit
      // SWEPT_AREA_SOLID with no scalar at all (treating direction as a
      // pre-scaled "translation vector").
      depth = 1;
    } else {
      // Non-numeric depth (string / enum / list / ref) — reject explicitly.
      return { kind: 'unsupported', reason: `${ent.name} has non-numeric depth` };
    }
  } else if (dirEnt && dirEnt.name === 'VECTOR') {
    const decoded = readExtrusionVector(dirArg.id, entities);
    if (decoded) {
      extrusionDir = decoded.direction;
      depth = decoded.magnitude;
    }
  }
  if (!extrusionDir) {
    return { kind: 'unsupported', reason: `${ent.name} extrusion ref is not DIRECTION or VECTOR` };
  }
  if (!(depth > POINT_EPS)) {
    return { kind: 'unsupported', reason: `${ent.name} has degenerate depth ${depth}` };
  }
  const axisKind = classifyAxisAlignment(extrusionDir);
  if (axisKind === null) {
    return {
      kind: 'unsupported',
      reason:
        `extrusion direction (${formatDir(extrusionDir)}) is not axis-aligned ` +
        `(Phase 3 limit: only ±X/±Y/±Z)`,
    };
  }

  // ─── decode the swept_area profile (re-uses the revolve helper) ─────────
  const profile = readSweptAreaProfile(sweptAreaArg.id, entities);
  if (profile.kind !== 'ok') {
    return { kind: 'unsupported', reason: `swept_area: ${profile.reason}` };
  }
  if (profile.points.length < 3) {
    return {
      kind: 'unsupported',
      reason: `swept_area has ${profile.points.length} points, need ≥ 3`,
    };
  }

  // ─── project the profile into 2D (drop the axis component) ──────────────
  // For axis-aligned extrusions the profile lies fully in the perpendicular
  // plane (or is treated as such — any axial drift is ignored).
  const profile2D: Array<{ x: number; y: number }> = [];
  for (const p of profile.points) {
    profile2D.push(perpProject(p, axisKind));
  }
  // Drop closing duplicate if present.
  if (
    profile2D.length > 3 &&
    Math.abs(profile2D[0]!.x - profile2D[profile2D.length - 1]!.x) <= POINT_EPS &&
    Math.abs(profile2D[0]!.y - profile2D[profile2D.length - 1]!.y) <= POINT_EPS
  ) {
    profile2D.pop();
  }

  // ─── build the world-space path: [origin, origin + depth * axis] ────────
  // The "origin" of the path is taken as the centroid of the swept_area in
  // world coords; that places the path on the profile plane so a downstream
  // CAD viewer can render the swept solid without an extra transform.
  const origin = centroid(profile.points);
  const axisU = unitVec(extrusionDir);
  // World extent = union of the swept_area profile and its translate along the axis.
  const sweptWorldBBox = bboxOfSweptProfile(profile.points, axisU, depth);
  return {
    kind: 'ok',
    worldBBox: sweptWorldBBox,
    feature: {
      kind: 'sweep',
      profile: { points: profile2D },
      path: [
        { x: origin[0], y: origin[1], z: origin[2] },
        {
          x: origin[0] + depth * axisU[0],
          y: origin[1] + depth * axisU[1],
          z: origin[2] + depth * axisU[2],
        },
      ],
      mode: 'add',
    },
  };
}

// ─── REVOLVED_AREA_SOLID → RevolveFeature ─────────────────────────────────

type RevolvedAreaResult =
  | { kind: 'ok'; feature: RevolveFeature; worldBBox?: WorldBBox | null }
  | { kind: 'unsupported'; reason: string };

/**
 * Parse a REVOLVED_AREA_SOLID entity directly into a `RevolveFeature`.
 *
 * Entity shape (ISO 10303-42 Part 4 §4.3.4):
 *   REVOLVED_AREA_SOLID('', #swept_area, #axis1_placement, angle)
 *
 * Where `#swept_area` is typically:
 *   - `PLANAR_FACE` referencing a `FACE_OUTER_BOUND` → `EDGE_LOOP` with
 *     linear `EDGE_CURVE`s (which is what we support);
 *   - or a curve-bounded surface / non-planar profile (NOT supported in
 *     Phase 2 — flagged with `complex profile` reason).
 *
 * Axis (AXIS1_PLACEMENT) MUST be ±X / ±Y / ±Z. Arbitrary axes are routed
 * to `unsupported` with a `not axis-aligned` reason.
 *
 * The profile is extracted as a list of (x, y, z) world points, then
 * transformed into the canonical rotate_extrude frame (axis = +Y, profile
 * in X ≥ 0 half) by:
 *   1. projecting each profile point onto the axis (→ canonical Y),
 *   2. taking the absolute perpendicular distance from the axis (→ canonical X).
 */
function revolvedAreaSolidToRevolve(
  revolveId: number,
  entities: Map<number, StepEntity>,
): RevolvedAreaResult {
  const ent = entities.get(revolveId);
  if (!ent || ent.name !== 'REVOLVED_AREA_SOLID') {
    return { kind: 'unsupported', reason: `not a REVOLVED_AREA_SOLID` };
  }
  // args[0]=name, args[1]=swept_area, args[2]=axis, args[3]=angle.
  const sweptAreaArg = ent.args[1];
  const axisArg = ent.args[2];
  const angleArg = ent.args[3];
  if (!sweptAreaArg || sweptAreaArg.kind !== 'ref') {
    return { kind: 'unsupported', reason: `REVOLVED_AREA_SOLID missing swept_area ref` };
  }
  if (!axisArg || axisArg.kind !== 'ref') {
    return { kind: 'unsupported', reason: `REVOLVED_AREA_SOLID missing AXIS1_PLACEMENT ref` };
  }
  // Angle is in radians per ISO 10303. Some viewers emit 0 to mean "full
  // revolve"; we treat 0 / null / missing as 2π.
  let angleRad = 2 * Math.PI;
  if (angleArg && angleArg.kind === 'number' && angleArg.value > 0) {
    angleRad = angleArg.value;
  }
  if (angleRad > 2 * Math.PI + 1e-6) {
    return { kind: 'unsupported', reason: `revolve angle ${angleRad} rad exceeds 2π` };
  }
  const angleDegrees = (angleRad * 180) / Math.PI;

  // ─── decode axis ────────────────────────────────────────────────────────
  const axisPlacement = readAxis1Placement(axisArg.id, entities);
  if (!axisPlacement) {
    return { kind: 'unsupported', reason: `bad AXIS1_PLACEMENT entity` };
  }
  const axisKind = classifyAxisAlignment(axisPlacement.direction);
  if (axisKind === null) {
    return {
      kind: 'unsupported',
      reason:
        `revolve axis (${formatDir(axisPlacement.direction)}) is not axis-aligned ` +
        `(Phase 2 limit: only ±X/±Y/±Z)`,
    };
  }

  // ─── decode profile ────────────────────────────────────────────────────
  const profile = readSweptAreaProfile(sweptAreaArg.id, entities);
  if (profile.kind !== 'ok') {
    return { kind: 'unsupported', reason: `swept_area: ${profile.reason}` };
  }
  if (profile.points.length < 3) {
    return {
      kind: 'unsupported',
      reason: `swept_area has ${profile.points.length} points, need ≥ 3`,
    };
  }

  // ─── transform profile into canonical (axis=Y, X≥0) frame ──────────────
  const axisU = unitVec(axisPlacement.direction);
  const origin = axisPlacement.origin;
  const canonical: Array<{ x: number; y: number }> = [];
  let signSeen: 1 | -1 | 0 = 0;
  for (const p of profile.points) {
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    const dz = p[2] - origin[2];
    // Y' = projection along axis.
    const yProj = dx * axisU[0] + dy * axisU[1] + dz * axisU[2];
    // X' = perpendicular distance from axis (vector subtraction).
    const perpX = dx - yProj * axisU[0];
    const perpY = dy - yProj * axisU[1];
    const perpZ = dz - yProj * axisU[2];
    const perpDist = Math.hypot(perpX, perpY, perpZ);
    // For axis-aligned cases the perpendicular plane has a deterministic
    // sign (it's the plane normal to the axis); we use the dominant
    // non-axis component as the sign source so we can reject profiles that
    // straddle the axis.
    const signRef = pickPerpSignReference(axisKind, perpX, perpY, perpZ);
    if (Math.abs(signRef) > POINT_EPS) {
      const sign = signRef > 0 ? 1 : -1;
      if (signSeen === 0) signSeen = sign;
      else if (signSeen !== sign) {
        return {
          kind: 'unsupported',
          reason: `profile straddles the revolve axis (would self-intersect)`,
        };
      }
    }
    canonical.push({ x: perpDist, y: yProj });
  }

  // Drop closing duplicate vertex if present.
  if (
    canonical.length > 3 &&
    Math.abs(canonical[0]!.x - canonical[canonical.length - 1]!.x) <= POINT_EPS &&
    Math.abs(canonical[0]!.y - canonical[canonical.length - 1]!.y) <= POINT_EPS
  ) {
    canonical.pop();
  }

  return {
    kind: 'ok',
    feature: {
      kind: 'revolve',
      loop: canonical,
      angleDegrees,
      mode: 'add',
    },
  };
}

type SweptAreaResult =
  | { kind: 'ok'; points: Array<[number, number, number]> }
  | { kind: 'unsupported'; reason: string };

/**
 * Extract the profile point ring from a REVOLVED_AREA_SOLID's swept_area.
 *
 * Supported shapes (Phase 2):
 *   - `PLANAR_FACE('', #face_outer_bound)` — most common; we drill down
 *     through FACE_OUTER_BOUND → EDGE_LOOP → ORIENTED_EDGE chain (LINE
 *     edges only).
 *
 * Anything else (CURVE_BOUNDED_PLANAR_SURFACE with B-spline bounds,
 * composite curve sections, etc) returns `unsupported` so the caller can
 * route to Phase 3 OCCT.
 */
function readSweptAreaProfile(
  sweptAreaId: number,
  entities: Map<number, StepEntity>,
): SweptAreaResult {
  const ent = entities.get(sweptAreaId);
  if (!ent) {
    return { kind: 'unsupported', reason: `swept_area #${sweptAreaId} missing` };
  }
  if (ent.name !== 'PLANAR_FACE' && ent.name !== 'FACE_OUTER_BOUND') {
    return {
      kind: 'unsupported',
      reason: `swept_area type ${ent.name} not supported (Phase 2: PLANAR_FACE only)`,
    };
  }
  // Find the FACE_OUTER_BOUND. PLANAR_FACE has bounds list as args[1];
  // FACE_OUTER_BOUND is itself the bound entity.
  let boundEnt: StepEntity | null = null;
  if (ent.name === 'PLANAR_FACE') {
    const boundsArg = ent.args[1];
    if (!boundsArg || boundsArg.kind !== 'list') {
      return { kind: 'unsupported', reason: `PLANAR_FACE missing bounds list` };
    }
    for (const item of boundsArg.items) {
      if (item.kind !== 'ref') continue;
      const b = entities.get(item.id);
      if (b && b.name === 'FACE_OUTER_BOUND') {
        boundEnt = b;
        break;
      }
    }
    if (!boundEnt) {
      return { kind: 'unsupported', reason: `PLANAR_FACE has no FACE_OUTER_BOUND` };
    }
  } else {
    boundEnt = ent;
  }
  // FACE_OUTER_BOUND('', #loop, .T.)
  const loopRef = boundEnt.args[1];
  if (!loopRef || loopRef.kind !== 'ref') {
    return { kind: 'unsupported', reason: `FACE_OUTER_BOUND missing loop ref` };
  }
  const loop = entities.get(loopRef.id);
  if (!loop || loop.name !== 'EDGE_LOOP') {
    return { kind: 'unsupported', reason: `bound loop is ${loop?.name ?? 'unknown'}` };
  }
  const oeArg = loop.args[1];
  if (!oeArg || oeArg.kind !== 'list') {
    return { kind: 'unsupported', reason: `EDGE_LOOP missing edge list` };
  }
  const ring: Array<[number, number, number]> = [];
  for (const item of oeArg.items) {
    if (item.kind !== 'ref') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE non-ref in loop` };
    }
    const oe = entities.get(item.id);
    if (!oe || oe.name !== 'ORIENTED_EDGE') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE missing` };
    }
    const ecRef = oe.args[3];
    const oeFlag = oe.args[4];
    if (!ecRef || ecRef.kind !== 'ref') {
      return { kind: 'unsupported', reason: `ORIENTED_EDGE missing EDGE_CURVE` };
    }
    const forwardOe = oeFlag?.kind === 'enum' ? oeFlag.value !== 'F' : true;
    const ec = entities.get(ecRef.id);
    if (!ec || ec.name !== 'EDGE_CURVE') {
      return { kind: 'unsupported', reason: `EDGE_CURVE missing` };
    }
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
          reason: `profile has non-linear edge (${curve.name})`,
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
  // Drop a closing duplicate vertex if present.
  if (ring.length > 3 && pointEq(ring[0]!, ring[ring.length - 1]!)) {
    ring.pop();
  }
  return { kind: 'ok', points: ring };
}

// ─── geometric helpers ────────────────────────────────────────────────────

/**
 * World-space AABB over every vertex of a plane-face set. Returns null when the
 * set is empty (no decoded planar geometry — e.g. a pure curved solid). For a
 * box / prism / linear-extrusion the plane faces cover the full solid extent; for
 * a canonicalised cylinder the two cap planes bound the radial + axial extent.
 */
function bboxOfPlaneFaces(faces: PlaneFace[]): WorldBBox | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
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
  if (!Number.isFinite(minX)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** World AABB of a swept-area solid: union of the profile ring and its translate. */
function bboxOfSweptProfile(
  points: Array<[number, number, number]>,
  axisU: [number, number, number],
  depth: number,
): WorldBBox | null {
  if (points.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const ends: Array<[number, number, number]> = [
      p,
      [p[0] + depth * axisU[0], p[1] + depth * axisU[1], p[2] + depth * axisU[2]],
    ];
    for (const q of ends) {
      for (let k = 0; k < 3; k++) {
        if (q[k] < min[k]) min[k] = q[k];
        if (q[k] > max[k]) max[k] = q[k];
      }
    }
  }
  return { min, max };
}

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

/**
 * Classify a (possibly non-unit) direction vector as ±X / ±Y / ±Z or
 * non-axis-aligned. Returns one of 'x' | 'y' | 'z' for axis-aligned
 * directions, null otherwise. Tolerance: AXIS_EPS on the unit-normalised
 * vector — the input does not need to be pre-normalised.
 *
 * Note: callers that need the sign of the axis (e.g. to flip a cap) must
 * inspect the raw direction; this classifier is sign-agnostic by design.
 */
function classifyAxisAlignment(
  dir: [number, number, number],
): 'x' | 'y' | 'z' | null {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len < 1e-9) return null;
  const ax = Math.abs(dir[0] / len);
  const ay = Math.abs(dir[1] / len);
  const az = Math.abs(dir[2] / len);
  if (Math.abs(ax - 1) <= AXIS_EPS && ay <= AXIS_EPS && az <= AXIS_EPS) return 'x';
  if (Math.abs(ay - 1) <= AXIS_EPS && ax <= AXIS_EPS && az <= AXIS_EPS) return 'y';
  if (Math.abs(az - 1) <= AXIS_EPS && ax <= AXIS_EPS && ay <= AXIS_EPS) return 'z';
  return null;
}

/** True iff `a` and `b` are parallel (same or opposite direction). */
function directionsParallel(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  const ua = unitVec(a);
  const ub = unitVec(b);
  // Cross product magnitude ≈ 0 ⇒ parallel.
  const cx = ua[1] * ub[2] - ua[2] * ub[1];
  const cy = ua[2] * ub[0] - ua[0] * ub[2];
  const cz = ua[0] * ub[1] - ua[1] * ub[0];
  return Math.hypot(cx, cy, cz) <= AXIS_EPS;
}

function unitVec(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function centroid(loop: Array<[number, number, number]>): [number, number, number] {
  let sx = 0, sy = 0, sz = 0;
  for (const v of loop) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  const n = loop.length;
  return n > 0 ? [sx / n, sy / n, sz / n] : [0, 0, 0];
}

/** Format a direction as a short "(x,y,z)" string for unsupported reasons. */
function formatDir(d: [number, number, number]): string {
  const fmt = (v: number) => Math.abs(v) < 1e-6 ? '0' : Number(v.toFixed(4)).toString();
  return `(${fmt(d[0])},${fmt(d[1])},${fmt(d[2])})`;
}

/**
 * For axis-aligned revolves, return the perpendicular component that
 * unambiguously signals which side of the axis a profile point sits on.
 *   - axis = X  →  use Y component (the dominant perpendicular)
 *   - axis = Y  →  use X component
 *   - axis = Z  →  use X component
 * (Z-axis revolves with profile in XZ vs YZ are both valid; we conservatively
 * use X — profiles in the YZ plane will all return signRef ≈ 0 and skip the
 * straddle check, which is the correct relaxation.)
 */
function pickPerpSignReference(
  axisKind: 'x' | 'y' | 'z',
  perpX: number,
  perpY: number,
  _perpZ: number,
): number {
  if (axisKind === 'x') return perpY;
  if (axisKind === 'y') return perpX;
  return perpX; // z-axis: profile expected in XZ or YZ plane
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
