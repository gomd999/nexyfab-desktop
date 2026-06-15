/**
 * pmiShapeBinding — Phase 5.3 Phase 2 shape binding for AP242 PMI.
 *
 * Wires the Phase-1 PMI fragment produced by `pmiExport.writePmiFragment` /
 * `pmiExport.writePmiFragmentWithSavedView` to actual STEP geometry entities
 * (ADVANCED_FACE / EDGE_CURVE / VERTEX_POINT) emitted by `stepWrite`. This
 * module is a strict NON-MUTATING composer:
 *
 *   - It NEVER modifies pmiExport.ts / stepWrite.ts / dimension.ts / sheet.ts.
 *   - It takes the Phase-1 PMI source as a string + a binding map
 *     (`Sheet ref id → STEP entity id + kind`) and produces:
 *       1. An additional fragment of `SHAPE_ASPECT` + `SHAPE_DEFINITION_REPRESENTATION`
 *          entities (one per *unique* ref present in BOTH the PMI source and the
 *          binding map).
 *       2. A patched copy of the PMI source in which the Phase-1 TODO comments
 *          are rewritten to surface the freshly allocated SHAPE_ASPECT id.
 *       3. A mapping from `Sheet ref id → SHAPE_ASPECT entity id` for callers
 *          that want to wire Phase-3 APPLIED_* entities downstream.
 *
 * Phase 2 conservative scope (this file):
 *   - We do NOT emit subtype-specific APPLIED_FACE / APPLIED_EDGE /
 *     APPLIED_VERTEX entities — the AP242 schema names for those vary by
 *     fixture (APPLIED_AREA_ASSIGNMENT vs FACE_BOUND_ASSIGNMENT vs
 *     FACE_TOPOLOGY_REPRESENTATION) and resolving them needs an OCCT walk
 *     that's still gated. Instead we emit a single SHAPE_ASPECT per binding
 *     and a SHAPE_DEFINITION_REPRESENTATION linking it to the geometry
 *     entity id directly, with the `kind` ('face'|'edge'|'vertex') embedded
 *     in the SHAPE_ASPECT `description` slot so downstream readers can
 *     classify without a second lookup.
 *   - Patching is regex-driven against the exact comment formats emitted by
 *     `pmiExport.emitDimension` / `pmiExport.emitGdt`:
 *       - Dimension:  `/​* dimension <d.id> refs: <r1>, <r2>, ... (Phase 2 OCCT plumbing) *​/`
 *       - GD&T:       `/​* GD&T <g.id> target: <targetRef> (Phase 2 OCCT plumbing) *​/`
 *     Each matched comment is REPLACED with a follow-up comment that lists
 *     the SHAPE_ASPECT refs it now resolves to, e.g.
 *     `/​* dimension dim-1 bound to #501 (face_07), #502 (edge_03) *​/`.
 *     Unresolved refs (no binding) keep their original mention so the
 *     traceability comment is never lost.
 *
 * Phase 3 wishlist (NOT in this file — see README at the bottom):
 *   - Emit APPLIED_FACE_FEATURE / APPLIED_EDGE_FEATURE /
 *     APPLIED_VERTEX_FEATURE wrappers per AP242 §6.4.7.
 *   - Walk `mapping` and re-emit DIMENSIONAL_SIZE / GEOMETRIC_TOLERANCE
 *     entities with the SHAPE_ASPECT ref in their `applies_to` slot (today
 *     they pass `$` because pmiExport runs before binding is known — a
 *     full Phase 3 would need a two-pass writer).
 *   - Validate that the bound entity kind in `stepWrite` source matches the
 *     declared `RefBinding.kind` (today we trust the caller).
 */

import type {
  WritePmiFragmentResult,
  WritePmiSavedViewResult,
} from './pmiExport';

// ─── public types ────────────────────────────────────────────────────────

/**
 * Single Sheet-ref → STEP-entity binding. The caller is responsible for
 * producing these by walking the geometry STEP source (e.g. lines matching
 * `/^#(\d+)=ADVANCED_FACE\(/`) and pairing them with the Sheet IR ref ids
 * (`Dimension.refs[*]`, `GdtCallout.targetRef`).
 */
