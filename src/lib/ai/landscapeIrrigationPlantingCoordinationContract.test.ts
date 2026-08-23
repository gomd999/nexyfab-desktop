import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import { buildLandscapeIrrigationPlantingReceipt, claimLandscapeIrrigationPlantingReceipt, exportLandscapeIrrigationPlantingArtifact, parseLandscapeIrrigationPlantingArtifact, verifyLandscapeIrrigationPlanting, type LandscapeIrrigationPlantingInput } from './landscapeIrrigationPlantingCoordinationContract';

const encoder = new TextEncoder(); const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'); const revisionValue = { project: 'park-irrigation', revision: 2 }; const workspaceRevisionId = 'park-workspace:r2'; const workspaceContentHash = designRevisionSha256(revisionValue);
const artifact = (id: string, kind: 'tin' | 'plant_library', body: string) => ({ id, kind, bytes: encoder.encode(body) });
function input(): LandscapeIrrigationPlantingInput {
  const tinArtifact = artifact('artifact:tin', 'tin', 'TIN-R2'), plantLibraryArtifact = artifact('artifact:library', 'plant_library', 'LIBRARY-R2');
  return {
    workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue: revisionValue, expectedWorkspaceContentHash: workspaceContentHash, tinArtifact, plantLibraryArtifact, expectedTinArtifactSha256: sha(tinArtifact.bytes), expectedPlantLibraryArtifactSha256: sha(plantLibraryArtifact.bytes),
    crs: { epsg: 5186, horizontalDatum: 'Korea2000', verticalDatum: 'KVD2002' }, minimumPressureKpa: 100, terrainSamples: [{ id: 'terrain:1', positionM: [0, 0], elevationM: 100 }],
    zones: [{ id: 'zone:north', boundaryM: [[0, 0], [20, 0], [20, 20], [0, 20]], hydrozoneId: 'hydro:north', wateringDurationMin: 30, utilityClearanceM: 1 }],
    plants: [{ id: 'plant:oak', libraryId: 'library:oak', zoneId: 'zone:north', positionM: [5, 5], spacingM: 4, rootballDiameterM: 2 }], library: [{ id: 'library:oak', waterDemandLPerDay: 120, matureRadiusM: 4 }],
    nodes: [{ id: 'node:valve', positionM: [0, 0], elevationM: 100 }, { id: 'node:emitter', positionM: [5, 5], elevationM: 100 }], pipes: [{ id: 'pipe:main', kind: 'main', fromNodeId: 'node:valve', toNodeId: 'node:emitter', diameterMm: 32, lengthM: 10 }],
    emitters: [{ id: 'emitter:oak', nodeId: 'node:emitter', plantId: 'plant:oak', flowLs: 0.1, minimumPressureKpa: 100 }], valves: [{ id: 'valve:north', nodeId: 'node:valve', hydrozoneId: 'hydro:north' }], controllers: [{ id: 'controller:main', valveIds: ['valve:north'] }], utilities: [{ id: 'utility:power', positionM: [15, 15] }],
  };
}
const evidence = (artifactSha256: string, contentHash: string) => encoder.encode(canonicalDesignJson({ schema: 'nexyfab.landscape-irrigation-planting-verification.v1', verifierId: 'landscape-irrigation-planting-structural.v1', status: 'passed', artifactSha256, contentHash, releaseReady: false }));

