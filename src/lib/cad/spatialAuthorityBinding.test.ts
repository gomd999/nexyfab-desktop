import { describe, expect, it } from 'vitest';
import { hashSpatialAuthorityBinding, validateSpatialAuthorityBinding, type SpatialAuthorityBinding, type SpatialAuthorityArtifact } from './spatialAuthorityBinding';

const h = 'a'.repeat(64);
const artifact = (kind: SpatialAuthorityArtifact['kind'], id: string, extra: Partial<SpatialAuthorityArtifact> = {}): SpatialAuthorityArtifact => ({
  id, kind, contentSha256: h, sourceRevision: { id: `${id}-r1`, sha256: h }, sourceClass: 'AUTHORITATIVE', reviewStatus: 'APPROVED',
  rights: { status: 'APPROVED', receiptSha256: h, allowedUse: 'commercial' }, capturedAt: '2026-08-24T00:00:00Z', reviewedAt: '2026-08-24T00:00:00Z', ...extra,
});
const binding = (domain: SpatialAuthorityBinding['domain'], authorities: readonly SpatialAuthorityArtifact[]): SpatialAuthorityBinding => ({
  schemaVersion: 'nexyfab.cad.spatial-authority-binding.v1', domain, projectId: 'project-1', projectRevision: { id: 'project-r1', sha256: h },
  coordinateFrame: { crsId: 'EPSG:5186', horizontalDatum: 'GRS80', verticalDatum: 'KVD2020', epoch: 2020, units: { linear: 'm', angular: 'deg' }, localOrigin: [0, 0, 0], localRotation: [0, 0, 0, 1], transformProvenanceSha256: h },
  authorities: [...authorities], upstreamBindings: [],
});

describe('spatial authority binding', () => {
  it.each([
    ['civil', [artifact('SURVEY_TIN', 'survey'), artifact('CLIENT', 'requirements')]],
    ['building', [artifact('BIM_HOST', 'host', { surveyedHost: true }), artifact('SURVEY_TIN', 'site'), artifact('CODE', 'code'), artifact('CLIENT', 'requirements')]],
    ['landscape', [artifact('SURVEY_TIN', 'surface'), artifact('CATALOG', 'plants'), artifact('HYDRAULIC', 'irrigation'), artifact('CLIENT', 'requirements')]],
    ['interior', [artifact('BIM_HOST', 'host', { surveyedHost: true }), artifact('CATALOG', 'products'), artifact('CODE', 'code'), artifact('CLIENT', 'requirements')]],
  ] as const)('passes required authority set for %s', (domain, authorities) => {
    const result = validateSpatialAuthorityBinding(binding(domain, authorities));
    expect(result.status).toBe('PASS');
    expect(result.canonicalSha256).toBe(hashSpatialAuthorityBinding(binding(domain, authorities)));
  });

  it('holds preview, synthetic and AI-inferred sources', () => {
    const result = validateSpatialAuthorityBinding(binding('civil', [artifact('SURVEY_TIN', 'survey', { sourceClass: 'SYNTHETIC' })]));
    expect(result.status).toBe('HOLD');
    expect(result.issues).toContain('authorities[0].sourceClass:synthetic_blocker');
  });

  it('holds an unsurveyed interior host and unconfirmed civil datum', () => {
    expect(validateSpatialAuthorityBinding(binding('interior', [artifact('BIM_HOST', 'host'), artifact('CATALOG', 'products'), artifact('CODE', 'code')])).status).toBe('HOLD');
    const civil = binding('civil', [artifact('SURVEY_TIN', 'survey')]);
    civil.coordinateFrame.verticalDatum = 'UNCONFIRMED';
    expect(validateSpatialAuthorityBinding(civil).status).toBe('HOLD');
  });

  it('rejects unknown keys and invalid rights hashes', () => {
    const value = binding('civil', [artifact('SURVEY_TIN', 'survey')]) as unknown as Record<string, unknown>;
    value.extra = true;
    (value.authorities as Array<Record<string, unknown>>)[0]!.rights = { status: 'APPROVED', receiptSha256: 'bad', allowedUse: 'commercial' };
    const result = validateSpatialAuthorityBinding(value);
    expect(result.status).toBe('HOLD');
    expect(result.issues).toEqual(expect.arrayContaining(['binding.extra:unknown_key', 'authorities[0].rights.receiptSha256:invalid_sha256']));
  });

  it('is deterministic and flags stale authorities as STALE', () => {
    const value = binding('civil', [artifact('SURVEY_TIN', 'survey', { reviewStatus: 'STALE' })]);
    const first = validateSpatialAuthorityBinding(value);
    const second = validateSpatialAuthorityBinding(JSON.parse(JSON.stringify(value)));
    expect(first.status).toBe('STALE');
    expect(first.issues).toEqual(second.issues);
    expect(hashSpatialAuthorityBinding(value)).toBe(hashSpatialAuthorityBinding(JSON.parse(JSON.stringify(value))));
  });

  it('marks an upstream revision mismatch stale', () => {
    const value = binding('civil', [artifact('SURVEY_TIN', 'survey')]);
    value.upstreamBindings = [{ id: 'up-1', artifactId: 'survey', revision: { id: 'survey-r2', sha256: h } }];
    const result = validateSpatialAuthorityBinding(value);
    expect(result.status).toBe('STALE');
    expect(result.issues).toContain('upstreamBindings[0].revision:mismatch');
  });
});
