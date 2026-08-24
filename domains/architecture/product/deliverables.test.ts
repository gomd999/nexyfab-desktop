import { describe, expect, it } from 'vitest';
import type { SpatialDeliverableBinding } from '../../../src/lib/cad/spatialDeliverableBinding';
import {
  BUILDING_CORE_DELIVERABLE_KINDS,
  createBuildingCoreDeliverableManifest,
  hashBuildingCoreDeliverableBinding,
  validateBuildingCoreDeliverableBinding,
  validateBuildingCoreDeliverableManifest,
  type BuildingCoreDeliverableBinding,
} from './deliverables';

const h = 'a'.repeat(64);
const revision = { id: 'building-rev-001', sha256: h } as const;
const generatedAt = '2026-08-24T00:00:00.000Z';
const model = {
  revision,
  modelSha256: h,
  semanticObjectGraphSha256: h,
  coordinateFrameSha256: h,
  quantitySha256: h,
  drawingScheduleSha256: h,
  sourceStatus: 'AUTHORITATIVE' as const,
};
const formats: Record<string, string> = {
  'native-building-document': 'json', 'site-plan': 'drawing', 'floor-plans': 'drawing',
  'roof-plan': 'drawing', elevations: 'drawing', sections: 'drawing',
  'opening-schedule': 'schedule', 'space-schedule': 'schedule', 'quantity-schedule': 'quantity-schedule',
  'coordination-report': 'pdf', ifc: 'ifc', 'verification-receipt': 'json',
};

function manifest() {
  return createBuildingCoreDeliverableManifest({
    projectRevision: revision.id,
    modelContentHash: h,
    generatedAt,
    deliverables: BUILDING_CORE_DELIVERABLE_KINDS.map((kind) => ({
      id: `building-${kind}`,
      kind,
      format: formats[kind] as never,
      contentSha256: h,
      byteLength: 100,
      sourceRevision: revision.id,
      generatedAt,
      verificationStatus: 'verified' as const,
    })),
  });
}

function spatialMinimum(): SpatialDeliverableBinding {
  return {
    schema: 'nexyfab.cad.spatial-deliverable-binding.v1', domain: 'building', projectId: 'building-core', model,
    deliverableManifestSha256: h,
    deliverables: ['ifc', 'drawing', 'schedule'].map((kind) => ({
      kind, contentSha256: h, sourceRevision: revision, sourceModelSha256: h,
      quantitySha256: h, drawingScheduleSha256: h, status: 'VERIFIED' as const,
    })),
    exchange: { kind: 'ifc', contentSha256: h, sourceRevision: revision, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' },
    independentRoundTrip: { receiptSha256: h, exchangeContentSha256: h, sourceRevision: revision, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' },
  };
}

function binding(): BuildingCoreDeliverableBinding {
  return {
    schema: 'nexyfab.cad.building-core-deliverable-binding.v1', domain: 'building', projectId: 'building-core',
    manifest: manifest(), model,
    authoritativeSource: { id: 'client-host-model', revision, sha256: h, rightsReceiptSha256: h, reviewStatus: 'APPROVED', commercialUse: true },
    spatialMinimum: spatialMinimum(),
    independentIfcRoundTrip: {
      receiptSha256: h, exchangeKind: 'ifc', exchangeContentSha256: h, sourceRevision: revision,
      sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h,
      semanticRoundTripSha256: h, geometryRoundTripSha256: h, independentValidatorId: 'ifc-validator-01',
      independent: true, status: 'VERIFIED',
    },
  };
}

describe('building commercial core deliverables', () => {
  it('requires the exact output set and authoritative IFC roundtrip binding', () => {
    const value = binding();
    expect(value.manifest.requiredDeliverableKinds).toEqual([...BUILDING_CORE_DELIVERABLE_KINDS]);
    expect(validateBuildingCoreDeliverableManifest(value.manifest)).toEqual({ valid: true, errors: [] });
    expect(validateBuildingCoreDeliverableBinding(value, { projectId: value.projectId, modelRevision: revision, modelSha256: h })).toMatchObject({ valid: true, status: 'VERIFIED' });
  });

  it.each([
    ['missing deliverable', (value: BuildingCoreDeliverableBinding) => ({ ...value, manifest: { ...value.manifest, deliverables: value.manifest.deliverables.slice(1) } })],
    ['stale deliverable', (value: BuildingCoreDeliverableBinding) => ({ ...value, manifest: { ...value.manifest, deliverables: value.manifest.deliverables.map((item) => item.kind === 'floor-plans' ? { ...item, sourceRevision: 'old-revision' } : item) } })],
    ['preview model', (value: BuildingCoreDeliverableBinding) => ({ ...value, model: { ...value.model, sourceStatus: 'PREVIEW' as const } })],
    ['unapproved source', (value: BuildingCoreDeliverableBinding) => ({ ...value, authoritativeSource: { ...value.authoritativeSource, reviewStatus: 'HOLD' as never } })],
    ['stale authoritative source', (value: BuildingCoreDeliverableBinding) => ({ ...value, authoritativeSource: { ...value.authoritativeSource, revision: { id: 'old', sha256: h } } })],
    ['manifest revision drift', (value: BuildingCoreDeliverableBinding) => ({ ...value, manifest: { ...value.manifest, projectRevision: 'old' } })],
    ['IFC substitution', (value: BuildingCoreDeliverableBinding) => ({ ...value, independentIfcRoundTrip: { ...value.independentIfcRoundTrip, exchangeKind: 'space-model' as never } })],
    ['semantic roundtrip not run', (value: BuildingCoreDeliverableBinding) => ({ ...value, independentIfcRoundTrip: { ...value.independentIfcRoundTrip, semanticRoundTripSha256: 'bad' } })],
    ['geometry roundtrip not run', (value: BuildingCoreDeliverableBinding) => ({ ...value, independentIfcRoundTrip: { ...value.independentIfcRoundTrip, geometryRoundTripSha256: 'bad' } })],
  ])('fails closed for %s', (_name, mutate) => expect(validateBuildingCoreDeliverableBinding(mutate(binding())).valid).toBe(false));

  it('marks changed model or revision stale', () => {
    const value = binding();
    expect(validateBuildingCoreDeliverableBinding(value, { modelSha256: 'b'.repeat(64) }).status).toBe('STALE');
    expect(validateBuildingCoreDeliverableBinding(value, { modelRevision: { id: 'new', sha256: h } }).status).toBe('STALE');
  });

  it('produces a deterministic canonical hash only for a valid binding', () => {
    const value = binding();
    const first = validateBuildingCoreDeliverableBinding(value);
    const second = validateBuildingCoreDeliverableBinding(structuredClone(value));
    expect(first.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canonicalSha256).toBe(second.canonicalSha256);
    expect(hashBuildingCoreDeliverableBinding(value)).toBe(first.canonicalSha256);
  });
});
