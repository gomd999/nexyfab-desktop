import { describe, expect, it } from 'vitest';
import { type SpatialDeliverableBinding } from '../../../src/lib/cad/spatialDeliverableBinding';
import {
  LANDSCAPE_SITE_DELIVERABLE_KINDS,
  createLandscapeSiteDeliverableManifest,
  hashLandscapeSiteDeliverableBinding,
  hashLandscapeSiteDeliverableManifest,
  validateLandscapeSiteDeliverableBinding,
  validateLandscapeSiteDeliverableManifest,
  type LandscapeSiteDeliverableBinding,
} from './deliverables';

const h = 'a'.repeat(64);
const rev = { id: 'landscape-rev-001', sha256: h } as const;
const now = '2026-08-24T00:00:00.000Z';
const model = {
  revision: rev,
  modelSha256: h,
  semanticObjectGraphSha256: h,
  coordinateFrameSha256: h,
  terrainSha256: h,
  geometrySha256: h,
  quantitySha256: h,
  drawingScheduleSha256: h,
  sourceStatus: 'AUTHORITATIVE' as const,
};
const formats: Record<string, string> = {
  'native-landscape-project': 'json',
  'grading-plan': 'drawing',
  'drainage-plan': 'drawing',
  'hardscape-accessibility-plan': 'drawing',
  'planting-plan': 'planting-plan',
  'irrigation-plan': 'irrigation-plan',
  'planting-schedule': 'schedule',
  'irrigation-schedule': 'schedule',
  'soil-hardscape-quantity-schedule': 'quantity-schedule',
  boq: 'csv',
  'maintenance-plan': 'drawing',
  'coordination-report': 'pdf',
  'site-model-exchange': 'site-model',
  'verification-receipt': 'json',
};

function manifest() {
  return createLandscapeSiteDeliverableManifest({
    projectRevision: rev.id,
    modelContentHash: h,
    generatedAt: now,
    deliverables: LANDSCAPE_SITE_DELIVERABLE_KINDS.map((kind) => ({
      id: `landscape-${kind}`,
      kind,
      format: formats[kind] as never,
      contentSha256: h,
      byteLength: 100,
      sourceRevision: rev.id,
      generatedAt: now,
      verificationStatus: 'verified' as const,
    })),
  });
}

function spatialMinimum(): SpatialDeliverableBinding {
  const commonModel = {
    revision: rev,
    modelSha256: h,
    semanticObjectGraphSha256: h,
    coordinateFrameSha256: h,
    quantitySha256: h,
    drawingScheduleSha256: h,
    sourceStatus: 'AUTHORITATIVE' as const,
  };
  return {
    schema: 'nexyfab.cad.spatial-deliverable-binding.v1',
    domain: 'landscape',
    projectId: 'small-plaza',
    model: commonModel,
    deliverableManifestSha256: h,
    deliverables: ['site-model', 'planting-plan', 'irrigation-plan'].map((kind) => ({
      kind,
      contentSha256: h,
      sourceRevision: rev,
      sourceModelSha256: h,
      quantitySha256: h,
      drawingScheduleSha256: h,
      status: 'VERIFIED' as const,
    })),
    exchange: {
      kind: 'site-model', contentSha256: h, sourceRevision: rev, sourceModelSha256: h,
      semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED',
    },
    independentRoundTrip: {
      receiptSha256: h, exchangeContentSha256: h, sourceRevision: rev, sourceModelSha256: h,
      semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED',
    },
  };
}

function source(sourceKind: 'SURVEY_TIN' | 'CATALOG' | 'HYDRAULIC') {
  return {
    id: `authority-${sourceKind.toLowerCase()}`,
    sourceKind,
    revision: rev,
    sha256: h,
    rightsReceiptSha256: h,
    reviewStatus: 'APPROVED' as const,
    commercialUse: true as const,
    status: 'VERIFIED' as const,
  };
}

