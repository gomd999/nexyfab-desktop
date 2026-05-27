import { describe, it, expect } from 'vitest';
import {
  dxfToSketch,
  summarizeConversion,
  type DxfEntity,
} from './dxfToSketch';

describe('dxfToSketch — single entities', () => {
  it('LINE → 1 line entity', () => {
    const entities: DxfEntity[] = [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ];
    const r = dxfToSketch(entities);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.kind).toBe('line');
  });

  it('CIRCLE → 1 circle entity', () => {
    const r = dxfToSketch([{ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 }]);
    expect(r.entities[0]!.kind).toBe('circle');
  });

  it('ARC produces shared start/end points', () => {
    const r = dxfToSketch([{ kind: 'ARC', center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI / 2 }]);
    expect(r.entities[0]!.kind).toBe('arc');
    expect(r.entities[0]!.pointRefs).toHaveLength(2);
  });

  it('LWPOLYLINE produces N-1 line segments', () => {
    const r = dxfToSketch([{
      kind: 'LWPOLYLINE',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    }]);
    expect(r.entities.filter(e => e.kind === 'line')).toHaveLength(2);
  });

  it('closed LWPOLYLINE adds a closing segment', () => {
    const r = dxfToSketch([{
      kind: 'LWPOLYLINE',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      closed: true,
    }]);
    expect(r.entities.filter(e => e.kind === 'line')).toHaveLength(3);
  });
});

describe('point welding', () => {
  it('coincident endpoints share a point id', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
    ]);
    // Two lines meet at (10, 0) → that point appears once.
    expect(r.points.size).toBe(3);
  });

  it('near-coincident endpoints weld within tolerance', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 10.01, y: 0 }, end: { x: 10, y: 5 } },
    ], { weldToleranceMm: 0.05 });
    expect(r.points.size).toBe(3);
  });

  it('far endpoints stay separate', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 11, y: 0 }, end: { x: 11, y: 5 } },
    ], { weldToleranceMm: 0.05 });
    expect(r.points.size).toBe(4);
  });
});

describe('coincidence constraints', () => {
  it('two lines sharing an endpoint → coincident constraint', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
    ]);
    expect(r.constraints.some(c => c.kind === 'coincident')).toBe(true);
  });
});

describe('horizontal / vertical inference', () => {
  it('flat line → horizontal', () => {
    const r = dxfToSketch([{ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    expect(r.constraints.some(c => c.kind === 'horizontal')).toBe(true);
  });

  it('vertical line → vertical', () => {
    const r = dxfToSketch([{ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } }]);
    expect(r.constraints.some(c => c.kind === 'vertical')).toBe(true);
  });

  it('diagonal line → neither H nor V', () => {
    const r = dxfToSketch([{ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }]);
    expect(r.constraints.some(c => c.kind === 'horizontal' || c.kind === 'vertical')).toBe(false);
  });
});

describe('parallel / perpendicular inference', () => {
  it('two horizontal lines → parallel', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    ]);
    expect(r.constraints.some(c => c.kind === 'parallel')).toBe(true);
  });

  it('H + V lines → perpendicular', () => {
    const r = dxfToSketch([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
    ]);
    expect(r.constraints.some(c => c.kind === 'perpendicular')).toBe(true);
  });
});

describe('equal-radius inference', () => {
  it('two same-radius circles → equal-radius', () => {
    const r = dxfToSketch([
      { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 },
      { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 5 },
    ]);
    expect(r.constraints.some(c => c.kind === 'equal-radius')).toBe(true);
  });

  it('different radii → no equal-radius', () => {
    const r = dxfToSketch([
      { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 },
      { kind: 'CIRCLE', center: { x: 20, y: 0 }, radius: 8 },
    ]);
    expect(r.constraints.some(c => c.kind === 'equal-radius')).toBe(false);
  });
});

describe('summarizeConversion', () => {
  it('counts entities + constraints', () => {
    const input: DxfEntity[] = [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { kind: 'LINE', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
    ];
    const output = dxfToSketch(input);
    const s = summarizeConversion(input, output);
    expect(s.inputEntityCount).toBe(2);
    expect(s.outputEntityCount).toBe(2);
    expect(s.constraintsByKind.coincident).toBeGreaterThan(0);
  });
});
