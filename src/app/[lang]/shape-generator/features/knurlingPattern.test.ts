import { describe, it, expect } from 'vitest';
import {
  generateKnurlPattern,
  mapToCylinder,
  mapPatternToCylinder,
  estimateGripGain,
  summarize,
  type KnurlingInput,
} from './knurlingPattern';

function baseInput(style: KnurlingInput['style'] = 'diamond'): KnurlingInput {
  return {
    style,
    uExtent: 100,
    vExtent: 50,
    uPitch: 10,
    vPitch: 5,
    elementSize: 1,
  };
}

describe('generateKnurlPattern', () => {
  it('straight pattern produces vertical-only grooves', () => {
    const p = generateKnurlPattern(baseInput('straight'));
    expect(p.elements.length).toBeGreaterThan(0);
    for (const e of p.elements) {
      expect(e.angleRad).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it('diagonal pattern uses 30° angle by default', () => {
    const p = generateKnurlPattern(baseInput('diagonal'));
    expect(p.elements[0]!.angleRad).toBeCloseTo((30 * Math.PI) / 180, 5);
  });

  it('diamond has 2× the elements of diagonal', () => {
    const diamond = generateKnurlPattern(baseInput('diamond'));
    const diagonal = generateKnurlPattern(baseInput('diagonal'));
    expect(diamond.elements.length).toBe(diagonal.elements.length * 2);
  });

  it('dimple pattern has no grooves (size > 0)', () => {
    const p = generateKnurlPattern(baseInput('dimple'));
    for (const e of p.elements) {
      expect(e.lengthUv).toBeUndefined();
      expect(e.size).toBeGreaterThan(0);
    }
  });

  it('coverage fraction between 0 and 1', () => {
    const p = generateKnurlPattern(baseInput('diamond'));
    expect(p.coverageFraction).toBeGreaterThan(0);
    expect(p.coverageFraction).toBeLessThanOrEqual(1);
  });

  it('density per uv² positive when elements exist', () => {
    const p = generateKnurlPattern(baseInput('diagonal'));
    expect(p.densityPerUv2).toBeGreaterThan(0);
  });

  it('finer pitch → more elements', () => {
    const wide = generateKnurlPattern({ ...baseInput('diamond'), uPitch: 20, vPitch: 10 });
    const fine = generateKnurlPattern({ ...baseInput('diamond'), uPitch: 5, vPitch: 2 });
    expect(fine.elements.length).toBeGreaterThan(wide.elements.length);
  });

  it('angleDeg override respected', () => {
    const p = generateKnurlPattern({ ...baseInput('diagonal'), angleDeg: 45 });
    expect(p.elements[0]!.angleRad).toBeCloseTo((45 * Math.PI) / 180, 5);
  });

  it('dimple staggered: alternating rows have different u offsets', () => {
    const p = generateKnurlPattern(baseInput('dimple'));
    expect(p.elements.length).toBeGreaterThan(2);
  });
});

describe('mapToCylinder', () => {
  it('origin uv maps to (R, 0, 0)', () => {
    const v3 = mapToCylinder({ u: 0, v: 0 }, 10);
    expect(v3.x).toBeCloseTo(10, 5);
    expect(v3.y).toBeCloseTo(0, 5);
    expect(v3.z).toBeCloseTo(0, 5);
  });

  it('u = circumference quarter maps to (0, R, 0)', () => {
    const v3 = mapToCylinder({ u: (Math.PI / 2) * 10, v: 0 }, 10);
    expect(v3.x).toBeCloseTo(0, 5);
    expect(v3.y).toBeCloseTo(10, 5);
  });

  it('v propagates to z', () => {
    const v3 = mapToCylinder({ u: 0, v: 25 }, 10);
    expect(v3.z).toBeCloseTo(25, 5);
  });
});

describe('mapPatternToCylinder', () => {
  it('maps each element to a 3D point', () => {
    const p = generateKnurlPattern(baseInput('dimple'));
    const points = mapPatternToCylinder(p, 15);
    expect(points).toHaveLength(p.elements.length);
  });

  it('all points lie on the cylinder', () => {
    const p = generateKnurlPattern(baseInput('dimple'));
    const points = mapPatternToCylinder(p, 15);
    for (const pt of points) {
      expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(15, 3);
    }
  });
});

describe('estimateGripGain', () => {
  it('grip gain > 1 for any knurl', () => {
    const p = generateKnurlPattern(baseInput('diamond'));
    expect(estimateGripGain(p, 1)).toBeGreaterThan(1);
  });

  it('diamond gives more grip than dimple', () => {
    const dia = estimateGripGain(generateKnurlPattern(baseInput('diamond')), 1);
    const dim = estimateGripGain(generateKnurlPattern(baseInput('dimple')), 1);
    expect(dia).toBeGreaterThan(dim);
  });

  it('deeper depth → more grip', () => {
    const p = generateKnurlPattern(baseInput('diamond'));
    expect(estimateGripGain(p, 2)).toBeGreaterThanOrEqual(estimateGripGain(p, 0.1));
  });
});

describe('summarize', () => {
  it('reports style + element count', () => {
    const p = generateKnurlPattern(baseInput('diamond'));
    const s = summarize(p, 1);
    expect(s.style).toBe('diamond');
    expect(s.elementCount).toBe(p.elements.length);
  });

  it('grip gain reported', () => {
    const p = generateKnurlPattern(baseInput('diagonal'));
    const s = summarize(p, 1);
    expect(s.estGripGain).toBeGreaterThan(1);
  });
});
