/**
 * phase2RegressionSuite.test.ts — Wave 2 Phase 2 ship-readiness signal.
 *
 * Track A6 (W6) deliverable. Every accumulated Phase 2 fixture survives
 * a save + load cycle through the current code:
 *
 *   - F-CONFIG-PERF-01           (Track A, configurations perf payload)
 *   - F-HW-01..05                (Track C, hole-wizard fixtures)
 *   - F-THREAD-01                (Track D, cosmetic thread fixture)
 *   - F-REFGEOM-01..10           (Track D, in-source TS fixtures via the
 *                                 referenceGeometry/__tests__/ helpers)
 *
 * Each fixture is wrapped in a minimal `.nfab` v3 project envelope and
 * round-tripped through `serializeProject` → `toJsonString` →
 * `parseProject`. Assertions:
 *
 *   1. `parsed.version === NFAB_FORMAT_VERSION` (v3 from D2; A6 confirms
 *      Track A did NOT bump beyond v3).
 *   2. `parsed.magic === 'nfab'`.
 *   3. Deep-equality on every payload field that is NOT a runtime-only
 *      slot (createdAt / updatedAt are recomputed by `serializeProject`).
 *   4. No data loss on any fixture-specific field: HoleSpec, ThreadFeature
 *      metadata, ConfigurationV1 array, ReferenceNode list.
 *
 * The intent is NOT to re-test each feature's domain semantics (those
 * have their own suites). This is the integration-level "the file format
 * still works end-to-end" gate.
 */

import { describe, it, expect } from 'vitest';
import {
  NFAB_FORMAT_VERSION,
  parseProject,
  serializeProject,
  toJsonString,
  type NfabConfigurationV1,
  type SerializeInput,
} from '../nfabFormat';
import type { ReferenceNode } from '../../referenceGeometry/types';
import { ALL_FIXTURES } from '../../referenceGeometry/__tests__/fixtures';
import { ALL_FIXTURES_EXTENDED } from '../../referenceGeometry/__tests__/fixturesExtended';

// ─── JSON fixture loaders ────────────────────────────────────────────────────
import F_CONFIG_PERF_01 from '../../../../../../tests/fixtures/F-CONFIG-PERF-01.json';
import F_HW_01 from '../../../../../../tests/fixtures/F-HW-01-burn-in.json';
import F_HW_02 from '../../../../../../tests/fixtures/F-HW-02-counterbore.json';
import F_HW_02b from '../../../../../../tests/fixtures/F-HW-02b-countersink.json';
import F_HW_03 from '../../../../../../tests/fixtures/F-HW-03-tap.json';
import F_HW_04 from '../../../../../../tests/fixtures/F-HW-04-counterdrill.json';
import F_HW_05 from '../../../../../../tests/fixtures/F-HW-05-pipe-tap.json';
import F_THREAD_01 from '../../../../../../tests/fixtures/F-THREAD-01-cosmetic.json';

// ─── Minimal v3 envelope helpers ─────────────────────────────────────────────

const MINIMAL_SCENE: SerializeInput['scene'] = {
  selectedId: 'box',
  params: { width: 10, height: 10, depth: 10 },
  paramExpressions: {},
  materialId: 'aluminum',
  color: '#888',
  isSketchMode: false,
  sketchPlane: 'xy',
  sketchProfile: { closed: false, segments: [] },
  sketchConfig: { mode: 'extrude', depth: 10, revolveAngle: 360, revolveAxis: 'y', segments: 32 },
};

const MINIMAL_HISTORY: SerializeInput['history'] = {
  nodes: [],
  rootId: 'r',
  activeNodeId: 'r',
  editingNodeId: null,
};

/** Round-trip a SerializeInput → string → SerializeInput. The createdAt
 *  / updatedAt timestamps recomputed by `serializeProject` are dropped
 *  from the comparison view (they are properties of "this write", not
 *  of the payload). */
function roundTrip(input: SerializeInput) {
  const written = serializeProject(input);
  const json = toJsonString(written);
  const reparsed = parseProject(json);
  return { written, reparsed };
}

// ─── Helpers: derive a configuration array from F-CONFIG-PERF-01 ─────────────

