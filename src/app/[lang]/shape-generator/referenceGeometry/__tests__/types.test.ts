/**
 * types.test.ts — type guards + `computeDependsOn` extractor.
 *
 * Pure data tests. No math, no solver.
 */

import { describe, it, expect } from 'vitest';
import {
  isAxisNode,
  isCsysNode,
  isPlaneNode,
  isPointNode,
  axisRefNodeId,
  csysRefNodeId,
  planeRefNodeId,
  pointRefNodeId,
  computeDependsOn,
  type ReferenceNode,
  type ReferencePlaneNode,
  type ReferenceAxisNode,
  type ReferencePointNode,
  type ReferenceCsysNode,
} from '../types';

function planeNode(partial: Partial<ReferencePlaneNode>): ReferencePlaneNode {
  return {
    id: 'p1',
    kind: 'plane',
    method: 'standard',
    label: 'Plane',
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
    ...partial,
  };
}

function axisNode(partial: Partial<ReferenceAxisNode>): ReferenceAxisNode {
  return {
    id: 'a1',
    kind: 'axis',
    method: 'standard',
    label: 'Axis',
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'x' },
    ...partial,
  };
}

function pointNode(partial: Partial<ReferencePointNode>): ReferencePointNode {
  return {
    id: 'pt1',
    kind: 'point',
    method: 'byCoordinates',
    label: 'Pt',
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'byCoordinates', position: [0, 0, 0] },
    ...partial,
  };
}

function csysNode(partial: Partial<ReferenceCsysNode>): ReferenceCsysNode {
  return {
    id: 'cs1',
    kind: 'csys',
    method: 'world',
    label: 'CS',
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'world' },
    ...partial,
  };
}

describe('kind type guards', () => {
  it('isPlaneNode narrows to plane', () => {
    const n: ReferenceNode = planeNode({});
    expect(isPlaneNode(n)).toBe(true);
    expect(isAxisNode(n)).toBe(false);
    expect(isPointNode(n)).toBe(false);
    expect(isCsysNode(n)).toBe(false);
  });

  it('isAxisNode narrows to axis', () => {
    const n: ReferenceNode = axisNode({});
    expect(isAxisNode(n)).toBe(true);
    expect(isPlaneNode(n)).toBe(false);
  });

  it('isPointNode narrows to point', () => {
    const n: ReferenceNode = pointNode({});
    expect(isPointNode(n)).toBe(true);
    expect(isPlaneNode(n)).toBe(false);
  });

  it('isCsysNode narrows to csys', () => {
    const n: ReferenceNode = csysNode({});
    expect(isCsysNode(n)).toBe(true);
    expect(isAxisNode(n)).toBe(false);
  });
});

describe('ref-nodeId extractors', () => {
  it('planeRefNodeId returns id only for reference kind', () => {
    expect(planeRefNodeId({ kind: 'reference', nodeId: 'foo' })).toBe('foo');
    expect(planeRefNodeId({ kind: 'standard', id: 'front' })).toBeNull();
    expect(
      planeRefNodeId({ kind: 'face', bodyId: 'b', faceId: 'f' }),
    ).toBeNull();
    expect(
      planeRefNodeId({
        kind: 'inline',
        origin: [0, 0, 0],
        uAxis: [1, 0, 0],
        vAxis: [0, 1, 0],
        normal: [0, 0, 1],
      }),
    ).toBeNull();
  });

  it('axisRefNodeId returns id only for reference kind', () => {
    expect(axisRefNodeId({ kind: 'reference', nodeId: 'bar' })).toBe('bar');
    expect(axisRefNodeId({ kind: 'standard', id: 'x' })).toBeNull();
  });

  it('pointRefNodeId returns id only for reference kind', () => {
    expect(pointRefNodeId({ kind: 'reference', nodeId: 'baz' })).toBe('baz');
    expect(pointRefNodeId({ kind: 'inline', position: [1, 2, 3] })).toBeNull();
  });

  it('csysRefNodeId returns id only for reference kind', () => {
    expect(csysRefNodeId({ kind: 'reference', nodeId: 'cs' })).toBe('cs');
    expect(csysRefNodeId({ kind: 'world' })).toBeNull();
  });
});

