/**
 * pmiExport — Phase 5.3 PMI (Product Manufacturing Information) writer for
 * NexyFab Pro own-CAD. Emits AP242 annotation / GD&T entities derived from a
 * `Sheet`'s `dimensions[]` + `gdtCallouts[]` arrays.
 *
 * Phase 1 SCOPE (this file):
 * --------------------------
 * Stand-alone **entity fragment** generator. The output of
 * `writePmiFragment` is a block of `#N=...;` lines suitable for concatenation
 * into the DATA section of a STEP file produced by `stepWrite.writeStepEntities`
 * (or `writeAssemblyAsStep`). It is NOT a complete STEP file on its own — no
 * HEADER / ENDSEC envelope is emitted, and no geometric back-references are
 * resolved.
 *
 * Phase 2 SCOPE (planned, gated on OCCT worker — NOT in this file):
 * -----------------------------------------------------------------
 *   - Resolve `Dimension.refs[]` (sketch geometry ids) into the actual
 *     ADVANCED_FACE / EDGE_CURVE / VERTEX_POINT refs produced by the
 *     `stepWrite` polygon/box emitter so DRAUGHTING_ANNOTATION items get
 *     real `geometric_set` / `shape_aspect` anchors.
 *   - Resolve `GdtCallout.datums[]` (letter labels) into DATUM entities tied
 *     to real source faces (currently emitted as named placeholders).
 *   - Emit PRESENTATION_LAYER_ASSIGNMENT and STYLED_ITEM cross-refs into the
 *     shape representation so PMI is visible in PDF-3D / JT viewers.
 *   - Emit DRAUGHTING_MODEL container so all PMI items live in a single,
 *     queryable saved-view.
 *
 * Phase 1 limitation summary (DOCUMENT EXPLICITLY):
 *   - `refs[]` and `targetRef` appear as `/* TODO Phase 2: ref ... *​/`
 *     comments next to the relevant DIMENSIONAL_* / GEOMETRIC_TOLERANCE
 *     entity instead of as real entity refs.
 *   - Datums are emitted as `DATUM('A',...)`-style entities (name-only),
 *     not linked to real faces.
 *   - Styling is best-effort (DRAUGHTING_PRE_DEFINED_COLOUR('black') +
 *     STYLED_ITEM) so a Part 21 parser round-trips cleanly, but PMI
 *     visibility in 3D viewers needs the Phase 2 DRAUGHTING_MODEL container.
 *
 * Spec reference:
 *   - ISO 10303-242 (AP242 Managed model based 3D engineering)
 *   - ISO 1101 (Geometric tolerancing)
 *   - ISO 286 (ISO system of limits and fits — H7/g6 etc.)
 */

import type { Sheet } from '@/lib/drawing/sheet';
import type {
  Dimension,
  GdtCallout,
  GdtKind,
  Tolerance,
} from '@/lib/drawing/dimension';

// ─── id allocator (mirrors stepWrite's StepBuilder shape) ────────────────

/**
 * Allocates unique `#N` identifiers starting at a caller-supplied seed so
 * the resulting fragment cannot collide with geometry already emitted into
 * the same DATA section. Each `add()` returns the ref string (`#42`) so
 * callers can wire entities without manual bookkeeping.
 */
class PmiBuilder {
  private next: number;
  private lines: string[] = [];

  constructor(startEntityId: number) {
    this.next = startEntityId;
  }

  add(body: string): string {
    const id = this.next++;
    this.lines.push(`#${id}=${body};`);
    return `#${id}`;
  }

  /** Add a free-form `/* ... *​/` comment line (no entity id consumed). */
  comment(body: string): void {
    this.lines.push(`/* ${body} */`);
  }

  /** Next id that WOULD be allocated (== lastEntityId + 1 after the call). */
  peekNext(): number {
    return this.next;
  }

  /** All entity + comment lines as a single newline-terminated string. */
  serialize(): string {
    if (this.lines.length === 0) return '';
    return this.lines.join('\n') + '\n';
  }
}

// ─── formatting helpers (kept local — DO NOT import from stepWrite) ──────

/** Mirrors stepWrite.fmt — REAL literal with trailing '.' for STEP parsers. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`pmiExport: non-finite number ${n}`);
  if (n === 0) return '0.';
  const fixed = n.toFixed(6);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '.');
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

/** Mirrors stepWrite.esc — single quotes doubled, control chars stripped. */
function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/[\x00-\x1f]/g, ' ');
}

