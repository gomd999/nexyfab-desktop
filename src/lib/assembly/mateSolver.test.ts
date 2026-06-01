/**
 * mateSolver — Phase 3.2.1 analytical placement tests.
 */
import { describe, it, expect } from 'vitest';
import {
  quatFromTo,
  rotateVec,
  placeAxisOntoAxis,
  placePointOntoPoint,
  placePlaneOntoPlane,
  distanceAxisToAxis,
  distancePointToAxis,
  type Placement,
  type AxisInWorld,
  type PlaneInWorld,
} from './mateSolver';
import { IDENTITY_QUAT } from './assemblyState';
import { vec3, sub, lengthOf, normalize } from '@/lib/sketch/sketchPlane';

// ─── quatFromTo ──────────────────────────────────────────────────────────

describe('quatFromTo', () => {
  it('parallel inputs → identity', () => {
    const q = quatFromTo(vec3(1, 0, 0), vec3(1, 0, 0));
    expect(q).toEqual(IDENTITY_QUAT);
  });

  it('90° rotation X→Y: rotating X gives Y', () => {
    const q = quatFromTo(vec3(1, 0, 0), vec3(0, 1, 0));
    const r = rotateVec(vec3(1, 0, 0), q);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(1, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it('anti-parallel: produces a 180° rotation', () => {
    const q = quatFromTo(vec3(1, 0, 0), vec3(-1, 0, 0));
    const r = rotateVec(vec3(1, 0, 0), q);
    expect(r.x).toBeCloseTo(-1, 6);
  });

  it('arbitrary direction → maps from to to within tolerance', () => {
    const from = normalize(vec3(0.3, 0.4, 0.9));
    const to = normalize(vec3(-0.6, 0.7, 0.2));
    const q = quatFromTo(from, to);
    const r = rotateVec(from, q);
    expect(r.x).toBeCloseTo(to.x, 5);
    expect(r.y).toBeCloseTo(to.y, 5);
    expect(r.z).toBeCloseTo(to.z, 5);
  });
});

// ─── placeAxisOntoAxis ───────────────────────────────────────────────────

describe('placeAxisOntoAxis (concentric mate)', () => {
  it('after placement, free axis is collinear with target axis (distance = 0)', () => {
    // Free part: axis points along local X, origin at (1, 2, 0) in part frame.
    const freeAxis: AxisInWorld = {
      origin: vec3(1, 2, 0),
      direction: vec3(1, 0, 0),
    };
    // Currently at world origin, identity orientation.
    const current: Placement = { position: vec3(0, 0, 0), orientation: IDENTITY_QUAT };
    // Target: world axis along Z passing through (5, 5, 0).
    const target: AxisInWorld = { origin: vec3(5, 5, 0), direction: vec3(0, 0, 1) };

    const newP = placeAxisOntoAxis(freeAxis, current, target);

    // Recompute free axis in world after placement.
    const newDirWorld = rotateVec(freeAxis.direction, newP.orientation);
    const newOriginWorld = {
      x: newP.position.x + rotateVec(freeAxis.origin, newP.orientation).x,
      y: newP.position.y + rotateVec(freeAxis.origin, newP.orientation).y,
      z: newP.position.z + rotateVec(freeAxis.origin, newP.orientation).z,
    };
    const newFreeAxis: AxisInWorld = { origin: newOriginWorld, direction: newDirWorld };

    // Distance between the placed free axis and target axis should be ~0.
    const d = distanceAxisToAxis(newFreeAxis, target);
    expect(d).toBeLessThan(1e-5);
  });

  it('when axes are already aligned, only translation is needed', () => {
    const freeAxis: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(0, 0, 1) };
    const current: Placement = { position: vec3(3, 0, 0), orientation: IDENTITY_QUAT };
    const target: AxisInWorld = { origin: vec3(7, 0, 0), direction: vec3(0, 0, 1) };
    const newP = placeAxisOntoAxis(freeAxis, current, target);
    // Should have moved from x=3 to x=7 (perpendicular shift), z preserved.
    expect(newP.position.x).toBeCloseTo(7, 6);
    expect(newP.position.z).toBeCloseTo(0, 6); // axial position preserved
  });
});

// ─── placePointOntoPoint ─────────────────────────────────────────────────

describe('placePointOntoPoint (coincident point/point)', () => {
  it('moves free part so the named local point lands on target world point', () => {
    const freePointLocal = vec3(2, 3, 4);
    const current: Placement = { position: vec3(0, 0, 0), orientation: IDENTITY_QUAT };
    const targetWorld = vec3(10, 10, 10);
    const newP = placePointOntoPoint(freePointLocal, current, targetWorld);
    // Verify: rotating freePointLocal by new orientation + adding newP.position == targetWorld
    const placed = {
      x: newP.position.x + rotateVec(freePointLocal, newP.orientation).x,
      y: newP.position.y + rotateVec(freePointLocal, newP.orientation).y,
      z: newP.position.z + rotateVec(freePointLocal, newP.orientation).z,
    };
    expect(placed.x).toBeCloseTo(10, 6);
    expect(placed.y).toBeCloseTo(10, 6);
    expect(placed.z).toBeCloseTo(10, 6);
  });

  it('preserves orientation', () => {
    const current: Placement = { position: vec3(5, 5, 5), orientation: IDENTITY_QUAT };
    const newP = placePointOntoPoint(vec3(0, 0, 0), current, vec3(100, 100, 100));
    expect(newP.orientation).toEqual(IDENTITY_QUAT);
  });
});

// ─── placePlaneOntoPlane ─────────────────────────────────────────────────

describe('placePlaneOntoPlane (coincident plane/plane)', () => {
  it('places free plane coincident with target (normals anti-parallel)', () => {
    // Free part has a plane with normal=+Z, origin at part-local (0,0,5).
    const freePlane: PlaneInWorld = { origin: vec3(0, 0, 5), normal: vec3(0, 0, 1) };
    const current: Placement = { position: vec3(0, 0, 0), orientation: IDENTITY_QUAT };
    // Target plane: normal=-Z (mating surface up), at world z=10.
    // We want the free plane's normal to face anti-parallel, so result is rotation.
    const target: PlaneInWorld = { origin: vec3(0, 0, 10), normal: vec3(0, 0, -1) };

    const newP = placePlaneOntoPlane(freePlane, current, target);
    // Free plane's normal in world after placement.
    const newNormalWorld = rotateVec(freePlane.normal, newP.orientation);
    // Should be anti-parallel to target.normal == +Z (anti-parallel to -Z).
    expect(newNormalWorld.z).toBeCloseTo(1, 6);
    // Free plane origin should sit on target plane (z=10).
    const placedOrigin = {
      x: newP.position.x + rotateVec(freePlane.origin, newP.orientation).x,
      y: newP.position.y + rotateVec(freePlane.origin, newP.orientation).y,
      z: newP.position.z + rotateVec(freePlane.origin, newP.orientation).z,
    };
    expect(placedOrigin.z).toBeCloseTo(10, 6);
  });
});

// ─── distance helpers ────────────────────────────────────────────────────

describe('distance helpers', () => {
  it('distancePointToAxis: point on axis → 0', () => {
    const ax: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) };
    expect(distancePointToAxis(vec3(5, 0, 0), ax)).toBeCloseTo(0, 9);
  });

  it('distancePointToAxis: point off axis → perpendicular distance', () => {
    const ax: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) };
    expect(distancePointToAxis(vec3(0, 3, 4), ax)).toBeCloseTo(5, 9);
  });

  it('distanceAxisToAxis: intersecting → 0', () => {
    const a: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) };
    const b: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(0, 1, 0) };
    expect(distanceAxisToAxis(a, b)).toBeCloseTo(0, 9);
  });

  it('distanceAxisToAxis: skew → closest approach', () => {
    const a: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) };
    const b: AxisInWorld = { origin: vec3(0, 0, 10), direction: vec3(0, 1, 0) };
    expect(distanceAxisToAxis(a, b)).toBeCloseTo(10, 9);
  });

  it('distanceAxisToAxis: parallel offset → perpendicular distance', () => {
    const a: AxisInWorld = { origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) };
    const b: AxisInWorld = { origin: vec3(0, 5, 0), direction: vec3(1, 0, 0) };
    expect(distanceAxisToAxis(a, b)).toBeCloseTo(5, 9);
  });
});

// ─── round-trip sanity ────────────────────────────────────────────────────

describe('placeAxisOntoAxis — round-trip verification', () => {
  it('rotating a unit vector by quatFromTo(a, b) yields b', () => {
    const a = normalize(vec3(1, 2, 3));
    const b = normalize(vec3(4, -1, 0));
    const q = quatFromTo(a, b);
    const r = rotateVec(a, q);
    expect(lengthOf(sub(r, b))).toBeLessThan(1e-6);
  });
});
