import { describe, expect, it } from 'vitest';
import { checkCoordinationCandidates, coordinationParameters, prepareExactClashJob, type CoordinationDocument } from './coordinationSpatialModel';

const base: CoordinationDocument = {
  schema: 'nexyfab.coordination.v1', revision: 0, activeCoordinateSystem: 'EPSG:5186', toleranceMm: 50,
  models: [
    { id: 'architecture', discipline: 'architecture', revision: 'A', coordinateSystem: 'EPSG:5186', offsetMm: [0, 0, 0], boundsMm: { min: [0, 0, 0], max: [12_000, 8000, 6400] }, geometryEvidence: 'concept_bounds' },
    { id: 'mep', discipline: 'mep', revision: 'A', coordinateSystem: 'EPSG:5186', offsetMm: [0, 0, 0], boundsMm: { min: [5500, 3500, 2600], max: [6500, 4500, 3100] }, geometryEvidence: 'concept_bounds' },
  ],
};

describe('coordination spatial model', () => {
  it('finds bounded candidates but keeps exact clash and release NOT_RUN', () => {
    expect(checkCoordinationCandidates(base)).toMatchObject({ state: 'PREVIEW', candidates: [{ modelA: 'architecture', modelB: 'mep', severity: 'hard', verification: 'PREVIEW' }], exactClashVerification: 'NOT_RUN', releaseVerification: 'NOT_RUN' });
  });

  it('blocks mismatched coordinates before calculating candidates', () => {
    const document = structuredClone(base);
    document.models[1]!.coordinateSystem = 'LOCAL';
    expect(checkCoordinationCandidates(document)).toMatchObject({ state: 'BLOCKED', candidates: [], issues: ['coordinate_mismatch:mep'] });
  });

  it('blocks an exact clash job for concept bounds without waiving any model', () => {
    expect(prepareExactClashJob(base)).toMatchObject({
      state: 'BLOCKED', request: null,
      issues: expect.arrayContaining(['exact_brep_required:architecture', 'exact_brep_required:mep']),
    });
  });

  it('persists only explicit exact revision bindings in coordination parameters', () => {
    const document = structuredClone(base);
    document.models[0] = { ...document.models[0]!, geometryEvidence: 'exact_brep', exactGeometry: { artifactId: 'artifact-1', contentHash: 'a'.repeat(64), shapeIdentityHash: 'b'.repeat(64) } };
    expect(coordinationParameters(document)).toMatchObject({ modelExactGeometry: { architecture: { artifactId: 'artifact-1', revision: 'A' }, mep: null } });
  });

  it('prepares a hash-bound request only when every model is exact', () => {
    const document = structuredClone(base);
    for (const [index, model] of document.models.entries()) {
      model.geometryEvidence = 'exact_brep';
      model.exactGeometry = { artifactId: `artifact-${index}`, contentHash: String(index + 1).repeat(64), shapeIdentityHash: String(index + 3).repeat(64) };
    }
    expect(prepareExactClashJob(document)).toMatchObject({ state: 'READY', request: { schema: 'nexyfab.exact-clash-job-request.v1', models: [{ artifactId: 'artifact-0' }, { artifactId: 'artifact-1' }] }, issues: [] });
  });
});
