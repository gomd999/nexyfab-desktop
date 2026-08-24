import { describe, expect, it } from 'vitest';
import { hashSpatialDeliverableBinding, type SpatialDeliverableBinding } from '../../../src/lib/cad/spatialDeliverableBinding';
import {
  createInteriorFitOutDeliverableManifest,
  INTERIOR_FIT_OUT_DELIVERABLE_KINDS,
  validateInteriorFitOutDeliverableBinding,
  validateInteriorFitOutDeliverableManifest,
  type InteriorFitOutDeliverableBinding,
} from './deliverables';

const h = 'a'.repeat(64);
const rev = { id: 'interior-rev-001', sha256: h } as const;
const now = '2026-08-24T00:00:00.000Z';
const model = { revision: rev, modelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, drawingScheduleSha256: h, sourceStatus: 'AUTHORITATIVE' as const };

const formats: Record<string, string> = {
  'native-interior-document': 'json', 'layout-plan': 'drawing', 'reflected-ceiling-plan': 'drawing', elevations: 'drawing',
  'millwork-details': 'drawing', 'finish-schedule': 'finish-schedule', 'ffe-schedule': 'schedule', boq: 'csv', ifc: 'ifc', 'coordination-report': 'pdf', 'verification-receipt': 'json',
};
function manifest() {
  return createInteriorFitOutDeliverableManifest({ projectRevision: rev.id, modelContentHash: h, generatedAt: now, deliverables: INTERIOR_FIT_OUT_DELIVERABLE_KINDS.map(kind => ({ id: `fit-${kind}`, kind, format: formats[kind] as never, contentSha256: h, byteLength: 100, sourceRevision: rev.id, generatedAt: now, verificationStatus: 'verified' as const })) });
}
function spatialMinimum(): SpatialDeliverableBinding {
  return {
    schema: 'nexyfab.cad.spatial-deliverable-binding.v1', domain: 'interior', projectId: 'office-fitout', model,
    deliverableManifestSha256: h,
    deliverables: ['space-model', 'drawing', 'finish-schedule'].map(kind => ({ kind, contentSha256: h, sourceRevision: rev, sourceModelSha256: h, quantitySha256: h, drawingScheduleSha256: h, status: 'VERIFIED' as const })),
    exchange: { kind: 'space-model', contentSha256: h, sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' },
    independentRoundTrip: { receiptSha256: h, exchangeContentSha256: h, sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED' },
  };
}
function binding(): InteriorFitOutDeliverableBinding {
  return {
    schema: 'nexyfab.cad.interior-fitout-deliverable-binding.v1', domain: 'interior', projectId: 'office-fitout', manifest: manifest(), model,
    spatialMinimum: spatialMinimum(),
    independentIfcRoundTrip: { receiptSha256: h, exchangeContentSha256: h, sourceRevision: rev, sourceModelSha256: h, semanticObjectGraphSha256: h, coordinateFrameSha256: h, quantitySha256: h, status: 'VERIFIED', exchangeKind: 'ifc' },
  };
}

describe('interior fit-out deliverables', () => {
  it('requires the exact product set and common spatial minimum', () => {
    const b = binding();
    expect(validateInteriorFitOutDeliverableManifest(b.manifest).valid).toBe(true);
    expect(validateInteriorFitOutDeliverableBinding(b, { projectId: b.projectId, modelRevision: rev, modelSha256: h })).toMatchObject({ valid: true, status: 'VERIFIED' });
  });
  it.each([
    ['missing deliverable', (b: InteriorFitOutDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.slice(1) } })],
    ['stale drawing', (b: InteriorFitOutDeliverableBinding) => ({ ...b, manifest: { ...b.manifest, deliverables: b.manifest.deliverables.map(d => d.kind === 'layout-plan' ? { ...d, sourceRevision: 'old' } : d) } })],
    ['preview model', (b: InteriorFitOutDeliverableBinding) => ({ ...b, model: { ...b.model, sourceStatus: 'PREVIEW' as const } })],
    ['IFC roundtrip not run', (b: InteriorFitOutDeliverableBinding) => ({ ...b, independentIfcRoundTrip: { ...b.independentIfcRoundTrip, status: 'NOT_RUN' as const } })],
    ['IFC substitution', (b: InteriorFitOutDeliverableBinding) => ({ ...b, independentIfcRoundTrip: { ...b.independentIfcRoundTrip, exchangeKind: 'space-model' as never } })],
  ])('fails closed for %s', (_name, mutate) => expect(validateInteriorFitOutDeliverableBinding(mutate(binding())).valid).toBe(false));
  it('marks changed model or revision stale', () => {
    const b = binding();
    expect(validateInteriorFitOutDeliverableBinding(b, { modelSha256: 'b'.repeat(64) }).status).toBe('STALE');
    expect(validateInteriorFitOutDeliverableBinding(b, { modelRevision: { id: 'new', sha256: h } }).status).toBe('STALE');
  });
  it('produces a canonical receipt hash only after validation', () => {
    const first = validateInteriorFitOutDeliverableBinding(binding());
    const second = validateInteriorFitOutDeliverableBinding(binding());
    expect(first.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.canonicalSha256).toBe(second.canonicalSha256);
    expect(hashSpatialDeliverableBinding(spatialMinimum())).toMatch(/^[a-f0-9]{64}$/);
  });
});
