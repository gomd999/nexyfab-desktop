/**
 * pmiOcctBinding — Phase 5.3 Phase 2 (deep) PMI ↔ OCCT-geometry binder.
 *
 * Where pmiShapeBinding (UU) emits an AP242 SHAPE_ASPECT side-channel and
 * leaves the PMI items pointing at the side-channel name, THIS module wires
 * the PMI items DIRECTLY to the underlying OCCT geometric entity — the
 * `#N=ADVANCED_FACE(...)` row produced by `stepWrite` / `stepWriteFilletChamfer`
 * (and, in the OCCT-real worker path, exported faithfully from the real
 * BRep_Builder solid).
 *
 * Why Phase 2 (deep) instead of staying with Phase 1 SHAPE_ASPECT?
 * ----------------------------------------------------------------
 *   - PMI Readers (PMI-CT, NIST STEP File Analyzer, the OCCT XDE PMI demo,
 *     Siemens JT2Go, KISTERS 3DViewStation) all support a "direct" anchor
 *     mode in which a GEOMETRIC_TOLERANCE / DIMENSIONAL_SIZE references the
 *     ADVANCED_FACE entity id straight from its `applies_to` /
 *     `toleranced_shape_aspect` slot, with NO intermediate SHAPE_ASPECT.
 *     This is the form OCCT itself round-trips when you build PMI in XCAFDoc
 *     via `XCAFDoc_DimTolTool::AddDimension(face_label, ...)` — the file
 *     reader on the other end recovers the bound face from the AdvancedFace
 *     id, not from a SHAPE_ASPECT name.
 *   - The Phase 5 OCCT-real worker (`occt-worker-real.js`) is now live with
 *     11 ops, so the geometry side of the contract is concrete. The same
 *     `faceEntityIds[]` table the stepWrite emitter would publish from a
 *     BRep_Builder walk is the perfect input for the direct binder: each
 *     entry maps the worker's ordinal face index (0..N-1, the same order
 *     OCCT's `TopExp_Explorer(TopAbs_FACE)` yields) to the `#N` row we put
 *     in the STEP file.
 *   - Direct binding eliminates one indirection in the file (smaller, fewer
 *     entities) AND matches what an OCCT-aware viewer expects, so PMI shows
 *     up anchored to the right face on the very first round-trip.
 *
 * Strict invariants:
 *   - DO NOT modify `pmiShapeBinding.ts`, `stepWrite.ts`, `pmiExport.ts`.
 *     This module is standalone — the wrapper that combines the SHAPE_ASPECT
 *     side-channel (Phase 1) with the direct OCCT anchor (Phase 2) is the
 *     next batch's responsibility.
 *   - Output PMI text is a STRICT in-place patch of the input PMI fragment.
 *     We rewrite the Phase-1 TODO comments AND, where the original PMI item
 *     carried a `$` placeholder in the slot that should host a geometric ref,
 *     fill that slot with the resolved `#<entityId>` so a PMI Reader walking
 *     `applies_to` / `toleranced_shape_aspect` finds the ADVANCED_FACE
 *     directly. No new entity rows are emitted (unlike Phase 1 which adds
 *     SHAPE_ASPECT + SHAPE_DEFINITION_REPRESENTATION).
 *   - faceIdx is the OCCT ordinal index (0..N-1) — NOT a SHAPE_ASPECT name,
 *     NOT a Sheet ref id. Callers using Sheet ref ids should chain through
 *     `pmiShapeBinding.bindPmiToShape` (Phase 1) first; this module is the
 *     deeper layer that the integrator wires together.
 *
 * Algorithm (1-pass):
 *   1. For each binding, resolve `entityId` either from `binding.faceRef.entityId`
 *      (caller-supplied; takes priority — used when the caller already knows
 *      the STEP entity id without consulting `shapeMeta`) or via
 *      `shapeMeta.faceEntityIds[binding.faceRef.faceIdx]` (the usual path —
 *      stepWrite publishes this table after emitting the box / polygon faces).
 *      A faceIdx outside `[0, faceEntityIds.length)` throws — better to fail
 *      loud than to silently anchor PMI to nothing.
 *   2. Build a `pmiRefId → entityId` map. The map is consulted by the
 *      placeholder patcher.
 *   3. Patch placeholders in the PMI source. Two placeholder shapes are
 *      recognised, in this order:
 *        - The Phase-1 TODO comments emitted by `pmiExport.emitDimension`
 *          and `pmiExport.emitGdt` (so a caller wiring Phase 2 against the
 *          raw Phase-1 fragment gets useful diagnostics in the file). Only
 *          comments whose ref appears in the binding map are rewritten;
 *          others are preserved verbatim.
 *        - The `__OCCT_REF__<pmiRefId>__` magic token. Callers wiring a
 *          newer PMI emitter (one that DOES expose a real placeholder rather
 *          than a `$`) can drop these tokens directly into the entity rows
 *          they care about. Patch is `__OCCT_REF__foo__` → `#1234`. Unmatched
 *          tokens are LEFT IN PLACE (we never silently drop them — the file
 *          would still parse but the PMI would dangle, which is exactly the
 *          bug we want a CI to catch).
 *
 * Spec reference:
 *   - ISO 10303-242 (AP242) §6.4.7 PMI representation
 *   - OCCT XCAFDoc_DimTolTool::AddDimension (direct face attach API)
 *   - ISO 10303-21 §6.4.1 entity_instance_name (`#N` ref syntax)
 */