function binding(): LandscapeSiteDeliverableBinding {
  const m = manifest();
  return {
    schema: 'nexyfab.cad.landscape-site-deliverable-binding.v1',
    domain: 'landscape',
    projectId: 'small-plaza',
    manifest: m,
    manifestSha256: hashLandscapeSiteDeliverableManifest(m),
    model,
    terrainAuthority: source('SURVEY_TIN'),
    catalogAuthority: source('CATALOG'),
    hydraulicAuthority: source('HYDRAULIC'),
    spatialMinimum: spatialMinimum(),
    independentSiteModelRoundTrip: {
      receiptSha256: h,
      exchangeKind: 'site-model',
      nativeFormat: 'ifc',
      exchangeContentSha256: h,
      sourceRevision: rev,
      sourceModelSha256: h,
      semanticObjectGraphSha256: h,
      coordinateFrameSha256: h,
      terrainSha256: h,
      geometrySha256: h,
      quantitySha256: h,
      semanticRoundTripSha256: h,
      geometryRoundTripSha256: h,
      quantityRoundTripSha256: h,
      independentValidatorId: 'site-model-validator-01',
      independent: true,
      status: 'VERIFIED',
    },
  };
}

describe('landscape site deliverables', () => {
  it('requires the complete exact landscape package and authoritative sources', () => {
    const b = binding();
    expect(validateLandscapeSiteDeliverableManifest(b.manifest).valid).toBe(true);
    expect(validateLandscapeSiteDeliverableBinding(b, { projectId: b.projectId, modelRevision: rev, modelSha256: h })).toMatchObject({ valid: true, status: 'VERIFIED' });
  });

  it.each([
    ['missing deliverable', (b: LandscapeSiteDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.slice(1) } })],
    ['stale deliverable', (b: LandscapeSiteDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.map((d) => d.kind === 'site-model-exchange' ? { ...d, sourceRevision: 'old' } : d) } })],
    ['preview model', (b: LandscapeSiteDeliverableBinding) => ({ ...b, model: { ...b.model, sourceStatus: 'PREVIEW' as const } })],
    ['terrain rights missing', (b: LandscapeSiteDeliverableBinding) => ({ ...b, terrainAuthority: { ...b.terrainAuthority, commercialUse: false as never } })],
    ['terrain model mismatch', (b: LandscapeSiteDeliverableBinding) => ({ ...b, terrainAuthority: { ...b.terrainAuthority, sha256: 'b'.repeat(64) } })],
    ['catalog source substituted', (b: LandscapeSiteDeliverableBinding) => ({ ...b, catalogAuthority: { ...b.catalogAuthority, sourceKind: 'PREVIEW' as never } })],
    ['hydraulic authority held', (b: LandscapeSiteDeliverableBinding) => ({ ...b, hydraulicAuthority: { ...b.hydraulicAuthority, status: 'HOLD' as const } })],
    ['roundtrip not run', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, status: 'NOT_RUN' as const } })],
    ['roundtrip substitution', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, exchangeKind: 'ifc' as never } })],
    ['roundtrip not independent', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, independent: false as never } })],
    ['geometry proof missing', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, geometryRoundTripSha256: 'bad' } })],
    ['coordinate mismatch', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, coordinateFrameSha256: 'b'.repeat(64) } })],
    ['quantity mismatch', (b: LandscapeSiteDeliverableBinding) => ({ ...b, independentSiteModelRoundTrip: { ...b.independentSiteModelRoundTrip, quantitySha256: 'b'.repeat(64) } })],
  ])('fails closed for %s', (_name, mutate) => expect(validateLandscapeSiteDeliverableBinding(mutate(binding())).valid).toBe(false));

  it('marks changed project, model, and revision stale', () => {
    const b = binding();
    expect(validateLandscapeSiteDeliverableBinding(b, { projectId: 'other-project' }).status).toBe('STALE');
    expect(validateLandscapeSiteDeliverableBinding(b, { modelSha256: 'b'.repeat(64) }).status).toBe('STALE');
    expect(validateLandscapeSiteDeliverableBinding(b, { modelRevision: { id: 'new', sha256: h } }).status).toBe('STALE');
  });

  it('rejects malformed required-kind declarations and stale source revisions', () => {
    const b = binding();
    expect(validateLandscapeSiteDeliverableManifest({ ...b.manifest, requiredDeliverableKinds: ['site-model'] }).valid).toBe(false);
    expect(validateLandscapeSiteDeliverableBinding({ ...b, terrainAuthority: { ...b.terrainAuthority, revision: { id: 'old', sha256: h } } }).valid).toBe(false);
  });

  it('produces a deterministic binding hash after validation', () => {
    const first = validateLandscapeSiteDeliverableBinding(binding());
    const second = validateLandscapeSiteDeliverableBinding(binding());
    expect(first.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canonicalSha256).toBe(second.canonicalSha256);
    expect(hashLandscapeSiteDeliverableBinding(binding())).toBe(first.canonicalSha256);
  });
});
