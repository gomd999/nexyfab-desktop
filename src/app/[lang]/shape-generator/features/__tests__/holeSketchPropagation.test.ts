import { describe, it, expect } from 'vitest';
import {
  applySketchUpdateToHoleFeature,
  buildExpansionContext,
  detectHoleToSketchEditAttempt,
  emptyFromSketchState,
  evaluateTapBottomRisk,
  expandWithSketchRegistry,
  findHoleFeaturesReferencingSketch,
  HOLE_TO_SKETCH_POLICY,
  makeSketchPointProvider,
  pointListBoundingBox,
  propagateSketchUpdate,
  type FromSketchState,
  type HoleFeatureRef,
  type SketchPointSnapshot,
} from '../holeSketchPropagation';
import {
  createFromSketchArrayDefaults,
  createLinearArrayDefaults,
  type HoleArrayDefinition,
  type HoleStandardRef,
} from '../holeArray';

/**
 * Pure-logic tests for sketch → hole propagation (Track C4 — Wave 2 Phase 2 W4).
 *
 * Each test exercises one path through `applySketchUpdateToHoleFeature` or one
 * of the propagation helpers. We never mount a React component or touch CRDT —
 * the propagation layer is intentionally framework-free.
 */

const SPEC: HoleStandardRef = { series: 'ISO', designation: 'M5', fitClass: 'normal' };

// ─── applySketchUpdateToHoleFeature ─────────────────────────────────────────

describe('applySketchUpdateToHoleFeature — sketch → hole', () => {
  it('treats first-attach as all-new: every current point becomes "added"', () => {
    const current: SketchPointSnapshot[] = [
      { id: 'p1', x: 10, y: 10 },
      { id: 'p2', x: 20, y: 10 },
    ];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      [],
      current,
      emptyFromSketchState(),
    );
    expect(result.changes.added).toEqual(['p1', 'p2']);
    expect(result.changes.removed).toEqual([]);
    expect(result.changes.moved).toEqual([]);
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].id).toBe('p1');
    expect(result.state.knownPointIds).toEqual(['p1', 'p2']);
  });

  it('detects a moved point (same id, different x/y)', () => {
    const previous: SketchPointSnapshot[] = [{ id: 'p1', x: 5, y: 5 }];
    const current: SketchPointSnapshot[] = [{ id: 'p1', x: 10, y: 12 }];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      { overrides: {}, knownPointIds: ['p1'] },
    );
    expect(result.changes.moved).toEqual(['p1']);
    expect(result.changes.added).toEqual([]);
    expect(result.changes.removed).toEqual([]);
    expect(result.positions[0].x).toBe(10);
    expect(result.positions[0].y).toBe(12);
  });

  it('detects a deleted point and lists it under removed', () => {
    const previous: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
    ];
    const current: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      { overrides: {}, knownPointIds: ['p1', 'p2'] },
    );
    expect(result.changes.removed).toEqual(['p2']);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].id).toBe('p1');
  });

  it('tombstones an override when its sketch point is deleted', () => {
    const previous: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
    ];
    const current: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const prevState: FromSketchState = {
      overrides: { p2: { depthOverride: 15 } },
      knownPointIds: ['p1', 'p2'],
    };
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      prevState,
    );
    expect(result.changes.tombstoned).toEqual(['p2']);
    expect(result.state.overrides.p2?.tombstone).toBe(true);
    expect(result.state.overrides.p2?.depthOverride).toBe(15);
  });

  it('garbage-collects overrides on deletion when the override is empty', () => {
    const previous: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
    ];
    const current: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const prevState: FromSketchState = {
      overrides: { p2: {} }, // empty override → no need to keep tombstone
      knownPointIds: ['p1', 'p2'],
    };
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      prevState,
    );
    expect(result.state.overrides.p2).toBeUndefined();
  });

  it('suppressed overrides drop the position from the output array', () => {
    const previous: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const current: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
    ];
    const prevState: FromSketchState = {
      overrides: { p1: { suppressed: true } },
      knownPointIds: ['p1'],
    };
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      prevState,
    );
    // p1 is suppressed → only p2 visible
    expect(result.positions.map((p) => p.id)).toEqual(['p2']);
    // override survives across the update
    expect(result.state.overrides.p1?.suppressed).toBe(true);
  });

  it('respects pointFilter — points not in filter are excluded from positions', () => {
    const current: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
      { id: 'p3', x: 10, y: 10 },
    ];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1', pointFilter: ['p1', 'p3'] },
      [],
      current,
      emptyFromSketchState(),
    );
    expect(result.positions.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('does NOT mark a filtered-out point as removed when the filter excludes it', () => {
    // p2 still exists in the sketch but is not in the filter — should not be
    // "removed" (only filter-driven exclusion).
    const previous: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const current: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
    ];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1', pointFilter: ['p1'] },
      previous,
      current,
      { overrides: {}, knownPointIds: ['p1', 'p2'] },
    );
    expect(result.changes.removed).toEqual([]);
  });

  it('detects added + moved + removed in one update (mixed)', () => {
    const previous: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 5, y: 5 },
      { id: 'p3', x: 10, y: 10 },
    ];
    const current: SketchPointSnapshot[] = [
      { id: 'p1', x: 0, y: 0 },
      { id: 'p2', x: 7, y: 7 }, // moved
      // p3 deleted
      { id: 'p4', x: 20, y: 20 }, // added
    ];
    const result = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      previous,
      current,
      { overrides: {}, knownPointIds: ['p1', 'p2', 'p3'] },
    );
    expect(result.changes.moved).toEqual(['p2']);
    expect(result.changes.added).toEqual(['p4']);
    expect(result.changes.removed).toEqual(['p3']);
  });

  it('preserves stable position ids across re-applies (== sketch point id)', () => {
    const current: SketchPointSnapshot[] = [
      { id: 'sk-pt-abc', x: 0, y: 0 },
      { id: 'sk-pt-def', x: 5, y: 5 },
    ];
    const a = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      [],
      current,
      emptyFromSketchState(),
    );
    const b = applySketchUpdateToHoleFeature(
      'arr-1',
      { sketchFeatureId: 'sketch-1' },
      current,
      current,
      a.state,
    );
    expect(b.positions.map((p) => p.id)).toEqual(['sk-pt-abc', 'sk-pt-def']);
    // No diffs on a no-op update.
    expect(b.changes.added).toEqual([]);
    expect(b.changes.removed).toEqual([]);
    expect(b.changes.moved).toEqual([]);
  });
});

