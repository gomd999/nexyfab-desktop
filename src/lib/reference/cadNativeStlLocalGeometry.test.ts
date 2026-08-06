import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCadNativeStlLocalGeometry } from './cadNativeStlLocalGeometry';

const identity = [1, 0, 0, 4, 0, 1, 0, 5, 0, 0, 1, 6, 0, 0, 0, 1];
const bytes = new TextEncoder().encode(`solid tetra
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endloop endfacet
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 0 0 1 vertex 1 0 0 endloop endfacet
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 0 1 0 vertex 0 0 1 endloop endfacet
facet normal 0 0 0 outer loop vertex 1 0 0 vertex 0 0 1 vertex 0 1 0 endloop endfacet
endsolid tetra`);
const hash = createHash('sha256').update(bytes).digest('hex');

describe('native STL local geometry', () => {
  it('preserves local vertices and the independent occurrence transform', () => {
    const result = buildCadNativeStlLocalGeometry([{ occurrenceId: 'o1', definitionId: 'tetra', bytes, sha256: hash, localToWorld: identity, unitScaleMm: 1 }]);
    expect(result).toMatchObject({ status: 'pass', releaseReady: true });
    expect(result.geometries[0]).toMatchObject({ localToWorld: identity, measurement: { triangles: 4, watertight: true } });
    expect(result.geometries[0]!.localMesh.verts).toContainEqual([0, 0, 0]);
  });
  it('does not guess unknown STL units', () => {
    expect(buildCadNativeStlLocalGeometry([{ occurrenceId: 'o1', definitionId: 'tetra', bytes, sha256: hash, localToWorld: identity, unitScaleMm: null }])).toMatchObject({ status: 'not_run', releaseReady: false, unresolved: ['native_stl_units_unknown:o1'] });
  });
  it('fails hash or transform corruption', () => {
    expect(buildCadNativeStlLocalGeometry([{ occurrenceId: 'o1', definitionId: 'tetra', bytes, sha256: '0'.repeat(64), localToWorld: identity, unitScaleMm: 1 }]).status).toBe('fail');
  });
});
