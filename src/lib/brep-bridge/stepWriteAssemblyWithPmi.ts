/**
 * stepWriteAssemblyWithPmi — Phase 5.3 assembly + per-part PMI integration.
 *
 * Companion to {@link writeStepWithPmiBindings} that extends the geometry +
 * PMI + binding composition to MULTI-PART ASSEMBLIES. Where the single-part
 * orchestrator emits a sheet's worth of PMI for the whole geometry, this
 * module emits a SEPARATE PMI fragment + SHAPE_ASPECT block per part, keyed
 * by `partSheets[partId]` and `partBindings[partId]`.
 *
 * Like its single-part sibling this module is a STRICT orchestrator. It
 * NEVER modifies:
 *   - stepWrite.ts          (Agent-EE/FF — geometry writers, incl. writeAssemblyAsStep)
 *   - pmiExport.ts          (Agent-II — PMI fragment writer)
 *   - pmiShapeBinding.ts    (Agent-UU — SHAPE_ASPECT binder)
 *   - stepWriteWithPmi.ts   (Agent-HH — single-part geometry+PMI splicer; we
 *                            reuse its `splitStepFile` helper exclusively)
 *   - stepWriteWithPmiBindings.ts (Agent-NNN — the single-part orchestrator)
 *   - pmiExport.test.ts     (write-only contract)
 *
 * All composition happens here + in the {@link PartPmiAllocator} helper.
 *
 * Algorithm:
 *
 *   1. Call `writeAssemblyAsStep(parts)` to produce the assembly STEP source
 *      and discover its max entity id (via `splitStepFile`).
 *   2. For each part, in `parts[]` array order:
 *        a. If `partSheets[partId]` is absent → record an empty range and
 *           continue. If `partBindings[partId]` was present, surface a
 *           warning so the caller can detect the unused bindings.
 *        b. Call `writePmiFragment(sheet, allocator.nextId())` and record
 *           the allocated range.
 *        c. If `partBindings[partId]` is present AND the PMI fragment is
 *           non-empty, call `bindPmiToShape` with `allocator.nextId()`. The
 *           patched-PMI replaces the raw PMI in the output, and the
 *           SHAPE_ASPECT block is appended after it.
 *   3. Splice every per-part PMI + binding block into the assembly DATA
 *      section, ordered exactly as the parts array was walked:
 *        HEADER + assembly-geometry-entities
 *               + part1 PMI + part1 bindings
 *               + part2 PMI + part2 bindings
 *               + ...
 *               + tail (ENDSEC; END-ISO-...)
 *   4. Return:
 *        - the full ISO-10303-21 source string,
 *        - a `Map<partId, Map<refId, SHAPE_ASPECT id>>` so callers can wire
 *          downstream APPLIED_* entities on a per-part basis,
 *        - any warnings collected (missing parts, empty PMI, etc.).
 *
 * Per-part id-range invariant (verified in the test suite + asserted at
 * runtime via `isStrictlyIncreasing`):
 *
 *   assembly-entities < part1-PMI < part1-binds < part2-PMI < part2-binds < ...
 *
 * Edge cases handled by short-circuit:
 *   - empty parts                            → throws (matches writeAssemblyAsStep)
 *   - partSheets undefined / empty           → assembly STEP only, no warnings
 *   - partSheets has key not in parts        → warning, the entry is ignored
 *   - partBindings has key not in parts      → warning, the entry is ignored
 *   - partBindings for a part with no sheet  → warning, the bindings ignored
 *   - sheet has 0 dim + 0 gdt for a part     → empty PMI, bindings ignored
 *                                               with warning (mirrors HH/NNN)
 *   - binding ref absent from PMI            → forwarded from bindPmiToShape
 */

import {
  writeAssemblyAsStep,
  type AssemblyPart,
  type AssemblyStepOptions,
  type StepHeaderOptions,
} from './stepWrite';
import { __internal as stepWriteWithPmiInternal } from './stepWriteWithPmi';
import {
  writePmiFragment,
  type WritePmiFragmentResult,
} from './pmiExport';
import {
  bindPmiToShape,
  type RefBinding,
} from './pmiShapeBinding';
import type { Sheet } from '@/lib/drawing/sheet';
import { validateSheet } from '@/lib/drawing/sheet';
import {
  PartPmiAllocator,
  isStrictlyIncreasing,
  type PartPmiRange,
} from './partPmi';

// ─── public API types ─────────────────────────────────────────────────────