// ─── findHoleFeaturesReferencingSketch + propagateSketchUpdate ──────────────

describe('findHoleFeaturesReferencingSketch', () => {
  function buildFeature(id: string, def: HoleArrayDefinition): HoleFeatureRef {
    return { featureId: id, holeArray: def };
  }

  it('returns only the features whose params reference the target sketch id', () => {
    const features: HoleFeatureRef[] = [
      buildFeature('hf-1', createFromSketchArrayDefaults('arr-1', 'sketch-A', SPEC)),
      buildFeature('hf-2', createLinearArrayDefaults('arr-2', SPEC)),
      buildFeature('hf-3', createFromSketchArrayDefaults('arr-3', 'sketch-B', SPEC)),
      buildFeature('hf-4', createFromSketchArrayDefaults('arr-4', 'sketch-A', SPEC)),
    ];
    const out = findHoleFeaturesReferencingSketch(features, 'sketch-A');
    expect(out.map((f) => f.featureId)).toEqual(['hf-1', 'hf-4']);
  });

  it('returns empty when no feature references the sketch', () => {
    const features: HoleFeatureRef[] = [
      buildFeature('hf-1', createFromSketchArrayDefaults('arr-1', 'sketch-A', SPEC)),
    ];
    expect(findHoleFeaturesReferencingSketch(features, 'sketch-Z')).toEqual([]);
  });
});

