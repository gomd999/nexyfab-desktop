import { describe, it, expect } from 'vitest';
import {
  generateScribePass,
  emitGcode,
  summarize,
  type ScribeFeature,
} from './scribePassGenerator';

function text(id: string, x: number, y: number, txt: string, h: number = 3): ScribeFeature {
  return { id, kind: 'engrave-text', position: { x, y }, text: txt, textHeightMm: h };
}

function line(id: string, x0: number, y0: number, x1: number, y1: number): ScribeFeature {
  return { id, kind: 'layout-line', position: { x: x0, y: y0 }, end: { x: x1, y: y1 } };
}

describe('generateScribePass', () => {
  it('empty input → no steps', () => {
    const r = generateScribePass([]);
    expect(r.steps).toEqual([]);
  });

  it('text feature → steps generated', () => {
    const r = generateScribePass([text('t1', 0, 0, 'AB')]);
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it('text with too-small height warns', () => {
    const r = generateScribePass([text('t1', 0, 0, 'X', 0.5)], { toolDiameterMm: 0.5, depthMm: 0.1, feedMmMin: 600, rapidMmMin: 5000, clearancePlaneMm: 2 });
    expect(r.warnings.some(w => w.includes('blur'))).toBe(true);
  });

  it('layout-line emits 4 steps (rapid+plunge+feed+retract)', () => {
    const r = generateScribePass([line('l1', 0, 0, 10, 0)]);
    expect(r.steps).toHaveLength(4);
  });

  it('datum-cross emits 8 steps (2 arms × 4)', () => {
    const r = generateScribePass([{ id: 'd1', kind: 'datum-cross', position: { x: 0, y: 0 } }]);
    expect(r.steps).toHaveLength(8);
  });

  it('matchmark emits 4 steps', () => {
    const r = generateScribePass([{ id: 'm1', kind: 'matchmark', position: { x: 0, y: 0 } }]);
    expect(r.steps).toHaveLength(4);
  });

  it('time positive for non-empty', () => {
    const r = generateScribePass([line('l1', 0, 0, 10, 0)]);
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });

  it('empty text warns', () => {
    const r = generateScribePass([text('t1', 0, 0, '')]);
    expect(r.warnings.some(w => w.includes('empty'))).toBe(true);
  });

  it('layout-line without end warns', () => {
    const r = generateScribePass([{ id: 'l1', kind: 'layout-line', position: { x: 0, y: 0 } }]);
    expect(r.warnings.some(w => w.includes('end'))).toBe(true);
  });
});

describe('emitGcode', () => {
  it('starts with G0 for first rapid', () => {
    const r = generateScribePass([line('l1', 0, 0, 10, 0)]);
    const lines = emitGcode(r);
    expect(lines[0]).toMatch(/^G0/);
  });

  it('contains G1 for feed move', () => {
    const r = generateScribePass([line('l1', 0, 0, 10, 0)]);
    const lines = emitGcode(r);
    expect(lines.some(l => l.startsWith('G1'))).toBe(true);
  });

  it('feed lines include F value', () => {
    const r = generateScribePass([line('l1', 0, 0, 10, 0)]);
    const lines = emitGcode(r);
    expect(lines.find(l => l.startsWith('G1'))!.includes('F')).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const features = [line('l1', 0, 0, 10, 0), text('t1', 0, 0, 'A')];
    const r = generateScribePass(features);
    const s = summarize(features, r);
    expect(s.featureCount).toBe(2);
    expect(s.stepCount).toBeGreaterThan(0);
  });
});
