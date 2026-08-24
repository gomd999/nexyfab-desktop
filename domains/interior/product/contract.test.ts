import { describe, expect, it } from 'vitest';
import {
  INTERIOR_PRODUCT_CONTRACT_SCHEMA, createInteriorProductContract, hashInteriorProductContract,
  validateInteriorProductContract, type InteriorObject,
} from './contract';

const h = (n: number) => n.toString(16).padStart(64, '0');
const revision = { id: 'r-1', sha256: h(1) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: h(2), rightsReceiptSha256: h(3), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const base = (id: string, kind: InteriorObject['kind'], data: Record<string, unknown>): InteriorObject => ({ id, kind, sourceRevision: revision, contentSha256: h(id.length + 4), provenance: provenance(id), hostRefs: ['host-1'], data });

function input() {
  const objects: InteriorObject[] = [
    base('space-1', 'space', { name: 'open work', polygon: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }, { x: 0, y: 0 }] }),
    base('wall-1', 'wall', { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 180 }),
    base('opening-1', 'opening', { hostWallId: 'wall-1', width: 900, sill: 0, head: 2100, center: { x: 3000, y: 0 }, swing: 'inward-left' }),
    base('ffe-1', 'ffe-envelope', { spaceId: 'space-1', x: 500, y: 500, width: 2000, depth: 800, height: 750, quantity: 2 }),
    base('ceiling-1', 'ceiling', { spaceId: 'space-1', elevation: 2700, type: 'coordination-plane' }),
    base('light-1', 'lighting', { ceilingId: 'ceiling-1', kind: 'linear', quantity: 4, photometricStatus: 'VERIFIED' }),
    base('mep-1', 'mep-zone', { spaceId: 'space-1', ceilingId: 'ceiling-1', zoneKind: 'supply-return-envelope', verificationStatus: 'VERIFIED' }),
    base('finish-1', 'finish-layer', { spaceId: 'space-1', floor: 'client-finish-a', wall: 'client-finish-b', ceiling: 'client-finish-c' }),
    base('millwork-1', 'millwork', { spaceId: 'space-1', kind: 'counter-envelope', x: 300, y: 300, width: 1800, depth: 600, height: 900, catalogStatus: 'APPROVED' }),
  ];
  const authority = { sourceRevision: revision, contentSha256: h(7), rightsReceiptSha256: h(8), authorityStatus: 'APPROVED' as const };
  return { schema: INTERIOR_PRODUCT_CONTRACT_SCHEMA, identity: { id: 'fitout-1', revision: revision.id }, units: { length: 'mm' as const, area: 'm2' as const, volume: 'm3' as const, angle: 'deg' as const }, requirements: { program: { ...authority, spaces: [{ spaceId: 'space-1', occupants: 8, areaTargetM2: 24 }] }, egress: { ...authority, maxTravelDistanceM: 30, minClearWidthMm: 900 }, clearances: { ...authority, minWorkingClearanceMm: 900, minCeilingClearanceMm: 2400, minMepZoneHeightMm: 300 } }, coordinateFrameSha256: h(4), hostBinding: { hostArtifactId: 'host-1', hostRevision: revision, hostContentSha256: h(5), surveyed: true as const, rightsReceiptSha256: h(6) }, objects, authoritative: true as const };
}

describe('interior product contract', () => {
  it('creates a self-hashed, strict small-office/retail fit-out contract', () => {
    const contract = createInteriorProductContract(input());
    expect(validateInteriorProductContract(contract)).toEqual([]);
    expect(contract.identity.contentSha256).toBe(hashInteriorProductContract(contract));
  });

  it('blocks preview, synthetic, catalog-unverified, host dangling, and open polygons', () => {
    const contract = createInteriorProductContract(input());
    const preview = structuredClone(contract); preview.objects[0]!.provenance.sourceRef = 'preview:generated';
    expect(validateInteriorProductContract(preview)).toContain('objects[0].provenance.sourceRef');
    const dangling = structuredClone(contract); dangling.objects[3]!.data.spaceId = 'missing-space';
    expect(validateInteriorProductContract(dangling)).toContain('objects:ffe-1:spaceId:dangling');
    const open = structuredClone(contract); (open.objects[0]!.data.polygon as Array<{ x: number; y: number }>).pop();
    expect(validateInteriorProductContract(open)).toContain('objects[0].data.polygon:not_closed');
    const unverified = structuredClone(contract); unverified.objects[8]!.data.catalogStatus = 'HOLD';
    expect(validateInteriorProductContract(unverified)).toContain('objects[8].data.catalogStatus');
  });

  it('rejects revision drift, duplicate IDs, and non-surveyed host', () => {
    const contract = createInteriorProductContract(input());
    const drift = structuredClone(contract); drift.objects[1]!.sourceRevision = { id: 'r-2', sha256: h(8) };
    expect(validateInteriorProductContract(drift)).toContain('objects[1].sourceRevision:mismatch');
    const sameIdHashDrift = structuredClone(contract); sameIdHashDrift.objects[1]!.sourceRevision = { id: revision.id, sha256: h(9) };
    expect(validateInteriorProductContract(sameIdHashDrift)).toContain('objects[1].sourceRevision:mismatch');
    const duplicate = structuredClone(contract); duplicate.objects[1]!.id = duplicate.objects[0]!.id;
    expect(validateInteriorProductContract(duplicate)).toContain('objects[1].id');
    const host = structuredClone(contract); (host.hostBinding as { surveyed: boolean }).surveyed = false;
    expect(validateInteriorProductContract(host)).toContain('hostBinding:surveyed_required');
  });

  it('requires governed program, egress, and clearance inputs', () => {
    const contract = createInteriorProductContract(input());
    const hold = structuredClone(contract); (hold.requirements.egress as { authorityStatus: string }).authorityStatus = 'HOLD';
    expect(validateInteriorProductContract(hold)).toContain('requirements.egress:not_authoritative');
    const dangling = structuredClone(contract); dangling.requirements.program.spaces[0]!.spaceId = 'missing-space';
    expect(validateInteriorProductContract(dangling)).toContain('requirements.program.spaces[0].spaceId:dangling');
  });
});