describe('computeDependsOn — plane methods', () => {
  it('standard plane: no deps', () => {
    const n = planeNode({});
    expect(computeDependsOn(n)).toEqual([]);
  });

  it('offset plane with reference parent: 1 dep', () => {
    const n = planeNode({
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'reference', nodeId: 'parent1' },
        distanceMm: 10,
        direction: 1,
      },
    });
    expect(computeDependsOn(n)).toEqual(['parent1']);
  });

  it('offset plane with standard parent: 0 deps', () => {
    const n = planeNode({
      method: 'offset',
      params: {
        method: 'offset',
        parent: { kind: 'standard', id: 'front' },
        distanceMm: 10,
        direction: 1,
      },
    });
    expect(computeDependsOn(n)).toEqual([]);
  });

  it('through3Points plane: 3 deps when all reference', () => {
    const n = planeNode({
      method: 'through3Points',
      params: {
        method: 'through3Points',
        points: [
          { kind: 'reference', nodeId: 'a' },
          { kind: 'reference', nodeId: 'b' },
          { kind: 'reference', nodeId: 'c' },
        ],
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['a', 'b', 'c']);
  });

  it('through3Points dedupes identical refs', () => {
    const n = planeNode({
      method: 'through3Points',
      params: {
        method: 'through3Points',
        points: [
          { kind: 'reference', nodeId: 'a' },
          { kind: 'reference', nodeId: 'a' },
          { kind: 'reference', nodeId: 'b' },
        ],
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['a', 'b']);
  });

  it('parallelThroughPoint: 2 deps', () => {
    const n = planeNode({
      method: 'parallelThroughPoint',
      params: {
        method: 'parallelThroughPoint',
        parent: { kind: 'reference', nodeId: 'plane1' },
        point: { kind: 'reference', nodeId: 'pt1' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['plane1', 'pt1']);
  });

  it('midBetween: 2 deps when both reference', () => {
    const n = planeNode({
      method: 'midBetween',
      params: {
        method: 'midBetween',
        a: { kind: 'reference', nodeId: 'a' },
        b: { kind: 'reference', nodeId: 'b' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['a', 'b']);
  });

  it('angle plane: parent + axis deps', () => {
    const n = planeNode({
      method: 'angle',
      params: {
        method: 'angle',
        parent: { kind: 'reference', nodeId: 'plane1' },
        axis: { kind: 'reference', nodeId: 'axis1' },
        angleDeg: 30,
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['axis1', 'plane1']);
  });

  it('throughLineAndPoint: axis + point deps', () => {
    const n = planeNode({
      method: 'throughLineAndPoint',
      params: {
        method: 'throughLineAndPoint',
        line: { kind: 'reference', nodeId: 'axis1' },
        point: { kind: 'reference', nodeId: 'pt1' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['axis1', 'pt1']);
  });

  it('tangentToCylinder: refPlane dep (face is topology-only)', () => {
    const n = planeNode({
      method: 'tangentToCylinder',
      params: {
        method: 'tangentToCylinder',
        face: { kind: 'face', bodyId: 'body1', faceId: 'face1' },
        refPlane: { kind: 'reference', nodeId: 'plane1' },
      },
    });
    expect(computeDependsOn(n)).toEqual(['plane1']);
  });
});

describe('computeDependsOn — axis methods', () => {
  it('standard axis: no deps', () => {
    const n = axisNode({});
    expect(computeDependsOn(n)).toEqual([]);
  });

  it('through2Points: 2 point deps', () => {
    const n = axisNode({
      method: 'through2Points',
      params: {
        method: 'through2Points',
        points: [
          { kind: 'reference', nodeId: 'pt1' },
          { kind: 'reference', nodeId: 'pt2' },
        ],
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['pt1', 'pt2']);
  });

  it('twoPlaneIntersect: 2 plane deps', () => {
    const n = axisNode({
      method: 'twoPlaneIntersect',
      params: {
        method: 'twoPlaneIntersect',
        a: { kind: 'reference', nodeId: 'pa' },
        b: { kind: 'reference', nodeId: 'pb' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['pa', 'pb']);
  });

  it('normalToPlaneAtPoint: 2 deps', () => {
    const n = axisNode({
      method: 'normalToPlaneAtPoint',
      params: {
        method: 'normalToPlaneAtPoint',
        plane: { kind: 'reference', nodeId: 'p' },
        point: { kind: 'reference', nodeId: 'pt' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['p', 'pt']);
  });

  it('alongEdge: edge is topology-only, no deps', () => {
    const n = axisNode({
      method: 'alongEdge',
      params: {
        method: 'alongEdge',
        edge: { kind: 'edge', bodyId: 'b', edgeId: 'e' },
      },
    });
    expect(computeDependsOn(n)).toEqual([]);
  });
});

describe('computeDependsOn — point methods', () => {
  it('vertex: topology-only, 0 deps', () => {
    const n = pointNode({
      method: 'vertex',
      params: {
        method: 'vertex',
        vertex: { kind: 'vertex', bodyId: 'b', vertexId: 'v' },
      },
    });
    expect(computeDependsOn(n)).toEqual([]);
  });

  it('intersectLineAndPlane: axis + plane deps', () => {
    const n = pointNode({
      method: 'intersectLineAndPlane',
      params: {
        method: 'intersectLineAndPlane',
        line: { kind: 'reference', nodeId: 'ax' },
        plane: { kind: 'reference', nodeId: 'pl' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['ax', 'pl']);
  });

  it('intersectThreePlanes: 3 deps', () => {
    const n = pointNode({
      method: 'intersectThreePlanes',
      params: {
        method: 'intersectThreePlanes',
        planes: [
          { kind: 'reference', nodeId: 'a' },
          { kind: 'reference', nodeId: 'b' },
          { kind: 'reference', nodeId: 'c' },
        ],
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['a', 'b', 'c']);
  });

  it('projectPointOntoPlane: point + plane deps', () => {
    const n = pointNode({
      method: 'projectPointOntoPlane',
      params: {
        method: 'projectPointOntoPlane',
        point: { kind: 'reference', nodeId: 'pt' },
        plane: { kind: 'reference', nodeId: 'pl' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['pl', 'pt']);
  });

  it('byCoordinates with csys: 1 dep', () => {
    const n = pointNode({
      method: 'byCoordinates',
      params: {
        method: 'byCoordinates',
        position: [1, 2, 3],
        csys: { kind: 'reference', nodeId: 'cs1' },
      },
    });
    expect(computeDependsOn(n)).toEqual(['cs1']);
  });

  it('byCoordinates without csys: 0 deps', () => {
    const n = pointNode({
      method: 'byCoordinates',
      params: { method: 'byCoordinates', position: [1, 2, 3] },
    });
    expect(computeDependsOn(n)).toEqual([]);
  });
});

describe('computeDependsOn — csys methods', () => {
  it('world: no deps', () => {
    const n = csysNode({});
    expect(computeDependsOn(n)).toEqual([]);
  });

  it('originAndTwoAxes: 3 deps', () => {
    const n = csysNode({
      method: 'originAndTwoAxes',
      params: {
        method: 'originAndTwoAxes',
        origin: { kind: 'reference', nodeId: 'pt' },
        xDir: { kind: 'reference', nodeId: 'ax' },
        yDir: { kind: 'reference', nodeId: 'ay' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['ax', 'ay', 'pt']);
  });

  it('originAndPlane: origin + plane + inPlaneRef deps', () => {
    const n = csysNode({
      method: 'originAndPlane',
      params: {
        method: 'originAndPlane',
        origin: { kind: 'reference', nodeId: 'pt' },
        plane: { kind: 'reference', nodeId: 'pl' },
        inPlaneRef: { kind: 'reference', nodeId: 'ax' },
      },
    });
    expect(computeDependsOn(n).sort()).toEqual(['ax', 'pl', 'pt']);
  });
});
