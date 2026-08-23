import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assessHvacDuctRouteRelease, HVAC_DUCT_ROUTE_EXCHANGE_SCHEMA, parseHvacDuctRouteOutput, type HvacDuctRouteReleaseInputV1, validateHvacDuctRouteRelease, verifyHvacDuctRouteReadback } from './hvacDuctRouteReleaseContract';

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
function fixture(): HvacDuctRouteReleaseInputV1 {
  const revisionSha256 = hash('hvac-revision-5'); const outputContent = JSON.stringify({ schema: HVAC_DUCT_ROUTE_EXCHANGE_SCHEMA, revision: 5, sourceWorkspaceId: 'workspace-hvac-1', sourceModelId: 'hvac-model-1', sourceModelSha256: hash('hvac-model'), sourceContentHash: hash('hvac-content'), sourceRawArtifactSha256: hash('hvac-raw'), routeIds: ['route-1'], portIds: ['port-1', 'port-2', 'port-3', 'port-4'], segmentIds: ['segment-1', 'segment-2'], fittingIds: ['fitting-elbow'], supportIds: ['support-1', 'support-2'] });
  return {
    schema: 'nexyfab.hvac-duct-route-release.v1', units: 'mm-Pa-m3s', revision: 5,
    source: { workspaceId: 'workspace-hvac-1', modelId: 'hvac-model-1', modelPath: 'models/hvac.ifc', modelSha256: hash('hvac-model'), contentHash: hash('hvac-content'), rawArtifactSha256: hash('hvac-raw'), revisionSha256, revision: 5 },
    routes: [{ id: 'route-1', segmentIds: ['segment-1', 'segment-2'], fittingIds: ['fitting-elbow'], portIds: ['port-1', 'port-2', 'port-3', 'port-4'], maxSupportSpacingMm: 1200, minimumClearanceMm: 50 }],
    ports: [
      { id: 'port-1', ownerType: 'segment', ownerId: 'segment-1', positionMm: { xMm: 0, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: [], shape: 'rectangular', widthMm: 200, heightMm: 100 },
      { id: 'port-2', ownerType: 'fitting', ownerId: 'fitting-elbow', positionMm: { xMm: 200, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: ['port-3'], shape: 'rectangular', widthMm: 200, heightMm: 100 },
      { id: 'port-3', ownerType: 'fitting', ownerId: 'fitting-elbow', positionMm: { xMm: 200, yMm: 0, zMm: 0 }, direction: { xMm: 0, yMm: 1, zMm: 0 }, connectedPortIds: ['port-2'], shape: 'round', diameterMm: 180 },
      { id: 'port-4', ownerType: 'segment', ownerId: 'segment-2', positionMm: { xMm: 200, yMm: 200, zMm: 0 }, direction: { xMm: 0, yMm: 1, zMm: 0 }, connectedPortIds: [], shape: 'round', diameterMm: 180 },
    ],
    segments: [
      { id: 'segment-1', routeId: 'route-1', startPortId: 'port-1', endPortId: 'port-2', shape: 'rectangular', widthMm: 200, heightMm: 100, centerlineMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 200, yMm: 0, zMm: 0 }], lengthMm: 200, flowM3s: 0.2, pressureLossPa: 200 * 0.2 ** 2 / (200 * 100) },
      { id: 'segment-2', routeId: 'route-1', startPortId: 'port-3', endPortId: 'port-4', shape: 'round', diameterMm: 180, centerlineMm: [{ xMm: 200, yMm: 0, zMm: 0 }, { xMm: 200, yMm: 200, zMm: 0 }], lengthMm: 200, flowM3s: 0.2, pressureLossPa: 200 * 0.2 ** 2 / (Math.PI * (180 / 2) ** 2) },
    ],
    fittings: [{ id: 'fitting-elbow', routeId: 'route-1', type: 'elbow', portIds: ['port-2', 'port-3'], lengthMm: 100, pressureLossPa: 10 }],
    supports: [{ id: 'support-1', segmentId: 'segment-1', positionAlongMm: 100, spacingMm: 600, supportType: 'trapeze' }, { id: 'support-2', segmentId: 'segment-2', positionAlongMm: 100, spacingMm: 600, supportType: 'trapeze' }],
    clearanceZones: [{ id: 'zone-1', ownerId: 'segment-1', originMm: { xMm: 0, yMm: 500, zMm: 0 }, widthMm: 100, depthMm: 100, heightMm: 100 }],
    output: { format: 'nexyfab-exchange-json', targetFormat: 'ifc-neutral', revision: 5, content: outputContent, bytes: Buffer.byteLength(outputContent, 'utf8'), sha256: hash(outputContent) },
  };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('HVAC duct route release contract', () => {
  it('validates rectangular/round centerlines, fitting connectivity, support spacing and pressure loss', () => {
    const input = fixture(); expect(validateHvacDuctRouteRelease(input)).toEqual({ valid: true, issues: [] }); const readback = parseHvacDuctRouteOutput(input); expect(verifyHvacDuctRouteReadback(input, readback)).toEqual({ valid: true, issues: [] }); const assessment = assessHvacDuctRouteRelease(input, readback); expect(assessment.releaseReady).toBe(false); expect(assessment.status).toBe('HOLD'); expect(assessment.blockers).toEqual(expect.arrayContaining(['tab_measurement_not_run', 'energy_and_air_balance_not_run', 'fire_and_building_code_authority_not_verified']));
  });
  it('fails closed for stale, disconnected, flow/length/pressure, clearance, and support mutations', () => {
    const stale = clone(fixture()); stale.revision = 6; expect(validateHvacDuctRouteRelease(stale).issues).toContain('stale_source_revision');
    const broken = clone(fixture()); broken.ports[2]!.connectedPortIds = []; broken.ports[2]!.direction = { xMm: 1, yMm: 0, zMm: 0 }; broken.segments[1]!.lengthMm = 250; broken.segments[1]!.flowM3s = -0.2; broken.segments[1]!.pressureLossPa = 0; broken.supports[0]!.spacingMm = 2000; broken.clearanceZones[0]!.originMm = { xMm: 50, yMm: 0, zMm: 0 };
    const result = validateHvacDuctRouteRelease(broken); expect(result.valid).toBe(false); expect(result.issues).toEqual(expect.arrayContaining(['port_bidirectional_ownership_invalid:port-2', 'segment_length_mismatch:segment-2', 'segment_pressure_loss_mismatch:segment-2', 'segment_flow_direction_invalid:segment-2', 'support_spacing_invalid:support-1', 'route_clearance_or_clash:segment-1']));
  });
  it('binds output bytes and parser readback to source identity', () => { const input = fixture(); const readback = parseHvacDuctRouteOutput(input); const tampered = clone(readback); tampered.outputSha256 = hash('tampered'); expect(verifyHvacDuctRouteReadback(input, tampered).valid).toBe(false); const changed = clone(input); changed.output.content += 'tampered'; expect(validateHvacDuctRouteRelease(changed).issues).toContain('output_binding_invalid'); const forged = clone(input); const payload = JSON.parse(forged.output.content) as { segmentIds: string[] }; payload.segmentIds = ['forged-segment']; forged.output.content = JSON.stringify(payload); forged.output.bytes = Buffer.byteLength(forged.output.content, 'utf8'); forged.output.sha256 = hash(forged.output.content); expect(validateHvacDuctRouteRelease(forged).issues).toContain('output_readback_invalid'); });
  it('does not throw on malformed collections', () => { const malformed = clone(fixture()) as unknown as Record<string, unknown>; malformed.routes = null; malformed.ports = null; malformed.segments = null; expect(() => validateHvacDuctRouteRelease(malformed as unknown as HvacDuctRouteReleaseInputV1)).not.toThrow(); expect(validateHvacDuctRouteRelease(malformed as unknown as HvacDuctRouteReleaseInputV1).valid).toBe(false); });
  it('does not treat one valid support as proof of every support gap or clearance direction', () => { const input = fixture(); input.supports[0]!.positionAlongMm = 0; input.supports[1]!.segmentId = 'segment-1'; input.supports[1]!.positionAlongMm = 100; input.routes[0]!.maxSupportSpacingMm = 50; const result = validateHvacDuctRouteRelease(input); expect(result.issues).toContain('support_gap_exceeded:segment-1'); const clash = clone(fixture()); clash.clearanceZones[0]!.originMm = { xMm: 100, yMm: -20, zMm: -20 }; expect(validateHvacDuctRouteRelease(clash).issues).toContain('route_clearance_or_clash:segment-1'); });
  it('rejects a route with no supports instead of treating unsupported duct as valid', () => { const input = clone(fixture()); input.supports = []; expect(validateHvacDuctRouteRelease(input).issues).toEqual(expect.arrayContaining(['support_missing:segment-1', 'support_missing:segment-2'])); });
  it('rejects connected ports whose declared positions are discontinuous', () => { const input = clone(fixture()); input.ports[2]!.positionMm = { xMm: 205, yMm: 0, zMm: 0 }; expect(validateHvacDuctRouteRelease(input).issues).toContain('port_spatial_continuity_invalid:port-2'); });
});
