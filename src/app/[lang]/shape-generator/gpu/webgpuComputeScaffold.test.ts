import { describe, it, expect } from 'vitest';
import {
  isWebGpuAvailable,
  paddedSize,
  workgroupCount1D,
  workgroupCount3D,
  buildElementwiseShader,
  buildVoxelGridShader,
  dispatchCompute,
  detectGpuCapabilities,
} from './webgpuComputeScaffold';

describe('isWebGpuAvailable', () => {
  it('returns boolean', () => {
    expect(typeof isWebGpuAvailable()).toBe('boolean');
  });
});

describe('paddedSize', () => {
  it('rounds up to alignment', () => {
    expect(paddedSize(5, 4)).toBe(8);
    expect(paddedSize(8, 4)).toBe(8);
    expect(paddedSize(9, 4)).toBe(12);
  });

  it('alignment 16 rounds up correctly', () => {
    expect(paddedSize(17, 16)).toBe(32);
  });
});

describe('workgroupCount1D', () => {
  it('computes ceil(N / size)', () => {
    expect(workgroupCount1D(1000, 64)).toEqual([16, 1, 1]);
  });

  it('exact multiple has no extra', () => {
    expect(workgroupCount1D(64, 64)).toEqual([1, 1, 1]);
  });
});

describe('workgroupCount3D', () => {
  it('ceil per axis', () => {
    expect(workgroupCount3D([16, 16, 16], [8, 8, 8])).toEqual([2, 2, 2]);
    expect(workgroupCount3D([17, 9, 1], [8, 8, 8])).toEqual([3, 2, 1]);
  });
});

describe('buildElementwiseShader', () => {
  it('contains binding and expression', () => {
    const wgsl = buildElementwiseShader({
      inputBinding: 0,
      outputBinding: 1,
      elementType: 'f32',
      workgroupSize: 64,
      expression: 'input[i] * 2.0',
    });
    expect(wgsl).toContain('@binding(0)');
    expect(wgsl).toContain('@binding(1)');
    expect(wgsl).toContain('input[i] * 2.0');
    expect(wgsl).toContain('@workgroup_size(64)');
  });
});

describe('buildVoxelGridShader', () => {
  it('contains uniform binding + workgroup', () => {
    const wgsl = buildVoxelGridShader({
      inputBinding: 1,
      outputBinding: 2,
      uniformBinding: 0,
      workgroupSize: [4, 4, 4],
      expression: 'input[idx]',
    });
    expect(wgsl).toContain('@binding(0)');
    expect(wgsl).toContain('var<uniform>');
    expect(wgsl).toContain('@workgroup_size(4,4,4)');
  });
});

describe('dispatchCompute (no WebGPU)', () => {
  it('throws when WebGPU unavailable in Node', async () => {
    if (isWebGpuAvailable()) return; // skip if running with WebGPU.
    await expect(dispatchCompute({
      source: '@compute @workgroup_size(1) fn main() {}',
      buffers: [],
      workgroups: [1, 1, 1],
    })).rejects.toThrow(/WebGPU not available/);
  });
});

describe('detectGpuCapabilities (no WebGPU)', () => {
  it('returns available=false in Node', async () => {
    if (isWebGpuAvailable()) return;
    const caps = await detectGpuCapabilities();
    expect(caps.available).toBe(false);
  });
});