export interface RefBinding {
  /** Sheet IR ref id (e.g., `'edge_42'`, `'face_07'`, `'vertex_3'`). */
  ref: string;
  /** STEP entity id (e.g., `7423` for `#7423=ADVANCED_FACE(...)`). */
  entityId: number;
  /**
   * Kind tag used to classify the SHAPE_ASPECT and (in Phase 3) decide which
   * APPLIED_* entity to wrap with. Today only embedded in the SHAPE_ASPECT
   * description, but kept as a discriminator so the public API doesn't have
   * to change in Phase 3.
   */
  kind: 'face' | 'edge' | 'vertex';
}

/** Options for {@link bindPmiToShape}. */
export interface PmiBindingOptions {
  /**
   * Bindings to consume. Bindings whose `ref` does NOT appear in any
   * Phase-1 TODO comment in `pmiFragment.source` are skipped silently —
   * the returned `mapping` will NOT contain them, and `warnings` will list
   * each skipped ref for callers that want to surface the diagnostic.
   *
   * Duplicate `ref` values are coalesced — only the FIRST binding wins, so
   * a single SHAPE_ASPECT entity is emitted regardless of how many times
   * the ref shows up in the PMI source.
   */
  bindings: ReadonlyArray<RefBinding>;
  /**
   * Phase-1 PMI fragment from `pmiExport.writePmiFragment` (or the saved-
   * view variant). Used READ-ONLY — never mutated.
   */
  pmiFragment: WritePmiFragmentResult | WritePmiSavedViewResult;
  /**
   * Starting entity id for the SHAPE_ASPECT + SHAPE_DEFINITION_REPRESENTATION
   * entities. MUST be strictly greater than `pmiFragment.lastEntityId` and
   * also greater than the max entity id present in the geometry STEP source
   * the caller plans to splice into — the caller usually passes
   * `Math.max(pmiFragment.lastEntityId, geometryLastEntityId) + 1`.
   */
  startEntityId: number;
}

/** Result of {@link bindPmiToShape}. */
export interface PmiBindingResult {
  /**
   * Additional STEP entities — one `SHAPE_ASPECT` + one
   * `SHAPE_DEFINITION_REPRESENTATION` per unique resolved ref. Empty string
   * when no binding resolved (e.g. `bindings` empty, or every binding's
   * `ref` was missing from the PMI source).
   */
  additionalSource: string;
  /**
   * The PMI source with the Phase-1 TODO comments rewritten to mention the
   * SHAPE_ASPECT refs they now resolve to. Identical to
   * `pmiFragment.source` when no binding resolved.
   */
  patchedPmi: string;
  /**
   * Highest entity id allocated. Equals `startEntityId - 1` when no entity
   * was emitted (so the caller can chain a follow-up fragment by passing
   * `lastEntityId + 1` as its next `startEntityId`).
   */
  lastEntityId: number;
  /**
   * `Sheet ref id → SHAPE_ASPECT entity id`. Bindings whose ref was not
   * present in the PMI source are absent from this map.
   */
  mapping: Map<string, number>;
  /**
   * Human-readable diagnostic strings, one per skipped binding. Format:
   * `'ref "<refId>" not referenced by any PMI item — skipped'`.
   */
  warnings: ReadonlyArray<string>;
}

// ─── internal helpers ────────────────────────────────────────────────────

/**
 * Mirrors `pmiExport.esc` (kept LOCAL — do NOT import from pmiExport to
 * preserve the strict "no modifications to pmiExport" invariant). STEP
 * Part 21 strings escape single quotes by doubling them and strip control
 * characters.
 */
function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/[\x00-\x1f]/g, ' ');
}

/**
 * Escape a string for safe embedding into a RegExp source. Used to anchor
 * the comment-replacement regex on the exact Sheet ref id (refs may contain
 * `.`, `+`, `*` etc. as valid identifiers).
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tiny entity-id allocator matching the shape of `pmiExport.PmiBuilder`
 * (no shared state — each `bindPmiToShape` call gets a fresh allocator).
 */
class BindingBuilder {
  private next: number;
  private readonly lines: string[] = [];

  constructor(startEntityId: number) {
    if (!Number.isInteger(startEntityId) || startEntityId < 1) {
      throw new Error(
        `pmiShapeBinding: startEntityId must be a positive integer, got ${startEntityId}`,
      );
    }
    this.next = startEntityId;
  }

  /**
   * Allocate a fresh entity id, append `#N=<body>;` to the buffer, and
   * return the `#N` ref. Same convention as `pmiExport.PmiBuilder.add`.
   */
  add(body: string): { ref: string; id: number } {
    const id = this.next++;
    this.lines.push(`#${id}=${body};`);
    return { ref: `#${id}`, id };
  }

