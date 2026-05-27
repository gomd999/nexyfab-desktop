import { describe, it, expect } from 'vitest';
import {
  exportBrep,
  importBrep,
  exportBrepJson,
  importBrepJson,
  roundTrip,
  diff,
  BREP_IO_VERSION,
} from './brepIo';
import {
  BrepModel,
  createVertex,
  createEdgePair,
  createFace,
} from './halfEdgeBrep';

function buildTriangleModel() {
  const m = new BrepModel();
  const shell = m.newShell();
  const v0 = createVertex(m, shell, [0, 0, 0]);
  const v1 = createVertex(m, shell, [1, 0, 0]);
  const v2 = createVertex(m, shell, [0, 1, 0]);
  const e01 = createEdgePair(m, shell, v0, v1);
  const e12 = createEdgePair(m, shell, v1, v2);
  const e20 = createEdgePair(m, shell, v2, v0);
  e01.next = e12; e12.prev = e01;
  e12.next = e20; e20.prev = e12;
  e20.next = e01; e01.prev = e20;
  const face = createFace(m, shell, e01);
  face.normal = [0, 0, 1];
  face.surfaceKind = 'planar';
  return m;
}

describe('exportBrep', () => {
  it('emits schema version', () => {
    const s = exportBrep(buildTriangleModel());
    expect(s.version).toBe(BREP_IO_VERSION);
  });

  it('emits one shell with 3 vertices + 6 half-edges + 1 face', () => {
    const s = exportBrep(buildTriangleModel());
    expect(s.shells).toHaveLength(1);
    expect(s.shells[0]!.vertices).toHaveLength(3);
    expect(s.shells[0]!.halfEdges).toHaveLength(6);
    expect(s.shells[0]!.faces).toHaveLength(1);
  });

  it('preserves surface kind + normal', () => {
    const s = exportBrep(buildTriangleModel());
    const face = s.shells[0]!.faces[0]!;
    expect(face.surfaceKind).toBe('planar');
    expect(face.normal).toEqual([0, 0, 1]);
  });

  it('preserves vertex positions', () => {
    const s = exportBrep(buildTriangleModel());
    const verts = s.shells[0]!.vertices;
    const xs = verts.map(v => v.x).sort();
    expect(xs).toEqual([0, 0, 1]);
  });
});

describe('importBrep', () => {
  it('reports success on round-trip', () => {
    const { report } = roundTrip(buildTriangleModel());
    expect(report.success).toBe(true);
    expect(report.shellCount).toBe(1);
    expect(report.vertexCount).toBe(3);
    expect(report.edgeCount).toBe(3);
    expect(report.faceCount).toBe(1);
  });

  it('rejects unknown schema version', () => {
    const schema = exportBrep(buildTriangleModel());
    schema.version = 999;
    const { report } = importBrep(schema);
    expect(report.success).toBe(false);
    expect(report.validationIssues[0]).toContain('999');
  });

  it('detects dangling reference', () => {
    const schema = exportBrep(buildTriangleModel());
    schema.shells[0]!.halfEdges[0]!.twin = 'nonexistent-id';
    const { report } = importBrep(schema);
    expect(report.danglingReferences.length).toBeGreaterThan(0);
  });

  it('preserves face → outerLoop after import', () => {
    const { model } = roundTrip(buildTriangleModel());
    const shell = model.shells[0]!;
    const face = [...shell.faces.values()][0]!;
    expect(face.outerLoop).not.toBeNull();
    expect(face.outerLoop!.face).toBe(face);
  });

  it('preserves half-edge twin symmetry', () => {
    const { model } = roundTrip(buildTriangleModel());
    const shell = model.shells[0]!;
    for (const he of shell.halfEdges.values()) {
      expect(he.twin).not.toBeNull();
      expect(he.twin!.twin).toBe(he);
    }
  });
});

describe('JSON serialization', () => {
  it('exportBrepJson produces valid JSON', () => {
    const json = exportBrepJson(buildTriangleModel());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('importBrepJson round-trips', () => {
    const json = exportBrepJson(buildTriangleModel());
    const { report } = importBrepJson(json);
    expect(report.success).toBe(true);
  });
});

describe('diff', () => {
  it('vertex added in B reported', () => {
    const a = exportBrep(buildTriangleModel());
    const b = exportBrep(buildTriangleModel());
    b.shells[0]!.vertices.push({ id: 'newV', x: 5, y: 5, z: 0, outgoing: null });
    const d = diff(a, b);
    expect(d.verticesAdded).toContain('newV');
  });

  it('vertex moved when position changes', () => {
    const a = exportBrep(buildTriangleModel());
    const b = exportBrep(buildTriangleModel());
    b.shells[0]!.vertices[0]!.x = 99;
    const d = diff(a, b);
    expect(d.verticesMoved).toHaveLength(1);
  });

  it('vertex removed when missing in B', () => {
    const a = exportBrep(buildTriangleModel());
    const b = exportBrep(buildTriangleModel());
    b.shells[0]!.vertices.pop();
    const d = diff(a, b);
    expect(d.verticesRemoved).toHaveLength(1);
  });

  it('no-op diff has zero changes', () => {
    const a = exportBrep(buildTriangleModel());
    const b = exportBrep(buildTriangleModel());
    const d = diff(a, b);
    expect(d.verticesAdded).toHaveLength(0);
    expect(d.verticesRemoved).toHaveLength(0);
    expect(d.verticesMoved).toHaveLength(0);
    expect(d.facesAdded).toHaveLength(0);
    expect(d.facesRemoved).toHaveLength(0);
  });

  it('face added reported', () => {
    const a = exportBrep(buildTriangleModel());
    const b = exportBrep(buildTriangleModel());
    b.shells[0]!.faces.push({ id: 'newFace', outerLoop: null, innerLoops: [] });
    const d = diff(a, b);
    expect(d.facesAdded).toContain('newFace');
  });
});
