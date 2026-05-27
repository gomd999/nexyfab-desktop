import { describe, it, expect } from 'vitest';
import { exportVtkLegacy, exportVtu, type VtkMesh, type VtkField } from './vtkExport';

const mesh: VtkMesh = {
  points: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  cells: [[0, 1, 2, 3]],
};

describe('exportVtkLegacy', () => {
  it('emits header + POINTS + CELLS + CELL_TYPES', () => {
    const out = exportVtkLegacy(mesh);
    expect(out).toContain('# vtk DataFile Version 3.0');
    expect(out).toContain('DATASET UNSTRUCTURED_GRID');
    expect(out).toContain('POINTS 4 float');
    expect(out).toContain('CELLS 1 5');
    expect(out).toContain('CELL_TYPES 1');
    expect(out).toContain('10'); // VTK_TETRA
  });

  it('emits scalar field with LOOKUP_TABLE', () => {
    const f: VtkField = { name: 'vonmises', kind: 'scalar', values: [100, 200, 150, 175] };
    const out = exportVtkLegacy(mesh, [f]);
    expect(out).toContain('SCALARS vonmises float 1');
    expect(out).toContain('LOOKUP_TABLE default');
    expect(out).toContain('200');
  });

  it('emits vector field', () => {
    const f: VtkField = {
      name: 'displacement',
      kind: 'vector',
      values: [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.05]],
    };
    const out = exportVtkLegacy(mesh, [f]);
    expect(out).toContain('VECTORS displacement float');
    expect(out).toContain('0.1 0 0');
  });

  it('emits tensor6 expanded to 3×3', () => {
    const f: VtkField = {
      name: 'stress',
      kind: 'tensor6',
      values: [[10, 20, 30, 1, 2, 3], [10, 20, 30, 1, 2, 3], [10, 20, 30, 1, 2, 3], [10, 20, 30, 1, 2, 3]],
    };
    const out = exportVtkLegacy(mesh, [f]);
    expect(out).toContain('TENSORS stress float');
    // First row of 3×3 symmetric: xx xy xz = 10 1 3
    expect(out).toContain('10 1 3');
  });

  it('emits POINT_DATA block only when point fields exist', () => {
    const out = exportVtkLegacy(mesh);
    expect(out).not.toContain('POINT_DATA');
  });

  it('emits CELL_DATA for cell-located fields', () => {
    const f: VtkField = { name: 'safety', kind: 'scalar', values: [2.5], location: 'cells' };
    const out = exportVtkLegacy(mesh, [f]);
    expect(out).toContain('CELL_DATA 1');
    expect(out).toContain('SCALARS safety float 1');
  });
});

describe('exportVtu', () => {
  it('produces valid VTU XML structure', () => {
    const out = exportVtu(mesh);
    expect(out).toContain('<VTKFile type="UnstructuredGrid"');
    expect(out).toContain('<UnstructuredGrid>');
    expect(out).toContain('<Piece NumberOfPoints="4" NumberOfCells="1">');
    expect(out).toContain('NumberOfComponents="3"');
  });

  it('encodes scalar field as 1 component', () => {
    const f: VtkField = { name: 'vonmises', kind: 'scalar', values: [100, 200, 150, 175] };
    const out = exportVtu(mesh, [f]);
    expect(out).toContain('<DataArray type="Float32" Name="vonmises" NumberOfComponents="1"');
  });

  it('encodes vector field as 3 components', () => {
    const f: VtkField = {
      name: 'disp',
      kind: 'vector',
      values: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    };
    const out = exportVtu(mesh, [f]);
    expect(out).toContain('Name="disp" NumberOfComponents="3"');
  });
});