  /** Append a free-form comment (consumes no entity id). */
  comment(body: string): void {
    this.lines.push(`/* ${body} */`);
  }

  /** Next id that WOULD be allocated. */
  peekNext(): number {
    return this.next;
  }

  /** Highest allocated id, or `startEntityId - 1` if nothing was added. */
  lastId(): number {
    return this.next - 1;
  }

  /**
   * Serialize as newline-joined lines. Returns `''` (NOT a trailing newline)
   * when the buffer is empty so callers can concatenate without producing a
   * stray blank line at the splice point.
   */
  serialize(): string {
    if (this.lines.length === 0) return '';
    return this.lines.join('\n') + '\n';
  }
}

/**
 * Find every ref id mentioned by a Phase-1 TODO comment in the PMI source.
 * The two comment shapes (per pmiExport.emitDimension / emitGdt) are:
 *
 *   /​* dimension <d.id> refs: <r1>, <r2>, ... (Phase 2 OCCT plumbing) *​/
 *   /​* GD&T <g.id> target: <targetRef> (Phase 2 OCCT plumbing) *​/
 *
 * Returns the SET of refs that actually appear — used to skip bindings
 * whose ref was never referenced by any PMI item.
 */
function collectReferencedRefs(pmiSource: string): Set<string> {
  const found = new Set<string>();

  // Dimension comments — refs are a comma-space-separated list.
  const dimRe = /\/\* dimension [^ ]+ refs: ([^()]+?) \(Phase 2 OCCT plumbing\) \*\//g;
  let m: RegExpExecArray | null;
  while ((m = dimRe.exec(pmiSource)) !== null) {
    const list = m[1]!;
    for (const r of list.split(',')) {
      const trimmed = r.trim();
      if (trimmed.length > 0) found.add(trimmed);
    }
  }

  // GD&T comments — single targetRef.
  const gdtRe = /\/\* GD&T [^ ]+ target: ([^ ]+) \(Phase 2 OCCT plumbing\) \*\//g;
  while ((m = gdtRe.exec(pmiSource)) !== null) {
    const ref = m[1]!.trim();
    if (ref.length > 0) found.add(ref);
  }

  return found;
}