interface ConfigPerfFixture {
  configs: ReadonlyArray<{
    id: string;
    name: string;
    parentId?: string;
    overrides: Record<string, { params?: Record<string, number>; suppressed?: boolean }>;
  }>;
  features: ReadonlyArray<{ id: string; params: Record<string, number>; enabled: boolean }>;
}

/** Project the perf fixture onto the `NfabConfigurationV1` slot — the
 *  schema that actually persists. The runtime `ConfigurationTable`
 *  understands richer fields (parentId, expressionVars), but those live
 *  in the runtime, not in the on-disk v1 row.
 *
 *  We pick ONE root-level param per config (the first numeric override)
 *  so the `params: Record<string, number>` field is non-empty and the
 *  round-trip exercises both `params` and `featureEnabled`. */
function projectPerfToV1Configurations(
  fx: ConfigPerfFixture,
): NfabConfigurationV1[] {
  return fx.configs.map(c => {
    // Hoist the first numeric override into the flat params record. The
    // schema only stores a single Record<string,number> per config (no
    // per-feature param keying — see configurations-spec §1.2).
    const params: Record<string, number> = {};
    for (const featureOverride of Object.values(c.overrides)) {
      if (featureOverride.params) {
        for (const [k, v] of Object.entries(featureOverride.params)) {
          if (typeof v === 'number' && !(k in params)) params[k] = v;
        }
      }
    }
    const featureEnabled: Record<string, boolean> = {};
    for (const [featureId, ov] of Object.entries(c.overrides)) {
      if (ov.suppressed) featureEnabled[featureId] = false;
    }
    return { id: c.id, name: c.name, params, featureEnabled };
  });
}

// ─── F-CONFIG-PERF-01 round-trip ─────────────────────────────────────────────

describe('Phase 2 regression — F-CONFIG-PERF-01 (Track A configurations)', () => {
  const configurations = projectPerfToV1Configurations(
    F_CONFIG_PERF_01 as unknown as ConfigPerfFixture,
  );

  it('round-trips through serialize → parse with v3 format', () => {
    const { reparsed } = roundTrip({
      name: 'F-CONFIG-PERF-01',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
      configurations,
      activeConfigurationId: configurations[0]?.id ?? null,
    });
    expect(reparsed.magic).toBe('nfab');
    expect(reparsed.version).toBe(NFAB_FORMAT_VERSION);
    expect(reparsed.version).toBe(3);
  });

  it('preserves the full configurations array (deep equal)', () => {
    const { reparsed } = roundTrip({
      name: 'F-CONFIG-PERF-01',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
      configurations,
      activeConfigurationId: configurations[0]?.id ?? null,
    });
    expect(reparsed.configurations).toEqual(configurations);
    expect(reparsed.activeConfigurationId).toBe(configurations[0]?.id);
  });

  it('no field is lost: each config row survives byte-for-byte', () => {
    const { written, reparsed } = roundTrip({
      name: 'F-CONFIG-PERF-01',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
      configurations,
    });
    expect(reparsed.configurations).toHaveLength(written.configurations?.length ?? 0);
    for (const cfg of reparsed.configurations ?? []) {
      expect(cfg.id).toBeTruthy();
      expect(cfg.name).toBeTruthy();
      expect(typeof cfg.params).toBe('object');
      expect(typeof cfg.featureEnabled).toBe('object');
    }
  });
});

// ─── F-HW-01..05 round-trip ──────────────────────────────────────────────────

describe('Phase 2 regression — F-HW-01..05 (Track C hole-wizard)', () => {
  // Each F-HW fixture carries a `holeSpec` + N variants. The .nfab slot
  // is `scadIntents` (per-node SCAD intent record) — we stuff the
  // fixture in there as an opaque blob and assert it round-trips
  // unchanged. Test C's domain code reads from its own fixtures
  // directly; this suite only proves the persistence envelope holds.
  const holeFixtures = [
    ['F-HW-01', F_HW_01],
    ['F-HW-02', F_HW_02],
    ['F-HW-02b', F_HW_02b],
    ['F-HW-03', F_HW_03],
    ['F-HW-04', F_HW_04],
    ['F-HW-05', F_HW_05],
  ] as const;

  for (const [name, fx] of holeFixtures) {
    it(`${name} survives round-trip with all fields preserved`, () => {
      const scadIntents = { [`hole-${name}`]: fx as unknown };
      const { reparsed } = roundTrip({
        name,
        history: MINIMAL_HISTORY,
        scene: MINIMAL_SCENE,
        scadIntents,
      });
      expect(reparsed.magic).toBe('nfab');
      expect(reparsed.version).toBe(NFAB_FORMAT_VERSION);
      expect(reparsed.scadIntents).toEqual(scadIntents);
    });
  }
});