// ─── public types ────────────────────────────────────────────────────────

/**
 * Reference to a single OCCT face. `faceIdx` is the ordinal index produced
 * by walking the solid with `TopExp_Explorer(TopAbs_FACE)` — i.e. the same
 * order in which `stepWrite` emits the `ADVANCED_FACE` rows. `entityId` is
 * the OPTIONAL STEP `#N` id; when present it wins over the `faceEntityIds`
 * lookup (useful when the caller already extracted the id from the source).
 */
export interface OcctFaceRef {
  /** Ordinal face index in the solid (0..N-1). */
  faceIdx: number;
  /**
   * STEP ADVANCED_FACE entity id (the integer `N` in `#N=ADVANCED_FACE(...)`)
   * extracted from the geometry source. OPTIONAL — when omitted, the binder
   * resolves it via `shapeMeta.faceEntityIds[faceIdx]`.
   */
  entityId?: number;
}

/**
 * A single binding from a PMI ref id (the Sheet IR ref id, e.g. `'face_07'`
 * or the GD&T target ref) to an OCCT face. The binder will patch the PMI
 * source so the named ref points at the underlying ADVANCED_FACE entity id.
 */
export interface OcctPmiBinding {
  /** Sheet IR ref id (e.g. `'face_07'`, `'gdt-flt-1'`). */
  pmiRefId: string;
  /** OCCT face this PMI ref anchors to. */
  faceRef: OcctFaceRef;
}

/**
 * Geometry-side metadata produced by `stepWrite`. Today the emitter doesn't
 * publish this directly — see the Phase-2 wrapper batch — but the contract
 * is stable: index `i` is the STEP `#N` id of the `i`-th ADVANCED_FACE
 * emitted into the DATA section, in `TopExp_Explorer(TopAbs_FACE)` order.
 */
export interface OcctShapeMeta {
  /** Length must equal the number of ADVANCED_FACE rows in the geometry source. */
  faceEntityIds: ReadonlyArray<number>;
}

/** Result of {@link bindPmiToOcctFace}. */
export interface OcctBindingResult {
  /**
   * The original PMI fragment text, byte-for-byte. Useful when the caller
   * wants to log a diff between `source` and `patched` for traceability.
   */
  source: string;
  /**
   * The PMI fragment with placeholders / TODO comments rewritten to reference
   * the resolved `#<entityId>` rows. When `bindings` resolves to an empty
   * map (no PMI ref appears in the source), equal to `source`.
   */
  patched: string;
  /**
   * `pmiRefId → entityId` for every binding that successfully resolved. A
   * binding NOT present here either had a faceIdx out of range (which threw)
   * or used a refId that doesn't appear anywhere in the PMI source (silent
   * skip — matches `pmiShapeBinding`'s policy).
   */
  mapping: Map<string, number>;
  /**
   * Human-readable diagnostics, one per binding that resolved an entityId
   * but found NO occurrence of its `pmiRefId` in the PMI source. Format:
   * `'ref "<refId>" not referenced by any PMI item — skipped'` (same string
   * shape as `pmiShapeBinding.warnings` so a combined caller can merge both).
   */
  warnings: ReadonlyArray<string>;
}