/**
 * Patch the Phase-1 TODO comments to mention the resolved SHAPE_ASPECT refs.
 *
 * For each matched comment, we REPLACE it with a new comment of the form
 *   /​* <orig kind> <id> bound to #<sa1> (<ref1>), #<sa2> (<ref2>), ... *​/
 * keeping the per-ref traceability. Unresolved refs (not in `mapping`) keep
 * their original `<ref>` token so the diagnostic isn't silently dropped.
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
      // No resolved refs → keep the original comment shape so the
      // traceability message is unchanged. We re-emit it explicitly because
      // String.replace consumes the match.
      if (resolved.length === 0) {
        return `/* dimension ${dimId} refs: ${parts.join(', ')} (Phase 2 OCCT plumbing) */`;
      }
      const head = `/* dimension ${dimId} bound to ${resolved.join(', ')}`;
      const tail = unresolved.length > 0
        ? ` (unresolved: ${unresolved.join(', ')}) */`
        : ' */';
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
      return `/* GD&T ${gdtId} bound to #${id} (${ref}) */`;
    },
  );

  return patched;
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Bind a Phase-1 PMI fragment to STEP geometry entities by emitting
 * SHAPE_ASPECT + SHAPE_DEFINITION_REPRESENTATION pairs and rewriting the
 * Phase-1 TODO comments to surface the freshly allocated ids.
 *
 * See module-level JSDoc for the full algorithm + Phase 3 wishlist.
 */
export function bindPmiToShape(opts: PmiBindingOptions): PmiBindingResult {
  const { bindings, pmiFragment, startEntityId } = opts;

  if (!Number.isInteger(startEntityId) || startEntityId < 1) {
    throw new Error(
      `bindPmiToShape: startEntityId must be a positive integer, got ${startEntityId}`,
    );
  }

  // Empty bindings → fast-path. We still validate startEntityId above so a
  // bad seed fails loudly rather than silently rendering an empty result.
  if (bindings.length === 0) {
    return {
      additionalSource: '',
      patchedPmi: pmiFragment.source,
      lastEntityId: startEntityId - 1,
      mapping: new Map<string, number>(),
      warnings: [],
    };
  }

  // Validate each binding's entityId is a positive integer. Failing fast
  // here beats emitting `#NaN=` lines that would crash a STEP parser.
  for (const b of bindings) {
    if (!Number.isInteger(b.entityId) || b.entityId < 1) {
      throw new Error(
        `bindPmiToShape: binding for ref '${b.ref}' has invalid entityId ${b.entityId}`,
      );
    }
    if (b.kind !== 'face' && b.kind !== 'edge' && b.kind !== 'vertex') {
      // Cast to string for the message — at this branch TypeScript has
      // narrowed `kind` to `never`, so template-literal interpolation would
      // be rejected without the explicit conversion.
      const badKind: string = String(b.kind);
      throw new Error(
        `bindPmiToShape: binding for ref '${b.ref}' has unknown kind '${badKind}'`,
      );
    }
  }

  // Coalesce duplicates (first-wins) so the SAME `ref` appearing in
  // multiple bindings produces ONE SHAPE_ASPECT.
  const uniqueBindings = new Map<string, RefBinding>();
  for (const b of bindings) {
    if (!uniqueBindings.has(b.ref)) {
      uniqueBindings.set(b.ref, b);
    }
  }

  // Restrict to refs actually referenced by a TODO comment. Bindings whose
  // ref is absent → warning + skip.
  const referenced = collectReferencedRefs(pmiFragment.source);
  const warnings: string[] = [];
  const resolvedBindings: RefBinding[] = [];
  for (const [ref, binding] of uniqueBindings) {
    if (referenced.has(ref)) {
      resolvedBindings.push(binding);
    } else {
      warnings.push(`ref "${ref}" not referenced by any PMI item — skipped`);
    }
  }

  // Nothing to emit → still return the patched (== original) source so the
  // caller can splice unconditionally without a null check.
  if (resolvedBindings.length === 0) {
    return {
      additionalSource: '',
      patchedPmi: pmiFragment.source,
      lastEntityId: startEntityId - 1,
      mapping: new Map<string, number>(),
      warnings,
    };
  }

  // Emit deterministically — iteration order matches `bindings` input
  // order (Map preserves insertion order, and we walked `bindings` once
  // building `uniqueBindings`).
  const b = new BindingBuilder(startEntityId);
  const mapping = new Map<string, number>();

  // 1-line header comment matches the style of `pmiExport.writePmiFragment`
  // so a reader scanning the combined source sees a clear section break.
  b.comment(
    `PMI shape binding — ${resolvedBindings.length} SHAPE_ASPECT, ${warnings.length} skipped`,
  );

  for (const binding of resolvedBindings) {
    // SHAPE_ASPECT(name, description, of_shape, product_definitional)
    //   - name        : the Sheet ref id (echoed for traceability).
    //   - description : '<kind>@#<entityId>' so a Part-21 reader can recover
    //                   the bound geometry without resolving SHAPE_DEFINITION_REPRESENTATION.
    //   - of_shape    : '$' — the product_definition_shape ref is resolved
    //                   in Phase 3 once stepWriteWithPmi exposes it.
    //   - product_def : `.T.` — these aspects are part of the product
    //                   definition (vs. a manufacturing-only annotation).
    const refLabel = esc(binding.ref);
    const description = esc(`${binding.kind}@#${binding.entityId}`);
    const saRes = b.add(
      `SHAPE_ASPECT('${refLabel}','${description}',$,.T.)`,
    );

    // SHAPE_DEFINITION_REPRESENTATION(definition, used_representation) ties
    // the SHAPE_ASPECT to the actual geometry entity id. AP242 typically
    // wants a PRODUCT_DEFINITION_SHAPE on the LHS, but the Phase-1 STEP
    // emitter doesn't yet expose one; we pass the SHAPE_ASPECT directly so
    // the relationship is parser-valid (Part 21 accepts any of the
    // characterized_definition select members here).
    b.add(
      `SHAPE_DEFINITION_REPRESENTATION(${saRes.ref},#${binding.entityId})`,
    );

    mapping.set(binding.ref, saRes.id);
  }

  const patchedPmi = patchTodoComments(pmiFragment.source, mapping);

  return {
    additionalSource: b.serialize(),
    patchedPmi,
    lastEntityId: b.lastId(),
    mapping,
    warnings,
  };
}

// ─── escape-hatch exports for tests ──────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests + Phase 3. */
export const __internal = {
  BindingBuilder,
  collectReferencedRefs,
  patchTodoComments,
  esc,
  escapeRegex,
};
