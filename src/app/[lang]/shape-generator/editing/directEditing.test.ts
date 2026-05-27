import { describe, it, expect } from 'vitest';
import {
  summarizeFace,
  pushPullFace,
  moveFace,
  resizeHole,
  rotateFace,
  pushOperation,
  undo,
  previewPushPull,
  type EditSession,
} from './directEditing';

/** Unit-square face in XY plane, z=0. Two triangles. */
function squareFaceMesh() {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('summarizeFace', () => {
  it('normal is +Z for an XY square (CCW)', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    expect(face.normal[2]).toBeCloseTo(1, 5);
  });

  it('centroid at (0.5, 0.5, 0) for unit square', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    expect(face.centroid[0]).toBeCloseTo(0.5, 5);
    expect(face.centroid[1]).toBeCloseTo(0.5, 5);
    expect(face.centroid[2]).toBeCloseTo(0, 5);
  });
});

describe('pushPullFace', () => {
  it('translates every vertex along normal by deltaMm', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = pushPullFace(mesh, face, 5);
    // All Z coords should be 5.
    for (let i = 2; i < r.positions.length; i += 3) {
      expect(r.positions[i]).toBeCloseTo(5, 5);
    }
  });

  it('negative delta pulls inward', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = pushPullFace(mesh, face, -2);
    expect(r.positions[2]).toBeCloseTo(-2, 5);
  });

  it('does not modify the input mesh', () => {
    const mesh = squareFaceMesh();
    const before = mesh.positions.slice();
    const face = summarizeFace(mesh, [0, 1]);
    pushPullFace(mesh, face, 10);
    expect(mesh.positions).toEqual(before);
  });
});

describe('moveFace', () => {
  it('translates vertices by 3D vector', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = moveFace(mesh, face, [3, 4, 5]);
    // Vertex 0 was (0,0,0) → (3,4,5).
    expect(r.positions[0]).toBe(3);
    expect(r.positions[1]).toBe(4);
    expect(r.positions[2]).toBe(5);
  });
});

describe('resizeHole', () => {
  it('positive radiusDelta moves vertices outward from centroid', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = resizeHole(mesh, face, 1);
    // Vertex 0 was 0.707 from centroid (0.5,0.5,0). Now 1.707.
    const dx = r.positions[0]! - face.centroid[0];
    const dy = r.positions[1]! - face.centroid[1];
    const newDist = Math.hypot(dx, dy);
    const origDist = Math.hypot(0.5, 0.5);
    expect(newDist).toBeCloseTo(origDist + 1, 4);
  });

  it('does not change distance along normal direction', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = resizeHole(mesh, face, 0.5);
    // All Z coords stay at 0.
    for (let i = 2; i < r.positions.length; i += 3) {
      expect(r.positions[i]).toBeCloseTo(0, 5);
    }
  });
});

describe('rotateFace', () => {
  it('rotation by 0 is identity', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = rotateFace(mesh, face, [0, 0, 1], 0);
    for (let i = 0; i < r.positions.length; i++) {
      expect(r.positions[i]).toBeCloseTo(mesh.positions[i]!, 5);
    }
  });

  it('rotation by π about Z swaps opposite corners', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const r = rotateFace(mesh, face, [0, 0, 1], Math.PI);
    // Vertex 0 = (0,0,0) was r=√0.5 from (0.5,0.5). 180° → opposite side = (1,1,0).
    expect(r.positions[0]).toBeCloseTo(1, 5);
    expect(r.positions[1]).toBeCloseTo(1, 5);
  });
});

describe('history (push/undo)', () => {
  it('caps history at 50 ops', () => {
    const session = { history: [] };
    for (let i = 0; i < 60; i++) pushOperation(session, 'move', [i]);
    expect(session.history.length).toBe(50);
  });

  it('undo restores previous positions', () => {
    const session = { history: [] };
    const mesh = squareFaceMesh();
    const before = mesh.positions.slice();
    pushOperation(session, 'push-pull', before);
    const mutated = { positions: mesh.positions.map(x => x + 100), indices: mesh.indices };
    const restored = undo(session, mutated);
    expect(restored!.positions).toEqual(before);
  });

  it('undo returns null when history empty', () => {
    const session = { history: [] };
    const mesh = squareFaceMesh();
    expect(undo(session, mesh)).toBeNull();
  });
});

describe('previewPushPull', () => {
  it('preview mesh applies the delta', () => {
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const live = previewPushPull(mesh, face, 7);
    // Z of every vertex in preview should be 7.
    for (let i = 2; i < live.previewMesh.positions.length; i += 3) {
      expect(live.previewMesh.positions[i]).toBeCloseTo(7, 5);
    }
  });

  it('commit adds entry to undo history', () => {
    const session: EditSession = { history: [] };
    const mesh = squareFaceMesh();
    const face = summarizeFace(mesh, [0, 1]);
    const live = previewPushPull(mesh, face, 3);
    live.commit(session);
    expect(session.history).toHaveLength(1);
    expect(session.history[0]!.kind).toBe('push-pull');
  });
});