// ─── internal helpers ────────────────────────────────────────────────────

/**
 * Escape a string for safe embedding into a RegExp source. PMI ref ids may
 * contain `.`, `+`, `*` etc. as valid characters — without escaping, a ref
 * id like `face.07` would silently match `face_07` because `.` is "any char"
 * in regex. We escape every metacharacter aggressively.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the STEP `#N` entity id for an `OcctFaceRef` against the meta
 * table. `entityId` on the binding wins (test-friendly + lets callers who
 * already know the id skip the lookup); otherwise `faceIdx` indexes into
 * `faceEntityIds[]`.
 *
 * Throws on:
 *   - `faceIdx` not an integer / negative
 *   - `faceIdx` >= `faceEntityIds.length`
 *   - resolved entityId not a positive integer
 *
 * Failing loud here is deliberate — silently rendering `#NaN` or `#-1` would
 * produce a Part-21 file that PMI Readers reject AFTER a multi-second parse,
 * not before. We'd rather the binder reject the input.
 */
function resolveEntityId(
  faceRef: OcctFaceRef,
  faceEntityIds: ReadonlyArray<number>,
): number {
  if (!Number.isInteger(faceRef.faceIdx) || faceRef.faceIdx < 0) {
    throw new Error(
      `pmiOcctBinding: faceIdx must be a non-negative integer, got ${faceRef.faceIdx}`,
    );
  }
  // Prefer caller-supplied entityId when present. Validate it the same way
  // we validate the lookup result so both paths produce the same error
  // message shape.
  let resolved: number;
  if (typeof faceRef.entityId === 'number') {
    resolved = faceRef.entityId;
  } else {
    if (faceRef.faceIdx >= faceEntityIds.length) {
      throw new Error(
        `pmiOcctBinding: faceIdx ${faceRef.faceIdx} out of range ` +
          `(faceEntityIds has ${faceEntityIds.length} entries)`,
      );
    }
    resolved = faceEntityIds[faceRef.faceIdx]!;
  }
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(
      `pmiOcctBinding: resolved entityId for faceIdx ${faceRef.faceIdx} ` +
        `is not a positive integer (${resolved})`,
    );
  }
  return resolved;
}

/**
 * Rewrite the Phase-1 TODO comments emitted by `pmiExport.emitDimension`
 * and `pmiExport.emitGdt` so they mention the resolved OCCT entity id:
 *
 *   /​* dimension <id> refs: face_07, face_08 (Phase 2 OCCT plumbing) *​/
 *     →
 *   /​* dimension <id> bound to #1024 (face_07), #1025 (face_08) (OCCT direct) *​/
 *
 *   /​* GD&T <id> target: face_07 (Phase 2 OCCT plumbing) *​/
 *     →
 *   /​* GD&T <id> bound to #1024 (face_07) (OCCT direct) *​/
 *
 * The `(OCCT direct)` suffix distinguishes this rewrite from Phase-1's
 * `(SHAPE_ASPECT)`-style suffix, so a reader looking at the file can tell
 * which binding layer produced the anchor.
 *
 * Unresolved refs (not in `mapping`) keep their original token so the
 * traceability isn't silently dropped — same policy as Phase 1.
 */
