import { describe, it, expect } from 'vitest';
import {
  build,
  fullLabel,
  summarize,
  type DatumTargetInput,
} from './datumTargetSymbol';

const base: DatumTargetInput = {
  datumLetter: 'A',
  targetNumber: 1,
  type: 'point',
  location: { x: 50, y: 50 },
};

describe('build', () => {
  it('bottom text = letter + number', () => {
    const r = build(base);
    expect(r.calloutBottomText).toBe('A1');
  });

  it('point target → cross marker (4 points)', () => {
    const r = build(base);
    expect(r.targetMarker.type).toBe('point');
    expect(r.targetMarker.geometry).toHaveLength(4);
  });

  it('point target has no top text', () => {
    expect(build(base).calloutTopText).toBe('');
  });

  it('area-circle → Ø top text + circle geometry', () => {
    const r = build({ ...base, type: 'area-circle', areaDiameterMm: 6 });
    expect(r.calloutTopText).toBe('Ø6');
    expect(r.targetMarker.geometry.length).toBeGreaterThan(4);
  });

  it('area-rect → W×H top text', () => {
    const r = build({ ...base, type: 'area-rect', areaWidthMm: 8, areaHeightMm: 4 });
    expect(r.calloutTopText).toBe('8×4');
  });

  it('line target uses both endpoints', () => {
    const r = build({ ...base, type: 'line', secondaryLocation: { x: 60, y: 50 } });
    expect(r.targetMarker.geometry).toHaveLength(2);
  });

  it('line target without secondary → warning', () => {
    const r = build({ ...base, type: 'line' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('area-circle without diameter → warning', () => {
    const r = build({ ...base, type: 'area-circle' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('callout circle offset from target', () => {
    const r = build(base);
    const d = Math.hypot(r.calloutCircle.centre.x - base.location.x, r.calloutCircle.centre.y - base.location.y);
    expect(d).toBeCloseTo(15, 4);
  });

  it('leader connects target to callout circle edge', () => {
    const r = build(base);
    expect(r.leaderStart).toEqual(base.location);
    const distToCentre = Math.hypot(r.leaderEnd.x - r.calloutCircle.centre.x, r.leaderEnd.y - r.calloutCircle.centre.y);
    expect(distToCentre).toBeCloseTo(r.calloutCircle.radiusMm, 4);
  });

  it('empty letter → warning', () => {
    const r = build({ ...base, datumLetter: '' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('fullLabel', () => {
  it('point → just bottom text', () => {
    expect(fullLabel(build(base))).toBe('A1');
  });

  it('area → top / bottom', () => {
    const r = build({ ...base, type: 'area-circle', areaDiameterMm: 6 });
    expect(fullLabel(r)).toBe('Ø6 / A1');
  });
});

describe('summarize', () => {
  it('reports label + type', () => {
    const r = build(base);
    const s = summarize(r);
    expect(s.label).toBe('A1');
    expect(s.type).toBe('point');
  });
});
