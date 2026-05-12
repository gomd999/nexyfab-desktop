import { describe, it, expect, beforeEach, vi } from 'vitest';

const tables = new Map<string, Map<string, Record<string, unknown>>>();

function getOrCreateTable(name: string) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
}

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]): Promise<void> {
      if (/CREATE TABLE/i.test(sql)) {
        getOrCreateTable('nf_provider_override');
        getOrCreateTable('nf_provider_override_audit');
        return;
      }
      if (/DELETE FROM nf_provider_override\b/i.test(sql) && !/audit/i.test(sql)) {
        const t = getOrCreateTable('nf_provider_override');
        t.clear();
        return;
      }
      if (/INSERT INTO nf_provider_override_audit/i.test(sql)) {
        const t = getOrCreateTable('nf_provider_override_audit');
        const [id, changed_at, changed_by, chain_json] = args as [string, number, string | null, string];
        t.set(id, { id, changed_at, changed_by, chain_json });
        return;
      }
      if (/INSERT INTO nf_provider_override\b/i.test(sql)) {
        const t = getOrCreateTable('nf_provider_override');
        const [provider, position, updated_at, updated_by] = args as [string, number, number, string | null];
        t.set(provider, { provider, position, updated_at, updated_by });
        return;
      }
    },
    async queryAll<T>(sql: string, ...args: unknown[]): Promise<T[]> {
      if (/FROM nf_provider_override_audit/i.test(sql)) {
        const t = getOrCreateTable('nf_provider_override_audit');
        const rows = Array.from(t.values()) as Array<{ id: string; changed_at: number; changed_by: string | null; chain_json: string }>;
        const sorted = rows.sort((a, b) => b.changed_at - a.changed_at);
        // Honor LIMIT ? when the parameterized query passes it.
        const limitMatch = /LIMIT\s+\?/i.test(sql);
        const limit = limitMatch && typeof args[0] === 'number' ? args[0] : Infinity;
        return sorted.slice(0, limit) as unknown as T[];
      }
      if (/FROM nf_provider_override\b/i.test(sql)) {
        const t = getOrCreateTable('nf_provider_override');
        const rows = Array.from(t.values()) as Array<{ provider: string; position: number; updated_at: number; updated_by: string | null }>;
        return rows.sort((a, b) => a.position - b.position) as unknown as T[];
      }
      return [];
    },
    async queryOne<T>(): Promise<T | null> { return null; },
  }),
}));

import {
  loadProviderOverride,
  setProviderOverride,
  listProviderOverride,
  listProviderOverrideAudit,
  providerOverrideCached,
  applyConsolidation,
  _clearProviderOverrideCacheForTests,
} from '../providerOverride';

describe('providerOverride', () => {
  beforeEach(() => {
    tables.clear();
    _clearProviderOverrideCacheForTests();
  });

  it('starts with no override', async () => {
    expect(await loadProviderOverride()).toBeNull();
    expect(await listProviderOverride()).toEqual([]);
  });

  it('set + load round-trips ordered chain', async () => {
    await setProviderOverride(['anthropic', 'deepseek', 'openai'], 'admin-1');
    expect(await loadProviderOverride(true)).toEqual(['anthropic', 'deepseek', 'openai']);
    const list = await listProviderOverride();
    expect(list.map(r => r.provider)).toEqual(['anthropic', 'deepseek', 'openai']);
    expect(list.every(r => r.updatedBy === 'admin-1')).toBe(true);
  });

  it('dedupes and validates input', async () => {
    await setProviderOverride(
      ['deepseek', 'deepseek', 'openai', 'unknown' as never, 'anthropic'],
      'admin',
    );
    const chain = await loadProviderOverride(true);
    expect(chain).toEqual(['deepseek', 'openai', 'anthropic']);
  });

  it('empty array clears override', async () => {
    await setProviderOverride(['anthropic'], 'admin');
    expect(await loadProviderOverride(true)).toEqual(['anthropic']);

    await setProviderOverride([], 'admin');
    expect(await loadProviderOverride(true)).toBeNull();
  });

  it('cache shields from DB on subsequent reads', async () => {
    await setProviderOverride(['openai'], 'admin');
    await loadProviderOverride();   // primes cache
    expect(providerOverrideCached()).toEqual(['openai']);

    // Clear DB rows directly without going through setProviderOverride —
    // cache should still see the old chain until TTL expires or invalidates.
    tables.get('nf_provider_override')?.clear();
    expect(providerOverrideCached()).toEqual(['openai']);
  });

  it('setProviderOverride invalidates cache', async () => {
    await setProviderOverride(['deepseek'], 'admin');
    await loadProviderOverride();
    expect(providerOverrideCached()).toEqual(['deepseek']);

    await setProviderOverride(['anthropic'], 'admin');
    // After mutation, cached() should return null until next load() populates it.
    expect(providerOverrideCached()).toBeNull();
    expect(await loadProviderOverride(true)).toEqual(['anthropic']);
  });

  it('providerOverrideCached returns null when cache cold', () => {
    expect(providerOverrideCached()).toBeNull();
  });

  it('every set writes an audit row, most recent first', async () => {
    await setProviderOverride(['deepseek'], 'admin-a');
    await new Promise(r => setTimeout(r, 5));  // ensure timestamps differ
    await setProviderOverride(['anthropic', 'openai'], 'admin-b');
    await new Promise(r => setTimeout(r, 5));
    await setProviderOverride([], 'admin-c');

    const audit = await listProviderOverrideAudit();
    expect(audit).toHaveLength(3);
    expect(audit[0].changedBy).toBe('admin-c');
    expect(audit[0].chain).toEqual([]);
    expect(audit[1].changedBy).toBe('admin-b');
    expect(audit[1].chain).toEqual(['anthropic', 'openai']);
    expect(audit[2].changedBy).toBe('admin-a');
    expect(audit[2].chain).toEqual(['deepseek']);
  });

  it('audit limit is honored', async () => {
    for (let i = 0; i < 5; i++) {
      await setProviderOverride(['deepseek'], `admin-${i}`);
      await new Promise(r => setTimeout(r, 2));
    }
    expect((await listProviderOverrideAudit(2)).length).toBeLessThanOrEqual(2);
  });

  describe('applyConsolidation', () => {
    it('moves keep to front and drops drop', () => {
      const out = applyConsolidation(['anthropic', 'deepseek', 'openai'], 'deepseek', 'anthropic');
      expect(out).toEqual(['deepseek', 'openai']);
    });

    it('preserves relative order of remaining providers', () => {
      const out = applyConsolidation(['deepseek', 'openai', 'anthropic', 'local'], 'openai', 'anthropic');
      expect(out).toEqual(['openai', 'deepseek', 'local']);
    });

    it('prepends keep when not present', () => {
      const out = applyConsolidation(['anthropic', 'openai'], 'deepseek', 'anthropic');
      expect(out).toEqual(['deepseek', 'openai']);
    });

    it('keep === drop is a no-op', () => {
      const before: Array<'deepseek' | 'openai' | 'anthropic'> = ['deepseek', 'openai', 'anthropic'];
      const out = applyConsolidation(before, 'deepseek', 'deepseek');
      expect(out).toEqual(before);
    });

    it('drops duplicates of keep too', () => {
      // applyConsolidation must not leave a stale `keep` entry behind when
      // it was already in the chain — otherwise the new chain has a dupe.
      const out = applyConsolidation(['anthropic', 'deepseek', 'openai'], 'deepseek', 'openai');
      expect(out).toEqual(['deepseek', 'anthropic']);
      expect(out.filter(p => p === 'deepseek').length).toBe(1);
    });
  });
});
