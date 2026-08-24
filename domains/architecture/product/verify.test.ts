import { describe, expect, it } from 'vitest';
import { createBuildingProductContract, type BuildingPoint, type BuildingProductContract } from './contract';
import {
  BUILDING_CHECK_IDS, validateBuildingCheckReceipt, verifyBuildingProduct,
  type BuildingExternalEvidence,
} from './verify';

const h = (n: number) => n.toString(16).padStart(64, '0');
const revision = { id: 'building-r1', sha256: h(1) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: h(2), rightsReceiptSha256: h(3), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const element = <T extends object>(id: string, data: T) => ({ id, sourceRevision: revision, contentSha256: h(id.length + 10), provenance: provenance(id), ...data });
const poly = (width: number, depth: number): BuildingPoint[] => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }, { x: 0, y: 0 }];
const authority = { sourceRevision: revision, contentSha256: h(20), rightsReceiptSha256: h(21), authorityStatus: 'APPROVED' as const };

function validContract(): BuildingProductContract {
  const levels = [element('level-1', { name: 'ground', elevationMm: 0, heightMm: 3200 }), element('level-2', { name: 'upper', elevationMm: 3400, heightMm: 3000 })];
  const walls = [element('wall-exterior', { levelId: 'level-1', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3200 }), element('wall-upper', { levelId: 'level-2', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3000 })];
  const spaces = [element('space-lobby', { levelId: 'level-1', name: 'lobby', use: 'public', boundary: poly(6000, 4000), areaM2: 24, heightMm: 3000 }), element('space-office', { levelId: 'level-2', name: 'office', use: 'office', boundary: poly(6000, 4000), areaM2: 24, heightMm: 2800 })];
  const slab = element('slab-ground', { levelId: 'level-1', kind: 'GROUND' as const, boundary: poly(6000, 4000), thicknessMm: 250 });
  const upperSlab = element('slab-upper', { levelId: 'level-2', kind: 'FLOOR' as const, boundary: poly(6000, 4000), thicknessMm: 220 });
  return createBuildingProductContract({
    schema: 'nexyfab.building.two-storey-small-commercial-core.v1', identity: { projectId: 'small-core', revision },
    units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg', force: 'kN', pressure: 'kPa' },
    siteAuthority: { ...provenance('survey'), sourceRevision: revision, coordinateReferenceSystem: 'EPSG:AUTHORITY_INPUT', horizontalDatum: 'HORIZONTAL_DATUM_INPUT', verticalDatum: 'VERTICAL_DATUM_INPUT', epoch: '2026-01-01', projectNorthDeg: 0, siteBoundary: poly(18000, 12000) },
    codeBasis: { ...authority, jurisdictionId: 'client-jurisdiction', codeBasis: 'client-provided-code-basis' },
    requirements: { program: { ...authority, spaces: [{ spaceId: 'space-lobby', occupancy: 8, areaTargetM2: 24, use: 'public' }, { spaceId: 'space-office', occupancy: 6, areaTargetM2: 24, use: 'office' }] }, loads: { ...authority, floorLiveLoadKPa: [{ spaceId: 'space-lobby', valueKPa: 3 }, { spaceId: 'space-office', valueKPa: 2 }], roofLiveLoadKPa: 1, environmentalLoadKPa: 1 }, accessibility: { ...authority, minClearWidthMm: 900, maxLevelChangeMm: 10, minTurningDiameterMm: 1500 }, egress: { ...authority, maxTravelDistanceM: 30, minClearWidthMm: 900, maxDeadEndDistanceM: 10, exitsByLevel: [{ levelId: 'level-1', requiredCount: 1 }, { levelId: 'level-2', requiredCount: 1 }] } },
    levels, grids: [element('grid-x', { axis: 'X' as const, label: 'A', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } })], spaces, walls, slabs: [slab, upperSlab], roof: element('roof', { levelId: 'level-2', boundary: poly(6000, 4000), elevationMm: 6600, thicknessMm: 250 }),
    envelopeLayers: [element('envelope', { hostId: 'wall-exterior', layerKind: 'INSULATION' as const, thicknessMm: 120, materialRef: 'client-material-insulation' })],
    doors: [element('door', { levelId: 'level-1', hostWallId: 'wall-exterior', center: { x: 3000, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const }), element('door-upper', { levelId: 'level-2', hostWallId: 'wall-upper', center: { x: 4500, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const })],
    windows: [element('window', { levelId: 'level-2', hostWallId: 'wall-upper', center: { x: 2200, y: 0 }, widthMm: 1500, heightMm: 1400, sillMm: 900 })],
    stairs: [element('stair', { fromLevelId: 'level-1', toLevelId: 'level-2', widthMm: 1100, riserMm: 170, treadMm: 280, landingCount: 2 })],
    egressRoutes: [element('route', { levelId: 'level-1', fromSpaceId: 'space-lobby', exitDoorId: 'door', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 0 }] }), element('route-upper', { levelId: 'level-2', fromSpaceId: 'space-office', exitDoorId: 'door-upper', path: [{ x: 1000, y: 1000 }, { x: 4500, y: 0 }] })],
    serviceOpenings: [element('service-opening', { levelId: 'level-2', hostId: 'slab-upper', discipline: 'MEP' as const, center: { x: 4000, y: 2000 }, widthMm: 500, heightMm: 300 })],
    upstreams: ['STRUCTURAL', 'MEP', 'MECHANICAL'].map((discipline, i) => ({ discipline: discipline as 'STRUCTURAL' | 'MEP' | 'MECHANICAL', artifactId: `${discipline.toLowerCase()}-model`, artifactRevision: revision, artifactContentSha256: h(30 + i), sourceRevision: revision, rightsReceiptSha256: h(40 + i), authorityStatus: 'APPROVED' as const })),
    relationships: [{ id: 'rel-space', kind: 'LOCATED_ON' as const, fromId: 'space-lobby', toId: 'level-1', sourceRevision: revision }, { id: 'rel-door', kind: 'HOSTS' as const, fromId: 'wall-exterior', toId: 'door', sourceRevision: revision }], authoritative: true,
  });
}

