/**
 * partPmi — Phase 5.3 per-part PMI allocation helpers.
 *
 * Small bookkeeping module used by {@link writeAssemblyWithPmi} to track
 * entity-id ranges allocated per assembly part as PMI fragments + SHAPE_ASPECT
 * blocks are emitted sequentially after the assembly geometry.
 *
 * This module is a STRICT helper:
 *   - It NEVER imports stepWrite / pmiExport / pmiShapeBinding / stepWriteWithPmi
 *     / stepWriteWithPmiBindings — it is pure id arithmetic + small structural
 *     containers.
 *   - It owns no STEP-text emission — the parent orchestrator wires the actual
 *     `writePmiFragment` / `bindPmiToShape` calls. We just track the ranges so
 *     the orchestrator can build the per-part mapping deterministically.
 *
 * Why it exists as its own file:
 *   - The id-range math (PMI start → PMI end → binding start → binding end →
 *     next-part PMI start) is the kind of off-by-one prone arithmetic that
 *     benefits from focused unit testing.
 *   - Keeps the parent orchestrator readable — it can talk in terms of
 *     `allocator.beginPart(id)` / `allocator.recordPmi(...)` rather than raw
 *     integer cursors.
 *
 * Phase 5.3 conservative scope:
 *   - We only model the FORWARD allocation direction. Re-numbering or
 *     compacting entities after the fact is out of scope.
 *   - Part order = the order the parts appear in the `geometry.parts[]` array.
 *     We make no attempt to honour `partSheets` map iteration order, which is
 *     not stable across engines for non-string keys (string keys ARE stable
 *     since ES2015, but the parent orchestrator iterates `parts` anyway).
 */

/**
 * Recorded id-range for a single part's PMI + binding emissions. All fields
 * are inclusive — e.g. a part whose PMI fragment occupies ids 200..210 has
 * `pmiStart = 200`, `pmiEnd = 210`. When no PMI was emitted for a part, both
 * `pmiStart` and `pmiEnd` are `null` (rather than 0) so callers can detect the
 * absence without inspecting magic sentinel values.
 */
export interface PartPmiRange {
  /** The part id this range describes — echoed from the source data. */
  partId: string;
  /** Inclusive lower bound of the PMI fragment's entity ids, or null. */
  pmiStart: number | null;
  /** Inclusive upper bound of the PMI fragment's entity ids, or null. */
  pmiEnd: number | null;
  /** Inclusive lower bound of the SHAPE_ASPECT block's entity ids, or null. */
  bindStart: number | null;
  /** Inclusive upper bound of the SHAPE_ASPECT block's entity ids, or null. */
  bindEnd: number | null;
}

/**
 * Stateful allocator that hands out monotonically-increasing entity-id ranges
 * for per-part PMI emission. Constructed with the highest id observed in the
 * assembly geometry; the first allocation starts at `assemblyMaxId + 1`.
 *
 * Usage shape (per part, in order):
 *
 *   const a = new PartPmiAllocator(assemblyMaxId);
 *   for (const part of parts) {
 *     a.beginPart(part.id);
 *     // emit PMI fragment starting at a.nextId() → lastPmiId returned by writer
 *     a.recordPmi(lastPmiId);
 *     // emit bindings starting at a.nextId() → lastBindId returned by binder
 *     a.recordBinding(lastBindId);
 *   }
 *   const ranges = a.snapshot();
 *
 * The allocator deliberately refuses to advance the cursor BACKWARDS — calls
 * like `recordPmi(lastPmiId)` where `lastPmiId < nextId() - 1` throw. This
 * catches the bug where a writer reports `lastEntityId = startEntityId - 1`
 * for an empty fragment but the caller forgets to special-case it (the
 * orchestrator should NOT call `recordPmi` / `recordBinding` for an empty
 * emission — see {@link skipPmi} / {@link skipBinding} instead).
 */
export class PartPmiAllocator {
  private cursor: number;
  private readonly ranges: PartPmiRange[] = [];
  private currentPart: PartPmiRange | null = null;

  /**
   * Construct an allocator that begins handing out ids at `assemblyMaxId + 1`.
   * @param assemblyMaxId Highest entity id observed in the geometry block
   * returned by `writeAssemblyAsStep`. Must be a non-negative integer.
   */
  constructor(assemblyMaxId: number) {
    if (!Number.isInteger(assemblyMaxId) || assemblyMaxId < 0) {
      throw new Error(
        `PartPmiAllocator: assemblyMaxId must be a non-negative integer, got ${assemblyMaxId}`,
      );
    }
    this.cursor = assemblyMaxId + 1;
  }

  /** Next entity id that would be allocated (== `assemblyMaxId + 1` initially). */
  nextId(): number {
    return this.cursor;
  }

