/**
 * computeAssemblyWorldBounds — world-space AABB over placed BOM parts (with
 * optional explode). Coverage-gap closure for the assembly subsystem.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeAssemblyWorldBounds } from './assemblyWorldBounds';

 
function part(position: [number, number, number]): any {
  return { name: 'p', result: { geometry: new THREE.BoxGeometry(60, 20, 40) }, position };
}

describe('computeAssemblyWorldBounds', () => {
  it('returns null for empty / nullish input', () => {
    expect(computeAssemblyWorldBounds(null, 0)).toBeNull();
    expect(computeAssemblyWorldBounds([], 0)).toBeNull();
  });
  it('bounds a single centered box to its half-extents', () => {
    const b = computeAssemblyWorldBounds([part([0, 0, 0])], 0)!;
    expect(b).toBeTruthy();
    expect(b.min[0]).toBeCloseTo(-30); expect(b.max[0]).toBeCloseTo(30);
    expect(b.min[1]).toBeCloseTo(-10); expect(b.max[1]).toBeCloseTo(10);
    expect(b.min[2]).toBeCloseTo(-20); expect(b.max[2]).toBeCloseTo(20);
  });
  it('expands to cover a translated part', () => {
    const b = computeAssemblyWorldBounds([part([0, 0, 0]), part([100, 0, 0])], 0)!;
    expect(b.max[0]).toBeGreaterThan(100);
    expect(b.min[0]).toBeCloseTo(-30);
  });
});
