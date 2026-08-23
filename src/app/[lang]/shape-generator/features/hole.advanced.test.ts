import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { meshVolume } from '../shapes';
import { holeFeature } from './hole';

const BASE = {
  holeType: 0,
  diameter: 6,
  posX: 0,
  posZ: 0,
  depth: 999,
  endCondition: 1,
  counterboreDia: 14,
  counterboreDepth: 4,
  countersinkDia: 14,
  countersinkAngle: 90,
  middleDiameter: 10,
  middleDepth: 8,
  threadPitch: 1,
  threadDepth: 10,
  taperAngle: 1.7833,
  engine: 0,
};

describe('advanced hole feature runtime', () => {
  it('counterdrill removes the head and middle steps in addition to the bore', () => {
    const body = new THREE.BoxGeometry(40, 20, 40);
    const drilled = holeFeature.apply(body.clone(), BASE, { featureId: 'drilled' });
    const counterdrill = holeFeature.apply(body.clone(), { ...BASE, holeType: 3 }, { featureId: 'counterdrill' });
    expect(meshVolume(counterdrill)).toBeLessThan(meshVolume(drilled));
  });

  it('up-to-next resolves a real material boundary and returns finite geometry', () => {
    const body = new THREE.BoxGeometry(40, 20, 40);
    const result = holeFeature.apply(body, { ...BASE, endCondition: 3 }, { featureId: 'up-to-next' });
    const positions = result.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  });

  it('pipe tap uses a tapered frustum cut instead of a cylindrical downgrade', () => {
    const body = new THREE.BoxGeometry(40, 20, 40);
    const straight = holeFeature.apply(body.clone(), BASE, { featureId: 'straight' });
    const tapered = holeFeature.apply(body.clone(), { ...BASE, holeType: 5 }, { featureId: 'pipe-tap' });
    expect(meshVolume(tapered)).not.toBeCloseTo(meshVolume(straight), 4);
  });

  it('cuts a side-flange hole along X/Z instead of projecting the legacy Y bore', () => {
    const body = new THREE.BoxGeometry(60, 20, 40);
    const xHole = holeFeature.apply(body.clone(), { ...BASE, axis: 0, posY: 0, posZ: 10 }, { featureId: 'x-hole' });
    const zHole = holeFeature.apply(body.clone(), { ...BASE, axis: 2, posX: 10, posY: 0 }, { featureId: 'z-hole' });
    const yHole = holeFeature.apply(body.clone(), { ...BASE, axis: 1, posX: 10, posZ: 0 }, { featureId: 'y-hole' });

    // A through cylinder removes πr² times the axis length. Distinct body
    // dimensions make an accidental Y-axis projection observable.
    const boreArea = 0.5 * 32 * Math.sin((2 * Math.PI) / 32) * 3 * 3;
    const expectedX = boreArea * 60;
    const expectedY = boreArea * 20;
    const expectedZ = boreArea * 40;
    expect(meshVolume(body) - meshVolume(xHole)).toBeCloseTo(expectedX, 0);
    expect(meshVolume(body) - meshVolume(yHole)).toBeCloseTo(expectedY, 0);
    expect(meshVolume(body) - meshVolume(zHole)).toBeCloseTo(expectedZ, 0);
    expect(meshVolume(body) - meshVolume(xHole)).toBeGreaterThan(
      (meshVolume(body) - meshVolume(yHole)) * 2,
    );
  });
});
