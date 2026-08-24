import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInteriorProductContract, type InteriorObject } from './contract';
import {
  INTERIOR_CHECK_IDS,
  INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA,
  validateInteriorCheckReceipt,
  verifyInteriorProduct,
  type InteriorExternalEvidence,
} from './verify';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const revision = { id: 'interior-revision-1', sha256: hash('host-revision-1') };
const provenance = { sourceId: 'source-original-1', sourceRef: 'author://interior/fitout/1', contentSha256: hash('object'), rightsReceiptSha256: hash('rights'), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const };
const hostId = 'host-office-1';

function object(id: string, kind: InteriorObject['kind'], data: Record<string, unknown>): InteriorObject {
  return { id, kind, sourceRevision: revision, contentSha256: hash({ id, kind, data }), provenance, hostRefs: [hostId], data };
}

function validContract() {
  const objects: InteriorObject[] = [
    object('space-work', 'space', { name: 'work area', polygon: [{ x: 300, y: 300 }, { x: 7700, y: 300 }, { x: 7700, y: 4300 }, { x: 300, y: 4300 }, { x: 300, y: 300 }] }),
    object('wall-south', 'wall', { start: { x: 0, y: 0 }, end: { x: 8000, y: 0 }, thickness: 180 }),
    object('door-entry', 'opening', { hostWallId: 'wall-south', width: 1000, sill: 0, head: 2100, center: { x: 4000, y: 0 }, swing: 'inward-left' }),
    object('ffe-desk', 'ffe-envelope', { spaceId: 'space-work', x: 1000, y: 1000, width: 2200, depth: 800, height: 750, quantity: 1 }),
    object('ceiling-work', 'ceiling', { spaceId: 'space-work', elevation: 2700, type: 'modular-plane' }),
    object('light-work', 'lighting', { ceilingId: 'ceiling-work', kind: 'linear', quantity: 2, photometricStatus: 'VERIFIED' }),
    object('mep-work', 'mep-zone', { spaceId: 'space-work', ceilingId: 'ceiling-work', zoneKind: 'supply-return', verificationStatus: 'VERIFIED' }),
    object('finish-work', 'finish-layer', { spaceId: 'space-work', floor: 'finish-original-floor', wall: 'finish-original-wall', ceiling: 'finish-original-ceiling' }),
    object('millwork-work', 'millwork', { spaceId: 'space-work', kind: 'counter', x: 5000, y: 1000, width: 1200, depth: 600, height: 900, catalogStatus: 'APPROVED' }),
  ];
  return createInteriorProductContract({
    schema: 'nexyfab.interior.small-office-retail-fitout.v1',
    units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg' },
    requirements: {
      program: { sourceRevision: revision, contentSha256: hash('program'), rightsReceiptSha256: hash('program-rights'), authorityStatus: 'APPROVED', spaces: [{ spaceId: 'space-work', occupants: 8, areaTargetM2: 42 }] },
      egress: { sourceRevision: revision, contentSha256: hash('egress'), rightsReceiptSha256: hash('egress-rights'), authorityStatus: 'APPROVED', maxTravelDistanceM: 10, minClearWidthMm: 900 },
      clearances: { sourceRevision: revision, contentSha256: hash('clearances'), rightsReceiptSha256: hash('clearance-rights'), authorityStatus: 'APPROVED', minWorkingClearanceMm: 100, minCeilingClearanceMm: 300, minMepZoneHeightMm: 300 },
    },
    coordinateFrameSha256: hash('local-frame-1'),
    hostBinding: { hostArtifactId: hostId, hostRevision: revision, hostContentSha256: hash('host-content'), surveyed: true, rightsReceiptSha256: hash('host-rights') },
    objects,
    authoritative: true,
    identity: { id: 'interior-fitout-1', revision: revision.id },
  });
}

function allExternalEvidence(contract: ReturnType<typeof validContract>, overrides: Partial<Record<string, Partial<InteriorExternalEvidence>>> = {}): Partial<Record<typeof INTERIOR_CHECK_IDS[number], InteriorExternalEvidence>> {
  return Object.fromEntries(INTERIOR_CHECK_IDS.map(checkId => [checkId, {
    status: 'PASS', sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256,
    coordinateFrameSha256: contract.coordinateFrameSha256, resultSha256: hash(`${checkId}:reviewed`),
    validatorId: 'independent.interior', validatorVersion: 'v1', reviewerId: 'reviewer-1', toleranceMm: 1, reason: '',
    ...overrides[checkId],
  }])) as Partial<Record<typeof INTERIOR_CHECK_IDS[number], InteriorExternalEvidence>>;
}

