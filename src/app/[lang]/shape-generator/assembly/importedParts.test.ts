import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { importedGeometriesToPlaced } from './importedParts';
import { buildShapeResult } from '../shapes';
import { clearImportedRegistry, isImportedShapeId } from '../shapes/importedRegistry';

beforeEach(() => clearImportedRegistry());

describe('imported mesh → PlacedPart bridge', () => {
  it('mints a PlacedPart per geometry with an imported: shapeId and bbox-centre position', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).translate(-50, 0, 0);
    const b = new THREE.BoxGeometry(10, 10, 10).translate(50, 0, 20);
    const placed = importedGeometriesToPlaced([a, b], 'shell');
    expect(placed).toHaveLength(2);
    expect(isImportedShapeId(placed[0]!.shapeId)).toBe(true);
    // position = original bbox centre
    expect(placed[0]!.position[0]).toBeCloseTo(-50, 3);
    expect(placed[1]!.position[0]).toBeCloseTo(50, 3);
    expect(placed[1]!.position[2]).toBeCloseTo(20, 3);
  });

  it('buildShapeResult RESOLVES the imported shapeId back to real geometry', () => {
    const box = new THREE.BoxGeometry(20, 4, 30);
    const [part] = importedGeometriesToPlaced([box], 'plate');
    const res = buildShapeResult(part!.shapeId, {});
    expect(res).not.toBeNull();
    expect(res!.geometry.attributes.position.count).toBeGreaterThan(0);
    // 20×4×30 = 2400 mm³ = 2.4 cm³
    expect(res!.volume_cm3).toBeGreaterThan(2.2);
    expect(res!.volume_cm3).toBeLessThan(2.6);
    expect(res!.bbox.w).toBeCloseTo(20, 1);
    expect(res!.bbox.h).toBeCloseTo(4, 1);
    expect(res!.bbox.d).toBeCloseTo(30, 1);
  });

  it('unknown imported id resolves to null (not a crash)', () => {
    expect(buildShapeResult('imported:999:ghost', {})).toBeNull();
  });

  it('geometry is recentred (local origin at bbox centre after placement)', () => {
    const box = new THREE.BoxGeometry(10, 10, 10).translate(100, 0, 0);
    const [part] = importedGeometriesToPlaced([box], 'p');
    const res = buildShapeResult(part!.shapeId, {})!;
    res.geometry.computeBoundingBox();
    const c = new THREE.Vector3();
    res.geometry.boundingBox!.getCenter(c);
    expect(c.length()).toBeLessThan(0.01); // centred at origin
    expect(part!.position[0]).toBeCloseTo(100, 2); // placement carries the offset
  });
});
