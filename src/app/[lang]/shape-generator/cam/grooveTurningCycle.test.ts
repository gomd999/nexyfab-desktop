import { describe, it, expect } from 'vitest';
import {
  generate,
  removedVolume,
  summarize,
  type GrooveTurningInput,
} from './grooveTurningCycle';

const base: GrooveTurningInput = {
  startDiameterMm: 50,
  grooveDepthMm: 5,
  grooveWidthMm: 3,
  toolWidthMm: 3,
  axialStartZMm: -20,
};

describe('generate', () => {
  it('single-tool-width groove → 1 axial step', () => {
    const r = generate(base);
    expect(r.axialSteps).toBe(1);
    expect(r.passes).toHaveLength(1);
  });

  it('wide groove → multiple axial steps', () => {
    const r = generate({ ...base, grooveWidthMm: 12 });
    expect(r.axialSteps).toBeGreaterThan(1);
  });

  it('radial pecks = ceil(depth / peck)', () => {
    const r = generate({ ...base, peckDepthMm: 1 });
    expect(r.radialPecksPerPlunge).toBe(5);
  });

  it('default peck = tool width', () => {
    const r = generate(base); // depth 5, peck 3 → ceil(5/3)=2
    expect(r.radialPecksPerPlunge).toBe(2);
  });

  it('final diameter = start − 2·depth', () => {
    const r = generate(base);
    expect(r.passes[0]!.finalDiameterMm).toBeCloseTo(40, 6);
  });

  it('emits G75 g-code', () => {
    const r = generate(base);
    expect(r.gCode).toContain('G75');
  });

  it('groove narrower than tool → warning', () => {
    const r = generate({ ...base, grooveWidthMm: 1 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('parting not reaching centre → warning', () => {
    const r = generate({ ...base, parting: true });
    expect(r.warnings.some(w => w.toLowerCase().includes('centre') || w.toLowerCase().includes('parting'))).toBe(true);
  });

  it('zero depth → warning', () => {
    const r = generate({ ...base, grooveDepthMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('removedVolume', () => {
  it('annular groove volume positive', () => {
    expect(removedVolume(base)).toBeGreaterThan(0);
  });

  it('parting through centre → solid cylinder volume', () => {
    const r = removedVolume({ ...base, grooveDepthMm: 30 }); // depth > radius 25
    expect(r).toBeCloseTo(Math.PI * 25 * 25 * base.grooveWidthMm, 4);
  });

  it('deeper groove → more volume', () => {
    const shallow = removedVolume({ ...base, grooveDepthMm: 2 });
    const deep = removedVolume({ ...base, grooveDepthMm: 8 });
    expect(deep).toBeGreaterThan(shallow);
  });
});

describe('summarize', () => {
  it('reports steps + pecks', () => {
    const r = generate(base);
    const s = summarize(r);
    expect(s.axialSteps).toBe(r.axialSteps);
    expect(s.radialPecks).toBe(r.radialPecksPerPlunge);
  });
});