  /**
   * Begin tracking emissions for a new part. The previous part's range (if
   * any) is pushed onto the snapshot list. Calling `beginPart` twice in a row
   * without recording anything records an "empty" range for the first part
   * (both PMI and binding bounds null) — useful when the parent walks all
   * parts even when some have no sheet.
   */
  beginPart(partId: string): void {
    if (typeof partId !== 'string' || partId.length === 0) {
      throw new Error(`PartPmiAllocator: partId must be a non-empty string`);
    }
    if (this.currentPart !== null) {
      this.ranges.push(this.currentPart);
    }
    this.currentPart = {
      partId,
      pmiStart: null,
      pmiEnd: null,
      bindStart: null,
      bindEnd: null,
    };
  }

  /**
   * Record that the PMI fragment for the current part occupies the contiguous
   * range `[nextId(), pmiLastId]`. Advances the cursor past `pmiLastId`.
   * Throws if no part is in progress, or if `pmiLastId < nextId()` (would
   * mean the writer made no progress — call {@link skipPmi} in that case).
   */
  recordPmi(pmiLastId: number): void {
    this.assertActivePart('recordPmi');
    if (!Number.isInteger(pmiLastId)) {
      throw new Error(`PartPmiAllocator.recordPmi: pmiLastId must be an integer, got ${pmiLastId}`);
    }
    if (pmiLastId < this.cursor) {
      throw new Error(
        `PartPmiAllocator.recordPmi: pmiLastId (${pmiLastId}) must be >= nextId (${this.cursor})`,
      );
    }
    this.currentPart!.pmiStart = this.cursor;
    this.currentPart!.pmiEnd = pmiLastId;
    this.cursor = pmiLastId + 1;
  }

  /**
   * Record that the SHAPE_ASPECT binding block for the current part occupies
   * `[nextId(), bindLastId]`. Advances the cursor past `bindLastId`. Same
   * monotonicity rule as {@link recordPmi}.
   */
  recordBinding(bindLastId: number): void {
    this.assertActivePart('recordBinding');
    if (!Number.isInteger(bindLastId)) {
      throw new Error(`PartPmiAllocator.recordBinding: bindLastId must be an integer, got ${bindLastId}`);
    }
    if (bindLastId < this.cursor) {
      throw new Error(
        `PartPmiAllocator.recordBinding: bindLastId (${bindLastId}) must be >= nextId (${this.cursor})`,
      );
    }
    this.currentPart!.bindStart = this.cursor;
    this.currentPart!.bindEnd = bindLastId;
    this.cursor = bindLastId + 1;
  }

  /**
   * Mark the current part as having no PMI emitted (e.g. partSheets[id] was
   * absent or the sheet was empty). No-op on the cursor.
   */
  skipPmi(): void {
    this.assertActivePart('skipPmi');
    // PMI bounds left as null.
  }

  /**
   * Mark the current part as having no binding emitted (e.g. partBindings[id]
   * absent, or none of its bindings resolved). No-op on the cursor.
   */
  skipBinding(): void {
    this.assertActivePart('skipBinding');
    // Binding bounds left as null.
  }

  /**
   * Finalize and return all per-part ranges in the order `beginPart` was
   * called. After this returns the allocator is exhausted — calling
   * `beginPart` again throws.
   */
  snapshot(): PartPmiRange[] {
    if (this.currentPart !== null) {
      this.ranges.push(this.currentPart);
      this.currentPart = null;
    }
    return [...this.ranges];
  }

  /** Internal — guards methods that need an active part. */
  private assertActivePart(method: string): void {
    if (this.currentPart === null) {
      throw new Error(`PartPmiAllocator.${method}: no active part (call beginPart first)`);
    }
  }
}

/**
 * Validate the input ordering invariant for a snapshot — for any two ranges
 * `a, b` where `a` comes before `b` in the snapshot list, every recorded id
 * in `a` must be strictly less than every recorded id in `b`, AND within a
 * single range, `pmiEnd < bindStart` whenever both are non-null.
 *
 * Used by the unit tests + as a defensive assertion in the orchestrator after
 * all PMI is emitted to surface allocator bugs immediately rather than
 * downstream when a STEP parser chokes on a duplicate id.
 */
export function isStrictlyIncreasing(ranges: ReadonlyArray<PartPmiRange>): boolean {
  let highest = -1;
  for (const r of ranges) {
    if (r.pmiStart !== null) {
      if (r.pmiStart <= highest) return false;
      if (r.pmiEnd === null || r.pmiEnd < r.pmiStart) return false;
      highest = r.pmiEnd;
    }
    if (r.bindStart !== null) {
      if (r.bindStart <= highest) return false;
      if (r.bindEnd === null || r.bindEnd < r.bindStart) return false;
      highest = r.bindEnd;
    }
  }
  return true;
}

/**
 * Convenience accessor — returns the highest id reserved across the entire
 * snapshot, or `-1` if no part emitted anything. The next free id is
 * `maxReservedId(ranges) + 1`.
 */
export function maxReservedId(ranges: ReadonlyArray<PartPmiRange>): number {
  let max = -1;
  for (const r of ranges) {
    if (r.pmiEnd !== null && r.pmiEnd > max) max = r.pmiEnd;
    if (r.bindEnd !== null && r.bindEnd > max) max = r.bindEnd;
  }
  return max;
}
