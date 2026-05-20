import { describe, it, expect } from 'vitest';
import {
  packInstances,
  applyCulling,
  compactVisible,
  estimateMemory,
  quaternionToMatrix43,
  eulerToQuaternion,
  axisAngleToQuaternion,
  gridInstances,
  QUATERNION_IDENTITY,
  type InstanceTRS,
  type Quaternion,
} from './instancingPrep';

function identity(): InstanceTRS {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: QUATERNION_IDENTITY,
    scale: { x: 1, y: 1, z: 1 },
  };
}

describe('packInstances', () => {
  it('packs N instances into matrices array', () => {
    const buffers = packInstances([identity(), identity(), identity()]);
    expect(buffers.matrices.length).toBe(36);
    expect(buffers.instanceCount).toBe(3);
  });

  it('identity transform produces identity rotation rows', () => {
    const buffers = packInstances([identity()]);
    expect(buffers.matrices[0]).toBeCloseTo(1, 5);
    expect(buffers.matrices[5]).toBeCloseTo(1, 5);
    expect(buffers.matrices[10]).toBeCloseTo(1, 5);
  });

  it('translation goes into last column', () => {
    const inst: InstanceTRS = {
      ...identity(),
      position: { x: 5, y: 10, z: 15 },
    };
    const buffers = packInstances([inst]);
    expect(buffers.matrices[3]).toBe(5);
    expect(buffers.matrices[7]).toBe(10);
    expect(buffers.matrices[11]).toBe(15);
  });

  it('color defaults to white', () => {
    const buffers = packInstances([identity()]);
    expect(buffers.colors[0]).toBe(1);
    expect(buffers.colors[1]).toBe(1);
  });

  it('initial visibility = 1', () => {
    const buffers = packInstances([identity(), identity()]);
    expect(buffers.visibleCount).toBe(2);
  });
});

describe('quaternionToMatrix43', () => {
  it('identity quat → identity rotation + position', () => {
    const m = quaternionToMatrix43(QUATERNION_IDENTITY, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(m[0]).toBeCloseTo(1, 5);
    expect(m[5]).toBeCloseTo(1, 5);
    expect(m[10]).toBeCloseTo(1, 5);
  });

  it('scale stretches matrix', () => {
    const m = quaternionToMatrix43(QUATERNION_IDENTITY, { x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 });
    expect(m[0]).toBe(2);
    expect(m[5]).toBe(3);
    expect(m[10]).toBe(4);
  });
});

describe('eulerToQuaternion', () => {
  it('zero rotation → identity', () => {
    const q = eulerToQuaternion(0, 0, 0);
    expect(q.w).toBeCloseTo(1, 5);
  });

  it('90° about X → unit quaternion', () => {
    const q = eulerToQuaternion(Math.PI / 2, 0, 0);
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('axisAngleToQuaternion', () => {
  it('produces unit quaternion', () => {
    const q = axisAngleToQuaternion({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(len).toBeCloseTo(1, 5);
  });

  it('zero angle → identity', () => {
    const q = axisAngleToQuaternion({ x: 1, y: 0, z: 0 }, 0);
    expect(q.w).toBeCloseTo(1, 5);
  });
});

describe('applyCulling', () => {
  it('distance threshold drops far instances', () => {
    const buffers = packInstances([
      { ...identity(), position: { x: 0, y: 0, z: 0 } },
      { ...identity(), position: { x: 1000, y: 0, z: 0 } },
    ]);
    applyCulling(buffers, { cameraPosition: { x: 0, y: 0, z: 0 }, maxDistanceMm: 100 });
    expect(buffers.visibility[0]).toBe(1);
    expect(buffers.visibility[1]).toBe(0);
    expect(buffers.visibleCount).toBe(1);
  });

  it('frustum plane culls outside instances', () => {
    const buffers = packInstances([
      { ...identity(), position: { x: 10, y: 0, z: 0 } },
      { ...identity(), position: { x: -10, y: 0, z: 0 } },
    ]);
    applyCulling(buffers, {
      cameraPosition: { x: 0, y: 0, z: 0 },
      maxDistanceMm: 1000,
      frustum: [{ normal: { x: 1, y: 0, z: 0 }, offset: 0 }],
    });
    expect(buffers.visibility[0]).toBe(1);
    expect(buffers.visibility[1]).toBe(0);
  });
});

describe('compactVisible', () => {
  it('returns only visible instances contiguously', () => {
    const buffers = packInstances([identity(), identity(), identity()]);
    buffers.visibility[1] = 0;
    buffers.visibleCount = 2;
    const compact = compactVisible(buffers);
    expect(compact.instanceCount).toBe(2);
    expect(compact.visibleCount).toBe(2);
  });
});

describe('estimateMemory', () => {
  it('10k instances → reasonable byte budget', () => {
    const est = estimateMemory(10_000);
    expect(est.totalBytes).toBeGreaterThan(0);
    expect(est.totalMB).toBeLessThan(10);
  });

  it('matrix bytes scale linearly', () => {
    const a = estimateMemory(1000);
    const b = estimateMemory(2000);
    expect(b.matrixBytes).toBe(a.matrixBytes * 2);
  });
});

describe('gridInstances', () => {
  it('produces rows × cols instances', () => {
    expect(gridInstances(3, 4, 10).length).toBe(12);
  });

  it('spacing controls separation', () => {
    const instances = gridInstances(2, 2, 5);
    expect(instances[1]!.position.x).toBe(5);
  });
});