function patchTodoComments(
  pmiSource: string,
  mapping: ReadonlyMap<string, number>,
): string {
  if (mapping.size === 0) return pmiSource;

  // Dimension form.
  let patched = pmiSource.replace(
    /\/\* dimension ([^ ]+) refs: ([^()]+?) \(Phase 2 OCCT plumbing\) \*\//g,
    (_match, dimId: string, list: string) => {
      const parts = list.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
      const resolved: string[] = [];
      const unresolved: string[] = [];
      for (const ref of parts) {
        const id = mapping.get(ref);
        if (typeof id === 'number') {
          resolved.push(`#${id} (${ref})`);
        } else {
          unresolved.push(ref);
        }
      }
      if (resolved.length === 0) {
        // No resolved refs → keep the original comment shape so the
        // Phase-1 traceability message is unchanged.
        return `/* dimension ${dimId} refs: ${parts.join(', ')} (Phase 2 OCCT plumbing) */`;
      }
      const head = `/* dimension ${dimId} bound to ${resolved.join(', ')}`;
      const tail = unresolved.length > 0
        ? ` (unresolved: ${unresolved.join(', ')}) (OCCT direct) */`
        : ' (OCCT direct) */';
      return head + tail;
    },
  );

  // GD&T form.
  patched = patched.replace(
    /\/\* GD&T ([^ ]+) target: ([^ ]+) \(Phase 2 OCCT plumbing\) \*\//g,
    (_match, gdtId: string, ref: string) => {
      const id = mapping.get(ref);
      if (typeof id !== 'number') {
        return `/* GD&T ${gdtId} target: ${ref} (Phase 2 OCCT plumbing) */`;
      }
      return `/* GD&T ${gdtId} bound to #${id} (${ref}) (OCCT direct) */`;
    },
  );

  return patched;
}

/**
 * Replace `__OCCT_REF__<pmiRefId>__` magic tokens with `#<entityId>`. Useful
 * for callers whose PMI emitter substitutes a real token rather than a `$`
 * placeholder (the latter is unsafe to overwrite because `$` is also the
 * AP242 "indeterminate value" marker — patching every `$` would corrupt
 * unrelated slots).
 *
 * Unmatched tokens are LEFT IN PLACE so the binder failure is visible at
 * file-validation time rather than silently swallowed.
 */
function patchMagicTokens(
  pmiSource: string,
  mapping: ReadonlyMap<string, number>,
): string {
  if (mapping.size === 0) return pmiSource;
  let patched = pmiSource;
  for (const [refId, entityId] of mapping) {
    const token = `__OCCT_REF__${refId}__`;
    // String.split / join is faster than a regex replace AND avoids the
    // need to escape regex metacharacters in `refId`. We split on the
    // literal token and rejoin with the entity ref so every occurrence
    // is replaced in one pass.
    patched = patched.split(token).join(`#${entityId}`);
  }
  return patched;
}

/**
 * Walk the PMI source and collect every ref id that appears in a Phase-1
 * TODO comment OR a magic token. Used to decide which bindings actually
 * have a home in the source (the rest become `warnings`).
 */
