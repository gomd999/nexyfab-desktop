/**
 * ingestStl.test.ts — proves the REAL STL parser and its honesty rules, plus the units-unknown
 * gate path (STL has no units → aspect-ratio comparison, not absolute dims).
 *
 * STL bytes are generated in-memory (no third-party CAD binary is committed — the reference
 * corpus is local-license only). The binary writer deliberately stamps a leading "solid" token
 * into the 80-byte header to exercise the length-based binary sniff.
 */

import { describe, it, expect } from 'vitest';
import { parseStl, stlToIr } from './ingestStl';
import { solidBox, type IndexedMesh } from './meshAnalysis';
import { verifyReconstruction } from './gate';

/** Write an indexed mesh as a binary STL, with a misleading "solid ..." header on purpose. */
function writeBinaryStl(mesh: IndexedMesh): Uint8Array {
  const n = mesh.faces.length;
  const buf = new Uint8Array(84 + n * 50);
  const dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('solid lying-binary-header'), 0); // header lies
  dv.setUint32(80, n, true);
  let off = 84;
  for (const f of mesh.faces) {
    off += 12; // zero normal
    for (const vi of f) {
      const v = mesh.verts[vi];
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return buf;
}

const ASCII_STL = `solid test
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
facet normal 0 0 1
 outer loop
  vertex 1 0 0
  vertex 1 1 0
  vertex 0 1 0
 endloop
endfacet
endsolid test
`;

describe('STL parser', () => {
  it('parses ASCII STL', () => {
    const { triangles, format } = parseStl(new TextEncoder().encode(ASCII_STL));
    expect(format).toBe('ascii');
    expect(triangles.length).toBe(2);
    expect(triangles[0][1]).toEqual([1, 0, 0]);
  });

  it('detects a binary STL that lies with a "solid" header (length-based sniff)', () => {
    const buf = writeBinaryStl(solidBox(30, 20, 10)); // box → 12 triangles
    expect(buf.length).toBe(684); // 84 + 12*50
    const { triangles, format } = parseStl(buf);
    expect(format).toBe('binary');
    expect(triangles.length).toBe(12);
  });
});

describe('STL → IR honesty', () => {
  it('records units:null / units_source:unknown for a parsed STL', () => {
    const buf = writeBinaryStl(solidBox(30, 20, 10));
    const ir = stlToIr(buf, { path: 'generated/box.stl', name: 'box' });
    expect(ir.identity.format).toBe('STL');
    expect(ir.extent!.units).toBeNull(); // honesty rule 1
    expect(ir.extent!.units_source).toBe('unknown');
    expect(ir.mesh!.watertight).toBe(true);
    expect(ir.mesh!.triangles).toBe(12);
    expect(ir.mesh!.volume_mm3_unit_warning).toBeTruthy(); // volume not claimed as mm³
    expect(ir.topology).toBeNull(); // a mesh has no B-rep topology — not fabricated
    expect(ir.reconstruct!.grade).toBe('D'); // watertight mesh → import stub only, not the fleet
    expect(ir.reconstruct!.strategy).toBe('mesh_import');
  });
});

describe('units-unknown gate path', () => {
  it('gates a self-consistent STL reconstruction via aspect ratios (no absolute dims)', () => {
    const buf = writeBinaryStl(solidBox(30, 20, 10));
    const ir = stlToIr(buf, { path: 'generated/box.stl', name: 'box' });
    const { triangles } = parseStl(buf);
    const r = verifyReconstruction({ kind: 'triangles', triangles }, ir);
    // Absolute bbox is skipped because units are unknown; aspect ratios carry the comparison.
    expect(r.checks.find((c) => c.name === 'bbox_x')?.status).toBe('skipped');
    expect(r.checks.some((c) => c.name.startsWith('aspect_ratio_'))).toBe(true);
    expect(r.passed).toBe(true);
  });
});
