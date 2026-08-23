import { describe, expect, it } from 'vitest';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';
import { architectureCirculationObstacleEnvelopeHash, verifyArchitectureDoorCirculation, type ArchitectureAccessibleRoute, type ArchitectureCirculationObstacle } from './architectureDoorCirculationVerifier';

const architecture = (): ArchitectureDocument => ({
  schema: 'nexyfab.architecture.v1', revision: 4,
  storeys: [{ id: 'storey:0', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
  walls: [
    { id: 'wall:a-bottom', kind: 'line', storeyId: 'storey:0', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:a-divider', kind: 'line', storeyId: 'storey:0', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:a-top', kind: 'line', storeyId: 'storey:0', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:a-left', kind: 'line', storeyId: 'storey:0', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:b-bottom', kind: 'line', storeyId: 'storey:0', startMm: [4000, 0], endMm: [8000, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:b-right', kind: 'line', storeyId: 'storey:0', startMm: [8000, 0], endMm: [8000, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall:b-top', kind: 'line', storeyId: 'storey:0', startMm: [8000, 3000], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
  ],
  spaces: [
    { id: 'space:a', storeyId: 'storey:0', name: 'A', usage: 'room', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall:a-bottom', 'wall:a-divider', 'wall:a-top', 'wall:a-left'], slabId: 'slab:a', ceilingId: 'ceiling:a' },
    { id: 'space:b', storeyId: 'storey:0', name: 'B', usage: 'room', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000], [4000, 3000]], wallIds: ['wall:b-bottom', 'wall:b-right', 'wall:b-top', 'wall:a-divider'], slabId: 'slab:b', ceilingId: 'ceiling:b' },
  ],
  slabs: [
    { id: 'slab:a', storeyId: 'storey:0', spaceId: 'space:a', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 200 },
    { id: 'slab:b', storeyId: 'storey:0', spaceId: 'space:b', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000], [4000, 3000]], thicknessMm: 200 },
  ],
  ceilings: [
    { id: 'ceiling:a', storeyId: 'storey:0', spaceId: 'space:a', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 3000 },
    { id: 'ceiling:b', storeyId: 'storey:0', spaceId: 'space:b', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000], [4000, 3000]], elevationMm: 3000 },
  ],
  openings: [{ id: 'door:ab', kind: 'door', hostWallId: 'wall:a-divider', offsetMm: 1200, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [4000, 1200, 0], connectsSpaceIds: ['space:a', 'space:b'], doorOperation: { pivotMm: [4000, 1200], closedAngleDeg: 90, openAngleDeg: 180, leafThicknessMm: 45 } }],
});

const route = (): ArchitectureAccessibleRoute => ({ id: 'route:ab', storeyId: 'storey:0', spaceIds: ['space:a', 'space:b'], doorIds: ['door:ab'], pathMm: [[1000, 1500], [7000, 1500]], sourceArchitectureRevision: 4, clearWidthMm: 1000, clearHeightMm: 2200 });
const rules = { minimumDoorClearWidthMm: 850, minimumAccessibleRouteWidthMm: 900, minimumAccessibleRouteHeightMm: 2000, sampleStepMm: 100 };

const multiArchitecture = (): ArchitectureDocument => {
  const value = architecture();
  value.walls.push({ id: 'wall:b-divider', kind: 'line', storeyId: 'storey:0', startMm: [6000, 0], endMm: [6000, 3000], thicknessMm: 200, heightMm: 3000 });
  value.spaces[1] = { ...value.spaces[1]!, boundaryMm: [[4000, 0], [6000, 0], [6000, 3000], [4000, 3000]], wallIds: ['wall:a-divider', 'wall:b-divider', 'wall:b-top', 'wall:b-bottom'] };
  value.slabs[1] = { ...value.slabs[1]!, boundaryMm: [[4000, 0], [6000, 0], [6000, 3000], [4000, 3000]] };
  value.ceilings[1] = { ...value.ceilings[1]!, boundaryMm: [[4000, 0], [6000, 0], [6000, 3000], [4000, 3000]] };
  value.spaces.push({ id: 'space:c', storeyId: 'storey:0', name: 'C', usage: 'room', boundaryMm: [[6000, 0], [8000, 0], [8000, 3000], [6000, 3000]], wallIds: ['wall:b-divider', 'wall:b-right', 'wall:b-top', 'wall:b-bottom'], slabId: 'slab:c', ceilingId: 'ceiling:c' });
  value.slabs.push({ id: 'slab:c', storeyId: 'storey:0', spaceId: 'space:c', boundaryMm: [[6000, 0], [8000, 0], [8000, 3000], [6000, 3000]], thicknessMm: 200 });
  value.ceilings.push({ id: 'ceiling:c', storeyId: 'storey:0', spaceId: 'space:c', boundaryMm: [[6000, 0], [8000, 0], [8000, 3000], [6000, 3000]], elevationMm: 3000 });
  value.openings.push({ id: 'door:bc', kind: 'door', hostWallId: 'wall:b-divider', offsetMm: 1200, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [6000, 1200, 0], connectsSpaceIds: ['space:b', 'space:c'], doorOperation: { pivotMm: [6000, 1200], closedAngleDeg: 90, openAngleDeg: 180, leafThicknessMm: 45 } });
  return value;
};