function collectReferencedRefs(pmiSource: string): Set<string> {
  const found = new Set<string>();

  // Phase-1 dimension TODO comments — comma-separated list.
  const dimRe = /\/\* dimension [^ ]+ refs: ([^()]+?) \(Phase 2 OCCT plumbing\) \*\//g;
  let m: RegExpExecArray | null;
  while ((m = dimRe.exec(pmiSource)) !== null) {
    const list = m[1]!;
    for (const r of list.split(',')) {
      const trimmed = r.trim();
      if (trimmed.length > 0) found.add(trimmed);
    }
  }

  // Phase-1 GD&T TODO comments — single targetRef.
  const gdtRe = /\/\* GD&T [^ ]+ target: ([^ ]+) \(Phase 2 OCCT plumbing\) \*\//g;
  while ((m = gdtRe.exec(pmiSource)) !== null) {
    const ref = m[1]!.trim();
    if (ref.length > 0) found.add(ref);
  }

  // Magic tokens (`__OCCT_REF__<refId>__`).
  const tokenRe = /__OCCT_REF__([A-Za-z0-9_.+\-:*?^${}()|[\]\\]+?)__/g;
  while ((m = tokenRe.exec(pmiSource)) !== null) {
    const ref = m[1]!;
    if (ref.length > 0) found.add(ref);
  }

  return found;
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Bind PMI refs DIRECTLY to OCCT ADVANCED_FACE entity ids. See module-level
 * JSDoc for the algorithm and the rationale for the Phase-2 "direct" mode
 * vs Phase-1's SHAPE_ASPECT side-channel.
 *
 * Inputs:
 *   - `pmiFragment`: PMI source text from `pmiExport.writePmiFragment` (or
 *     the saved-view variant). Used READ-ONLY.
 *   - `bindings`: list of `pmiRefId → OcctFaceRef` pairs. Duplicate refIds
 *     are coalesced (first wins) so a single ref pointing at multiple faces
 *     resolves to the first face's entity id; this matches OCCT's own
 *     "PMI attaches to a single primary face" convention.
 *   - `shapeMeta.faceEntityIds`: ordinal face index → STEP entity id table.
 *     Indexed by `OcctFaceRef.faceIdx`. Out-of-range indices THROW.
 *
 * Returns:
 *   - `source`: original PMI text (unchanged).
 *   - `patched`: PMI text with TODO comments / magic tokens rewritten.
 *   - `mapping`: `pmiRefId → entityId` for every binding that resolved.
 *   - `warnings`: diagnostics for bindings whose refId never appeared in
 *     the PMI source.
 *
 * Throws on:
 *   - `faceIdx` out of range
 *   - `faceIdx` negative / non-integer
 *   - resolved `entityId` not a positive integer
 *
 * @example
 * ```ts
 * import { writePmiFragment } from './pmiExport';
 * import { bindPmiToOcctFace } from './pmiOcctBinding';
 *
 * const frag = writePmiFragment(sheet, 100);
 * // faceEntityIds[0] = #501, faceEntityIds[1] = #515 (from stepWrite walk)
 * const result = bindPmiToOcctFace(
 *   frag.source,
 *   [{ pmiRefId: 'face_07', faceRef: { faceIdx: 0 } }],
 *   { faceEntityIds: [501, 515, 530, 545, 560, 575] },
 * );
 * console.log(result.patched);  // PMI text with '#501 (face_07)' anchor
 * ```
 */
export function bindPmiToOcctFace(
  pmiFragment: string,
  bindings: ReadonlyArray<OcctPmiBinding>,
  shapeMeta: OcctShapeMeta,
): OcctBindingResult {
  // Fast-path: no bindings → original text + empty mapping. We still validate
  // `shapeMeta` shape so a caller passing a corrupt meta blob fails loud at
  // the call site rather than at the next binding attempt.
  if (!Array.isArray(shapeMeta.faceEntityIds)) {
    throw new Error(
      `pmiOcctBinding: shapeMeta.faceEntityIds must be an array, got ${typeof shapeMeta.faceEntityIds}`,
    );
  }
  if (bindings.length === 0) {
    return {
      source: pmiFragment,
      patched: pmiFragment,
      mapping: new Map<string, number>(),
      warnings: [],
    };
  }

  // Coalesce duplicates — first occurrence of a given `pmiRefId` wins. This
  // matches the Phase-1 SHAPE_ASPECT coalescing policy so a caller swapping
  // layers sees identical id assignment order.
  const uniqueBindings = new Map<string, OcctPmiBinding>();
  for (const b of bindings) {
    if (!uniqueBindings.has(b.pmiRefId)) {
      uniqueBindings.set(b.pmiRefId, b);
    }
  }

  // Resolve entity ids FIRST (so a bad faceIdx throws before any patching).
  // We then collect referenced refs from the source to decide which entries
  // survive (and which become warnings).
  const resolvedById = new Map<string, number>();
  for (const [refId, binding] of uniqueBindings) {
    const entityId = resolveEntityId(binding.faceRef, shapeMeta.faceEntityIds);
    resolvedById.set(refId, entityId);
  }

  const referenced = collectReferencedRefs(pmiFragment);
  const warnings: string[] = [];
  const mapping = new Map<string, number>();
  for (const [refId, entityId] of resolvedById) {
    if (referenced.has(refId)) {
      mapping.set(refId, entityId);
    } else {
      warnings.push(`ref "${refId}" not referenced by any PMI item — skipped`);
    }
  }

  // Patch in two phases — TODO comments first (so the diagnostic suffix
  // ends up in the comment, not in a downstream magic-token rewrite),
  // then magic tokens (cheap string replace).
  let patched = patchTodoComments(pmiFragment, mapping);
  patched = patchMagicTokens(patched, mapping);

  return {
    source: pmiFragment,
    patched,
    mapping,
    warnings,
  };
}

// ─── escape-hatch exports for tests ──────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests + Phase 3. */
export const __internal = {
  escapeRegex,
  resolveEntityId,
  patchTodoComments,
  patchMagicTokens,
  collectReferencedRefs,
};
