import { describe, expect, it } from 'vitest';
import {
  LARGE_ASSEMBLY_DETAIL_BATCH_PARTS,
  LARGE_ASSEMBLY_INITIAL_DETAIL_PARTS,
  LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS,
  LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY,
  planProgressiveAssemblyLoad,
} from '@/lib/progressiveAssemblyLoad';

describe('large assembly progressive load plan', () => {
  it('loads a small assembly in one pass', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `p${index}`);
    const plan = planProgressiveAssemblyLoad(ids);
    expect(plan.progressive).toBe(false);
    expect(plan.batches).toEqual([ids]);
  });

  it('prioritises selected parts and chunks a 500-part assembly', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `p${index}`);
    const plan = planProgressiveAssemblyLoad(ids, ['p499', 'p250', 'missing', 'p499']);
    expect(plan.progressive).toBe(true);
    expect(plan.orderedPartIds.slice(0, 2)).toEqual(['p499', 'p250']);
    expect(plan.batches[0]).toHaveLength(LARGE_ASSEMBLY_INITIAL_DETAIL_PARTS);
    expect(plan.batches.slice(1).every((batch) => batch.length <= LARGE_ASSEMBLY_DETAIL_BATCH_PARTS)).toBe(true);
    expect(plan.batches.flat()).toHaveLength(500);
    expect(new Set(plan.batches.flat()).size).toBe(500);
  });

  it('keeps commercial budgets explicit and bounded', () => {
    expect(LARGE_ASSEMBLY_PROGRESSIVE_MIN_PARTS).toBe(48);
    expect(LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY).toBeGreaterThanOrEqual(2);
    expect(LARGE_ASSEMBLY_TESSELLATION_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});
