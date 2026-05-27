import { describe, it, expect } from 'vitest';
import {
  layoutDetailView,
  fullLabel,
  summarize,
  type DetailViewInput,
} from './detailViewBubble';

const base: DetailViewInput = {
  featureCentre: { x: 100, y: 100 },
  featureRadiusMm: 10,
  scale: 2,
  label: 'A',
  sheet: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
  parentViewBounds: { minX: 50, minY: 50, maxX: 200, maxY: 200 },
};

describe('layoutDetailView', () => {
  it('boundary circle wraps the feature', () => {
    const r = layoutDetailView(base);
    expect(r.boundaryCircle.centre).toEqual({ x: 100, y: 100 });
    expect(r.boundaryCircle.radiusMm).toBe(10);
  });

  it('enlarged radius = featureRadius × scale', () => {
    const r = layoutDetailView(base);
    expect(r.enlargedRadiusMm).toBe(20);
  });

  it('scale ≥ 1 → "SCALE n:1"', () => {
    expect(layoutDetailView(base).scaleLabel).toBe('SCALE 2:1');
  });

  it('scale < 1 → "SCALE 1:n"', () => {
    const r = layoutDetailView({ ...base, scale: 0.5 });
    expect(r.scaleLabel).toBe('SCALE 1:2');
  });

  it('fits in large sheet', () => {
    expect(layoutDetailView(base).fitsInSheet).toBe(true);
  });

  it('huge scale → does not fit → warning', () => {
    const r = layoutDetailView({ ...base, scale: 50 });
    expect(r.fitsInSheet).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('enlarged centre avoids parent view', () => {
    const r = layoutDetailView(base);
    const pv = base.parentViewBounds;
    const insideParent = r.enlargedCentre.x >= pv.minX && r.enlargedCentre.x <= pv.maxX
      && r.enlargedCentre.y >= pv.minY && r.enlargedCentre.y <= pv.maxY;
    expect(insideParent).toBe(false);
  });

  it('zero feature radius → warning', () => {
    const r = layoutDetailView({ ...base, featureRadiusMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('existing details push placement away', () => {
    const withExisting = layoutDetailView({
      ...base,
      existingDetailCentres: [{ x: 400, y: 280 }],
    });
    expect(withExisting.enlargedCentre).toBeDefined();
  });
});

describe('fullLabel', () => {
  it('composes DETAIL + SCALE', () => {
    const r = layoutDetailView(base);
    expect(fullLabel(r)).toBe('DETAIL A  SCALE 2:1');
  });
});

describe('summarize', () => {
  it('reports label + radius + fit', () => {
    const r = layoutDetailView(base);
    const s = summarize(r);
    expect(s.label).toBe('A');
    expect(s.enlargedRadiusMm).toBe(20);
  });
});
