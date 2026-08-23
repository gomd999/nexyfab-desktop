/** Commercial large-assembly viewport budgets. */
export const LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS = 48;
export const LARGE_ASSEMBLY_INITIAL_DETAIL_PARTS = 24;
export const LARGE_ASSEMBLY_DETAIL_BATCH_PARTS = 16;
export const LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY = 4;

export interface ProgressiveAssemblyLoadPlan {
  progressive: boolean;
  orderedPartIds: string[];
  batches: string[][];
}

/**
 * Deterministic loading plan. Selected/focused parts are promoted first, while
 * every remaining occurrence keeps source order so reconnects paint the same
 * assembly progressively. The function is pure and used by both the viewport
 * detail scheduler and the server-tessellation queue.
 */
export function planProgressiveAssemblyLoad(
  partIds: readonly string[],
  priorityPartIds: readonly string[] = [],
  options: { threshold?: number; initial?: number; batch?: number } = {},
): ProgressiveAssemblyLoadPlan {
  const threshold = Math.max(1, options.threshold ?? LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS);
  const initial = Math.max(1, options.initial ?? LARGE_ASSEMBLY_INITIAL_DETAIL_PARTS);
  const batch = Math.max(1, options.batch ?? LARGE_ASSEMBLY_DETAIL_BATCH_PARTS);
  const valid = new Set(partIds);
  const seen = new Set<string>();
  const orderedPartIds: string[] = [];
  for (const id of [...priorityPartIds, ...partIds]) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    orderedPartIds.push(id);
  }
  if (orderedPartIds.length < threshold) {
    return { progressive: false, orderedPartIds, batches: [orderedPartIds] };
  }
  const batches: string[][] = [];
  batches.push(orderedPartIds.slice(0, initial));
  for (let index = initial; index < orderedPartIds.length; index += batch) {
    batches.push(orderedPartIds.slice(index, index + batch));
  }
  return { progressive: true, orderedPartIds, batches };
}
