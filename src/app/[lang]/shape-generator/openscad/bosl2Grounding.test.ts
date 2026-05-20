import { describe, it, expect } from 'vitest';
import { BOSL2_REFERENCE, BOSL2_INCLUDE, buildBosl2GroundingPrompt } from './bosl2Grounding';

describe('BOSL2_REFERENCE', () => {
  it('covers the verified equipment/finished-product primitives', () => {
    const names = BOSL2_REFERENCE.map(e => e.name);
    for (const expected of ['cuboid', 'spur_gear', 'threaded_rod', 'screw', 'rect', 'path_sweep']) {
      expect(names).toContain(expected);
    }
  });

  it('every entry has a signature + summary + category', () => {
    for (const e of BOSL2_REFERENCE) {
      expect(e.signature.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeGreaterThan(0);
      expect(['solid', 'fastener', 'gear', 'profile', 'sweep']).toContain(e.category);
    }
  });
});

describe('buildBosl2GroundingPrompt', () => {
  it('includes the mandatory header and every reference signature', () => {
    const prompt = buildBosl2GroundingPrompt();
    expect(prompt).toContain(BOSL2_INCLUDE);
    for (const e of BOSL2_REFERENCE) {
      expect(prompt).toContain(e.name);
    }
  });

  it('mentions the attachment system for assemblies', () => {
    const prompt = buildBosl2GroundingPrompt();
    expect(prompt).toMatch(/attach|position/);
    expect(prompt).toMatch(/TOP|BOTTOM|anchor/);
  });
});
