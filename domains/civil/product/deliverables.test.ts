import { describe, expect, it } from 'vitest';
import { hashSpatialDeliverableBinding, type SpatialDeliverableBinding } from '../../../src/lib/cad/spatialDeliverableBinding';
import {
  CIVIL_SITE_DELIVERABLE_KINDS, createCivilSiteDeliverableManifest,
  hashCivilSiteDeliverableManifest, validateCivilSiteDeliverableBinding, validateCivilSiteDeliverableManifest,
  type CivilSiteDeliverableBinding,
} from './deliverables';

const h = 'a'.repeat(64);
const rev = { id: 'civil-rev-001', sha256: h } as const;
const now = '2026-08-24T00:00:00.000Z';
const model = { revision: rev, modelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, drawingScheduleSha256: h, sourceStatus: 'AUTHORITATIVE' as const, geometrySha256: h };
const formats: Record<string, string> = {
  'native-civil-project': 'json', 'survey-control-report': 'pdf', 'existing-surface-tin': 'landxml', 'proposed-surface-tin': 'landxml',
  'alignment-profile-sheets': 'drawing', 'cross-section-package': 'drawing', 'corridor-grading-package': 'drawing', 'drainage-hydraulic-report': 'pdf',
  'earthwork-quantity-report': 'pdf', 'quantity-schedule': 'quantity-schedule', 'construction-stage-package': 'pdf', landxml: 'landxml', 'coordination-report': 'pdf', 'verification-receipt': 'json',
};
function manifest() {
  return createCivilSiteDeliverableManifest({ projectRevision: rev.id, modelContentHash: h, generatedAt: now, deliverables: CIVIL_SITE_DELIVERABLE_KINDS.map(kind => ({ id: `civil-${kind}`, kind, format: formats[kind] as never, contentSha256: h, byteLength: 100, sourceRevision: rev.id, generatedAt: now, verificationStatus: 'verified' as const })) });
}
function spatialMinimum(): SpatialDeliverableBinding {
  const commonModel = { revision: rev, modelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, drawingScheduleSha256: h, sourceStatus: 'AUTHORITATIVE' as const };
  return { schema: 'nexyfab.cad.spatial-deliverable-binding.v1', domain: 'civil', projectId: 'road-corridor', model: commonModel, deliverableManifestSha256: h, deliverables: ['landxml', 'drawing', 'quantity-schedule'].map(kind => ({ kind, contentSha256: h, sourceRevision: rev, sourceModelSha256: h, quantitySha256: h, drawingScheduleSha256: h, status: 'VERIFIED' as const })), exchange: { kind: 'landxml', contentSha256: h, sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' }, independentRoundTrip: { receiptSha256: h, exchangeContentSha256: h, sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' } };
}
function binding(): CivilSiteDeliverableBinding {
  const m = manifest();
  return { schema: 'nexyfab.cad.civil-site-deliverable-binding.v1', domain: 'civil', projectId: 'road-corridor', manifest: m, manifestSha256: hashCivilSiteDeliverableManifest(m), model, surveyAuthority: { sourceId: 'survey-control-001', sourceKind: 'SURVEY_TIN', sourceRevision: rev, surveyDataSha256: h, controlNetworkSha256: h, rightsReceiptSha256: h, capturedAt: now, reviewedAt: now, commercialUseAllowed: true, status: 'VERIFIED' }, spatialMinimum: spatialMinimum(), independentLandXmlRoundTrip: { receiptSha256: h, exchangeContentSha256: h, exchangeKind: 'landxml', sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, geometrySha256: h, semanticRoundTripSha256: h, geometryRoundTripSha256: h, quantityRoundTripSha256: h, independentValidatorId: 'landxml-validator-01', independent: true, status: 'VERIFIED' } };
}

describe('civil site deliverables', () => {
  it('requires the exact survey-to-construction package', () => {
    const b = binding();
    expect(validateCivilSiteDeliverableManifest(b.manifest).valid).toBe(true);
    const result = validateCivilSiteDeliverableBinding(b, { projectId: b.projectId, modelRevision: rev, modelSha256: h });
    expect(result).toMatchObject({ valid: true, status: 'VERIFIED' });
  });
  it.each([
    ['missing deliverable', (b: CivilSiteDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.slice(1) } })],
    ['stale deliverable', (b: CivilSiteDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.map(d => d.kind === 'landxml' ? { ...d, sourceRevision: 'old' } : d) } })],
    ['preview model', (b: CivilSiteDeliverableBinding) => ({ ...b, model: { ...b.model, sourceStatus: 'PREVIEW' as const } })],
    ['survey rights missing', (b: CivilSiteDeliverableBinding) => ({ ...b, surveyAuthority: { ...b.surveyAuthority, commercialUseAllowed: false as never } })],
    ['LandXML not run', (b: CivilSiteDeliverableBinding) => ({ ...b, independentLandXmlRoundTrip: { ...b.independentLandXmlRoundTrip, status: 'NOT_RUN' as const } })],
    ['LandXML substitution', (b: CivilSiteDeliverableBinding) => ({ ...b, independentLandXmlRoundTrip: { ...b.independentLandXmlRoundTrip, exchangeKind: 'ifc' as never } })],
    ['LandXML not independent', (b: CivilSiteDeliverableBinding) => ({ ...b, independentLandXmlRoundTrip: { ...b.independentLandXmlRoundTrip, independent: false as never } })],
    ['LandXML semantic proof missing', (b: CivilSiteDeliverableBinding) => ({ ...b, independentLandXmlRoundTrip: { ...b.independentLandXmlRoundTrip, semanticRoundTripSha256: 'bad' } })],
    ['quantity mismatch', (b: CivilSiteDeliverableBinding) => ({ ...b, independentLandXmlRoundTrip: { ...b.independentLandXmlRoundTrip, quantitySha256: 'b'.repeat(64) } })],
  ])('fails closed for %s', (_name, mutate) => expect(validateCivilSiteDeliverableBinding(mutate(binding())).valid).toBe(false));
  it('marks changed model or revision stale', () => {
    const b = binding();
    expect(validateCivilSiteDeliverableBinding(b, { modelSha256: 'b'.repeat(64) }).status).toBe('STALE');
    expect(validateCivilSiteDeliverableBinding(b, { modelRevision: { id: 'new', sha256: h } }).status).toBe('STALE');
  });
  it('rejects stale manifest revisions and survey review chronology', () => {
    const stale = binding(); stale.manifest.projectRevision = 'old'; stale.manifestSha256 = hashCivilSiteDeliverableManifest(stale.manifest);
    expect(validateCivilSiteDeliverableBinding(stale).valid).toBe(false);
    const chronology = binding(); chronology.surveyAuthority.reviewedAt = '2026-08-23T00:00:00.000Z';
    expect(validateCivilSiteDeliverableBinding(chronology).valid).toBe(false);
  });
  it('produces a deterministic binding hash after validation', () => {
    const first = validateCivilSiteDeliverableBinding(binding());
    const second = validateCivilSiteDeliverableBinding(binding());
    expect(first.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canonicalSha256).toBe(second.canonicalSha256);
    expect(hashSpatialDeliverableBinding(spatialMinimum())).toMatch(/^[a-f0-9]{64}$/);
  });
});