/** Options accepted by {@link writeAssemblyWithPmi}. */
export interface AssemblyPmiOptions {
  /**
   * Assembly geometry source. The `parts` array is forwarded verbatim to
   * `writeAssemblyAsStep`; ordering of parts here also defines the iteration
   * order used to splice per-part PMI fragments into the final source.
   */
  geometry: {
    kind: 'assembly';
    /** Human-readable root assembly name. Forwarded to the geometry writer. */
    assemblyName?: string;
    parts: ReadonlyArray<AssemblyPart>;
  };
  /**
   * Per-part PMI sheets, keyed by `AssemblyPart.id`. Parts without an entry
   * (or whose entry is undefined) emit no PMI fragment.
   *
   * Keys that DO NOT match any part id surface as warnings and are otherwise
   * ignored — they never produce a stray PMI block in the output.
   */
  partSheets?: Record<string, Sheet>;
  /**
   * Per-part SHAPE_ASPECT bindings, keyed by `AssemblyPart.id`. Each value
   * is forwarded verbatim to `bindPmiToShape` for its part's PMI fragment.
   *
   * Bindings whose part has no sheet (or an empty sheet) are warned-out
   * because there's no PMI source to anchor them to. This mirrors the
   * single-part orchestrator's behaviour.
   */
  partBindings?: Record<string, ReadonlyArray<RefBinding>>;
  /** ISO-10303-21 HEADER overrides (forwarded to the geometry writer). */
  header?: StepHeaderOptions;
  /** Forwarded to `writeAssemblyAsStep`. Optional in all paths. */
  onAssemblyPartFallback?: AssemblyStepOptions['onFallback'];
}

/** Result of {@link writeAssemblyWithPmi}. */
export interface AssemblyPmiResult {
  /** Complete ISO-10303-21 STEP source (HEADER + DATA + END-ISO trailer). */
  source: string;
  /**
   * `partId → (Sheet ref id → SHAPE_ASPECT entity id)`. Only parts with a
   * non-empty PMI fragment AND at least one resolved binding appear. Empty
   * (but non-null) when no part emitted any binding.
   */
  pmiMappingByPart: Map<string, Map<string, number>>;
  /**
   * Per-part entity-id ranges (PMI + binding). Useful for downstream
   * diagnostics + Phase 3 APPLIED_* wiring. Order matches `geometry.parts[]`.
   */
  ranges: ReadonlyArray<PartPmiRange>;
  /**
   * Diagnostics surfaced during composition. Includes:
   *   - 'partSheets key "<key>" does not match any part — ignored'
   *   - 'partBindings key "<key>" does not match any part — ignored'
   *   - 'partBindings for "<id>" ignored: no sheet supplied'
   *   - 'partBindings for "<id>" ignored: empty PMI fragment'
   *   - forwarded bindPmiToShape warnings (e.g. ref not present in PMI)
   */
  warnings: string[];
}

// ─── internal helpers ────────────────────────────────────────────────────

/**
 * Normalise a STEP source-fragment to end with exactly one newline. Mirrors
 * the same convention used by the single-part orchestrator so per-part
 * splices never produce a stray blank line at the boundary.
 */
function ensureTrailingNewline(s: string): string {
  if (s.length === 0) return s;
  return s.endsWith('\n') ? s : `${s}\n`;
}

/**
 * Build the per-part composite source = patched-PMI + binding source.
 * Pulled out as a tiny pure function so it can be unit-tested in isolation.
 */
function joinPartFragment(pmiSource: string, bindSource: string): string {
  if (pmiSource.length === 0 && bindSource.length === 0) return '';
  if (bindSource.length === 0) return ensureTrailingNewline(pmiSource);
  if (pmiSource.length === 0) return ensureTrailingNewline(bindSource);
  return ensureTrailingNewline(pmiSource) + ensureTrailingNewline(bindSource);
}

// ─── public entry point ──────────────────────────────────────────────────

/**
 * Emit a complete ISO-10303-21 STEP file that combines a multi-part assembly
 * geometry with per-part AP242 PMI + SHAPE_ASPECT bindings.
 *
 * See module-level JSDoc for the full algorithm + edge-case matrix.
 */