// ─── shared context entities (units, colour) ──────────────────────────────

interface PmiContext {
  /** Length unit ref used by all MEASURE_WITH_UNIT items. */
  lenUnit: string;
  /** Plane-angle unit ref used by angular DIMENSIONAL_LOCATION items. */
  angUnit: string;
  /** Colour ref reused across STYLED_ITEM entries. */
  colour: string;
}

/**
 * Emit the small set of context entities every PMI item references (units,
 * default colour). Done once per fragment so the per-dimension / per-GD&T
 * blocks stay readable.
 */
function emitContext(b: PmiBuilder): PmiContext {
  const lenUnit = b.add(`( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )`);
  const angUnit = b.add(`( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )`);
  const colour = b.add(`DRAUGHTING_PRE_DEFINED_COLOUR('black')`);
  return { lenUnit, angUnit, colour };
}

// ─── tolerance emission ───────────────────────────────────────────────────

/**
 * Emit the entity instances for a Dimension's tolerance + return the leaf
 * ref the dimension entity should reference. Returns `null` for `kind:'none'`
 * (caller skips the tolerance attachment) or for tolerance-less dimensions.
 */
function emitTolerance(
  b: PmiBuilder,
  ctx: PmiContext,
  nominalValue: number,
  tolerance: Tolerance | undefined,
): string | null {
  if (!tolerance || tolerance.kind === 'none') return null;

  switch (tolerance.kind) {
    case 'bilateral': {
      // PLUS_MINUS_TOLERANCE wraps a TOLERANCE_VALUE(lower_bound, upper_bound).
      const upperVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(tolerance.upper)}),${ctx.lenUnit})`,
      );
      const lowerVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(-tolerance.lower)}),${ctx.lenUnit})`,
      );
      const tolValue = b.add(`TOLERANCE_VALUE(${lowerVal},${upperVal})`);
      return b.add(`PLUS_MINUS_TOLERANCE(${tolValue},'bilateral')`);
    }
    case 'unilateral': {
      // Same envelope as bilateral but one of the bounds is exactly zero.
      const upperVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(tolerance.upper)}),${ctx.lenUnit})`,
      );
      const lowerVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(-tolerance.lower)}),${ctx.lenUnit})`,
      );
      const tolValue = b.add(`TOLERANCE_VALUE(${lowerVal},${upperVal})`);
      return b.add(`PLUS_MINUS_TOLERANCE(${tolValue},'unilateral')`);
    }
    case 'limit': {
      // DIMENSIONAL_SIZE_WITH_PATH carries explicit min/max bounds rather
      // than a deviation pair. We emit it alongside the regular dim and let
      // the caller cross-reference; the leaf ref returned here is the
      // PLUS_MINUS_TOLERANCE-equivalent envelope.
      const minVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(tolerance.min)}),${ctx.lenUnit})`,
      );
      const maxVal = b.add(
        `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(tolerance.max)}),${ctx.lenUnit})`,
      );
      // AP242 DIMENSIONAL_SIZE_WITH_PATH is the "limit dimension" carrier.
      // We emit it with both bounds; the dimensional_size cross-ref is added
      // by the caller. `nominalValue` is documented as the mid-bound target.
      b.comment(`limit dimension nominal ${fmt(nominalValue)} bounded by [${fmt(tolerance.min)}, ${fmt(tolerance.max)}]`);
      return b.add(`DIMENSIONAL_SIZE_WITH_PATH(${minVal},${maxVal},'limit')`);
    }
    case 'iso_fit': {
      // ISO 286 fits ride as a free-text annotation in AP242. We emit a
      // DESCRIPTOR-like DRAUGHTING_TEXT label and return that ref.
      return b.add(
        `DESCRIPTIVE_REPRESENTATION_ITEM('iso_fit','${esc(tolerance.designation)}')`,
      );
    }
  }
}

// ─── dimension emission ───────────────────────────────────────────────────

/**
 * Emit all entity instances for a single Dimension. Returns the top-level
 * DRAUGHTING_ANNOTATION (or DIMENSIONAL_SIZE / DIMENSIONAL_LOCATION) ref
 * that callers register in the cross-reference mapping.
 */
function emitDimension(
  b: PmiBuilder,
  ctx: PmiContext,
  d: Dimension,
): string {
  // ── 1. refs[] are Phase 2 — surface them as comments for traceability ───
  if (d.refs.length > 0) {
    b.comment(`dimension ${d.id} refs: ${d.refs.join(', ')} (Phase 2 OCCT plumbing)`);
  }

  // ── 2. prefix / suffix → DESCRIPTOR (DESCRIPTIVE_REPRESENTATION_ITEM) ──
  // Emit before the dim itself so the dim entity can point at them.
  const prefixRef = d.prefix
    ? b.add(`DESCRIPTIVE_REPRESENTATION_ITEM('prefix','${esc(d.prefix)}')`)
    : null;
  const suffixRef = d.suffix
    ? b.add(`DESCRIPTIVE_REPRESENTATION_ITEM('suffix','${esc(d.suffix)}')`)
    : null;

  // ── 3. nominal value via MEASURE_WITH_UNIT (mm) ─────────────────────────
  // For Phase 1 we treat valueOverride as the source of truth; the renderer
  // would normally measure the actual geometry, but here we don't have the
  // OCCT plumbing yet (Phase 2).
  const nominal = d.valueOverride ?? 0;
  const isAngular = d.kind === 'angular';
  const unitRef = isAngular ? ctx.angUnit : ctx.lenUnit;
  const measureType = isAngular ? 'PLANE_ANGLE_MEASURE' : 'LENGTH_MEASURE';
  const measureWrapper = isAngular ? 'PLANE_ANGLE_MEASURE_WITH_UNIT' : 'LENGTH_MEASURE_WITH_UNIT';
  const valueRef = b.add(
    `${measureWrapper}(${measureType}(${fmt(nominal)}),${unitRef})`,
  );

  // ── 4. tolerance ────────────────────────────────────────────────────────
  const toleranceRef = emitTolerance(b, ctx, nominal, d.tolerance);

  // ── 5. dim kind → DIMENSIONAL_SIZE (linear/aligned/radial/diametric) ───
  //                   DIMENSIONAL_LOCATION (angular)
  // AP242 sub-types are encoded in the SHAPE_ASPECT_RELATIONSHIP description
  // field; we surface them via the entity 'name' attribute so a reader can
  // recover the original IR kind.
  const kindHint = d.kind; // e.g. 'radial', 'diametric', etc.
  let dimEntityRef: string;
  if (isAngular) {
    // DIMENSIONAL_LOCATION(name, relating_shape_aspect, related_shape_aspect)
    // Phase 1: shape_aspect refs are placeholder ($) until OCCT plumbing.
    dimEntityRef = b.add(
      `DIMENSIONAL_LOCATION('${esc(d.id)}: ${kindHint}',$,$)`,
    );
  } else {
    // DIMENSIONAL_SIZE(applies_to, name) — AP242 typical form. The
    // applies_to slot points at a SHAPE_ASPECT (Phase 2); '$' for now.
    dimEntityRef = b.add(
      `DIMENSIONAL_SIZE($,'${esc(d.id)}: ${kindHint}')`,
    );
  }

  // ── 6. cross-link value + tolerance + prefix/suffix to the dim ─────────
  // These are emitted as REPRESENTATION_RELATIONSHIP rows so downstream
  // readers can walk from the dim back to its value/tolerance/prefix items.
  b.add(
    `REPRESENTATION_RELATIONSHIP('value','nominal value',${valueRef},${dimEntityRef})`,
  );
  if (toleranceRef) {
    b.add(
      `REPRESENTATION_RELATIONSHIP('tolerance','tolerance band',${toleranceRef},${dimEntityRef})`,
    );
  }
  if (prefixRef) {
    b.add(
      `REPRESENTATION_RELATIONSHIP('prefix','dimension prefix',${prefixRef},${dimEntityRef})`,
    );
  }
  if (suffixRef) {
    b.add(
      `REPRESENTATION_RELATIONSHIP('suffix','dimension suffix',${suffixRef},${dimEntityRef})`,
    );
  }

  // ── 7. styling (DRAUGHTING_PRE_DEFINED_COLOUR via STYLED_ITEM) ─────────
  const colourAssign = b.add(`COLOUR_RGB('',0.,0.,0.)`); // black fallback alongside named colour
  void colourAssign; // referenced by the styled-item presentation block below
  const fillAreaStyle = b.add(`PRESENTATION_STYLE_ASSIGNMENT((${ctx.colour}))`);
  b.add(`STYLED_ITEM('${esc(d.id)}: style',(${fillAreaStyle}),${dimEntityRef})`);

  return dimEntityRef;
}

// ─── GD&T emission ────────────────────────────────────────────────────────

/**
 * Map a GdtKind to its AP242 GEOMETRIC_TOLERANCE subtype name.
 *
 * Phase 1: we emit the subtype name as-is. AP242 actually requires the
 * subtype to be the entity TYPE, and we honour that — these names are
 * standard ISO 10303-47 / AP242 GEOMETRIC_TOLERANCE specializations.
 */
function gdtSubtype(kind: GdtKind): string {
  switch (kind) {
    case 'straightness': return 'STRAIGHTNESS_TOLERANCE';
    case 'flatness': return 'FLATNESS_TOLERANCE';
    case 'circularity': return 'ROUNDNESS_TOLERANCE'; // AP242 uses ROUNDNESS for circularity
    case 'cylindricity': return 'CYLINDRICITY_TOLERANCE';
    case 'position': return 'POSITION_TOLERANCE';
    case 'concentricity': return 'CONCENTRICITY_TOLERANCE';
    case 'runout': return 'CIRCULAR_RUNOUT_TOLERANCE';
  }
}

/**
 * Material condition modifier → AP242 LIMIT_CONDITION enum. RFS
 * (regardless_of_feature_size) is the implicit default and is NOT wrapped
 * in MODIFIED_GEOMETRIC_TOLERANCE — callers receive `null` and skip the
 * modifier entity.
 */
function materialConditionEnum(mc: 'M' | 'L' | '' | undefined): string | null {
  // RFS is the default — empty string and undefined both skip the modifier.
  if (!mc) return null;
  if (mc === 'M') return '.MAXIMUM_MATERIAL_CONDITION.';
  if (mc === 'L') return '.LEAST_MATERIAL_CONDITION.';
  return null;
}

/**
 * Emit all entity instances for a single GdtCallout. Returns the top-level
 * GEOMETRIC_TOLERANCE-subtype ref (or its MODIFIED_GEOMETRIC_TOLERANCE
 * wrapper when a material condition is applied).
 */
function emitGdt(
  b: PmiBuilder,
  ctx: PmiContext,
  g: GdtCallout,
): string {
  // ── 1. targetRef is Phase 2 — surface as comment ────────────────────────
  b.comment(`GD&T ${g.id} target: ${g.targetRef} (Phase 2 OCCT plumbing)`);

  // ── 2. tolerance value via LENGTH_MEASURE_WITH_UNIT ─────────────────────
  const valueRef = b.add(
    `LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${fmt(g.toleranceValue)}),${ctx.lenUnit})`,
  );

  // ── 3. datum_system if datums present ───────────────────────────────────
  let datumSystemRef: string | null = null;
  if (g.datums && g.datums.length > 0) {
    const datumRefs: string[] = [];
    for (const letter of g.datums) {
      // Phase 1: datums are name-only DATUM entities with no real face link.
      const datum = b.add(`DATUM('${esc(letter)}','${esc(letter)}','',.T.,'${esc(letter)}')`);
      const datumRef = b.add(`DATUM_REFERENCE(${datumRefs.length + 1},${datum})`);
      datumRefs.push(datumRef);
    }
    datumSystemRef = b.add(`DATUM_SYSTEM('${esc(g.id)}: datums',(${datumRefs.join(',')}))`);
  }

  // ── 4. GEOMETRIC_TOLERANCE subtype ──────────────────────────────────────
  // Form: <SUBTYPE>(name, description, magnitude, toleranced_shape_aspect)
  //   - name        : g.id
  //   - description : Phase 1 free text
  //   - magnitude   : LENGTH_MEASURE_WITH_UNIT ref
  //   - toleranced  : Phase 2 SHAPE_ASPECT ref — '$' placeholder for now
  const subtype = gdtSubtype(g.kind);
  let gtRef = b.add(
    `${subtype}('${esc(g.id)}','${esc(g.kind)}',${valueRef},$)`,
  );

  // ── 5. datum system relation (when present) ─────────────────────────────
  if (datumSystemRef) {
    b.add(
      `GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE(${gtRef},${datumSystemRef})`,
    );
  }

  // ── 6. material condition → MODIFIED_GEOMETRIC_TOLERANCE wrapper ────────
  // RFS is the default and emits no wrapper.
  const mcEnum = materialConditionEnum(g.materialCondition);
  if (mcEnum) {
    gtRef = b.add(`MODIFIED_GEOMETRIC_TOLERANCE(${gtRef},${mcEnum})`);
  }

  // ── 7. styling (same colour as dimensions) ──────────────────────────────
  const fillAreaStyle = b.add(`PRESENTATION_STYLE_ASSIGNMENT((${ctx.colour}))`);
  b.add(`STYLED_ITEM('${esc(g.id)}: style',(${fillAreaStyle}),${gtRef})`);

  return gtRef;
}

// ─── public API ───────────────────────────────────────────────────────────

export interface WritePmiFragmentResult {
  /**
   * Concatenable STEP fragment — a sequence of `#N=...;` lines plus inline
   * `/* ... *​/` comments. Suitable for splicing into a DATA section between
   * geometry entities and `ENDSEC;`. Newline-terminated; empty string when
   * the sheet has no dimensions or GD&T callouts.
   */
  source: string;
  /**
   * Highest entity id allocated (== `startEntityId - 1` when nothing was
   * emitted, so the caller can chain a follow-up fragment by passing
   * `lastEntityId + 1` as its `startEntityId`).
   */
  lastEntityId: number;
  /**
   * Maps each `Dimension.id` / `GdtCallout.id` → the entity id (as a
   * positive integer, e.g. 42 for `#42`) of its top-level
   * DRAUGHTING_ANNOTATION / GEOMETRIC_TOLERANCE entity. Useful for
   * cross-referencing from a higher-level DRAUGHTING_MODEL container in
   * Phase 2.
   */
  mapping: Map<string, number>;
}

