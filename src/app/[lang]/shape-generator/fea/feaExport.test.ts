import { describe, it, expect } from 'vitest';
import { exportNastranBdf, exportOnshapeJson, type FeaProblem } from './feaExport';

const tetProblem: FeaProblem = {
  vertices: new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
    0, 0, 10,
  ]),
  tetrahedra: new Uint32Array([0, 1, 2, 3]),
  materialId: 'aluminum',
  constraints: [{ nodeIndices: [0], dofs: 'all' }],
  loads: [{ nodeIndices: [3], force: [0, 0, -100] }],
};

describe('exportNastranBdf', () => {
  it('begins with the BEGIN BULK / ends with ENDDATA card', () => {
    const deck = exportNastranBdf(tetProblem);
    expect(deck).toContain('BEGIN BULK');
    expect(deck.trimEnd().endsWith('ENDDATA')).toBe(true);
  });

  it('emits 4 GRID cards for the 4 vertices', () => {
    const deck = exportNastranBdf(tetProblem);
    const grids = deck.split('\n').filter(l => l.startsWith('GRID'));
    expect(grids).toHaveLength(4);
  });

  it('emits a CTETRA card for the tetrahedron', () => {
    const deck = exportNastranBdf(tetProblem);
    const tets = deck.split('\n').filter(l => l.startsWith('CTETRA'));
    expect(tets).toHaveLength(1);
  });

  it('emits SPC1 for fixed constraint and FORCE for the load', () => {
    const deck = exportNastranBdf(tetProblem);
    expect(deck).toMatch(/SPC1/);
    expect(deck).toMatch(/FORCE/);
  });

  it('includes a MAT1 material card with non-default fields', () => {
    const deck = exportNastranBdf(tetProblem);
    const mat = deck.split('\n').find(l => l.startsWith('MAT1'));
    expect(mat).toBeDefined();
    // Aluminum E = 69 GPa = 69000 MPa.
    expect(mat).toMatch(/69/);
  });

  it('skips loads with zero magnitude', () => {
    const zeroLoad: FeaProblem = {
      ...tetProblem,
      loads: [{ nodeIndices: [3], force: [0, 0, 0] }],
    };
    const deck = exportNastranBdf(zeroLoad);
    expect(deck).not.toMatch(/FORCE/);
  });
});

describe('exportOnshapeJson', () => {
  it('emits a valid JSON document', () => {
    const json = exportOnshapeJson(tetProblem);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('carries schema id + material properties', () => {
    const obj = JSON.parse(exportOnshapeJson(tetProblem));
    expect(obj.schema).toMatch(/nexyfab\.fea/);
    expect(obj.material.id).toBe('aluminum');
    expect(obj.material.youngsModulusGpa).toBe(69);
  });

  it('reports vertex / tetra counts', () => {
    const obj = JSON.parse(exportOnshapeJson(tetProblem));
    expect(obj.mesh.vertexCount).toBe(4);
    expect(obj.mesh.tetrahedronCount).toBe(1);
  });

  it('translates dofs to numeric arrays', () => {
    const obj = JSON.parse(exportOnshapeJson(tetProblem));
    expect(obj.boundaryConditions.constraints[0].dofs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('includes preview-grade disclaimer in notes', () => {
    const obj = JSON.parse(exportOnshapeJson(tetProblem));
    expect(obj.notes).toMatch(/Preview-grade/);
  });

  it('unknown material → null property fields, schema still valid', () => {
    const obj = JSON.parse(exportOnshapeJson({ ...tetProblem, materialId: 'unobtanium' }));
    expect(obj.material.youngsModulusGpa).toBeNull();
    expect(obj.schema).toBeDefined();
  });
});