export function writeAssemblyWithPmi(opts: AssemblyPmiOptions): AssemblyPmiResult {
  // ── 1. Input validation — surface bad input before any work happens. ────
  if (!opts.geometry || opts.geometry.kind !== 'assembly') {
    throw new Error(
      `writeAssemblyWithPmi: geometry.kind must be 'assembly', got ${String(opts.geometry?.kind)}`,
    );
  }
  if (opts.geometry.parts.length === 0) {
    // Defer the exact wording to writeAssemblyAsStep so the error message stays
    // single-sourced. We just guard so a misuse fails loudly at THIS layer too.
    throw new Error('writeAssemblyWithPmi: assembly must have at least one part');
  }

  // Validate every supplied sheet up-front so a bad sheet aborts BEFORE we
  // spend time emitting the (potentially large) assembly geometry block.
  const partSheets = opts.partSheets ?? {};
  for (const [partId, sheet] of Object.entries(partSheets)) {
    if (sheet) validateSheet(sheet);
    // We don't error on unknown keys here — that's surfaced as a warning later
    // (matches the partBindings policy and keeps the partSheets / partBindings
    // contracts symmetric).
    void partId;
  }

  const warnings: string[] = [];

  // ── 2. Detect partSheets / partBindings keys that don't match any part. ─
  const partIdSet = new Set<string>();
  for (const part of opts.geometry.parts) partIdSet.add(part.id);
  for (const key of Object.keys(partSheets)) {
    if (!partIdSet.has(key)) {
      warnings.push(`partSheets key "${key}" does not match any part — ignored`);
    }
  }
  const partBindings = opts.partBindings ?? {};
  for (const key of Object.keys(partBindings)) {
    if (!partIdSet.has(key)) {
      warnings.push(`partBindings key "${key}" does not match any part — ignored`);
    }
  }

  // ── 3. Emit the assembly geometry alone. We delegate to the existing
  //       writer rather than re-implement so any future change to the
  //       assembly envelope is picked up here for free.
  const assemblySource = writeAssemblyAsStep(
    {
      assemblyName: opts.geometry.assemblyName ?? 'assembly',
      parts: opts.geometry.parts,
    },
    {
      ...(opts.header ?? {}),
      ...(opts.onAssemblyPartFallback
        ? { onFallback: opts.onAssemblyPartFallback }
        : {}),
    },
  );

  // ── 4. Split into HEADER / DATA-entities / tail to recover the max id.
  const split = stepWriteWithPmiInternal.splitStepFile(assemblySource);

  // ── 5. Walk parts in input order, emitting per-part PMI + bindings.
  const allocator = new PartPmiAllocator(split.maxEntityId);
  const perPartFragments: string[] = [];
  const pmiMappingByPart = new Map<string, Map<string, number>>();

  for (const part of opts.geometry.parts) {
    allocator.beginPart(part.id);
    const sheet = partSheets[part.id];
    const bindings = partBindings[part.id];

    if (!sheet) {
      allocator.skipPmi();
      allocator.skipBinding();
      if (bindings && bindings.length > 0) {
        warnings.push(`partBindings for "${part.id}" ignored: no sheet supplied`);
      }
      continue;
    }

    // Emit PMI fragment for this part.
    const pmiResult: WritePmiFragmentResult = writePmiFragment(sheet, allocator.nextId());

    if (pmiResult.source.length === 0) {
      // Empty sheet (0 dim + 0 gdt). writePmiFragment leaves lastEntityId ==
      // startEntityId in that case, but we deliberately treat the range as
      // "skipped" so the snapshot accurately reflects that no entity was
      // emitted. The PMI fragment contributes nothing to the spliced output.
      allocator.skipPmi();
      allocator.skipBinding();
      if (bindings && bindings.length > 0) {
        warnings.push(`partBindings for "${part.id}" ignored: empty PMI fragment`);
      }
      continue;
    }

    allocator.recordPmi(pmiResult.lastEntityId);

    // Optionally bind to shape.
    let patchedPmi = pmiResult.source;
    let bindSource = '';
    if (bindings && bindings.length > 0) {
      const bindResult = bindPmiToShape({
        bindings,
        pmiFragment: pmiResult,
        startEntityId: allocator.nextId(),
      });
      patchedPmi = bindResult.patchedPmi;
      bindSource = bindResult.additionalSource;

      // Only record a non-empty range if the binder actually emitted entities.
      // bindPmiToShape returns `lastEntityId == startEntityId - 1` when no
      // resolved binding was emitted (e.g. every binding's ref was absent).
      if (bindResult.additionalSource.length > 0) {
        allocator.recordBinding(bindResult.lastEntityId);
      } else {
        allocator.skipBinding();
      }

      if (bindResult.mapping.size > 0) {
        const partMap = new Map<string, number>();
        for (const [ref, id] of bindResult.mapping) {
          partMap.set(ref, id);
        }
        pmiMappingByPart.set(part.id, partMap);
      }

      for (const w of bindResult.warnings) {
        // Prefix the warning so the caller can tell which part it came from
        // when multiple parts report the same ref-missing diagnostic.
        warnings.push(`part "${part.id}": ${w}`);
      }
    } else {
      allocator.skipBinding();
    }

    perPartFragments.push(joinPartFragment(patchedPmi, bindSource));
  }

  const ranges = allocator.snapshot();

  // ── 6. Defensive invariant check — surfaces any allocator bug NOW rather
  //       than downstream when a STEP parser chokes on a duplicate id.
  if (!isStrictlyIncreasing(ranges)) {
    throw new Error(
      `writeAssemblyWithPmi: internal id-allocation bug — ranges are not strictly increasing: ${JSON.stringify(ranges)}`,
    );
  }

  // ── 7. Re-assemble. Order: HEADER + assembly entities + per-part PMI/binds + tail.
  const geomBlock = ensureTrailingNewline(split.dataEntities);
  const middle = perPartFragments.join('');
  const finalSource = `${split.headerBlock}${geomBlock}${middle}${split.tail}`;

  return {
    source: finalSource,
    pmiMappingByPart,
    ranges,
    warnings,
  };
}

// ─── escape-hatch exports for tests ───────────────────────────────────────

/** Internal API surface — not stable; exposed for unit tests only. */
export const __internal = {
  ensureTrailingNewline,
  joinPartFragment,
};
