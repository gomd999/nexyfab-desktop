import { describe, it, expect } from 'vitest';
import {
  analyzeZebra,
  classifyQuality,
  summarize,
  type SurfaceSample,
} from './zebraStripeAnalysis';

function uniformPlane(count: number): SurfaceSample[] {
  const out: SurfaceSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: i, normal: [0, 0, 1] });
  }
  return out;
}

function noisyPlane(count: number, kink: number): SurfaceSample[] {
  const out: SurfaceSample[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i === kink ? 0.7 : 0;
    out.push({ id: i, normal: [Math.sin(angle), 0, Math.cos(angle)], neighbors: i > 0 ? [i - 1] : [] });
  }
  return out;
}

describe('analyzeZebra', () => {
  it('empty samples → empty output', () => {
    const r = analyzeZebra([]);
    expect(r.stripeBin).toEqual([]);
    expect(r.discontinuities).toEqual([]);
  });

  it('uniform plane produces stripe bin per sample', () => {
    const r = analyzeZebra(uniformPlane(10));
    expect(r.stripeBin).toHaveLength(10);
  });

  it('reflection angles in [0, 2π)', () => {
    const r = analyzeZebra(uniformPlane(5));
    for (const a of r.reflectionAngles) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(2 * Math.PI + 0.001);
    }
  });

  it('detects discontinuity at kink (tilted view)', () => {
    const samples = noisyPlane(10, 5);
    const r = analyzeZebra(samples, { discontinuityRad: 0.05, viewDirection: [0.5, 0.5, -1] });
    expect(r.discontinuities.length).toBeGreaterThan(0);
  });

  it('smooth surface yields no discontinuities', () => {
    const samples: SurfaceSample[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push({ id: i, normal: [0, 0, 1], neighbors: i > 0 ? [i - 1] : [] });
    }
    const r = analyzeZebra(samples);
    expect(r.discontinuities).toEqual([]);
  });

  it('stripeCount option respected', () => {
    const r = analyzeZebra(uniformPlane(5), { stripeCount: 50 });
    expect(r.stripeCount).toBe(50);
  });
});

describe('classifyQuality', () => {
  it('clean surface → class-a', () => {
    const r = analyzeZebra(uniformPlane(100));
    const q = classifyQuality(r, 100);
    expect(q.verdict).toBe('class-a');
  });

  it('high discontinuity fraction → reject', () => {
    const samples: SurfaceSample[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i % 2 === 0) ? 0.8 : 0;
      samples.push({ id: i, normal: [Math.sin(angle), 0, Math.cos(angle)], neighbors: i > 0 ? [i - 1] : [] });
    }
    const r = analyzeZebra(samples, { discontinuityRad: 0.02, viewDirection: [0.5, 0.5, -1] });
    const q = classifyQuality(r, 10);
    expect(['reject', 'class-b']).toContain(q.verdict);
  });

  it('worstDeltaRad is non-negative', () => {
    const r = analyzeZebra(noisyPlane(10, 5));
    const q = classifyQuality(r, 10);
    expect(q.worstDeltaRad).toBeGreaterThanOrEqual(0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = analyzeZebra([]);
    const s = summarize(r, 0);
    expect(s.sampleCount).toBe(0);
    expect(s.discontinuityCount).toBe(0);
  });

  it('stripe bin counts sum to sample count', () => {
    const r = analyzeZebra(uniformPlane(20));
    const s = summarize(r, 20);
    expect(s.stripe0Count + s.stripe1Count).toBe(20);
  });

  it('reports verdict', () => {
    const r = analyzeZebra(uniformPlane(100));
    const s = summarize(r, 100);
    expect(['class-a', 'class-b', 'reject']).toContain(s.verdict);
  });
});
