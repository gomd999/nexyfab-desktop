import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitPrimitive, fittedPartsFromGeometries, cylinderRotationFor } from './fitPrimitive';

describe('fitPrimitive', () => {
  it('fits a box mesh → box with bbox dims', () => {
    const f = fitPrimitive(new THREE.BoxGeometry(40, 20, 60));
    expect(f.shapeId).toBe('box');
    expect(f.params).toMatchObject({ width: 40, height: 20, depth: 60 });
    expect(f.fitError).toBeLessThan(0.05);
  });

  it('fits a Y-axis cylinder → cylinder(diameter,height) axis y', () => {
    // THREE CylinderGeometry axis is Y by default.
    const f = fitPrimitive(new THREE.CylinderGeometry(15, 15, 50, 64));
    expect(f.shapeId).toBe('cylinder');
    expect(f.axis).toBe('y');
    expect(f.params.diameter).toBeGreaterThan(28);
    expect(f.params.diameter).toBeLessThan(32);
    expect(f.params.height).toBeGreaterThan(48);
    expect(f.fitError).toBeLessThan(0.1);
  });

  it('detects a cylinder lying along Z', () => {
    const g = new THREE.CylinderGeometry(10, 10, 80, 64);
    g.rotateX(Math.PI / 2); // Y → Z
    const f = fitPrimitive(g);
    expect(f.shapeId).toBe('cylinder');
    expect(f.axis).toBe('z');
    expect(cylinderRotationFor(f.axis)).toEqual([90, 0, 0]);
  });

  it('fits a sphere → sphere(diameter)', () => {
    const f = fitPrimitive(new THREE.SphereGeometry(20, 48, 32));
    expect(f.shapeId).toBe('sphere');
    expect(f.params.diameter).toBeGreaterThan(38);
    expect(f.params.diameter).toBeLessThan(42);
    expect(f.fitError).toBeLessThan(0.1);
  });

  it('reports bbox centre as the placement', () => {
    const g = new THREE.BoxGeometry(10, 10, 10).translate(25, 0, -15);
    const f = fitPrimitive(g);
    expect(f.center[0]).toBeCloseTo(25, 1);
    expect(f.center[2]).toBeCloseTo(-15, 1);
  });

  it('fittedPartsFromGeometries → editable catalog PlacedParts', () => {
    const parts = fittedPartsFromGeometries([
      new THREE.BoxGeometry(40, 5, 40),
      new THREE.CylinderGeometry(8, 8, 30, 48).translate(0, 20, 0),
    ], 'shell');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.shapeId).toBe('box');
    expect(parts[1]!.shapeId).toBe('cylinder');
    // params are real numbers (so sliders/balance work)
    expect(typeof parts[0]!.params.width).toBe('number');
    expect(parts[1]!.position[1]).toBeCloseTo(20, 0);
  });
});
