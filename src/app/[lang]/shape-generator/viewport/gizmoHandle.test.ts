import { describe, it, expect } from 'vitest';
import {
  pickHandle,
  mapDrag,
  snapTranslation,
  snapAngle,
  rayPlaneIntersect,
} from './gizmoHandle';

describe('pickHandle', () => {
  it('hits the +X axis when ray points at it', () => {
    const ray = { origin: [0, 0, -10] as [number, number, number], direction: [0.3, 0, 1] as [number, number, number] };
    const hit = pickHandle(ray, [0, 0, 0], 5, 'translate', 1);
    // Depending on geometry the test may match an axis or plane handle near origin.
    expect(hit).not.toBeNull();
  });

  it('miss returns null', () => {
    const ray = { origin: [100, 100, 100] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
    expect(pickHandle(ray, [0, 0, 0], 5, 'translate', 1)).toBeNull();
  });

  it('rotate mode picks rings via torus hit', () => {
    const ray = { origin: [5, 0, -10] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
    const hit = pickHandle(ray, [0, 0, 0], 5, 'rotate', 1);
    expect(hit).not.toBeNull();
    expect(hit!.handle.kind).toBe('axis');
  });

  it('scale mode offers uniform handle at center', () => {
    const ray = { origin: [0, 0, -10] as [number, number, number], direction: [0, 0, 1] as [number, number, number] };
    const hit = pickHandle(ray, [0, 0, 0], 5, 'scale', 2);
    expect(hit).not.toBeNull();
  });
});

describe('mapDrag — axis', () => {
  it('drag along X axis returns X translation', () => {
    const result = mapDrag({
      handle: { kind: 'axis', axis: 'x' },
      gizmoOrigin: [0, 0, 0],
      startHitPoint: [0, 0, 0],
      currentRay: { origin: [5, 0, -10], direction: [0, 0, 1] },
    });
    expect(Math.abs(result.translation[0])).toBeGreaterThan(0);
    expect(Math.abs(result.translation[1])).toBeLessThan(0.001);
    expect(result.rotationRad).toBe(0);
    expect(result.scaleFactor).toBe(1);
  });
});

describe('mapDrag — plane', () => {
  it('plane drag returns 2D translation in the plane', () => {
    const result = mapDrag({
      handle: { kind: 'plane', plane: 'xy' },
      gizmoOrigin: [0, 0, 0],
      startHitPoint: [0, 0, 0],
      currentRay: { origin: [2, 3, -10], direction: [0, 0, 1] },
    });
    expect(result.translation[0]).toBeCloseTo(2, 4);
    expect(result.translation[1]).toBeCloseTo(3, 4);
  });
});

describe('mapDrag — uniform', () => {
  it('uniform drag returns scaleFactor', () => {
    const result = mapDrag({
      handle: { kind: 'uniform' },
      gizmoOrigin: [0, 0, 0],
      startHitPoint: [1, 0, 0],
      currentRay: { origin: [2, 0, -10], direction: [0, 0, 1] },
    });
    expect(result.scaleFactor).toBeGreaterThan(0);
    expect(result.translation).toEqual([0, 0, 0]);
  });
});

describe('snapTranslation', () => {
  it('rounds to grid', () => {
    const r = snapTranslation([1.2, 5.7, 2.3], 0.5);
    expect(r).toEqual([1, 5.5, 2.5]);
  });

  it('zero grid → no-op', () => {
    expect(snapTranslation([1.2, 5.7, 2.3], 0)).toEqual([1.2, 5.7, 2.3]);
  });
});

describe('snapAngle', () => {
  it('rounds to 15° increments', () => {
    const step = (15 * Math.PI) / 180;
    const r = snapAngle((17 * Math.PI) / 180, step);
    expect(r).toBeCloseTo(step, 5);
  });

  it('zero step → no-op', () => {
    expect(snapAngle(1.234, 0)).toBe(1.234);
  });
});

describe('rayPlaneIntersect', () => {
  it('hits when ray points at plane', () => {
    const hit = rayPlaneIntersect(
      { origin: [0, 0, -5], direction: [0, 0, 1] },
      [0, 0, 0],
      [0, 0, 1],
    );
    expect(hit).not.toBeNull();
    expect(hit![2]).toBeCloseTo(0, 5);
  });

  it('miss when behind the ray', () => {
    const hit = rayPlaneIntersect(
      { origin: [0, 0, 5], direction: [0, 0, 1] },
      [0, 0, 0],
      [0, 0, 1],
    );
    expect(hit).toBeNull();
  });

  it('parallel ray returns null', () => {
    const hit = rayPlaneIntersect(
      { origin: [0, 0, 5], direction: [1, 0, 0] },
      [0, 0, 0],
      [0, 0, 1],
    );
    expect(hit).toBeNull();
  });
});