describe('propagateSketchUpdate', () => {
  it('runs the propagation on every dependent feature and returns per-feature results', () => {
    const features: HoleFeatureRef[] = [
      {
        featureId: 'hf-1',
        holeArray: createFromSketchArrayDefaults('arr-1', 'sketch-A', SPEC),
      },
      {
        featureId: 'hf-2',
        holeArray: createFromSketchArrayDefaults('arr-2', 'sketch-A', SPEC),
        fromSketchState: { overrides: { p1: { depthOverride: 5 } }, knownPointIds: ['p1'] },
      },
      {
        featureId: 'hf-3',
        holeArray: createLinearArrayDefaults('arr-3', SPEC), // unrelated
      },
    ];
    const previous: SketchPointSnapshot[] = [{ id: 'p1', x: 0, y: 0 }];
    const current: SketchPointSnapshot[] = [{ id: 'p1', x: 2, y: 3 }];
    const out = propagateSketchUpdate(features, 'sketch-A', previous, current);
    expect(out).toHaveLength(2);
    expect(out[0].result.changes.moved).toEqual(['p1']);
    expect(out[1].result.changes.moved).toEqual(['p1']);
    // hf-2's depthOverride survived.
    expect(out[1].result.state.overrides.p1?.depthOverride).toBe(5);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('makeSketchPointProvider + buildExpansionContext', () => {
  it('returns the registered point list for a known sketch id', () => {
    const registry = {
      'sketch-1': [{ id: 'p1', x: 0, y: 0 }],
    };
    const provider = makeSketchPointProvider(registry);
    expect(provider('sketch-1')).toEqual(registry['sketch-1']);
    expect(provider('sketch-missing')).toBeUndefined();
  });

  it('buildExpansionContext wraps the provider in a BoundingBoxCtx shape', () => {
    const provider = makeSketchPointProvider({ 'sk': [{ id: 'p', x: 1, y: 2 }] });
    const ctx = buildExpansionContext(provider);
    expect(ctx.resolveSketchPoints).toBe(provider);
  });

  it('expandWithSketchRegistry feeds a fromSketch HoleArrayDefinition end-to-end', () => {
    const def = createFromSketchArrayDefaults('arr-1', 'sk', SPEC);
    const registry = {
      sk: [
        { id: 'p1', x: 10, y: 10 },
        { id: 'p2', x: 20, y: 20 },
      ],
    };
    const positions = expandWithSketchRegistry(def, registry);
    expect(positions.map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [20, 20],
    ]);
    expect(positions.every((p) => p.source === 'fromSketch')).toBe(true);
  });
});

describe('pointListBoundingBox', () => {
  it('returns null for an empty list', () => {
    expect(pointListBoundingBox([])).toBeNull();
  });

  it('computes (min, max, width, height) for a multi-point list', () => {
    const bbox = pointListBoundingBox([
      { id: 'a', x: 5, y: 10 },
      { id: 'b', x: 25, y: 30 },
      { id: 'c', x: 15, y: 20 },
    ]);
    expect(bbox).toEqual({
      minX: 5,
      minY: 10,
      maxX: 25,
      maxY: 30,
      width: 20,
      height: 20,
    });
  });

  it('returns a zero-size box for a single point', () => {
    const bbox = pointListBoundingBox([{ id: 'a', x: 7, y: 8 }]);
    expect(bbox).toEqual({
      minX: 7, minY: 8, maxX: 7, maxY: 8, width: 0, height: 0,
    });
  });
});

// ─── Hole → Sketch policy ──────────────────────────────────────────────────

describe('hole → sketch policy (MVP sketch-only)', () => {
  it('HOLE_TO_SKETCH_POLICY direction is the sketch-only MVP', () => {
    expect(HOLE_TO_SKETCH_POLICY.direction).toBe('sketch-to-hole-only');
  });

  it('detectHoleToSketchEditAttempt flags fromSketch → sketch mutation', () => {
    const def = createFromSketchArrayDefaults('arr-1', 'sk', SPEC);
    expect(detectHoleToSketchEditAttempt(def, 'sketch')).toBe(true);
    expect(detectHoleToSketchEditAttempt(def, 'hole-array')).toBe(false);
  });

  it('does NOT flag manual position mode (no sketch dependency)', () => {
    const def = createLinearArrayDefaults('arr-1', SPEC);
    expect(detectHoleToSketchEditAttempt(def, 'sketch')).toBe(false);
  });
});

// ─── TAP_BOTTOM_RISK rule (spec §2.5) ──────────────────────────────────────

describe('evaluateTapBottomRisk — DFM gate', () => {
  it('returns null for non-tap kinds', () => {
    const out = evaluateTapBottomRisk({
      kind: 'drilled',
      terminationKind: 'blind',
      blindDepth: 10,
      tapDepth: 8,
      pitch: 1.0,
    });
    expect(out).toBeNull();
  });

  it('returns null for through-all termination (rule only fires on blind)', () => {
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'through',
      tapDepth: 8,
      pitch: 1.0,
    });
    expect(out).toBeNull();
  });

  it('emits warning when tapDepth is within 2×pitch of drillDepth', () => {
    // Spec F-HW-03: pitch=0.8, drill=12, tap=11 → margin=1, threshold=1.6 → warn.
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'blind',
      blindDepth: 12,
      tapDepth: 11,
      pitch: 0.8,
    });
    expect(out).not.toBeNull();
    expect(out?.severity).toBe('warning');
    expect(out?.margin).toBeCloseTo(1, 6);
    expect(out?.recommendedMargin).toBeCloseTo(1.6, 6);
  });

  it('emits ERROR severity when tap depth exceeds bore depth (impossible cut)', () => {
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'blind',
      blindDepth: 8,
      tapDepth: 10,
      pitch: 1.0,
    });
    expect(out?.severity).toBe('error');
    expect(out?.margin).toBeLessThan(0);
  });

  it('passes cleanly when tapDepth has ≥ 2×pitch buffer', () => {
    // F-HW-03 inverse: pitch=0.8, drill=12, tap=10 → margin=2 ≥ 1.6 → ok.
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'blind',
      blindDepth: 12,
      tapDepth: 10,
      pitch: 0.8,
    });
    expect(out).toBeNull();
  });

  it('returns null for invalid (non-finite) inputs', () => {
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'blind',
      blindDepth: NaN,
      tapDepth: 10,
      pitch: 1.0,
    });
    expect(out).toBeNull();
  });

  it('returns null when required fields are absent', () => {
    const out = evaluateTapBottomRisk({
      kind: 'tap',
      terminationKind: 'blind',
      // no blindDepth, no tapDepth, no pitch
    });
    expect(out).toBeNull();
  });
});