function completeEvidence(contract: BuildingProductContract): Partial<Record<(typeof BUILDING_CHECK_IDS)[number], BuildingExternalEvidence>> {
  const external = BUILDING_CHECK_IDS.filter(id => ['surveyed-host', 'envelope-continuity', 'upstream-coordination', 'drawing-schedule-quantity-consistency', 'ifc-roundtrip', 'code-authority', 'independent-review'].includes(id));
  const coordinateAuthoritySha256 = verifyBuildingProduct(contract).coordinateAuthoritySha256!;
  return Object.fromEntries(external.map(checkId => [checkId, { status: 'PASS', sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256, resultSha256: h(checkId.length + 50), validatorId: 'independent.building', validatorVersion: 'v1', reviewerId: 'reviewer-1', reason: '' }])) as Partial<Record<(typeof BUILDING_CHECK_IDS)[number], BuildingExternalEvidence>>;
}

describe('building product verification', () => {
  it('keeps missing external authority HOLD while deterministic gates run', () => {
    const result = verifyBuildingProduct(validContract());
    expect(result.status).toBe('HOLD');
    expect(result.receipts.find(r => r.checkId === 'space-closure')?.status).toBe('PASS');
    expect(result.receipts.find(r => r.checkId === 'surveyed-host')?.status).toBe('NOT_RUN');
    expect(result.productReceiptPromotionReady).toBe(false);
  });
  it('accepts a fully bound evidence set only for the current revision', () => {
    const contract = validContract();
    const result = verifyBuildingProduct(contract, { externalEvidence: completeEvidence(contract) });
    expect(result.status).toBe('PASS');
    expect(result.currentRevisionVerified).toBe(true);
    expect(result.receipts.every(receipt => validateBuildingCheckReceipt(receipt).length === 0)).toBe(true);
  });
  it('marks stale revision/model/coordinate evidence STALE', () => {
    const contract = validContract();
    const evidence = completeEvidence(contract);
    evidence['ifc-roundtrip'] = { ...evidence['ifc-roundtrip']!, sourceRevision: { id: 'old', sha256: h(99) } };
    const result = verifyBuildingProduct(contract, { externalEvidence: evidence });
    expect(result.receipts.find(r => r.checkId === 'ifc-roundtrip')?.status).toBe('STALE');
    expect(result.blockers.some(b => b.startsWith('check_stale:ifc-roundtrip'))).toBe(true);
  });
  it('does not let external PASS override an internal opening failure', () => {
    const contract = validContract();
    const broken = createBuildingProductContract({ ...contract, identity: { projectId: contract.identity.projectId, revision: contract.identity.revision }, doors: contract.doors.map(door => ({ ...door, center: { x: 200, y: 0 } })) });
    const result = verifyBuildingProduct(broken, { externalEvidence: completeEvidence(broken) });
    expect(result.receipts.find(r => r.checkId === 'opening-integrity')?.status).toBe('FAIL');
    expect(result.status).toBe('FAIL');
  });
  it('holds malformed external evidence instead of fabricating verification', () => {
    const contract = validContract();
    const evidence = completeEvidence(contract);
    evidence['ifc-roundtrip'] = { ...evidence['ifc-roundtrip']!, validatorId: '' };
    const result = verifyBuildingProduct(contract, { externalEvidence: evidence });
    expect(result.receipts.find(r => r.checkId === 'ifc-roundtrip')).toMatchObject({ status: 'HOLD', reason: 'ifc-roundtrip_evidence_invalid' });
    expect(result.currentRevisionVerified).toBe(false);
  });
  it('requires each route to terminate at its bound door and counts unique exits per level', () => {
    const contract = validContract();
    const detached = createBuildingProductContract({
      ...contract,
      identity: { projectId: contract.identity.projectId, revision: contract.identity.revision },
      egressRoutes: contract.egressRoutes.map((route, index) => index === 0 ? { ...route, path: [route.path[0]!, { x: 100, y: 100 }] } : route),
    });
    const result = verifyBuildingProduct(detached, { externalEvidence: completeEvidence(detached) });
    expect(result.receipts.find(receipt => receipt.checkId === 'stairs-egress-accessibility')).toMatchObject({ status: 'FAIL', reason: 'egress_route_binding:route' });
  });
});
