import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use an in-memory mock of getDbAdapter so we can assert behavior without
// touching real SQLite/Postgres. The mock implements the small slice of the
// adapter that disabledVariants.ts exercises.
const tables = new Map<string, Map<string, Record<string, unknown>>>();

function getOrCreateTable(name: string) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
}

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]): Promise<void> {
      if (/CREATE TABLE/i.test(sql)) {
        getOrCreateTable('nf_disabled_variants');
        return;
      }
      if (/INSERT OR REPLACE INTO nf_disabled_variants/i.test(sql)) {
        const t = getOrCreateTable('nf_disabled_variants');
        const [variant_id, reason, disabled_at, disabled_by] = args as [string, string | null, number, string | null];
        t.set(variant_id, { variant_id, reason, disabled_at, disabled_by });
        return;
      }
      if (/DELETE FROM nf_disabled_variants/i.test(sql)) {
        const t = getOrCreateTable('nf_disabled_variants');
        const [variant_id] = args as [string];
        t.delete(variant_id);
        return;
      }
    },
    async queryAll<T>(sql: string): Promise<T[]> {
      if (/FROM nf_disabled_variants/i.test(sql)) {
        const t = getOrCreateTable('nf_disabled_variants');
        return Array.from(t.values()) as unknown as T[];
      }
      return [];
    },
    async queryOne<T>(): Promise<T | null> { return null; },
  }),
}));

import {
  loadDisabledVariants,
  disableVariant,
  enableVariant,
  listDisabledVariants,
  disabledVariantsCached,
  _clearDisabledVariantsCacheForTests,
} from '../disabledVariants';

describe('disabledVariants', () => {
  beforeEach(() => {
    tables.clear();
    _clearDisabledVariantsCacheForTests();
  });

  it('starts empty', async () => {
    expect((await loadDisabledVariants()).size).toBe(0);
    expect(await listDisabledVariants()).toEqual([]);
  });

  it('disable + enable round-trips', async () => {
    await disableVariant({ variantId: 'shape-chat:exp', reason: 'high error rate', disabledBy: 'admin-1' });

    const list = await listDisabledVariants();
    expect(list).toHaveLength(1);
    expect(list[0].variantId).toBe('shape-chat:exp');
    expect(list[0].reason).toBe('high error rate');
    expect(list[0].disabledBy).toBe('admin-1');

    await enableVariant('shape-chat:exp');
    expect(await listDisabledVariants()).toEqual([]);
  });

  it('disabledVariantsCached returns empty before first load', () => {
    expect(disabledVariantsCached().size).toBe(0);
  });

  it('disable invalidates cache so next load reflects the change', async () => {
    await loadDisabledVariants();           // primes empty cache
    expect(disabledVariantsCached().size).toBe(0);

    await disableVariant({ variantId: 'foo:bar' });
    // Cache is invalidated → cached() returns empty until next load fires.
    // Ensure load picks up the new state.
    expect((await loadDisabledVariants()).has('foo:bar')).toBe(true);
  });

  it('disable is idempotent (INSERT OR REPLACE)', async () => {
    await disableVariant({ variantId: 'shape-chat:v2', reason: 'first' });
    await disableVariant({ variantId: 'shape-chat:v2', reason: 'second' });
    const list = await listDisabledVariants();
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('second');
  });

  it('multiple variants tracked independently', async () => {
    await disableVariant({ variantId: 'a:x' });
    await disableVariant({ variantId: 'b:y' });
    const set = await loadDisabledVariants();
    expect(set.has('a:x')).toBe(true);
    expect(set.has('b:y')).toBe(true);
    expect(set.size).toBe(2);
  });
});