const egress = {
  nodes: [{ id: 'origin', point: { x: 2000, y: 2000 }, kind: 'origin' as const }, { id: 'exit', point: { x: 0, y: 0 }, kind: 'exit' as const }],
  edges: [{ id: 'route', from: 'origin', to: 'exit', clearWidthMm: 1200 }], originNodeIds: ['origin'], exitNodeIds: ['exit'], maximumTravelDistanceMm: 10000, minimumClearWidthMm: 900, minimumIndependentExits: 1,
};

describe('interior product verification', () => {
  it('passes deterministic geometry only while external gates remain HOLD/NOT_RUN', () => {
    const contract = validContract();
    const result = verifyInteriorProduct(contract, {
      minimumFfeClearanceMm: 100,
      egressInput: egress,
      doorSwingInput: { pivot: { x: 3500, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 1000, thicknessMm: 45, requiredClearanceMm: 50, obstacles: [] },
    });
    expect(result.status).toBe('HOLD');
    expect(result.currentRevisionVerified).toBe(false);
    expect(result.receipts.find(receipt => receipt.checkId === 'space-closure')?.status).toBe('PASS');
    expect(result.receipts.find(receipt => receipt.checkId === 'circulation-egress-accessibility')?.status).toBe('PASS');
    expect(result.receipts.find(receipt => receipt.checkId === 'surveyed-host')?.status).toBe('NOT_RUN');
    expect(result.blockers.some(blocker => blocker.includes('ifc-roundtrip'))).toBe(true);
    expect(result.productReceiptPromotionReady).toBe(false);
  });

  it('accepts a complete external evidence set only when every receipt is bound to the current revision and model', () => {
    const contract = validContract();
    const result = verifyInteriorProduct(contract, {
      minimumFfeClearanceMm: 100,
      egressInput: egress,
      doorSwingInput: { pivot: { x: 3500, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 1000, thicknessMm: 45, requiredClearanceMm: 50, obstacles: [] },
      externalEvidence: allExternalEvidence(contract),
    });
    expect(result.status).toBe('PASS');
    expect(result.currentRevisionVerified).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.receipts.every(receipt => validateInteriorCheckReceipt(receipt).length === 0)).toBe(true);
  });

  it('downgrades mismatched evidence to STALE instead of allowing a false PASS', () => {
    const contract = validContract();
    const evidence = allExternalEvidence(contract, { 'ifc-roundtrip': { sourceRevision: 'old-revision' } });
    const result = verifyInteriorProduct(contract, { minimumFfeClearanceMm: 100, egressInput: egress, externalEvidence: evidence });
    const receipt = result.receipts.find(item => item.checkId === 'ifc-roundtrip');
    expect(receipt?.status).toBe('STALE');
    expect(result.blockers.some(blocker => blocker.startsWith('check_stale:ifc-roundtrip'))).toBe(true);
  });

  it('rejects malformed receipt metadata and requires a reviewer for PASS', () => {
    const contract = validContract();
    const result = verifyInteriorProduct(contract, { externalEvidence: allExternalEvidence(contract, { 'code-authority': { reviewerId: 'none' } }) });
    const receipt = result.receipts.find(item => item.checkId === 'code-authority')!;
    expect(receipt.schema).toBe(INTERIOR_PRODUCT_CHECK_RECEIPT_SCHEMA);
    expect(receipt.status).toBe('STALE');
    expect(validateInteriorCheckReceipt({ ...receipt, modelSha256: 'bad' })).toContain('receipt:model_hash_invalid');
  });

  it('does not allow external PASS evidence to override a deterministic door-swing failure', () => {
    const contract = validContract();
    const result = verifyInteriorProduct(contract, {
      minimumFfeClearanceMm: 1,
      egressInput: egress,
      doorSwingInput: {
        pivot: { x: 3500, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90,
        widthMm: 1000, thicknessMm: 45, obstacles: [{ id: 'blocked', polygon: [{ x: 3600, y: 0 }, { x: 3700, y: 0 }, { x: 3700, y: 100 }, { x: 3600, y: 100 }] }],
      },
      externalEvidence: allExternalEvidence(contract),
    });
    expect(result.receipts.find(receipt => receipt.checkId === 'door-swing')?.status).toBe('FAIL');
    expect(result.status).toBe('FAIL');
  });

  it('holds malformed external PASS evidence instead of counting it as verification', () => {
    const contract = validContract();
    const evidence = allExternalEvidence(contract);
    evidence['ifc-roundtrip'] = { ...evidence['ifc-roundtrip']!, validatorId: '' };
    const result = verifyInteriorProduct(contract, { egressInput: egress, externalEvidence: evidence });
    expect(result.receipts.find(receipt => receipt.checkId === 'ifc-roundtrip')).toMatchObject({ status: 'HOLD', reason: 'ifc-roundtrip_evidence_invalid' });
    expect(result.currentRevisionVerified).toBe(false);
  });
});
