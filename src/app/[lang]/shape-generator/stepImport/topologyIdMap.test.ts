import { describe, it, expect } from 'vitest';
import { faceId, edgeId, buildIdMap, findCollisions } from './topologyIdMap';

describe('faceId · determinism', () => {
  it('same input → same id', () => {
    const input = {
      surfaceType: 'plane',
      surfaceParams: [0, 0, 1, 0],
      loopPoints: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
    };
    expect(faceId(input)).toBe(faceId(input));
  });

  it('different surface type → different id', () => {
    const planeId = faceId({
      surfaceType: 'plane',
      surfaceParams: [0, 0, 1, 0],
      loopPoints: [0, 0, 0],
    });
    const cylinderId = faceId({
      surfaceType: 'cylinder',
      surfaceParams: [0, 0, 1, 0],
      loopPoints: [0, 0, 0],
    });
    expect(planeId).not.toBe(cylinderId);
  });

  it('different loop points → different id', () => {
    const a = faceId({
      surfaceType: 'plane', surfaceParams: [0, 0, 1, 0],
      loopPoints: [0, 0, 0, 10, 0, 0, 10, 10, 0],
    });
    const b = faceId({
      surfaceType: 'plane', surfaceParams: [0, 0, 1, 0],
      loopPoints: [0, 0, 0, 20, 0, 0, 20, 10, 0],
    });
    expect(a).not.toBe(b);
  });

  it('float drift within 6-decimal quantisation does not change id', () => {
    const a = faceId({
      surfaceType: 'plane', surfaceParams: [0, 0, 1.0000001, 0],
      loopPoints: [0, 0, 0],
    });
    const b = faceId({
      surfaceType: 'plane', surfaceParams: [0, 0, 1.0000004, 0],
      loopPoints: [0, 0, 0],
    });
    expect(a).toBe(b);
  });
});

describe('edgeId · direction-insensitive', () => {
  it('reversed endpoints produce the same id', () => {
    const a = edgeId({
      curveType: 'line',
      endpoints: [0, 0, 0, 10, 0, 0],
      curveParams: [],
    });
    const b = edgeId({
      curveType: 'line',
      endpoints: [10, 0, 0, 0, 0, 0], // reversed
      curveParams: [],
    });
    expect(a).toBe(b);
  });

  it('different curve type → different id', () => {
    const lineId = edgeId({
      curveType: 'line', endpoints: [0, 0, 0, 10, 0, 0], curveParams: [],
    });
    const arcId = edgeId({
      curveType: 'arc', endpoints: [0, 0, 0, 10, 0, 0], curveParams: [5],
    });
    expect(lineId).not.toBe(arcId);
  });
});

describe('buildIdMap', () => {
  it('maps STEP refs to persistent ids', () => {
    const r = buildIdMap(
      [
        { stepRef: 100, surfaceType: 'plane', surfaceParams: [0, 0, 1, 0], loopPoints: [0, 0, 0] },
        { stepRef: 101, surfaceType: 'plane', surfaceParams: [0, 0, 1, 0], loopPoints: [0, 0, 5] },
      ],
      [
        { stepRef: 200, curveType: 'line', endpoints: [0, 0, 0, 10, 0, 0], curveParams: [] },
      ],
    );
    expect(r.byStepRef.size).toBe(3);
    expect(r.byStepRef.get(100)).toMatch(/^face_/);
    expect(r.byStepRef.get(200)).toMatch(/^edge_/);
  });

  it('clashes share persistent id (same content)', () => {
    const r = buildIdMap(
      [
        { stepRef: 100, surfaceType: 'plane', surfaceParams: [0, 0, 1, 0], loopPoints: [0, 0, 0] },
        { stepRef: 101, surfaceType: 'plane', surfaceParams: [0, 0, 1, 0], loopPoints: [0, 0, 0] },
      ],
      [],
    );
    const collisions = findCollisions(r.byPersistentId);
    expect(collisions.length).toBe(1);
    expect(collisions[0].refs.sort()).toEqual([100, 101]);
  });

  it('no collisions when every face has distinct content', () => {
    const r = buildIdMap(
      [
        { stepRef: 100, surfaceType: 'plane', surfaceParams: [0, 0, 1, 0], loopPoints: [0, 0, 0] },
        { stepRef: 101, surfaceType: 'plane', surfaceParams: [0, 0, 1, 5], loopPoints: [0, 0, 5] },
      ],
      [],
    );
    expect(findCollisions(r.byPersistentId)).toEqual([]);
  });
});
