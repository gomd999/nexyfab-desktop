import { describe, expect, it } from 'vitest';
import { hashSpatialDeliverableBinding, validateSpatialDeliverableBinding, type SpatialDeliverableBinding } from './spatialDeliverableBinding';

const h = (n: number) => n.toString(16).padStart(64, '0');
function sample(domain: 'building' | 'civil' | 'landscape' | 'interior' = 'building'): SpatialDeliverableBinding {
  const revision = { id: 'r1', sha256: h(1) };
  const model = { revision, modelSha256: h(2), semanticObjectGraphSha256: h(3), coordinateFrameSha256: h(4), quantitySha256: h(5), drawingScheduleSha256: h(6), sourceStatus: 'AUTHORITATIVE' as const };
  const required = { building: ['ifc', 'drawing', 'schedule'], civil: ['landxml', 'drawing', 'quantity-schedule'], landscape: ['site-model', 'planting-plan', 'irrigation-plan'], interior: ['space-model', 'drawing', 'finish-schedule'] }[domain];
  const deliverables = required.map(kind => ({ kind, contentSha256: h(kind.length + 10), sourceRevision: revision, sourceModelSha256: model.modelSha256, quantitySha256: model.quantitySha256, drawingScheduleSha256: model.drawingScheduleSha256, status: 'VERIFIED' as const }));
  const exchange = { kind: { building: 'ifc', civil: 'landxml', landscape: 'site-model', interior: 'space-model' }[domain], contentSha256: h(20), sourceRevision: revision, sourceModelSha256: model.modelSha256, semanticObjectGraphSha256: model.semanticObjectGraphSha256, coordinateFrameSha256: model.coordinateFrameSha256, quantitySha256: model.quantitySha256, status: 'VERIFIED' as const };
  return { schema: 'nexyfab.cad.spatial-deliverable-binding.v1', domain, projectId: 'p1', model, deliverableManifestSha256: h(30), deliverables, exchange, independentRoundTrip: { receiptSha256: h(31), exchangeContentSha256: exchange.contentSha256, sourceRevision: revision, sourceModelSha256: model.modelSha256, semanticObjectGraphSha256: model.semanticObjectGraphSha256, coordinateFrameSha256: model.coordinateFrameSha256, quantitySha256: model.quantitySha256, status: 'VERIFIED' } };
}

describe('spatial deliverable binding', () => {
  it('accepts a complete authoritative building binding and canonical hash is stable', () => {
    const value = sample();
    const result = validateSpatialDeliverableBinding(value);
    expect(result).toMatchObject({ valid: true, status: 'VERIFIED', errors: [] });
    expect(result.canonicalSha256).toBe(hashSpatialDeliverableBinding(value));
  });
  it('fixes required kinds by domain and rejects missing or preview sources', () => {
    const value = sample('civil');
    value.deliverables.pop();
    expect(validateSpatialDeliverableBinding(value).status).toBe('HOLD');
    const preview = sample('interior');
    preview.model.sourceStatus = 'PREVIEW';
    expect(validateSpatialDeliverableBinding(preview).errors).toContain('model.source_preview_blocker');
  });
  it('blocks stale revisions and quantity/coordinate mismatches', () => {
    const value = sample();
    value.exchange.coordinateFrameSha256 = h(99);
    value.deliverables[0].quantitySha256 = h(98);
    value.independentRoundTrip.sourceRevision = { id: 'old', sha256: h(97) };
    expect(validateSpatialDeliverableBinding(value).status).toBe('STALE');
    expect(validateSpatialDeliverableBinding(value).errors).toEqual(expect.arrayContaining(['exchange.coordinate_frame_mismatch', 'deliverables[0].quantity_hash_mismatch', 'roundtrip.revision_stale']));
  });
  it('rejects NOT_RUN, HOLD, FAIL and unknown keys', () => {
    const value = sample();
    value.independentRoundTrip.status = 'NOT_RUN';
    expect(validateSpatialDeliverableBinding(value).status).toBe('HOLD');
    const unknown = sample() as unknown as Record<string, unknown>;
    (unknown.exchange as Record<string, unknown>).unexpected = true;
    expect(validateSpatialDeliverableBinding(unknown).errors).toContain('exchange:keys_invalid');
  });
});
