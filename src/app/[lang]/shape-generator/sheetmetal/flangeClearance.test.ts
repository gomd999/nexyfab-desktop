import { describe, it, expect } from 'vitest';
import {
  checkFlangeClearance,
  checkFlangePairs,
  summarize,
  type BendLine,
  type NearbyFeature,
} from './flangeClearance';

const bend: BendLine = {
  id: 'b1',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  radiusMm: 1,
  angleDeg: 90,
};

function feat(id: string, kind: NearbyFeature['kind'], x: number, y: number, sizeMm?: number): NearbyFeature {
  const f: NearbyFeature = { id, kind, point: { x, y } };
  if (sizeMm !== undefined) f.sizeMm = sizeMm;
  return f;
}

describe('checkFlangeClearance', () => {
  it('no features → no violations', () => {
    expect(checkFlangeClearance([bend], [], { thicknessMm: 1, safetyMultiplier: 1 })).toEqual([]);
  });

  it('hole 2t away → no violation (t=1, required=2)', () => {
    const violations = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 2.1)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(violations).toHaveLength(0);
  });

  it('hole at 1.5 mm violates (required 2 mm) with warn severity', () => {
    const violations = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 1.5)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe('warn');
  });

  it('very close → critical', () => {
    const violations = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 0.1)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(violations[0]!.severity).toBe('critical');
  });

  it('safety multiplier scales required distance', () => {
    const ok = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 2.5)], { thicknessMm: 1, safetyMultiplier: 1 });
    const tight = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 2.5)], { thicknessMm: 1, safetyMultiplier: 2 });
    expect(ok).toHaveLength(0);
    expect(tight).toHaveLength(1);
  });

  it('override min replaces default', () => {
    const violations = checkFlangeClearance(
      [bend],
      [feat('h1', 'hole', 50, 5)],
      { thicknessMm: 1, safetyMultiplier: 1, overrideMin: { hole: 10 } },
    );
    expect(violations).toHaveLength(1);
  });

  it('flange features have larger required distance than hole', () => {
    // both at 1.5 mm, t=1 → hole required=2 (violation), flange required=4 (worse violation).
    const v1 = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 1.5)], { thicknessMm: 1, safetyMultiplier: 1 });
    const v2 = checkFlangeClearance([bend], [feat('f1', 'flange', 50, 1.5)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(v2[0]!.requiredDistanceMm).toBeGreaterThan(v1[0]!.requiredDistanceMm);
  });

  it('recommendation text references move amount', () => {
    const violations = checkFlangeClearance([bend], [feat('h1', 'hole', 50, 0.5)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(violations[0]!.recommendation).toMatch(/\d/);
  });

  it('degenerate bend (zero length) uses point distance', () => {
    const degen: BendLine = { ...bend, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
    const violations = checkFlangeClearance([degen], [feat('h1', 'hole', 1, 0)], { thicknessMm: 1, safetyMultiplier: 1 });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.actualDistanceMm).toBeCloseTo(1, 5);
  });
});

describe('checkFlangePairs', () => {
  it('two parallel bends well separated → ok', () => {
    const b1: BendLine = { ...bend, id: 'b1' };
    const b2: BendLine = { ...bend, id: 'b2', start: { x: 0, y: 100 }, end: { x: 100, y: 100 } };
    const conflicts = checkFlangePairs([b1, b2], 1);
    expect(conflicts[0]!.severity).toBe('ok');
  });

  it('two bends colliding → critical', () => {
    const b1: BendLine = { ...bend, id: 'b1' };
    const b2: BendLine = { ...bend, id: 'b2', start: { x: 0, y: 1 }, end: { x: 100, y: 1 } };
    const conflicts = checkFlangePairs([b1, b2], 1);
    expect(conflicts[0]!.severity).toBe('critical');
  });
});

describe('summarize', () => {
  it('counts by kind', () => {
    const violations = checkFlangeClearance(
      [bend],
      [feat('h1', 'hole', 50, 0.5), feat('s1', 'slot', 60, 0.5)],
      { thicknessMm: 1, safetyMultiplier: 1 },
    );
    const s = summarize(violations);
    expect(s.byFeatureKind.hole).toBe(1);
    expect(s.byFeatureKind.slot).toBe(1);
  });

  it('empty → Infinity worst', () => {
    expect(summarize([]).worstActualMm).toBe(Infinity);
  });

  it('counts severity', () => {
    const violations = checkFlangeClearance(
      [bend],
      [feat('h1', 'hole', 50, 0.1), feat('h2', 'hole', 60, 1.5)],
      { thicknessMm: 1, safetyMultiplier: 1 },
    );
    const s = summarize(violations);
    expect(s.criticalCount).toBe(1);
    expect(s.warnCount).toBe(1);
  });
});
