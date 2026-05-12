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
        getOrCreateTable('nf_prompt_compare_runs');
        return;
      }
      if (/INSERT INTO nf_prompt_compare_runs/i.test(sql)) {
        const t = getOrCreateTable('nf_prompt_compare_runs');
        const [id, created_at, created_by, prompt_id, prompt_version, max_tokens, temperature, user_input, results_json] =
          args as [string, number, string | null, string, string | null, number | null, number | null, string, string];
        t.set(id, { id, created_at, created_by, prompt_id, prompt_version, max_tokens, temperature, user_input, results_json });
        return;
      }
    },
    async queryAll<T>(sql: string, ...args: unknown[]): Promise<T[]> {
      if (/FROM nf_prompt_compare_runs/i.test(sql)) {
        const t = getOrCreateTable('nf_prompt_compare_runs');
        const all = Array.from(t.values()) as Array<Record<string, unknown> & {
          created_at: number; prompt_id: string; created_by: string | null;
        }>;
        let filtered = all;
        // args[] order matches the dynamic WHERE clause in compareStore.
        const remaining: unknown[] = [...args];
        if (/prompt_id\s*=\s*\?/i.test(sql)) {
          const v = String(remaining.shift());
          filtered = filtered.filter(r => r.prompt_id === v);
        }
        if (/created_by\s*=\s*\?/i.test(sql)) {
          const v = String(remaining.shift());
          filtered = filtered.filter(r => r.created_by === v);
        }
        if (/created_at\s*>=\s*\?/i.test(sql)) {
          const v = remaining.shift() as number;
          filtered = filtered.filter(r => r.created_at >= v);
        }
        if (/created_at\s*<=\s*\?/i.test(sql)) {
          const v = remaining.shift() as number;
          filtered = filtered.filter(r => r.created_at <= v);
        }
        const sorted = filtered.sort((a, b) => b.created_at - a.created_at);
        const limit = remaining[remaining.length - 1] as number;
        return sorted.slice(0, limit) as unknown as T[];
      }
      return [];
    },
    async queryOne<T>(sql: string, ...args: unknown[]): Promise<T | null> {
      if (/FROM nf_prompt_compare_runs WHERE id = \?/i.test(sql)) {
        const t = getOrCreateTable('nf_prompt_compare_runs');
        return (t.get(String(args[0])) ?? null) as T | null;
      }
      return null;
    },
  }),
}));

import { saveCompareRun, listCompareRuns, getCompareRun } from '../compareStore';

describe('compareStore', () => {
  beforeEach(() => { tables.clear(); });

  it('save + get round-trips a run', async () => {
    const id = await saveCompareRun({
      createdBy: 'admin-1',
      promptId: 'shape-chat',
      promptVersion: '1.0.0',
      maxTokens: 1000,
      temperature: 0.2,
      userInput: 'Make a flange',
      results: [
        { provider: 'deepseek', ok: true, text: 'flange code' },
        { provider: 'anthropic', ok: true, text: 'flange code 2' },
      ],
    });
    expect(id).toMatch(/^pcr-/);

    const fetched = await getCompareRun(id);
    expect(fetched).not.toBeNull();
    expect(fetched?.promptId).toBe('shape-chat');
    expect(fetched?.userInput).toBe('Make a flange');
    expect(fetched?.providers).toEqual(['deepseek', 'anthropic']);
    expect(fetched?.results).toEqual([
      { provider: 'deepseek', ok: true, text: 'flange code' },
      { provider: 'anthropic', ok: true, text: 'flange code 2' },
    ]);
  });

  it('list returns most-recent first', async () => {
    const a = await saveCompareRun({ promptId: 'x', userInput: 'a', results: [] });
    await new Promise(r => setTimeout(r, 5));
    const b = await saveCompareRun({ promptId: 'x', userInput: 'b', results: [] });
    const list = await listCompareRuns();
    expect(list[0].id).toBe(b);
    expect(list[1].id).toBe(a);
  });

  it('list filters by promptId', async () => {
    await saveCompareRun({ promptId: 'shape-chat', userInput: 'a', results: [] });
    await saveCompareRun({ promptId: 'compose', userInput: 'b', results: [] });
    const filtered = await listCompareRuns({ promptId: 'shape-chat' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].promptId).toBe('shape-chat');
  });

  it('list honors limit', async () => {
    for (let i = 0; i < 5; i++) {
      await saveCompareRun({ promptId: 'x', userInput: `i=${i}`, results: [] });
      await new Promise(r => setTimeout(r, 2));
    }
    expect((await listCompareRuns({ limit: 3 })).length).toBe(3);
  });

  it('userInput is capped to prevent runaway rows', async () => {
    const huge = 'a'.repeat(20_000);
    const id = await saveCompareRun({ promptId: 'x', userInput: huge, results: [] });
    const got = await getCompareRun(id);
    expect(got?.userInput.length).toBeLessThanOrEqual(16_000);
  });

  it('getCompareRun returns null for missing id', async () => {
    expect(await getCompareRun('does-not-exist')).toBeNull();
  });

  it('filters by createdBy', async () => {
    await saveCompareRun({ createdBy: 'u-a', promptId: 'x', userInput: 'a', results: [] });
    await saveCompareRun({ createdBy: 'u-b', promptId: 'x', userInput: 'b', results: [] });
    const list = await listCompareRuns({ createdBy: 'u-a' });
    expect(list).toHaveLength(1);
    expect(list[0].createdBy).toBe('u-a');
  });

  it('filters by date range (sinceMs/untilMs)', async () => {
    const t1 = Date.now();
    await saveCompareRun({ promptId: 'x', userInput: 'one', results: [] });
    await new Promise(r => setTimeout(r, 5));
    await saveCompareRun({ promptId: 'x', userInput: 'two', results: [] });
    await new Promise(r => setTimeout(r, 5));
    const t3 = Date.now();
    await saveCompareRun({ promptId: 'x', userInput: 'three', results: [] });

    const since = await listCompareRuns({ sinceMs: t3 });
    expect(since.length).toBeGreaterThanOrEqual(1);
    expect(since.every(r => r.createdAt >= t3)).toBe(true);

    const until = await listCompareRuns({ untilMs: t1 + 10 });
    expect(until.every(r => r.createdAt <= t1 + 10)).toBe(true);
  });

  it('combines multiple filters', async () => {
    await saveCompareRun({ createdBy: 'u-1', promptId: 'shape-chat', userInput: 'a', results: [] });
    await saveCompareRun({ createdBy: 'u-1', promptId: 'compose', userInput: 'b', results: [] });
    await saveCompareRun({ createdBy: 'u-2', promptId: 'shape-chat', userInput: 'c', results: [] });
    const list = await listCompareRuns({ createdBy: 'u-1', promptId: 'shape-chat' });
    expect(list).toHaveLength(1);
    expect(list[0].userInput).toBe('a');
  });

  it('list summary parses providers from results_json', async () => {
    const id = await saveCompareRun({
      promptId: 'x',
      userInput: 'q',
      results: [
        { provider: 'a', ok: true },
        { provider: 'b', ok: false },
        { /* no provider */ ok: true },
      ],
    });
    const list = await listCompareRuns();
    const found = list.find(r => r.id === id);
    expect(found?.providers).toEqual(['a', 'b']);
  });
});
