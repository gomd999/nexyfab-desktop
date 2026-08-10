import { beforeAll, describe, expect, it } from 'vitest';
import { projectReplicadShapeExact, type ReplicadProjectionView } from './replicadExactProjection';

// Runtime feasibility test: this loads the real Replicad OCCT WASM, not a mock.
import { ensureReplicad } from '../../../scripts/drawing-to-3d/to-step.mjs';

type Rc = Awaited<ReturnType<typeof ensureReplicad>>;
let rc: Rc;

beforeAll(async () => { rc = await ensureReplicad(); }, 60_000);

const paths = (shape: unknown, view: ReplicadProjectionView) => {
  const projected = projectReplicadShapeExact(rc, shape as never, view);
  return {
    ...projected,
    visiblePaths: projected.visible.toSVGPaths(),
    hiddenPaths: projected.hidden.toSVGPaths(),
    serialized: projected.visible.serialize?.() ?? '',
  };
};

describe('commercial drawing projection precondition', () => {
  it('projects cylinder and preserves an analytic circle in the axial view', () => {
    const result = paths(rc.makeCylinder(10, 30), 'top');
    expect(result.method).toBe('replicad-hlr');
    expect(result.visiblePaths.length).toBeGreaterThan(0);
    expect(result.analyticCurveEvidence).toBe(true);
    expect(result.serialized).toMatch(/"8\s/);
    expect(paths(rc.makeCylinder(10, 30), 'front').analyticCurveEvidence).toBe(false);
  });

  it('projects conical, filleted and hollow B-Reps with visible/hidden separation', () => {
    const cone = rc.draw([0, 0]).lineTo([12, 0]).lineTo([5, 30]).lineTo([0, 30])
      .close().sketchOnPlane('XZ').revolve([0, 0, 1]);
    const fillet = rc.makeBaseBox(30, 20, 10).fillet(2, (finder: { inDirection: (axis: number[]) => unknown }) => finder.inDirection([0, 0, 1]));
    const hollow = rc.makeCylinder(12, 30).cut(rc.makeCylinder(8, 30));
    for (const shape of [cone, fillet, hollow]) {
      const result = paths(shape, 'front');
      expect(result.method).toBe('replicad-hlr');
      expect(result.visiblePaths.length).toBeGreaterThan(0);
      expect(result.hiddenPaths.length).toBeGreaterThan(0);
    }
  });

  it('recovers the exact orthographic circle for a translated single sphere', () => {
    const sphere = rc.makeSphere(10).translate([4, 7, 11]);
    const first = paths(sphere, 'front');
    const second = paths(sphere, 'front');
    expect(first.method).toBe('analytic-sphere-fallback');
    expect(first.analyticCurveEvidence).toBe(true);
    expect(first.hiddenPaths).toEqual([]);
    expect(first.serialized).toMatch(/"8\s/);
    expect(first.serialized).toBe(second.serialized);
  });

  it('never converts an unknown HLR failure into an approximate success', () => {
    const failure = new Error('HLR failed');
    const fakeRc = {
      drawProjection: () => { throw failure; },
      drawCircle: () => { throw new Error('must not be called'); },
      Drawing: class {},
    };
    expect(() => projectReplicadShapeExact(fakeRc as never, { faces: [{ geomType: 'BSPLINE' }] }, 'front')).toThrow(failure);
  });
});