const multiRoute = (): ArchitectureAccessibleRoute => ({ id: 'route:abc', storeyId: 'storey:0', spaceIds: ['space:a', 'space:b', 'space:c'], doorIds: ['door:ab', 'door:bc'], pathMm: [[1000, 1500], [7000, 1500]], sourceArchitectureRevision: 4, clearWidthMm: 1000, clearHeightMm: 2200 });

describe('architecture door circulation verifier', () => {
  it('checks a revision-bound door swing and continuous accessible route', () => {
    const result = verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [route()], architectureRevision: 4, rules });
    expect(result).toMatchObject({ schema: 'nexyfab.architecture-door-circulation-verifier.v1', status: 'passed', architectureRevision: 4, failures: [] });
  });

  it('fails closed for route holes, narrow dimensions, swing escape, and stale revisions', () => {
    const invalidRoute = route(); invalidRoute.pathMm = [[1000, 1500], [4000, -100], [7000, 1500]]; invalidRoute.clearWidthMm = 700; invalidRoute.sourceArchitectureRevision = 3;
    const invalidArchitecture = architecture(); invalidArchitecture.openings[0]!.doorOperation!.pivotMm = [4000, 200]; invalidArchitecture.openings[0]!.doorOperation!.openAngleDeg = -90;
    const result = verifyArchitectureDoorCirculation({ architecture: invalidArchitecture, routes: [invalidRoute], architectureRevision: 3, rules });
    expect(result.status).toBe('failed');
    expect(result.failures.map(failure => failure.code)).toEqual(expect.arrayContaining(['ARCHITECTURE_REVISION_MISMATCH', 'ROUTE_REVISION_MISMATCH', 'ACCESSIBLE_ROUTE_TOO_NARROW', 'ACCESSIBLE_ROUTE_LEAVES_DECLARED_SPACES', 'DOOR_SWING_LEAVES_CONNECTED_SPACES']));
  });

  it('rejects a route that crosses the shared wall away from the declared door aperture', () => {
    const away = route();
    away.pathMm = [[1000, 500], [7000, 500]];
    const result = verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [away], architectureRevision: 4, rules });
    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_AWAY_FROM_APERTURE' }]));
  });

  it('does not mistake a crossing of a finite line wall extension for a door traversal', () => {
    const beyond = route();
    beyond.pathMm = [[1000, 3500], [7000, 3500]];
    const result = verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [beyond], architectureRevision: 4, rules });
    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_MISSING' }]));
  });

  it('binds multi-door transitions to strictly increasing path distance', () => {
    const result = verifyArchitectureDoorCirculation({ architecture: multiArchitecture(), routes: [multiRoute()], architectureRevision: 4, rules });
    expect(result).toMatchObject({ status: 'passed', failures: [] });
    expect(result.crossings.map(crossing => ({ doorId: crossing.doorId, pathDistanceMm: crossing.pathDistanceMm, segmentIndex: crossing.segmentIndex }))).toEqual([
      { doorId: 'door:ab', pathDistanceMm: 3000, segmentIndex: 0 },
      { doorId: 'door:bc', pathDistanceMm: 5000, segmentIndex: 0 },
    ]);
  });

  it('fails closed for reverse order, round trips, duplicate hosts, undeclared crossings, and ambiguous endpoints', () => {
    const reverse = multiRoute(); reverse.pathMm = [[7000, 1500], [1000, 1500]];
    expect(verifyArchitectureDoorCirculation({ architecture: multiArchitecture(), routes: [reverse], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'route:abc', code: 'ROUTE_DOOR_CROSSING_ORDER_INVALID', measured: 1000, required: 3000 }]));

    const roundTrip = multiRoute(); roundTrip.pathMm = [[1000, 1500], [7000, 1500], [1000, 1500]];
    expect(verifyArchitectureDoorCirculation({ architecture: multiArchitecture(), routes: [roundTrip], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_COUNT_INVALID' }, { objectId: 'door:bc', code: 'ROUTE_DOOR_CROSSING_COUNT_INVALID' }]));

    const duplicateHost = multiArchitecture(); duplicateHost.openings[1]!.hostWallId = 'wall:a-divider';
    expect(verifyArchitectureDoorCirculation({ architecture: duplicateHost, routes: [multiRoute()], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'route:abc', code: 'ROUTE_DOOR_HOST_DUPLICATE' }]));

    const undeclared = multiArchitecture(); const oneDoorRoute = multiRoute(); oneDoorRoute.spaceIds = ['space:a', 'space:b']; oneDoorRoute.doorIds = ['door:ab'];
    expect(verifyArchitectureDoorCirculation({ architecture: undeclared, routes: [oneDoorRoute], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:bc', code: 'ROUTE_DOOR_CROSSING_UNDECLARED', measured: 1, required: 0 }]));

    const ambiguous = multiRoute(); ambiguous.pathMm = [[1000, 1500], [4000, 1500], [7000, 1500]];
    expect(verifyArchitectureDoorCirculation({ architecture: multiArchitecture(), routes: [ambiguous], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_AMBIGUOUS' }]));
  });

  it('analytically binds a directed arc-wall crossing to its aperture', () => {
    const curved = architecture();
    curved.walls[1] = { id: 'wall:a-divider', kind: 'arc', storeyId: 'storey:0', centerMm: [3500, 1500], radiusMm: 500, startAngleDeg: -90, endAngleDeg: 90, thicknessMm: 200, heightMm: 3000 };
    curved.openings[0]!.offsetMm = Math.PI * 500 / 2 - 200;
    curved.openings[0]!.widthMm = 850;
    curved.openings[0]!.doorOperation!.pivotMm = [4000, 1500];
    const result = verifyArchitectureDoorCirculation({ architecture: curved, routes: [route()], architectureRevision: 4, rules });
    expect(result).toMatchObject({ status: 'passed', failures: [] });
  });

  it('preserves directed membership and fails closed for arc-outside, aperture-outside, and tangent cases', () => {
    const reverse = architecture();
    reverse.walls[1] = { id: 'wall:a-divider', kind: 'arc', storeyId: 'storey:0', centerMm: [3500, 1500], radiusMm: 500, startAngleDeg: 30, endAngleDeg: 60, thicknessMm: 200, heightMm: 3000 };
    reverse.openings[0]!.offsetMm = 0;
    reverse.openings[0]!.widthMm = 200;
    reverse.openings[0]!.doorOperation!.pivotMm = [4000, 1500];
    expect(verifyArchitectureDoorCirculation({ architecture: reverse, routes: [route()], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_MISSING' }]));

    const outside = architecture();
    outside.walls[1] = { id: 'wall:a-divider', kind: 'arc', storeyId: 'storey:0', centerMm: [3500, 1500], radiusMm: 500, startAngleDeg: -90, endAngleDeg: 90, thicknessMm: 200, heightMm: 3000 };
    outside.openings[0]!.offsetMm = 0;
    outside.openings[0]!.widthMm = 200;
    outside.openings[0]!.doorOperation!.pivotMm = [4000, 1500];
    expect(verifyArchitectureDoorCirculation({ architecture: outside, routes: [route()], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_AWAY_FROM_APERTURE' }]));

    const tangent = architecture();
    tangent.walls[1] = { id: 'wall:a-divider', kind: 'arc', storeyId: 'storey:0', centerMm: [3500, 1500], radiusMm: 500, startAngleDeg: -135, endAngleDeg: 135, thicknessMm: 200, heightMm: 3000 };
    tangent.openings[0]!.offsetMm = 1000;
    tangent.openings[0]!.widthMm = 850;
    tangent.openings[0]!.doorOperation!.pivotMm = [4000, 1500];
    const tangentRoute = route(); tangentRoute.pathMm = [[1000, 2000], [7000, 2000]];
    expect(verifyArchitectureDoorCirculation({ architecture: tangent, routes: [tangentRoute], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_CROSSING_AMBIGUOUS' }]));

    const fullTurn = architecture();
    fullTurn.walls[1] = { id: 'wall:a-divider', kind: 'arc', storeyId: 'storey:0', centerMm: [3500, 1500], radiusMm: 500, startAngleDeg: 0, endAngleDeg: 360, thicknessMm: 200, heightMm: 3000 };
    fullTurn.openings[0]!.offsetMm = 0;
    fullTurn.openings[0]!.widthMm = 850;
    fullTurn.openings[0]!.doorOperation!.pivotMm = [4000, 1500];
    expect(verifyArchitectureDoorCirculation({ architecture: fullTurn, routes: [route()], architectureRevision: 4, rules }).failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_HOST_GEOMETRY_UNSUPPORTED' }]));
  });

  it('does not claim a run when governing dimensions are absent', () => {
    const result = verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [route()], architectureRevision: 4 });
    expect(result).toMatchObject({ status: 'not_run', failures: [{ objectId: 'project', code: 'GOVERNING_DIMENSION_CRITERIA_MISSING' }] });
  });

  it('fails closed for empty, malformed, or sampling-abusive route inputs', () => {
    expect(verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [], architectureRevision: 4, rules })).toMatchObject({ status: 'failed', failures: [{ code: 'ROUTE_COLLECTION_EMPTY' }] });
    expect(verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [null] as unknown as ArchitectureAccessibleRoute[], architectureRevision: 4, rules })).toMatchObject({ status: 'failed', failures: [{ code: 'ROUTE_RECORD_INVALID' }] });
    expect(verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [route()], architectureRevision: 4, rules: { ...rules, sampleStepMm: 1 } })).toMatchObject({ status: 'failed', failures: [{ code: 'GOVERNING_DIMENSION_CRITERIA_INVALID' }] });
  });

  it('reports obstacle verification as not run when no bound source is supplied', () => {
    expect(verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [route()], architectureRevision: 4, rules })).toMatchObject({ status: 'passed', obstacleCheck: 'not_run' });
  });

  it('binds interior furniture to its revision/hash and rejects a continuous route envelope collision', () => {
    const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 7, architectureDocumentId: 'arch-doc', lights: [], finishes: [], furniture: [{ id: 'desk', spaceId: 'space:a', positionMm: [1500, 1500, 0], sizeMm: [500, 500, 750], clearanceMm: 0 }], millwork: [{ id: 'casework', spaceId: 'space:a', positionMm: [1000, 2500, 0], sizeMm: [500, 200, 900], material: 'plywood', clearanceMm: 0 }] };
    const architectureValue = architecture();
    const result = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, interior, obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 7, sourceContentHash: designRevisionSha256(interior) } });
    expect(result).toMatchObject({ status: 'failed', obstacleCheck: 'failed' });
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'desk', code: 'ROUTE_OBSTACLE_CLEARANCE_COLLISION' }]));
    const stale = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, interior, obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 6, sourceContentHash: designRevisionSha256(interior) } });
    expect(stale.failures).toEqual(expect.arrayContaining([{ objectId: 'interior', code: 'OBSTACLE_INTERIOR_REVISION_MISMATCH', measured: 7, required: 6 }]));
  });

  it('checks rotated explicit obstacles and door swing swept samples, including contact', () => {
    const obstacle: ArchitectureCirculationObstacle = { id: 'casework', spaceId: 'space:a', positionMm: [3920, 2075, 0], sizeMm: [100, 100, 900], clearanceMm: 0, rotationDeg: 15, sourceArchitectureRevision: 4 };
    const architectureValue = architecture();
    const result = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [obstacle], obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 2, sourceContentHash: architectureCirculationObstacleEnvelopeHash([obstacle], 2) } });
    expect(result).toMatchObject({ status: 'failed', obstacleCheck: 'failed' });
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'casework', code: 'DOOR_SWING_OBSTACLE_COLLISION' }]));
    const touching = { ...obstacle, id: 'touching', positionMm: [2000, 2050, 0] as [number, number, number], sizeMm: [100, 100, 900] as [number, number, number], rotationDeg: 0 };
    const touchingArchitecture = architecture();
    const touchingResult = verifyArchitectureDoorCirculation({ architecture: touchingArchitecture, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [touching], obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(touchingArchitecture), sourceRevision: 2, sourceContentHash: architectureCirculationObstacleEnvelopeHash([touching], 2) } });
    expect(touchingResult.failures).toEqual(expect.arrayContaining([{ objectId: 'touching', code: 'ROUTE_OBSTACLE_CLEARANCE_COLLISION' }]));
  });

  it('fails closed for missing, transplanted, stale, and malformed obstacle bindings', () => {
    const obstacle: ArchitectureCirculationObstacle = { id: 'fixed', spaceId: 'space:a', positionMm: [1200, 2300, 0], sizeMm: [300, 300, 800], clearanceMm: 20, sourceArchitectureRevision: 3 };
    const missing = verifyArchitectureDoorCirculation({ architecture: architecture(), routes: [route()], architectureRevision: 4, rules, obstacles: [obstacle] });
    expect(missing.failures).toEqual(expect.arrayContaining([{ objectId: 'obstacles', code: 'OBSTACLE_BINDING_INVALID' }]));
    const malformed = { ...obstacle, id: 'fixed-bad', sizeMm: [0, 300, 800] as [number, number, number], sourceArchitectureRevision: 4 };
    const architectureValue = architecture();
    const transplanted = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [malformed], obstacleBinding: { architectureDocumentId: 'other-project', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 1, sourceContentHash: architectureCirculationObstacleEnvelopeHash([malformed], 1) } });
    expect(transplanted.failures).toEqual(expect.arrayContaining([
      { objectId: 'obstacles', code: 'OBSTACLE_ARCHITECTURE_ID_MISMATCH' },
      { objectId: 'fixed-bad', code: 'OBSTACLE_GEOMETRY_OR_BINDING_INVALID' },
    ]));
    const wrongHash = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [obstacle], obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 1, sourceContentHash: '0'.repeat(64) } });
    expect(wrongHash.failures).toEqual(expect.arrayContaining([{ objectId: 'obstacles', code: 'OBSTACLE_SOURCE_HASH_MISMATCH' }]));
    const wrongArchitectureHash = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [], obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: '0'.repeat(64), sourceRevision: 1, sourceContentHash: architectureCirculationObstacleEnvelopeHash([], 1) } });
    expect(wrongArchitectureHash.failures).toEqual(expect.arrayContaining([{ objectId: 'obstacles', code: 'OBSTACLE_ARCHITECTURE_HASH_MISMATCH' }]));
  });

  it('fails closed when an obstacle clearance envelope leaves its declared space', () => {
    const architectureValue = architecture();
    const obstacle: ArchitectureCirculationObstacle = { id: 'outside', spaceId: 'space:a', positionMm: [3990, 1500, 0], sizeMm: [100, 100, 900], clearanceMm: 25, sourceArchitectureRevision: 4 };
    const result = verifyArchitectureDoorCirculation({ architecture: architectureValue, architectureDocumentId: 'arch-doc', routes: [route()], architectureRevision: 4, rules, obstacles: [obstacle], obstacleBinding: { architectureDocumentId: 'arch-doc', architectureRevision: 4, architectureContentHash: designRevisionSha256(architectureValue), sourceRevision: 2, sourceContentHash: architectureCirculationObstacleEnvelopeHash([obstacle], 2) } });
    expect(result).toMatchObject({ status: 'failed', obstacleCheck: 'failed' });
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'outside', code: 'OBSTACLE_GEOMETRY_OR_BINDING_INVALID' }]));
  });

  it('binds every route door host to the route storey', () => {
    const architectureValue = architecture();
    architectureValue.storeys.push({ id: 'storey:1', name: 'Other', elevationMm: 4000, heightMm: 3000 });
    architectureValue.walls[1]!.storeyId = 'storey:1';
    const result = verifyArchitectureDoorCirculation({ architecture: architectureValue, routes: [route()], architectureRevision: 4, rules });
    expect(result.failures).toEqual(expect.arrayContaining([{ objectId: 'door:ab', code: 'ROUTE_DOOR_HOST_STOREY_INVALID' }]));
  });
});
