import { describe, it, expect } from 'vitest';
import {
  diffParts,
  buildRecommendation,
  summarize,
  type PartSpec,
} from './partReplacementDiff';

function part(overrides: Partial<PartSpec> = {}): PartSpec {
  return {
    id: 'p1',
    envelope: { x: 100, y: 50, z: 25 },
    mountingHoles: [
      { x: 0, y: 0, z: 0, diameterMm: 5 },
      { x: 100, y: 50, z: 0, diameterMm: 5 },
    ],
    material: 'AL-6061',
    finishRaMicron: 1.6,
    massKg: 1.0,
    cog: { x: 50, y: 25, z: 10 },
    ...overrides,
  };
}

describe('diffParts', () => {
  it('identical parts → drop-in', () => {
    const r = diffParts(part(), part());
    expect(r.verdict).toBe('drop-in');
    expect(r.reasons).toEqual([]);
  });

  it('material change → no drop-in', () => {
    const r = diffParts(part(), part({ material: 'SS-304' }));
    expect(r.verdict).not.toBe('drop-in');
    expect(r.materialMatch).toBe(false);
  });

  it('hole count differs → no-go', () => {
    const r = diffParts(part(), part({ mountingHoles: [{ x: 0, y: 0, z: 0, diameterMm: 5 }] }));
    expect(r.verdict).toBe('no-go');
    expect(r.holeCountDelta).not.toBe(0);
  });

  it('hole position drift triggers rework', () => {
    const r = diffParts(part(), part({
      mountingHoles: [
        { x: 1, y: 0, z: 0, diameterMm: 5 },
        { x: 101, y: 50, z: 0, diameterMm: 5 },
      ],
    }));
    expect(r.verdict).toBe('rework');
    expect(r.holePositionErrorMm).toBeGreaterThan(0);
  });

  it('mass delta exceeded → not drop-in', () => {
    const r = diffParts(part(), part({ massKg: 1.5 }));
    expect(r.verdict).not.toBe('drop-in');
  });

  it('cog shift flagged', () => {
    const r = diffParts(part(), part({ cog: { x: 50, y: 25, z: 30 } }));
    expect(r.cogDeltaMm).toBeGreaterThan(0);
    expect(r.verdict).not.toBe('drop-in');
  });

  it('envelope large deviation → no-go', () => {
    const r = diffParts(part(), part({ envelope: { x: 200, y: 100, z: 50 } }));
    expect(r.verdict).toBe('no-go');
  });

  it('finish ratio out of band', () => {
    const r = diffParts(part(), part({ finishRaMicron: 5 }));
    expect(r.finishCompatible).toBe(false);
  });

  it('hole diameter mismatch flagged', () => {
    const r = diffParts(part(), part({
      mountingHoles: [
        { x: 0, y: 0, z: 0, diameterMm: 6 },
        { x: 100, y: 50, z: 0, diameterMm: 5 },
      ],
    }));
    expect(r.holeDiameterErrorMm).toBeGreaterThan(0);
  });
});

describe('buildRecommendation', () => {
  it('drop-in case → no adapter', () => {
    const rec = buildRecommendation(diffParts(part(), part()));
    expect(rec.adapterRequired).toBe(false);
    expect(rec.verdict).toBe('drop-in');
  });

  it('rework with hole mismatch → adapter required', () => {
    const rec = buildRecommendation(diffParts(part(), part({
      mountingHoles: [
        { x: 1, y: 0, z: 0, diameterMm: 5 },
        { x: 101, y: 50, z: 0, diameterMm: 5 },
      ],
    })));
    expect(rec.adapterRequired).toBe(true);
  });

  it('no-go has rationale', () => {
    const rec = buildRecommendation(diffParts(part(), part({ envelope: { x: 200, y: 100, z: 50 } })));
    expect(rec.verdict).toBe('no-go');
    expect(rec.rationale.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports verdict + counts', () => {
    const r = diffParts(part(), part({ material: 'SS-304' }));
    const s = summarize(r);
    expect(s.verdict).toBe(r.verdict);
    expect(s.reasonCount).toBe(r.reasons.length);
  });
});