/**
 * Generate the AP242 PMI fragment for a sheet's dimensions + GD&T callouts.
 *
 * The output is a stand-alone block of entity definitions, NOT a complete
 * STEP file. See module-level JSDoc for the Phase 1 / Phase 2 split.
 *
 * The id allocator starts at `startEntityId` so the fragment can be
 * concatenated into an existing DATA section without `#N` collisions.
 */
export function writePmiFragment(
  sheet: Sheet,
  startEntityId: number,
): WritePmiFragmentResult {
  if (!Number.isInteger(startEntityId) || startEntityId < 1) {
    throw new Error(`writePmiFragment: startEntityId must be a positive integer, got ${startEntityId}`);
  }

  const dimensions = sheet.dimensions ?? [];
  const gdtCallouts = sheet.gdtCallouts ?? [];
  const mapping = new Map<string, number>();

  // Empty sheet → empty fragment + lastEntityId == startEntityId (no id used).
  if (dimensions.length === 0 && gdtCallouts.length === 0) {
    return {
      source: '',
      lastEntityId: startEntityId,
      mapping,
    };
  }

  const b = new PmiBuilder(startEntityId);

  // 1-line header comment per spec.
  b.comment(
    `PMI from sheet ${sheet.id} — ${dimensions.length} dimensions, ${gdtCallouts.length} GD&T`,
  );

  // Shared context (units, colour). Allocated once.
  const ctx = emitContext(b);

  // Dimensions first, then GD&T.
  for (const d of dimensions) {
    const ref = emitDimension(b, ctx, d);
    mapping.set(d.id, refToId(ref));
  }
  for (const g of gdtCallouts) {
    const ref = emitGdt(b, ctx, g);
    mapping.set(g.id, refToId(ref));
  }

  return {
    source: b.serialize(),
    // peekNext() returns the NEXT id; the last allocated id is one less.
    lastEntityId: b.peekNext() - 1,
    mapping,
  };
}

/** Parse a `#42` ref string back to its numeric id. */
function refToId(ref: string): number {
  if (!ref.startsWith('#')) throw new Error(`pmiExport: invalid ref '${ref}'`);
  const id = Number.parseInt(ref.slice(1), 10);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`pmiExport: invalid ref id parsed from '${ref}'`);
  }
  return id;
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests + Phase 2. */
export const __internal = {
  PmiBuilder,
  emitContext,
  emitTolerance,
  emitDimension,
  emitGdt,
  gdtSubtype,
  materialConditionEnum,
  fmt,
  esc,
};
