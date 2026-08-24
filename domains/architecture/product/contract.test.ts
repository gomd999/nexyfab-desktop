import { describe, expect, it } from 'vitest';
import {
  BUILDING_PRODUCT_CONTRACT_SCHEMA, createBuildingProductContract, hashBuildingProductContract,
  validateBuildingProductContract, type BuildingElementBase, type BuildingPoint,
} from './contract';

const h = (n: number) => n.toString(16).padStart(64, '0');
const revision = { id: 'building-r1', sha256: h(1) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: h(2), rightsReceiptSha256: h(3), origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const element = <T extends object>(id: string, data: T): T & BuildingElementBase => ({ id, sourceRevision: revision, contentSha256: h(id.length + 10), provenance: provenance(id), ...data });
const polygon = (width: number, depth: number): BuildingPoint[] => [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }, { x: 0, y: 0 }];
const authority = { sourceRevision: revision, contentSha256: h(20), rightsReceiptSha256: h(21), authorityStatus: 'APPROVED' as const };

function input() {
  const levels = [
    element('level-1', { name: 'ground', elevationMm: 0, heightMm: 3200 }),
    element('level-2', { name: 'upper', elevationMm: 3400, heightMm: 3000 }),
  ];
  const grids = [element('grid-x-a', { axis: 'X' as const, label: 'A', start: { x: 0, y: 0 }, end: { x: 12000, y: 0 } })];
  const spaces = [
    element('space-lobby', { levelId: 'level-1', name: 'public lobby', use: 'public', boundary: polygon(6000, 4000), areaM2: 24, heightMm: 3000 }),
    element('space-office', { levelId: 'level-2', name: 'office', use: 'office', boundary: polygon(6000, 4000), areaM2: 24, heightMm: 2800 }),
  ];
  const walls = [
    element('wall-exterior', { levelId: 'level-1', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3200 }),
    element('wall-core', { levelId: 'level-1', kind: 'CORE' as const, start: { x: 3000, y: 0 }, end: { x: 3000, y: 4000 }, thicknessMm: 200, heightMm: 3200 }),
    element('wall-upper', { levelId: 'level-2', kind: 'EXTERIOR' as const, start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thicknessMm: 200, heightMm: 3000 }),
  ];
  const slabs = [element('slab-ground', { levelId: 'level-1', kind: 'GROUND' as const, boundary: polygon(6000, 4000), thicknessMm: 250 }), element('slab-upper', { levelId: 'level-2', kind: 'FLOOR' as const, boundary: polygon(6000, 4000), thicknessMm: 220 })];
  const roof = element('roof-main', { levelId: 'level-2', boundary: polygon(6000, 4000), elevationMm: 6600, thicknessMm: 250 });
  const envelopeLayers = [element('envelope-wall', { hostId: 'wall-exterior', layerKind: 'INSULATION' as const, thicknessMm: 120, materialRef: 'client-material-insulation' })];
  const doors = [element('door-egress', { levelId: 'level-1', hostWallId: 'wall-exterior', center: { x: 3000, y: 0 }, widthMm: 1000, heightMm: 2100, sillMm: 0, swing: 'OUTWARD_LEFT' as const })];
  const windows = [element('window-office', { levelId: 'level-2', hostWallId: 'wall-upper', center: { x: 2200, y: 0 }, widthMm: 1500, heightMm: 1400, sillMm: 900 })];
  const stairs = [element('stair-core', { fromLevelId: 'level-1', toLevelId: 'level-2', widthMm: 1100, riserMm: 170, treadMm: 280, landingCount: 2 })];
  const egressRoutes = [element('egress-lobby', { levelId: 'level-1', fromSpaceId: 'space-lobby', exitDoorId: 'door-egress', path: [{ x: 1000, y: 1000 }, { x: 3000, y: 0 }] })];
  const serviceOpenings = [element('opening-mep', { levelId: 'level-2', hostId: 'slab-upper', discipline: 'MEP' as const, center: { x: 4500, y: 2200 }, widthMm: 500, heightMm: 300 })];
  return {
    schema: BUILDING_PRODUCT_CONTRACT_SCHEMA,
    identity: { projectId: 'small-commercial-core', revision },
    units: { length: 'mm' as const, area: 'm2' as const, volume: 'm3' as const, angle: 'deg' as const, force: 'kN' as const, pressure: 'kPa' as const },
    siteAuthority: { ...provenance('survey'), sourceRevision: revision, coordinateReferenceSystem: 'EPSG:AUTHORITY_INPUT', horizontalDatum: 'HORIZONTAL_DATUM_INPUT', verticalDatum: 'VERTICAL_DATUM_INPUT', epoch: '2026-01-01', projectNorthDeg: 0, siteBoundary: polygon(18000, 12000) },
    codeBasis: { ...authority, jurisdictionId: 'client-jurisdiction', codeBasis: 'client-provided-code-basis' },
    requirements: {
      program: { ...authority, spaces: [{ spaceId: 'space-lobby', occupancy: 8, areaTargetM2: 24, use: 'public' }, { spaceId: 'space-office', occupancy: 6, areaTargetM2: 24, use: 'office' }] },
      loads: { ...authority, floorLiveLoadKPa: [{ spaceId: 'space-lobby', valueKPa: 3 }, { spaceId: 'space-office', valueKPa: 2 }], roofLiveLoadKPa: 1, environmentalLoadKPa: 1 },
      accessibility: { ...authority, minClearWidthMm: 900, maxLevelChangeMm: 10, minTurningDiameterMm: 1500 },
      egress: { ...authority, maxTravelDistanceM: 30, minClearWidthMm: 900, maxDeadEndDistanceM: 10, exitsByLevel: [{ levelId: 'level-1', requiredCount: 1 }, { levelId: 'level-2', requiredCount: 1 }] },
    },
    levels, grids, spaces, walls, slabs, roof, envelopeLayers, doors, windows, stairs, egressRoutes, serviceOpenings,
    upstreams: [
      { discipline: 'STRUCTURAL' as const, artifactId: 'structural-model', artifactRevision: revision, artifactContentSha256: h(30), sourceRevision: revision, rightsReceiptSha256: h(31), authorityStatus: 'APPROVED' as const },
      { discipline: 'MEP' as const, artifactId: 'mep-model', artifactRevision: revision, artifactContentSha256: h(32), sourceRevision: revision, rightsReceiptSha256: h(33), authorityStatus: 'APPROVED' as const },
      { discipline: 'MECHANICAL' as const, artifactId: 'mechanical-model', artifactRevision: revision, artifactContentSha256: h(34), sourceRevision: revision, rightsReceiptSha256: h(35), authorityStatus: 'APPROVED' as const },
    ],
    relationships: [
      { id: 'rel-space-level', kind: 'LOCATED_ON' as const, fromId: 'space-lobby', toId: 'level-1', sourceRevision: revision },
      { id: 'rel-door-wall', kind: 'HOSTS' as const, fromId: 'wall-exterior', toId: 'door-egress', sourceRevision: revision },
      { id: 'rel-stair-level', kind: 'CONNECTS' as const, fromId: 'stair-core', toId: 'level-2', sourceRevision: revision },
    ],
    authoritative: true as const,
  };
}

