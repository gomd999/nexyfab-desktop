import { describe, expect, it } from 'vitest';
import { hashSpatialSemanticObjectGraph, validateSpatialSemanticObjectGraph, type SpatialSemanticObjectGraph } from './spatialSemanticObject';

const sha = 'a'.repeat(64);
const revision = { id: 'rev-1', sha256: sha };
const object = (id: string, namespace: 'building' | 'interior', authority: 'AUTHORITATIVE' | 'PREVIEW' = 'AUTHORITATIVE', representation: 'BIM_SEMANTIC' | 'PREVIEW_BOUNDS' = 'BIM_SEMANTIC') => ({ id, namespace, semanticKind: 'space', authority, representation, sourceRevision: revision, contentSha256: sha, transformSha256: sha, coordinateFrameSha256: sha });
const base: SpatialSemanticObjectGraph = { schema: 'nexyfab.cad.spatial-semantic-object-graph.v1', projectId: 'p-1', projectRevision: revision, releaseRepresentation: 'SPATIAL_SEMANTIC', objects: [object('building:space-1', 'building'), object('interior:space-1', 'interior')], relationships: [{ id: 'r-1', kind: 'HOST', fromObjectId: 'interior:space-1', toObjectId: 'building:space-1', sourceRevision: revision }] };

describe('spatial semantic object graph', () => {
  it('validates stable namespaced objects and host relationships', () => {
    const result = validateSpatialSemanticObjectGraph(base);
    expect(result.valid).toBe(true);
    expect(result.canonicalSha256).toBe(hashSpatialSemanticObjectGraph(base));
  });
  it.each([
    ['duplicate object id', { objects: [base.objects[0], base.objects[0]] }],
    ['dangling host', { relationships: [{ ...base.relationships[0], toObjectId: 'building:missing' }] }],
    ['forbidden domain edge', { relationships: [{ ...base.relationships[0], fromObjectId: 'interior:space-1', toObjectId: 'interior:space-1' }] }],
    ['preview promotion', { objects: [object('building:space-1', 'building', 'PREVIEW'), object('interior:space-1', 'interior')] }],
  ])('fails closed for %s', (_name, change) => {
    const candidate = { ...base, ...change } as SpatialSemanticObjectGraph;
    expect(validateSpatialSemanticObjectGraph(candidate).valid).toBe(false);
  });
  it('rejects an exact-brep claim for a spatial release and mechanical disguise', () => {
    expect(validateSpatialSemanticObjectGraph({ ...base, releaseRepresentation: 'EXACT_BREP' }).valid).toBe(false);
    const disguised = { ...base, objects: [{ ...base.objects[0], representation: 'EXACT_BREP', namespace: 'building' }] } as unknown as SpatialSemanticObjectGraph;
    expect(validateSpatialSemanticObjectGraph(disguised).valid).toBe(false);
  });
  it('rejects a release graph containing an otherwise well-formed preview object', () => {
    const preview = object('interior:preview-chair', 'interior', 'PREVIEW', 'PREVIEW_BOUNDS');
    expect(validateSpatialSemanticObjectGraph({ ...base, objects: [...base.objects, preview] }).errors).toContain('spatial_release_preview_object_blocked');
  });
  it('canonical hash preserves relationship order as authored', () => {
    const reversed = { ...base, relationships: [...base.relationships].reverse() };
    expect(hashSpatialSemanticObjectGraph(reversed)).toBe(hashSpatialSemanticObjectGraph(base));
  });
});
