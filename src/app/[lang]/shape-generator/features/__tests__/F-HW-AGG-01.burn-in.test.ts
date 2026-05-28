/**
 * F-HW-AGG-01 — GA-gate aggregate burn-in (Phase 2 Week 6 Track C6).
 *
 * Spec ref: `wave-2-phase-2-hole-wizard-spec.md` §9 Week 4 — "F-HW-AGG-01
 * burn-in passes the 3.0s GA gate". This is the single fixture that
 * exercises the full hole-wizard pipeline end-to-end with mixed hole
 * kinds + mixed position-pattern kinds, and asserts the wall-clock for
 * the parse → expand → project → aggregate path fits inside the budget.
 *
 * What this test does NOT exercise:
 *   - The OCCT worker boolean (blocked until Wave 1 task #31). The
 *     burn-in is pure-client and measures the data-layer hot path, not
 *     the worker boolean — that's covered by F-HW-01 per-N burn-in.
 *   - The full HoleWizardModalV2 rendering. Render is fast (< 50 ms
 *     in jsdom per the W3 measurements) and lives in the V2 test
 *     suite; the GA gate cares about the data layer.
 *
 * If this test ever exceeds the 3 s budget, it means one of these
 * pieces regressed and should be profiled with `vitest --profile`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expandHoleArray,
  validateHoleArray,
  type HoleArrayDefinition,
  type HoleSpec,
} from '../holeArray';
import { extractHoleMeta, aggregateHoleMeta } from '../holeMeta';
import {
  ensureHoleFeatureV8,
  HOLE_FEATURE_SCHEMA_VERSION,
} from '../holeFeatureMigration';

// ─── Fixture loader ────────────────────────────────────────────────────────

interface FixtureArray {
  id: string;
  description: string;
  kind: HoleArrayDefinition['kind'];
  params: HoleArrayDefinition['params'];
  holeSpec: HoleArrayDefinition['holeSpec'];
  holeSpecDetail: HoleSpec;
  terminationKind: HoleArrayDefinition['terminationKind'];
  terminationParams: HoleArrayDefinition['terminationParams'];
}

interface Fixture {
  fixtureId: string;
  budgetMs: number;
  arrays: FixtureArray[];
  sketches: Record<string, Array<{ id: string; x: number; y: number }>>;
  expected: {
    totalPositions: number;
    arrayCount: number;
    kindCount: number;
    bomRowCount: number;
  };
}

function loadFixture(): Fixture {
  // tests/fixtures sits at repo root; resolve from process.cwd() which
  // vitest sets to the worktree root (same as the rest of the suite).
  const path = resolve(process.cwd(), 'tests/fixtures/F-HW-AGG-01-burn-in.json');
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as Fixture;
}

function toDef(arr: FixtureArray): HoleArrayDefinition {
  return {
    id: arr.id,
    kind: arr.kind,
    params: arr.params,
    holeSpec: arr.holeSpec,
    holeSpecDetail: arr.holeSpecDetail,
    terminationKind: arr.terminationKind,
    terminationParams: arr.terminationParams,
  };
}

// ─── The burn-in itself ────────────────────────────────────────────────────

describe('F-HW-AGG-01 GA-gate burn-in', () => {
  it('loads + processes the full fixture under 3.0 s wall-clock', () => {
    const fixture = loadFixture();
    const t0 = performance.now();

    // 1. Parse (already done by loadFixture, but we run the explicit
    //    conversion + validation step here so it's part of the timing).
    const defs = fixture.arrays.map(toDef);

    // 2. Validate every array def — catches regressions where a fixture
    //    field shape drifts away from the validator.
    for (const def of defs) {
      const result = validateHoleArray(def);
      expect(result.ok, `${def.id} validation: ${JSON.stringify(result)}`).toBe(true);
    }

    // 3. Expand positions for every array. fromSketch reads from
    //    fixture.sketches; the others are pure math.
    const sketchRegistry = fixture.sketches;
    const positionsByArray = defs.map((def) => ({
      def,
      positions: expandHoleArray(def, {
        resolveSketchPoints: (id) => sketchRegistry[id],
      }),
    }));

    // 4. Project holeMeta for each array with the resolved positions.
    const metas = positionsByArray.map(({ def, positions }) => {
      const spec = def.holeSpecDetail as HoleSpec;
      const blindDepthMm =
        def.terminationParams.kind === 'blind' ? def.terminationParams.depth : undefined;
      return extractHoleMeta(spec, def, { positions, blindDepthMm });
    });

    // 5. Aggregate BOM.
    const agg = aggregateHoleMeta(metas);

    const elapsedMs = performance.now() - t0;

    // ── Functional assertions (must hold regardless of perf).
    expect(metas).toHaveLength(fixture.expected.arrayCount);
    const totalPositions = positionsByArray.reduce((n, p) => n + p.positions.length, 0);
    expect(totalPositions).toBe(fixture.expected.totalPositions);
    expect(agg.rows).toHaveLength(fixture.expected.bomRowCount);
    expect(agg.grandTotal).toBe(fixture.expected.totalPositions);

    // Every BOM row has a non-empty callout.
    for (const row of agg.rows) {
      expect(row.callout.length).toBeGreaterThan(0);
      expect(row.totalCount).toBeGreaterThan(0);
    }

    // All five hole sub-kinds are represented (spec §9.5 acceptance).
    const kinds = new Set(metas.map((m) => m.kind));
    expect(kinds.size).toBe(fixture.expected.kindCount);
    expect(kinds.has('drilled')).toBe(true);
    expect(kinds.has('counterbore')).toBe(true);
    expect(kinds.has('countersink')).toBe(true);
    expect(kinds.has('tap')).toBe(true);
    expect(kinds.has('pipe_tap')).toBe(true);

    // ── Perf gate.
    expect(elapsedMs, `burn-in took ${elapsedMs.toFixed(2)} ms (budget ${fixture.budgetMs} ms)`).toBeLessThan(fixture.budgetMs);

    // Surface the timing in the vitest log for human readers.
    console.log(`[F-HW-AGG-01] elapsed=${elapsedMs.toFixed(2)} ms / budget=${fixture.budgetMs} ms (${(elapsedMs / fixture.budgetMs * 100).toFixed(1)} %)`);
  });

  it('runs the v7 → v8 migration step on every array without exceeding 3 s', () => {
    // Mixed scenario: 5 fresh v8 arrays + 50 synthetic legacy v7 nodes
    // (modeling a worst-case project full of pre-Phase-2 features).
    const fixture = loadFixture();
    const t0 = performance.now();

    // v7 synthetic nodes — 50 of them, mixed kinds.
    const v7Nodes = Array.from({ length: 50 }, (_, i) => ({
      nodeId: `legacy-${i}`,
      raw: {
        holeType: i % 3, // cycle through 0/1/2
        diameter: 3 + (i % 8),
        posX: (i % 10) * 20,
        posZ: Math.floor(i / 10) * 20,
        depth: i % 2 === 0 ? 999 : 12,
        counterboreDia: 8,
        counterboreDepth: 3,
        countersinkAngle: 90,
      },
    }));

    // Migrate every legacy node.
    const migrated = v7Nodes.map((n) => ensureHoleFeatureV8(n.nodeId, n.raw));
    expect(migrated.every((m) => m.holeFeatureSchemaVersion === HOLE_FEATURE_SCHEMA_VERSION)).toBe(true);

    // Combine with the fixture's v8 arrays and project + aggregate.
    const allDefs: HoleArrayDefinition[] = [
      ...fixture.arrays.map(toDef),
      ...migrated.map((m) => m.holeArrayDef),
    ];

    // Pass the sketch registry so the fromSketch fixture array resolves
    // its 4 sketch points (otherwise it reports 0 and skews the total).
    const sketchRegistry = fixture.sketches;
    const metas = allDefs.map((def) => {
      const spec = def.holeSpecDetail as HoleSpec;
      const positions = expandHoleArray(def, {
        resolveSketchPoints: (id) => sketchRegistry[id],
      });
      return extractHoleMeta(spec, def, { positions });
    });
    const agg = aggregateHoleMeta(metas);

    const elapsedMs = performance.now() - t0;

    expect(metas).toHaveLength(5 + 50);
    expect(agg.grandTotal).toBeGreaterThan(0);
    // Fixture: 10 + 12 + 8 + 16 + 4 = 50 positions across 5 arrays.
    // Legacy: 50 single-position manual arrays → 50 positions.
    // Total: 100.
    expect(agg.grandTotal).toBe(100);
    expect(elapsedMs, `combined burn-in took ${elapsedMs.toFixed(2)} ms`).toBeLessThan(fixture.budgetMs);

    console.log(`[F-HW-AGG-01 +migration] elapsed=${elapsedMs.toFixed(2)} ms / budget=${fixture.budgetMs} ms`);
  });
});
