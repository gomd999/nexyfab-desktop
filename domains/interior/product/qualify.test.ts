import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInteriorProductContract, type InteriorObject, type InteriorProductContract } from './contract';
import { qualifyInteriorProduct } from './qualify';

const h = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const revision = { id: 'interior-qualify-r1', sha256: h('host-revision') };
const hostId = 'host-qualify-1';
const provenance = { sourceId: 'original-interior', sourceRef: 'author://interior', contentSha256: h('object'), rightsReceiptSha256: h('rights'), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const };
function object(id: string, kind: InteriorObject['kind'], data: Record<string, unknown>): InteriorObject { return { id, kind, sourceRevision: revision, contentSha256: h({ id, kind, data }), provenance, hostRefs: [hostId], data }; }

function contract(): InteriorProductContract {
  const objects: InteriorObject[] = [
    object('space-work', 'space', { name: 'work area', polygon: [{ x: 300, y: 300 }, { x: 7700, y: 300 }, { x: 7700, y: 4300 }, { x: 300, y: 4300 }, { x: 300, y: 300 }] }),
    object('wall-south', 'wall', { start: { x: 0, y: 0 }, end: { x: 8000, y: 0 }, thickness: 180 }),
    object('door-entry', 'opening', { hostWallId: 'wall-south', width: 1000, sill: 0, head: 2100, center: { x: 4000, y: 0 }, swing: 'inward-left' }),
    object('ffe-desk', 'ffe-envelope', { spaceId: 'space-work', x: 1000, y: 1000, width: 2200, depth: 800, height: 750, quantity: 1 }),
    object('ceiling-work', 'ceiling', { spaceId: 'space-work', elevation: 2700, type: 'modular-plane' }),
    object('light-work', 'lighting', { ceilingId: 'ceiling-work', kind: 'linear', quantity: 2, photometricStatus: 'VERIFIED' }),
    object('mep-work', 'mep-zone', { spaceId: 'space-work', ceilingId: 'ceiling-work', zoneKind: 'supply-return', verificationStatus: 'VERIFIED' }),
    object('finish-work', 'finish-layer', { spaceId: 'space-work', floor: 'original-floor', wall: 'original-wall', ceiling: 'original-ceiling' }),
    object('millwork-work', 'millwork', { spaceId: 'space-work', kind: 'counter', x: 5000, y: 1000, width: 1200, depth: 600, height: 900, catalogStatus: 'APPROVED' }),
  ];
  return createInteriorProductContract({
    schema: 'nexyfab.interior.small-office-retail-fitout.v1', units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg' },
    requirements: { program: { sourceRevision: revision, contentSha256: h('program'), rightsReceiptSha256: h('program-rights'), authorityStatus: 'APPROVED', spaces: [{ spaceId: 'space-work', occupants: 8, areaTargetM2: 29.6 }] }, egress: { sourceRevision: revision, contentSha256: h('egress'), rightsReceiptSha256: h('egress-rights'), authorityStatus: 'APPROVED', maxTravelDistanceM: 10, minClearWidthMm: 900 }, clearances: { sourceRevision: revision, contentSha256: h('clearances'), rightsReceiptSha256: h('clearance-rights'), authorityStatus: 'APPROVED', minWorkingClearanceMm: 100, minCeilingClearanceMm: 300, minMepZoneHeightMm: 300 } },
    coordinateFrameSha256: h('frame'), hostBinding: { hostArtifactId: hostId, hostRevision: revision, hostContentSha256: h('host-content'), surveyed: true, rightsReceiptSha256: h('host-rights') }, objects, authoritative: true,
    identity: { id: 'qualify-interior', revision: revision.id },
  });
}

function authorityManifest(projectRevision = revision): import('../../../src/lib/cad/domainAuthorityManifest').DomainAuthorityManifest {
  return { schemaVersion: 'nexyfab.cad.domain-authority-manifest.v1', domain: 'interior', projectId: 'qualify-interior', projectRevision, sourceRevision: projectRevision, authorities: [{ id: 'client-authority', kind: 'client', sourceRef: 'client://authority', contentSha256: h('authority-content'), capturedAt: '2026-01-01T00:00:00Z', reviewedAt: '2026-01-01T00:00:00Z', status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: h('rights') } }] };
}

describe('interior product qualification', () => {
  it('derives room, finish, quantity, and drawing artifacts but stays HOLD for one synthetic case', () => {
    const result = qualifyInteriorProduct(contract(), { issuedAt: '2026-08-24T00:00:00.000Z' });
    expect(result.artifacts.roomSchedule).toHaveLength(1);
    expect(result.verification.currentRevisionVerified).toBe(false);
    expect(result.evaluation.status).toBe('HOLD');
    expect(result.evaluation.blockers).toEqual(expect.arrayContaining(['authority_manifest_not_run', 'deliverable_manifest_not_run', 'exchange_receipt_not_run', 'campaign_count_below_three', 'independent_review_count_below_two', 'pilot_count_below_three']));
    expect(result.receipt.claimedState).toBe('PRODUCT_QUALIFIED');
  });

  it('rejects a valid but stale authority manifest and cannot be spoofed by claim state', () => {
    expect(() => qualifyInteriorProduct(contract(), { claimedState: 'PRODUCT_QUALIFIED', authorityManifest: authorityManifest({ id: 'old-revision', sha256: h('old') }) })).toThrow('interior_authority_manifest_detached');
    const result = qualifyInteriorProduct(contract(), { claimedState: 'PRODUCT_QUALIFIED', issuedAt: '2026-08-24T00:00:00.000Z' });
    expect(result.receipt.claimedState).toBe('PRODUCT_QUALIFIED');
    expect(result.evaluation.status).toBe('HOLD');
    expect(result.evaluation.blockers).toContain('authority_manifest_not_run');
  });
});
