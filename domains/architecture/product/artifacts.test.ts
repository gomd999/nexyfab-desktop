import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBuildingProductContract, type BuildingPoint, type BuildingProductContract } from './contract';
import { generateBuildingNativeArtifacts, validateBuildingNativeArtifacts } from './artifacts';

const h = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const revision = { id: 'building-r1', sha256: h('revision') };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `author://${id}`, contentSha256: h(id), rightsReceiptSha256: h(`${id}-rights`), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const element = <T extends object>(id: string, data: T) => ({ id, sourceRevision: revision, contentSha256: h(id), provenance: provenance(id), ...data });
const poly = (width: number, depth: number): BuildingPoint[] => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }, { x: 0, y: 0 }];
const authority = { sourceRevision: revision, contentSha256: h('authority'), rightsReceiptSha256: h('authority-rights'), authorityStatus: 'APPROVED' as const };

function contract(): BuildingProductContract {
  const levels = [element('level-1', { name: 'ground', elevationMm: 0, heightMm: 3200 }), element('level-2', { name: 'upper', elevationMm: 3400, heightMm: 3000 })];
  const walls = [element('wall-1', { levelId: 'level-1', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3200 }), element('wall-2', { levelId: 'level-2', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3000 })];
  const spaces = [element('space-1', { levelId: 'level-1', name: 'lobby', use: 'public', boundary: poly(6000, 4000), areaM2: 24, heightMm: 3000 }), element('space-2', { levelId: 'level-2', name: 'office', use: 'office', boundary: poly(6000, 4000), areaM2: 24, heightMm: 2800 })];
  const slab = element('slab-1', { levelId: 'level-1', kind: 'GROUND' as const, boundary: poly(6000, 4000), thicknessMm: 250 });
  return createBuildingProductContract({
    schema: 'nexyfab.building.two-storey-small-commercial-core.v1', identity: { projectId: 'core-1', revision }, units: { length: 'mm', area: 'm2', volume: 'm3', angle: 'deg', force: 'kN', pressure: 'kPa' },
    siteAuthority: { ...provenance('site'), sourceRevision: revision, coordinateReferenceSystem: 'AUTHORITY_CRS', horizontalDatum: 'AUTHORITY_HORIZONTAL_DATUM', verticalDatum: 'AUTHORITY_VERTICAL_DATUM', epoch: '2026-01-01', projectNorthDeg: 0, siteBoundary: poly(18000, 12000) }, codeBasis: { ...authority, jurisdictionId: 'client-jurisdiction', codeBasis: 'client-provided-basis' },
    requirements: { program: { ...authority, spaces: [{ spaceId: 'space-1', occupancy: 8, areaTargetM2: 24, use: 'public' }, { spaceId: 'space-2', occupancy: 6, areaTargetM2: 24, use: 'office' }] }, loads: { ...authority, floorLiveLoadKPa: [{ spaceId: 'space-1', valueKPa: 3 }, { spaceId: 'space-2', valueKPa: 2 }], roofLiveLoadKPa: 1, environmentalLoadKPa: 1 }, accessibility: { ...authority, minClearWidthMm: 900, maxLevelChangeMm: 10, minTurningDiameterMm: 1500 }, egress: { ...authority, maxTravelDistanceM: 30, minClearWidthMm: 900, maxDeadEndDistanceM: 10, exitsByLevel: [{ levelId: 'level-1', requiredCount: 1 }, { levelId: 'level-2', requiredCount: 1 }] } },
    levels, grids: [element('grid-1', { axis: 'X' as const, label: 'A', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } })], spaces, walls, slabs: [slab, element('slab-2', { levelId: 'level-2', kind: 'FLOOR' as const, boundary: poly(6000, 4000), thicknessMm: 220 })], roof: element('roof-1', { levelId: 'level-2', boundary: poly(6000, 4000), elevationMm: 6600, thicknessMm: 250 }), envelopeLayers: [element('envelope-1', { hostId: 'wall-1', layerKind: 'INSULATION' as const, thicknessMm: 120, materialRef: 'client-material-insulation' })],
    doors: [element('door-1', { levelId: 'level-1', hostWallId: 'wall-1', center: { x: 3000, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const }), element('door-2', { levelId: 'level-2', hostWallId: 'wall-2', center: { x: 3000, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const })], windows: [element('window-1', { levelId: 'level-2', hostWallId: 'wall-2', center: { x: 2000, y: 0 }, widthMm: 1500, heightMm: 1400, sillMm: 900 })], stairs: [element('stair-1', { fromLevelId: 'level-1', toLevelId: 'level-2', widthMm: 1100, riserMm: 170, treadMm: 280, landingCount: 2 })], egressRoutes: [element('route-1', { levelId: 'level-1', fromSpaceId: 'space-1', exitDoorId: 'door-1', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 0 }] }), element('route-2', { levelId: 'level-2', fromSpaceId: 'space-2', exitDoorId: 'door-2', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 0 }] })], serviceOpenings: [element('service-1', { levelId: 'level-2', hostId: 'slab-2', discipline: 'MEP' as const, center: { x: 4000, y: 2000 }, widthMm: 500, heightMm: 300 })], upstreams: ['STRUCTURAL', 'MEP', 'MECHANICAL'].map((discipline, index) => ({ discipline: discipline as 'STRUCTURAL' | 'MEP' | 'MECHANICAL', artifactId: `${discipline.toLowerCase()}-model`, artifactRevision: revision, artifactContentSha256: h(index), sourceRevision: revision, rightsReceiptSha256: h(index + 10), authorityStatus: 'APPROVED' as const })), relationships: [{ id: 'rel-1', kind: 'LOCATED_ON' as const, fromId: 'space-1', toId: 'level-1', sourceRevision: revision }], authoritative: true,
  });
}

describe('building native artifacts', () => {
  it('derives deterministic schedules, quantities, and plan data', () => {
    const value = generateBuildingNativeArtifacts(contract());
    expect(value.sourceRevision).toEqual(revision);
    expect(value.spaceSchedule[0]).toMatchObject({ id: 'space-1', areaM2: 24, targetAreaM2: 24 });
    expect(value.openingSchedule).toHaveLength(3);
    expect(value.materialQuantitySchedule[0]?.materialRef).toBe('client-material-insulation');
    expect(value.materialQuantitySchedule[0]?.areaM2).toBeCloseTo(17.1);
    expect(value.materialQuantitySchedule[0]?.volumeM3).toBeCloseTo(2.052);
    expect(value.planSnapshot.walls[0]?.id).toBe('wall-1');
    expect(validateBuildingNativeArtifacts(value)).toEqual([]);
    expect(generateBuildingNativeArtifacts(contract()).contentSha256).toBe(value.contentSha256);
  });
  it('rejects stale bindings and invalid or duplicate source contracts', () => {
    const value = contract();
    expect(() => generateBuildingNativeArtifacts(value, { modelSha256: h('stale') })).toThrow('binding:model_sha256_stale');
    expect(() => generateBuildingNativeArtifacts({ ...value, walls: [...value.walls, value.walls[0]] })).toThrow('contract:');
    const invalid = structuredClone(value); (invalid.envelopeLayers[0] as { thicknessMm: number }).thicknessMm = -1;
    expect(() => generateBuildingNativeArtifacts(invalid)).toThrow('contract:');
  });
});