describe('building product contract', () => {
  it('creates a strict, self-hashed two-storey building core contract', () => {
    const contract = createBuildingProductContract(input());
    expect(validateBuildingProductContract(contract)).toEqual([]);
    expect(contract.identity.contentSha256).toBe(hashBuildingProductContract(contract));
  });

  it('rejects preview, synthetic, AI-inferred and HOLD authority inputs', () => {
    const contract = createBuildingProductContract(input());
    const preview = structuredClone(contract); preview.siteAuthority.sourceRef = 'preview:site';
    expect(validateBuildingProductContract(preview)).toContain('siteAuthority.sourceRef');
    const synthetic = structuredClone(contract); synthetic.siteAuthority.sourceRef = 'synthetic:site';
    expect(validateBuildingProductContract(synthetic)).toContain('siteAuthority.sourceRef');
    const ai = structuredClone(contract); ai.codeBasis.codeBasis = 'ai:guessed-code';
    expect(validateBuildingProductContract(ai)).toContain('codeBasis.codeBasis');
    const hold = structuredClone(contract); (hold.requirements.egress as { authorityStatus: string }).authorityStatus = 'HOLD';
    expect(validateBuildingProductContract(hold)).toContain('requirements.egress:not_authoritative');
  });

  it('rejects dangling hosts, duplicate IDs, invalid polygons, and revision drift', () => {
    const contract = createBuildingProductContract(input());
    const dangling = structuredClone(contract); dangling.doors[0]!.hostWallId = 'missing-wall';
    expect(validateBuildingProductContract(dangling)).toContain('doors[0].hostWallId:dangling');
    const duplicate = structuredClone(contract); duplicate.windows[0]!.id = duplicate.doors[0]!.id;
    expect(validateBuildingProductContract(duplicate)).toContain('windows[0].id:duplicate');
    const invalid = structuredClone(contract); invalid.spaces[0]!.boundary = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 0 }];
    expect(validateBuildingProductContract(invalid)).toContain('spaces[0].boundary:zero_area');
    const drift = structuredClone(contract); drift.walls[0]!.sourceRevision = { id: 'building-r2', sha256: h(9) };
    expect(validateBuildingProductContract(drift)).toContain('walls[0].sourceRevision:mismatch');
  });

  it('requires all three authoritative upstream disciplines and connected requirement references', () => {
    const contract = createBuildingProductContract(input());
    const missing = structuredClone(contract); missing.upstreams = missing.upstreams.filter(item => item.discipline !== 'MEP');
    expect(validateBuildingProductContract(missing)).toContain('upstreams:required:MEP');
    const ref = structuredClone(contract); ref.requirements.program.spaces[0]!.spaceId = 'missing-space';
    expect(validateBuildingProductContract(ref)).toContain('requirements.program.spaces[0].spaceId:dangling');
    const drift = structuredClone(contract); drift.upstreams[0]!.artifactRevision = { id: 'other', sha256: h(99) };
    expect(validateBuildingProductContract(drift)).toEqual(expect.arrayContaining(['identity.contentSha256:mismatch']));
  });

  it('requires non-degenerate grids and walls plus windows and coordinated service openings', () => {
    const contract = createBuildingProductContract(input());
    const zeroWall = structuredClone(contract); zeroWall.walls[0]!.end = { ...zeroWall.walls[0]!.start };
    expect(validateBuildingProductContract(zeroWall)).toContain('walls[0]:zero_length');
    const noWindows = structuredClone(contract); noWindows.windows = [];
    expect(validateBuildingProductContract(noWindows)).toContain('windows:required');
    const noOpenings = structuredClone(contract); noOpenings.serviceOpenings = [];
    expect(validateBuildingProductContract(noOpenings)).toContain('serviceOpenings:required');
  });
});