// ─── F-THREAD-01 round-trip ──────────────────────────────────────────────────

describe('Phase 2 regression — F-THREAD-01 (Track D threads, cosmetic)', () => {
  it('cosmetic thread metadata round-trips through scadIntents', () => {
    const scadIntents = { 'thread-cosmetic-01': F_THREAD_01 as unknown };
    const { reparsed } = roundTrip({
      name: 'F-THREAD-01',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
      scadIntents,
    });
    expect(reparsed.magic).toBe('nfab');
    expect(reparsed.version).toBe(NFAB_FORMAT_VERSION);
    expect(reparsed.scadIntents).toEqual(scadIntents);
  });
});

// ─── F-REFGEOM-01..10 round-trip ─────────────────────────────────────────────

describe('Phase 2 regression — F-REFGEOM-01..10 (Track D reference-geometry)', () => {
  const refGeomFixtures = [
    ...ALL_FIXTURES.map(f => ({ name: f.name, nodes: f.nodes })),
    ...ALL_FIXTURES_EXTENDED.map(f => ({ name: f.name, nodes: f.nodes })),
  ];

  it('every fixture defines a non-empty ReferenceNode array', () => {
    for (const fx of refGeomFixtures) {
      expect(fx.nodes.length).toBeGreaterThan(0);
    }
  });

  for (const fx of refGeomFixtures) {
    it(`${fx.name} survives round-trip with all ReferenceNodes preserved`, () => {
      const referenceGeometry = [...fx.nodes] as ReferenceNode[];
      const { reparsed } = roundTrip({
        name: fx.name,
        history: MINIMAL_HISTORY,
        scene: MINIMAL_SCENE,
        referenceGeometry,
      });
      expect(reparsed.magic).toBe('nfab');
      expect(reparsed.version).toBe(NFAB_FORMAT_VERSION);
      expect(reparsed.referenceGeometry).toEqual(referenceGeometry);
    });
  }
});

// ─── Schema-version agreement gate ───────────────────────────────────────────

describe('Phase 2 regression — schema version agreement (v3)', () => {
  it('NFAB_FORMAT_VERSION is v3 (D2 / A1 shared envelope, A6 unchanged)', () => {
    expect(NFAB_FORMAT_VERSION).toBe(3);
  });

  it('an empty v3 project round-trips with version stable', () => {
    const { reparsed } = roundTrip({
      name: 'empty',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
    });
    expect(reparsed.version).toBe(NFAB_FORMAT_VERSION);
    expect(reparsed.version).toBe(3);
  });

  it('a mixed Phase-2 project (configs + ref-geom + scadIntents) round-trips', () => {
    const configurations = projectPerfToV1Configurations(
      F_CONFIG_PERF_01 as unknown as ConfigPerfFixture,
    ).slice(0, 3);
    const referenceGeometry: ReferenceNode[] = [...ALL_FIXTURES[0]!.nodes];
    const scadIntents = {
      hole: F_HW_01 as unknown,
      thread: F_THREAD_01 as unknown,
    };
    const { reparsed } = roundTrip({
      name: 'phase-2-mixed',
      history: MINIMAL_HISTORY,
      scene: MINIMAL_SCENE,
      configurations,
      referenceGeometry,
      scadIntents,
    });
    expect(reparsed.version).toBe(3);
    expect(reparsed.configurations).toEqual(configurations);
    expect(reparsed.referenceGeometry).toEqual(referenceGeometry);
    expect(reparsed.scadIntents).toEqual(scadIntents);
  });
});