describe('landscape irrigation/planting coordination contract', () => {
  it('binds sources, computes hydrozone checks and produces evidence-bound receipt', () => { const first = exportLandscapeIrrigationPlantingArtifact(input()); const parsed = parseLandscapeIrrigationPlantingArtifact(first.bytes, first.payload.binding); expect(verifyLandscapeIrrigationPlanting({ artifact: parsed, ...first.payload.binding })).toMatchObject({ status: 'passed' }); const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed)), verifierEvidenceBytes = evidence(first.artifactSha256, first.contentHash); const receiptBytes = buildLandscapeIrrigationPlantingReceipt({ artifact: first, parserOutputBytes, verifierEvidenceBytes }); expect(claimLandscapeIrrigationPlantingReceipt({ artifact: first, receiptBytes, parserOutputBytes, verifierEvidenceBytes }).claim).toBe('internal-landscape-irrigation-planting-verified'); expect(first.payload.releaseReady).toBe(false); });
  it('rejects clearance, cycles, stale artifacts and pressure failure', () => { const spacing = input(); spacing.plants[0]!.spacingM = 1; expect(() => exportLandscapeIrrigationPlantingArtifact(spacing)).toThrow('PLANT_CLEARANCE_INVALID'); const cycle = input(); cycle.pipes.push({ id: 'pipe:cycle', kind: 'lateral', fromNodeId: 'node:emitter', toNodeId: 'node:valve', diameterMm: 32, lengthM: 10 }); expect(() => exportLandscapeIrrigationPlantingArtifact(cycle)).toThrow('NETWORK_INVALID'); const pressure = input(); pressure.emitters[0]!.minimumPressureKpa = 400; expect(() => exportLandscapeIrrigationPlantingArtifact(pressure)).toThrow('PRESSURE_INVALID'); const stale = input(); stale.expectedWorkspaceContentHash = 'c'.repeat(64); expect(() => exportLandscapeIrrigationPlantingArtifact(stale)).toThrow('STALE_REVISION_HASH'); });
  it('rejects parser, in-memory payload and evidence substitution', () => { const exported = exportLandscapeIrrigationPlantingArtifact(input()); const parsed = parseLandscapeIrrigationPlantingArtifact(exported.bytes); const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed)), verifierEvidenceBytes = evidence(exported.artifactSha256, exported.contentHash); const receiptBytes = buildLandscapeIrrigationPlantingReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes }); expect(() => claimLandscapeIrrigationPlantingReceipt({ artifact: exported, receiptBytes, parserOutputBytes: encoder.encode('{}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH'); expect(() => buildLandscapeIrrigationPlantingReceipt({ artifact: { ...exported, payload: { ...exported.payload, irrigationSimulator: 'COMPLETE' as never } }, parserOutputBytes, verifierEvidenceBytes })).toThrow('ARTIFACT_BINDING_MISMATCH'); expect(() => buildLandscapeIrrigationPlantingReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes: encoder.encode('{}') })).toThrow('VERIFIER_EVIDENCE_MISMATCH'); });
  it('enforces and persists the global minimum pressure criterion', () => {
    const value = input(); value.minimumPressureKpa = 301;
    expect(() => exportLandscapeIrrigationPlantingArtifact(value)).toThrow('PRESSURE_INVALID');
    value.minimumPressureKpa = 100;
    expect(exportLandscapeIrrigationPlantingArtifact(value).payload.minimumPressureKpa).toBe(100);
  });
  it('fails closed when an emitter is not reachable from its hydrozone valve', () => {
    const value = input(); value.pipes[0]!.toNodeId = 'node:valve';
    expect(() => exportLandscapeIrrigationPlantingArtifact(value)).toThrow('NETWORK_INVALID');
  });
  it('rejects swapped semantic artifact roles and colliding artifact ids', () => {
    const swapped = input(); (swapped.tinArtifact as { kind: string }).kind = 'plant_library';
    expect(() => exportLandscapeIrrigationPlantingArtifact(swapped)).toThrow('ARTIFACT_HASH_MISMATCH');
    const collision = input(); collision.plantLibraryArtifact.id = collision.tinArtifact.id;
    expect(() => exportLandscapeIrrigationPlantingArtifact(collision)).toThrow('ARTIFACT_ID_COLLISION');
  });
  it('rejects forged hydrozone demand and plants outside their governed zone', () => {
    const exported = exportLandscapeIrrigationPlantingArtifact(input());
    const envelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: typeof exported.payload; contentHash: string };
    envelope.payload.hydrozones[0]!.demandLs = 999;
    envelope.payload.plants[0]!.positionM = [100, 100];
    envelope.contentHash = designRevisionSha256(envelope.payload);
    const bytes = encoder.encode(canonicalDesignJson(envelope));
    const parsed = parseLandscapeIrrigationPlantingArtifact(bytes);
    expect(verifyLandscapeIrrigationPlanting({ artifact: parsed, ...parsed.payload.binding })).toMatchObject({ status: 'failed', issues: expect.arrayContaining(['landscape_hydrozone_computation_mismatch', 'landscape_plant_outside_zone:plant:oak']) });
  });
});
