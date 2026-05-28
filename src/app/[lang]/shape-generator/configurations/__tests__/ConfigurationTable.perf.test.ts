/**
 * ConfigurationTable.perf.test.ts — A3 perf regression test.
 *
 * Master tracker Track A row W3 requirement:
 *   "Perf p95 ≤ 50ms" — config switch latency.
 *
 * This test loads `tests/fixtures/F-CONFIG-PERF-01.json` (a synthetic
 * worst-case: 50 features, 10 configs, 5-deep parent chain) and times
 * 100 invocations of `table.resolveActive(features)`. It asserts:
 *   - p95 latency < 50ms (tracker requirement)
 *   - p99 latency < 100ms (sanity ceiling)
 *
 * The fixture is the heaviest realistic case we expect to ship in
 * Phase 2; if this regresses, the pipeline integration will not meet
 * the W3 latency budget. The threshold is intentionally generous (in
 * practice the pure-JS resolver runs in sub-millisecond on dev hardware)
 * so the test won't be CI-flaky on slow runners.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigurationTable, type ConfigurationTableSnapshot } from '../ConfigurationTable';
import type { FeatureInstance } from '../../features/types';
import type { ConfigEntry } from '../types';

interface PerfFixture {
  fixtureId: string;
  featureCount: number;
  configCount: number;
  features: FeatureInstance[];
  configs: Array<{
    id: string;
    name: string;
    parentId?: string;
    overrides: Record<string, { suppressed?: boolean; params?: Record<string, number | string> }>;
    expressionVars: Record<string, number | string>;
  }>;
  activeConfigId: string;
}

function loadFixture(): PerfFixture {
  // The vitest cwd is the repo root, so the fixture path is relative
  // to it (mirroring how F-HW-01 is loaded by the hole-wizard burn-in).
  const p = path.resolve(process.cwd(), 'tests/fixtures/F-CONFIG-PERF-01.json');
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as PerfFixture;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

describe('ConfigurationTable — perf benchmark (W3 A3, F-CONFIG-PERF-01)', () => {
  it('loads the fixture cleanly', () => {
    const f = loadFixture();
    expect(f.fixtureId).toBe('F-CONFIG-PERF-01');
    expect(f.features.length).toBe(50);
    expect(f.configs.length).toBe(10);
  });

  it('resolveActive p95 < 50ms, p99 < 100ms (100 runs on 50 features × 10 configs)', () => {
    const f = loadFixture();

    // Reconstitute via the public fromJSON / add entry path. The
    // fixture omits the `expressionVars` field on overrides because
    // ConfigOverride doesn't carry one, so this mirrors the runtime
    // shape exactly.
    const snap: ConfigurationTableSnapshot = {
      configs: f.configs.map<ConfigEntry>(c => ({
        id: c.id,
        name: c.name,
        ...(c.parentId !== undefined ? { parentId: c.parentId } : {}),
        overrides: c.overrides,
        expressionVars: c.expressionVars,
      })),
      activeConfigId: f.activeConfigId,
      globalVars: {},
    };
    const table = ConfigurationTable.fromJSON(snap);
    expect(table.getActiveId()).toBe(f.activeConfigId);

    const features = f.features;

    // Warm-up — give the JIT a chance to settle before measuring.
    for (let i = 0; i < 10; i += 1) {
      table.resolveActive(features);
    }

    // Measure.
    const samples: number[] = [];
    const N = 100;
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      const out = table.resolveActive(features);
      const t1 = performance.now();
      samples.push(t1 - t0);
      // Sanity: resolver should drop the 1 suppressed feature in the
      // deep chain (feat-49 is suppressed by cfg-a-child-4).
      expect(out.length).toBeGreaterThan(0);
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    // Emit numbers via stdout so they're visible on the CI reporter
    // (vitest's default reporter surfaces test stdout when the test
    // takes longer than the slow-test threshold; we want it visible
    // every time for perf signal).
    console.log(
      `[F-CONFIG-PERF-01] N=${N} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`,
    );

    // Master tracker Track A row W3: "Perf p95 ≤ 50ms".
    expect(p95).toBeLessThan(50);
    // Sanity ceiling — anything > 100ms in p99 is a clear regression.
    expect(p99).toBeLessThan(100);
  });

  it('resolveActive correctness on the fixture (suppressed feature is dropped)', () => {
    const f = loadFixture();
    const snap: ConfigurationTableSnapshot = {
      configs: f.configs.map<ConfigEntry>(c => ({
        id: c.id,
        name: c.name,
        ...(c.parentId !== undefined ? { parentId: c.parentId } : {}),
        overrides: c.overrides,
        expressionVars: c.expressionVars,
      })),
      activeConfigId: f.activeConfigId,
      globalVars: {},
    };
    const table = ConfigurationTable.fromJSON(snap);
    const out = table.resolveActive(f.features);
    // cfg-a-child-4 suppresses feat-49; cfg-a-child-2 suppresses feat-40.
    // cfg-root-a suppresses feat-25 (inherited down the chain).
    const ids = out.map(x => x.id);
    expect(ids).not.toContain('feat-25');
    expect(ids).not.toContain('feat-40');
    expect(ids).not.toContain('feat-49');
    // The other 47 features survive.
    expect(out.length).toBe(47);
  });
});
