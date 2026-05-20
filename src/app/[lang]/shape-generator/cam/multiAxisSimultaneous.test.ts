import { describe, it, expect } from 'vitest';
import {
  slerpAxis,
  toolAxisFromSurfaceNormal,
  toolAxisToRotaryAngles,
  poleProximity,
  scanSingularities,
  generate5AxisToolpath,
  resamplePath,
  type SurfacePoint,
  type ToolAxisSample,
} from './multiAxisSimultaneous';

describe('slerpAxis', () => {
  it('t=0 → first axis', () => {
    const r = slerpAxis([1, 0, 0], [0, 1, 0], 0);
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[1]).toBeCloseTo(0, 5);
  });

  it('t=1 → second axis', () => {
    const r = slerpAxis([1, 0, 0], [0, 1, 0], 1);
    expect(r[1]).toBeCloseTo(1, 5);
  });

  it('t=0.5 → 45° between', () => {
    const r = slerpAxis([1, 0, 0], [0, 1, 0], 0.5);
    expect(r[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(r[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('nearly parallel axes → no interp degeneracy', () => {
    const a: [number, number, number] = [1, 0, 0];
    const b: [number, number, number] = [1, 1e-7, 0];
    const r = slerpAxis(a, b, 0.5);
    expect(Number.isFinite(r[0])).toBe(true);
  });
});

describe('toolAxisFromSurfaceNormal', () => {
  it('zero lead/lag → axis = surface normal', () => {
    const axis = toolAxisFromSurfaceNormal([0, 0, 1], [1, 0, 0], { leadAngleRad: 0, tiltAngleRad: 0 });
    expect(axis[2]).toBeCloseTo(1, 5);
  });

  it('non-zero lead tilts axis toward feed direction', () => {
    const axis = toolAxisFromSurfaceNormal([0, 0, 1], [1, 0, 0], { leadAngleRad: Math.PI / 6, tiltAngleRad: 0 });
    // 30° lead → tilted by 30° toward +X.
    expect(axis[0]).toBeGreaterThan(0);
    expect(axis[2]).toBeLessThan(1);
  });

  it('output is unit length', () => {
    const axis = toolAxisFromSurfaceNormal([0, 0, 1], [1, 0, 0], { leadAngleRad: 0.3, tiltAngleRad: 0.2 });
    expect(Math.hypot(axis[0], axis[1], axis[2])).toBeCloseTo(1, 5);
  });
});

describe('toolAxisToRotaryAngles', () => {
  it('vertical axis on BC head: B=0', () => {
    const r = toolAxisToRotaryAngles([0, 0, 1], 'BC');
    expect(r.bAxisDeg).toBeCloseTo(0, 4);
  });

  it('vertical axis on AC head: A=0', () => {
    const r = toolAxisToRotaryAngles([0, 0, 1], 'AC');
    expect(r.aAxisDeg).toBeCloseTo(0, 4);
  });

  it('axis pointing +X on BC: B=90', () => {
    const r = toolAxisToRotaryAngles([1, 0, 0], 'BC');
    expect(r.bAxisDeg).toBeCloseTo(90, 4);
  });

  it('AB head emits a + b', () => {
    const r = toolAxisToRotaryAngles([0, 0, 1], 'AB');
    expect(r.aAxisDeg).toBeDefined();
    expect(r.bAxisDeg).toBeDefined();
  });
});

describe('poleProximity', () => {
  it('axis exactly at pole → 0', () => {
    expect(poleProximity([0, 0, 1], 'BC')).toBe(0);
  });

  it('axis far from pole → ~1', () => {
    expect(poleProximity([1, 0, 0], 'BC')).toBeCloseTo(1, 5);
  });
});

describe('scanSingularities', () => {
  it('flags samples within threshold', () => {
    const toolpath: ToolAxisSample[] = [
      { position: [0, 0, 0], axis: [0, 0, 1] }, // at pole
      { position: [1, 0, 0], axis: [1, 0, 0] }, // far
    ];
    const r = scanSingularities(toolpath, 'BC', 0.1);
    expect(r.map(w => w.sampleIndex)).toContain(0);
    expect(r.map(w => w.sampleIndex)).not.toContain(1);
  });
});

describe('generate5AxisToolpath', () => {
  it('emits one sample per surface point', () => {
    const surface: SurfacePoint[] = [
      { position: [0, 0, 0], normal: [0, 0, 1] },
      { position: [10, 0, 0], normal: [0, 0, 1] },
      { position: [20, 0, 0], normal: [0, 0, 1] },
    ];
    const r = generate5AxisToolpath(surface, { leadAngleRad: 0.1, tiltAngleRad: 0 });
    expect(r).toHaveLength(3);
  });
});

describe('resamplePath', () => {
  it('emits requested sample count', () => {
    const path: ToolAxisSample[] = [
      { position: [0, 0, 0], axis: [0, 0, 1] },
      { position: [10, 0, 0], axis: [1, 0, 0] },
    ];
    const r = resamplePath(path, 20);
    expect(r).toHaveLength(20);
  });

  it('first sample = input start', () => {
    const path: ToolAxisSample[] = [
      { position: [5, 5, 5], axis: [0, 0, 1] },
      { position: [10, 0, 0], axis: [1, 0, 0] },
    ];
    const r = resamplePath(path, 10);
    expect(r[0]!.position).toEqual([5, 5, 5]);
  });

  it('passes through with single sample', () => {
    const path: ToolAxisSample[] = [{ position: [0, 0, 0], axis: [0, 0, 1] }];
    expect(resamplePath(path, 10)).toHaveLength(1);
  });
});
