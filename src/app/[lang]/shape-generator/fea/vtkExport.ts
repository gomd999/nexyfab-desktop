/**
 * vtkExport.ts — FEA results → VTK Legacy (.vtk) / VTU (.vtu).
 *
 * NexyFab's FEA is preview-grade. Users who need real solving open
 * the same model in Ansys / FreeCAD / Calculix. VTK Legacy is the
 * highest-compatibility format — every FEA viewer, including
 * Paraview, ParaviewWeb, and tetgen visualisers, reads it.
 *
 * We also emit VTU (XML, modern Paraview default). VTU supports
 * binary data appendage but we ship ASCII only — the data volumes
 * for preview meshes are small.
 *
 * Field types supported:
 *   - **scalar** — von-Mises stress, safety factor
 *   - **vector** — displacement, force
 *   - **tensor** — full stress tensor (6-component symmetric)
 */

export interface VtkMesh {
  /** Vertex positions (Nx3). */
  points: Array<[number, number, number]>;
  /** Tetra4 cells (each [n0, n1, n2, n3]). */
  cells: Array<[number, number, number, number]>;
}

export interface VtkField {
  name: string;
  kind: 'scalar' | 'vector' | 'tensor6';
  /** Per-point values. scalar=number[], vector=Vec3[], tensor6=6-tuple[]. */
  values: Array<number | [number, number, number] | [number, number, number, number, number, number]>;
  /** 'points' (default) or 'cells'. */
  location?: 'points' | 'cells';
}

export function exportVtkLegacy(mesh: VtkMesh, fields: VtkField[] = []): string {
  const lines: string[] = [];
  lines.push('# vtk DataFile Version 3.0');
  lines.push('NexyFab FEA preview');
  lines.push('ASCII');
  lines.push('DATASET UNSTRUCTURED_GRID');

  lines.push(`POINTS ${mesh.points.length} float`);
  for (const p of mesh.points) lines.push(`${p[0]} ${p[1]} ${p[2]}`);

  const cellSize = mesh.cells.length * 5; // (1 count + 4 ids) per tetra
  lines.push(`CELLS ${mesh.cells.length} ${cellSize}`);
  for (const c of mesh.cells) lines.push(`4 ${c[0]} ${c[1]} ${c[2]} ${c[3]}`);

  lines.push(`CELL_TYPES ${mesh.cells.length}`);
  for (let i = 0; i < mesh.cells.length; i++) lines.push('10'); // VTK_TETRA = 10

  // Group fields by location.
  const pointFields = fields.filter(f => (f.location ?? 'points') === 'points');
  const cellFields = fields.filter(f => f.location === 'cells');

  if (pointFields.length > 0) {
    lines.push(`POINT_DATA ${mesh.points.length}`);
    for (const f of pointFields) appendField(lines, f);
  }
  if (cellFields.length > 0) {
    lines.push(`CELL_DATA ${mesh.cells.length}`);
    for (const f of cellFields) appendField(lines, f);
  }

  return lines.join('\n') + '\n';
}

function appendField(lines: string[], f: VtkField): void {
  switch (f.kind) {
    case 'scalar':
      lines.push(`SCALARS ${f.name} float 1`);
      lines.push('LOOKUP_TABLE default');
      for (const v of f.values) lines.push(String(v));
      break;
    case 'vector':
      lines.push(`VECTORS ${f.name} float`);
      for (const v of f.values) {
        const arr = v as [number, number, number];
        lines.push(`${arr[0]} ${arr[1]} ${arr[2]}`);
      }
      break;
    case 'tensor6':
      // Pad 6 → 9 (full 3×3 symmetric) for VTK convention.
      lines.push(`TENSORS ${f.name} float`);
      for (const v of f.values) {
        const [xx, yy, zz, xy, yz, xz] = v as [number, number, number, number, number, number];
        lines.push(`${xx} ${xy} ${xz}`);
        lines.push(`${xy} ${yy} ${yz}`);
        lines.push(`${xz} ${yz} ${zz}`);
      }
      break;
  }
}

/** Modern VTU XML output (Paraview default). */
export function exportVtu(mesh: VtkMesh, fields: VtkField[] = []): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0"?>');
  lines.push('<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">');
  lines.push('  <UnstructuredGrid>');
  lines.push(`    <Piece NumberOfPoints="${mesh.points.length}" NumberOfCells="${mesh.cells.length}">`);
  lines.push('      <Points>');
  lines.push('        <DataArray type="Float32" NumberOfComponents="3" format="ascii">');
  lines.push('          ' + mesh.points.flat().join(' '));
  lines.push('        </DataArray>');
  lines.push('      </Points>');
  lines.push('      <Cells>');
  lines.push('        <DataArray type="Int32" Name="connectivity" format="ascii">');
  lines.push('          ' + mesh.cells.flat().join(' '));
  lines.push('        </DataArray>');
  lines.push('        <DataArray type="Int32" Name="offsets" format="ascii">');
  lines.push('          ' + mesh.cells.map((_, i) => (i + 1) * 4).join(' '));
  lines.push('        </DataArray>');
  lines.push('        <DataArray type="UInt8" Name="types" format="ascii">');
  lines.push('          ' + mesh.cells.map(() => 10).join(' '));
  lines.push('        </DataArray>');
  lines.push('      </Cells>');

  const pointFields = fields.filter(f => (f.location ?? 'points') === 'points');
  if (pointFields.length > 0) {
    lines.push('      <PointData>');
    for (const f of pointFields) {
      const nc = f.kind === 'scalar' ? 1 : f.kind === 'vector' ? 3 : 6;
      lines.push(`        <DataArray type="Float32" Name="${f.name}" NumberOfComponents="${nc}" format="ascii">`);
      lines.push('          ' + flattenFieldValues(f).join(' '));
      lines.push('        </DataArray>');
    }
    lines.push('      </PointData>');
  }

  lines.push('    </Piece>');
  lines.push('  </UnstructuredGrid>');
  lines.push('</VTKFile>');
  return lines.join('\n');
}

function flattenFieldValues(f: VtkField): number[] {
  switch (f.kind) {
    case 'scalar': return f.values as number[];
    case 'vector': return (f.values as Array<[number, number, number]>).flat();
    case 'tensor6': return (f.values as Array<[number, number, number, number, number, number]>).flat();
  }
}
