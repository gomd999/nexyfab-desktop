import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInteriorProductContract, type InteriorObject } from './contract';
import { generateInteriorNativeArtifacts, validateInteriorNativeArtifacts } from './artifacts';

const h = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const revision = { id: 'interior-r1', sha256: h('revision') };
const provenance = { sourceId: 'author-1', sourceRef: 'author://interior/1', contentSha256: h('object'), rightsReceiptSha256: h('rights'), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const };
const hostId = 'host-1';
const object = (id: string, kind: InteriorObject['kind'], data: Record<string, unknown>): InteriorObject => ({ id, kind, sourceRevision: revision, contentSha256: h({ id, kind, data }), provenance, hostRefs: [hostId], data });

function contract() {
  const objects: InteriorObject[] = [
    object('space-1', 'space', { name: 'work', polygon: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }, { x: 0, y: 0 }] }),
    object('wall-1', 'wall', { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 180 }),
    object('opening-1', 'opening', { hostWallId: 'wall-1', width: 900, sill: 0, head: 2100, center: { x: 3000, y: 0 }, swing: 'inward-left' }),
    object('ffe-1', 'ffe-envelope', { spaceId: 'space-1', x: 500, y: 500, width: 1200, depth: 700, height: 750, quantity: 2 }),
    object('ceiling-1', 'ceiling', { spaceId: 'space-1', elevation: 2700, type: 'plane' }),
    object('light-1', 'lighting', { ceilingId: 'ceiling-1', kind: 'linear', quantity: 2, photometricStatus: 'VERIFIED' }),
    object('mep-1', 'mep-zone', { spaceId: 'space-1', ceilingId: 'ceiling-1', zoneKind: 'coordination', verificationStatus: 'VERIFIED' }),
    object('finish-1', 'finish-layer', { spaceId: 'space-1', floor: 'original-floor', wall: 'original-wall', ceiling: 'original-ceiling' }),
    object('millwork-1', 'millwork', { spaceId: 'space-1', kind: 'counter', x: 3000, y: 500, width: 1500, depth: 600, height: 900, catalogStatus: 'APPROVED' }),
  ];
  return createInteriorProductContract({
    schema: 'nexyfab.interior.small-office-retail-fitout.v1', units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg' },
    requirements: { program: { sourceRevision: revision, contentSha256: h('program'), rightsReceiptSha256: h('rights-program'), authorityStatus: 'APPROVED', spaces: [{ spaceId: 'space-1', occupants: 8, areaTargetM2: 24 }] }, egress: { sourceRevision: revision, contentSha256: h('egress'), rightsReceiptSha256: h('rights-egress'), authorityStatus: 'APPROVED', maxTravelDistanceM: 30, minClearWidthMm: 900 }, clearances: { sourceRevision: revision, contentSha256: h('clearance'), rightsReceiptSha256: h('rights-clearance'), authorityStatus: 'APPROVED', minWorkingClearanceMm: 900, minCeilingClearanceMm: 2400, minMepZoneHeightMm: 300 } },
    coordinateFrameSha256: h('frame'), hostBinding: { hostArtifactId: hostId, hostRevision: revision, hostContentSha256: h('host'), surveyed: true, rightsReceiptSha256: h('host-rights') }, objects, authoritative: true, identity: { id: 'fitout-1', revision: revision.id },
  });
}

describe('interior native artifacts', () => {
  it('derives deterministic schedules and drawing data bound to the contract', () => {
    const value = generateInteriorNativeArtifacts(contract());
    expect(value.sourceRevision).toEqual(revision);
    expect(value.modelSha256).toBe(contract().identity.contentSha256);
    expect(value.roomSchedule[0]).toMatchObject({ id: 'space-1', areaM2: 24, occupants: 8 });
    expect(value.ffeSchedule[0]).toMatchObject({ quantity: 2, footprintM2: 0.84 });
    expect(value.finishSchedule[0]?.areaM2).toBe(24);
    expect(value.drawingSnapshot.openings[0]?.hostWallId).toBe('wall-1');
    expect(validateInteriorNativeArtifacts(value)).toEqual([]);
    expect(generateInteriorNativeArtifacts(contract()).contentSha256).toBe(value.contentSha256);
  });
  it('rejects stale expected bindings and malformed or duplicate contracts', () => {
    const value = contract();
    expect(() => generateInteriorNativeArtifacts(value, { modelSha256: h('stale') })).toThrow('binding:model_sha256_stale');
    const duplicate = { ...value, objects: [...value.objects, value.objects[0]] };
    expect(() => generateInteriorNativeArtifacts(duplicate)).toThrow('contract:');
    const invalid = structuredClone(value); (invalid.objects[3]!.data as Record<string, unknown>).width = -1;
    expect(() => generateInteriorNativeArtifacts(invalid)).toThrow('contract:');
  });

  it('supports valid project coordinates on either side of the local origin', () => {
    const value = contract();
    const shifted = createInteriorProductContract({
      ...value,
      identity: { id: value.identity.id, revision: value.identity.revision },
      objects: value.objects.map(item => item.kind !== 'space' ? item : {
        ...item,
        data: { ...item.data, polygon: (item.data.polygon as Array<{ x: number; y: number }>).map(point => ({ x: point.x - 1_000, y: point.y - 1_000 })) },
      }),
    });
    expect(generateInteriorNativeArtifacts(shifted).roomSchedule[0]?.areaM2).toBe(24);
  });
});
