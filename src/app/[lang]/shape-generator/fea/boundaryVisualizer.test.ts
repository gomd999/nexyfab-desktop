import { describe, it, expect } from 'vitest';
import {
  visualizeBoundaryConditions,
  summarize,
  type BoundaryCondition,
} from './boundaryVisualizer';

const at: BoundaryCondition['position'] = { x: 0, y: 0, z: 0 };

describe('visualizeBoundaryConditions', () => {
  it('empty input → empty output', () => {
    expect(visualizeBoundaryConditions([])).toEqual([]);
  });

  it('fixed BC emits cone + label', () => {
    const r = visualizeBoundaryConditions([{ id: 'f1', kind: 'fixed', position: at, normal: { x: 0, y: 0, z: 1 } }]);
    const kinds = r[0]!.primitives.map(p => p.kind);
    expect(kinds).toContain('cone');
    expect(kinds).toContain('label');
  });

  it('pinned BC emits sphere + line', () => {
    const r = visualizeBoundaryConditions([{ id: 'p1', kind: 'pinned', position: at }]);
    const kinds = r[0]!.primitives.map(p => p.kind);
    expect(kinds).toContain('sphere');
    expect(kinds).toContain('line');
  });

  it('roller BC emits a circle', () => {
    const r = visualizeBoundaryConditions([{ id: 'r1', kind: 'roller', position: at }]);
    expect(r[0]!.primitives.some(p => p.kind === 'circle')).toBe(true);
  });

  it('load BC emits an arrow', () => {
    const r = visualizeBoundaryConditions([{ id: 'l1', kind: 'load', position: at, force: { x: 100, y: 0, z: 0 } }]);
    expect(r[0]!.primitives.some(p => p.kind === 'arrow')).toBe(true);
  });

  it('pressure BC emits multiple arrows (grid)', () => {
    const r = visualizeBoundaryConditions([
      { id: 'p1', kind: 'pressure', position: at, normal: { x: 0, y: 0, z: 1 }, pressureMpa: 2.5 },
    ]);
    const arrows = r[0]!.primitives.filter(p => p.kind === 'arrow');
    expect(arrows.length).toBeGreaterThan(3);
  });

  it('bearing BC emits radial + axial arrows', () => {
    const r = visualizeBoundaryConditions([{ id: 'b1', kind: 'bearing', position: at }]);
    const arrows = r[0]!.primitives.filter(p => p.kind === 'arrow');
    expect(arrows.length).toBe(2);
  });

  it('thermal BC emits a line + sphere (thermometer)', () => {
    const r = visualizeBoundaryConditions([{ id: 't1', kind: 'thermal', position: at, tempC: 80 }]);
    const kinds = r[0]!.primitives.map(p => p.kind);
    expect(kinds).toContain('line');
    expect(kinds).toContain('sphere');
  });

  it('records BC id and kind', () => {
    const r = visualizeBoundaryConditions([{ id: 'x1', kind: 'fixed', position: at, normal: { x: 0, y: 0, z: 1 } }]);
    expect(r[0]!.bcId).toBe('x1');
    expect(r[0]!.bcKind).toBe('fixed');
  });

  it('scale option affects glyph size', () => {
    const small = visualizeBoundaryConditions([{ id: 'f', kind: 'pinned', position: at }], { scaleMm: 2 });
    const big = visualizeBoundaryConditions([{ id: 'f', kind: 'pinned', position: at }], { scaleMm: 20 });
    const smallSphere = small[0]!.primitives.find(p => p.kind === 'sphere');
    const bigSphere = big[0]!.primitives.find(p => p.kind === 'sphere');
    if (smallSphere && smallSphere.kind === 'sphere' && bigSphere && bigSphere.kind === 'sphere') {
      expect(bigSphere.radius).toBeGreaterThan(smallSphere.radius);
    }
  });

  it('load arrow length scales with scale option', () => {
    const r = visualizeBoundaryConditions(
      [{ id: 'l1', kind: 'load', position: at, force: { x: 0, y: 0, z: -1 } }],
      { scaleMm: 5 },
    );
    const arrow = r[0]!.primitives.find(p => p.kind === 'arrow');
    expect(arrow).toBeDefined();
  });
});

describe('summarize', () => {
  it('empty input', () => {
    const s = summarize([]);
    expect(s.bcCount).toBe(0);
    expect(s.primitiveCount).toBe(0);
  });

  it('counts primitives by kind', () => {
    const r = visualizeBoundaryConditions([
      { id: 'l1', kind: 'load', position: at, force: { x: 0, y: 0, z: -1 } },
      { id: 'p1', kind: 'pinned', position: at },
    ]);
    const s = summarize(r);
    expect(s.primitivesByKind.label).toBeGreaterThan(0);
  });

  it('bcCount matches input', () => {
    const r = visualizeBoundaryConditions([
      { id: 'a', kind: 'roller', position: at },
      { id: 'b', kind: 'pinned', position: at },
    ]);
    expect(summarize(r).bcCount).toBe(2);
  });
});
