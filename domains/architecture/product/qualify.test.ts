import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBuildingProductContract, type BuildingPoint, type BuildingProductContract } from './contract';
import { qualifyBuildingProduct } from './qualify';

const h = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const revision = { id: 'building-qualify-r1', sha256: h('revision') };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `author://${id}`, contentSha256: h(`${id}:content`), rightsReceiptSha256: h(`${id}:rights`), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const element = <T extends object>(id: string, data: T) => ({ id, sourceRevision: revision, contentSha256: h({ id, data }), provenance: provenance(id), ...data });
const poly = (width: number, depth: number): BuildingPoint[] => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }, { x: 0, y: 0 }];
const authority = { sourceRevision: revision, contentSha256: h('authority'), rightsReceiptSha256: h('authority-rights'), authorityStatus: 'APPROVED' as const };

function contract(): BuildingProductContract {
  const levels = [element('level-1', { name: 'ground', elevationMm: 0, heightMm: 3200 }), element('level-2', { name: 'upper', elevationMm: 3400, heightMm: 3000 })];
  const walls = [element('wall-1', { levelId: 'level-1', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3200 }), element('wall-2', { levelId: 'level-2', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3000 })];
  const spaces = [element('space-1', { levelId: 'level-1', name: 'lobby', use: 'public', boundary: poly(6000, 4000), areaM2: 24, heightMm: 3000 }), element('space-2', { levelId: 'level-2', name: 'office', use: 'office', boundary: poly(6000, 4000), areaM2: 24, heightMm: 2800 })];
  const slab1 = element('slab-1', { levelId: 'level-1', kind: 'GROUND' as const, boundary: poly(6000, 4000), thicknessMm: 250 });
  const slab2 = element('slab-2', { levelId: 'level-2', kind: 'FLOOR' as const, boundary: poly(6000, 4000), thicknessMm: 220 });
  return createBuildingProductContract({
    schema: 'nexyfab.building.two-storey-small-commercial-core.v1', identity: { projectId: 'qualify-building', revision },
    units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg', force: 'kN', pressure: 'kPa' },
    siteAuthority: { ...provenance('site'), sourceRevision: revision, coordinateReferenceSystem: 'EPSG:LOCAL', horizontalDatum: 'LOCAL', verticalDatum: 'LOCAL', epoch: '2026-01-01', projectNorthDeg: 0, siteBoundary: poly(18000, 12000) },
    codeBasis: { ...authority, jurisdictionId: 'client', codeBasis: 'client-code-basis' },
    requirements: { program: { ...authority, spaces: [{ spaceId: 'space-1', occupancy: 8, areaTargetM2: 24, use: 'public' }, { spaceId: 'space-2', occupancy: 6, areaTargetM2: 24, use: 'office' }] }, loads: { ...authority, floorLiveLoadKPa: [{ spaceId: 'space-1', valueKPa: 3 }, { spaceId: 'space-2', valueKPa: 2 }], roofLiveLoadKPa: 1, environmentalLoadKPa: 1 }, accessibility: { ...authority, minClearWidthMm: 900, maxLevelChangeMm: 10, minTurningDiameterMm: 1500 }, egress: { ...authority, maxTravelDistanceM: 30, minClearWidthMm: 900, maxDeadEndDistanceM: 10, exitsByLevel: [{ levelId: 'level-1', requiredCount: 1 }, { levelId: 'level-2', requiredCount: 1 }] } },
    levels, grids: [element('grid-1', { axis: 'X' as const, label: 'A', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } })], spaces, walls, slabs: [slab1, slab2], roof: element('roof', { levelId: 'level-2', boundary: poly(6000, 4000), elevationMm: 6600, thicknessMm: 250 }),
    envelopeLayers: [element('envelope-1', { hostId: 'wall-1', layerKind: 'INSULATION' as const, thicknessMm: 120, materialRef: 'client-insulation' })],
    doors: [element('door-1', { levelId: 'level-1', hostWallId: 'wall-1', center: { x: 3000, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const }), element('door-2', { levelId: 'level-2', hostWallId: 'wall-2', center: { x: 4500, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const })],
    windows: [element('window-1', { levelId: 'level-2', hostWallId: 'wall-2', center: { x: 2200, y: 0 }, widthMm: 1500, heightMm: 1400, sillMm: 900 })],
    stairs: [element('stair-1', { fromLevelId: 'level-1', toLevelId: 'level-2', widthMm: 1100, riserMm: 170, treadMm: 280, landingCount: 2 })],
    egressRoutes: [element('route-1', { levelId: 'level-1', fromSpaceId: 'space-1', exitDoorId: 'door-1', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 0 }] }), element('route-2', { levelId: 'level-2', fromSpaceId: 'space-2', exitDoorId: 'door-2', path: [{ x: 1000, y: 1000 }, { x: 4500, y: 0 }] })],
    serviceOpenings: [element('opening-1', { levelId: 'level-2', hostId: 'slab-2', discipline: 'MEP' as const, center: { x: 4000, y: 2000 }, widthMm: 500, heightMm: 300 })],
    upstreams: ['STRUCTURAL', 'MEP', 'MECHANICAL'].map((discipline, i) => ({ discipline: discipline as 'STRUCTURAL' | 'MEP' | 'MECHANICAL', artifactId: `${discipline.toLowerCase()}-model`, artifactRevision: revision, artifactContentSha256: h(i), sourceRevision: revision, rightsReceiptSha256: h(`upstream-${i}`), authorityStatus: 'APPROVED' as const })),
    relationships: [{ id: 'relationship-1', kind: 'LOCATED_ON' as const, fromId: 'space-1', toId: 'level-1', sourceRevision: revision }], authoritative: true,
  });
}

function authorityManifest(projectRevision = revision): import('../../../src/lib/cad/domainAuthorityManifest').DomainAuthorityManifest {
  return { schemaVersion: 'nexyfab.cad.domain-authority-manifest.v1', domain: 'building', projectId: 'qualify-building', projectRevision, sourceRevision: projectRevision, authorities: [{ id: 'client-authority', kind: 'client', sourceRef: 'client://authority', contentSha256: h('authority-content'), capturedAt: '2026-01-01T00:00:00Z', reviewedAt: '2026-01-01T00:00:00Z', status: 'APPROVED', rights: { status: 'APPROVED', receiptSha256: h('rights') } }] };
}

describe('building product qualification', () => {
  it('derives native artifacts and keeps a one-case synthetic revision HOLD', () => {
    const result = qualifyBuildingProduct(contract(), { issuedAt: '2026-08-24T00:00:00.000Z' });
    expect(result.artifacts.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.verification.currentRevisionVerified).toBe(false);
    expect(result.evaluation.status).toBe('HOLD');
    expect(result.evaluation.blockers).toEqual(expect.arrayContaining(['authority_manifest_not_run', 'deliverable_manifest_not_run', 'exchange_receipt_not_run', 'campaign_count_below_three', 'independent_review_count_below_two', 'pilot_count_below_three']));
    expect(result.receipt.claimedState).toBe('PRODUCT_QUALIFIED');
  });

  it('rejects a valid but detached authority manifest before common evaluation', () => {
    expect(() => qualifyBuildingProduct(contract(), { authorityManifest: authorityManifest({ id: 'old-revision', sha256: h('old') }) })).toThrow('building_authority_manifest_detached');
  });
});
