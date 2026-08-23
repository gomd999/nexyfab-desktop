import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import {
  buildCivilGravityDrainageHydraulicReceipt,
  claimCivilGravityDrainageHydraulicReceipt,
  exportCivilGravityDrainageHydraulicArtifact,
  parseCivilGravityDrainageHydraulicArtifact,
  verifyCivilGravityDrainageHydraulic,
  type CivilGravityDrainageHydraulicInput,
} from './civilGravityDrainageHydraulicContract';

const encoder = new TextEncoder();
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const revisionValue = { project: 'road-drain', revision: 4, source: 'governed-civil-network' };
const workspaceRevisionId = 'road-workspace:r4';
const workspaceContentHash = designRevisionSha256(revisionValue);
const artifact = (id: string, kind: 'tin' | 'alignment' | 'network', text: string) => ({ id, kind, bytes: encoder.encode(text) });

function input(): CivilGravityDrainageHydraulicInput {
  const tinArtifact = artifact('artifact:tin', 'tin', 'TIN-R4');
  const alignmentArtifact = artifact('artifact:alignment', 'alignment', 'ALIGNMENT-R4');
  const networkArtifact = artifact('artifact:network', 'network', 'NETWORK-R4');
  return {
    workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue: revisionValue, expectedWorkspaceContentHash: workspaceContentHash,
    expectedTinArtifactSha256: sha(tinArtifact.bytes), expectedAlignmentArtifactSha256: sha(alignmentArtifact.bytes), expectedNetworkArtifactSha256: sha(networkArtifact.bytes),
    tinArtifact, alignmentArtifact, networkArtifact,
    rainfall: { intensityMmPerHour: 100, durationMin: 15, sourceId: 'rainfall:design-15min', sourceSha256: 'a'.repeat(64) },
    catchments: [{ id: 'catchment:road', areaM2: 1000, runoffCoefficient: 0.7, outletNodeId: 'node:inlet', sourceId: 'catchment-survey', sourceSha256: 'b'.repeat(64) }],
    nodes: [
      { id: 'node:inlet', kind: 'inlet', positionM: [0, 0, 0], invertElevationM: 8, rimElevationM: 10 },
      { id: 'node:mh', kind: 'manhole', positionM: [100, 0, 0], invertElevationM: 7.5, rimElevationM: 9.8 },
      { id: 'node:outfall', kind: 'outfall', positionM: [200, 0, 0], invertElevationM: 7, rimElevationM: 9 },
    ],
    pipes: [
      { id: 'pipe:inlet-mh', fromNodeId: 'node:inlet', toNodeId: 'node:mh', invertStartM: 8, invertEndM: 7.5, diameterMm: 600, lengthM: 100, roughnessN: 0.013 },
      { id: 'pipe:mh-outfall', fromNodeId: 'node:mh', toNodeId: 'node:outfall', invertStartM: 7.5, invertEndM: 7, diameterMm: 600, lengthM: 100, roughnessN: 0.013 },
    ],
    outfalls: [{ id: 'outfall:river', nodeId: 'node:outfall', tailwaterElevationM: 6.8 }],
    minimumFreeboardM: 0.5, minimumCoverM: 0.8,
  };
}

describe('civil gravity drainage hydraulic contract', () => {
  it('binds TIN/alignment/network artifacts and verifies Rational/Manning/HGL checks deterministically', () => {
    const first = exportCivilGravityDrainageHydraulicArtifact(input());
    const second = exportCivilGravityDrainageHydraulicArtifact(input());
    expect(first.artifactSha256).toBe(second.artifactSha256);
    expect(first.payload.units).toMatchObject({ length: 'm', flow: 'm3/s' });
    expect(first.payload.pipeChecks).toHaveLength(2);
    expect(first.payload.pipeChecks.every(check => check.status === 'passed' && check.capacityRatio < 1)).toBe(true);
    expect(first.payload.dynamicHydraulics).toBe('NOT_RUN');
    expect(first.payload.releaseReady).toBe(false);
    const parsed = parseCivilGravityDrainageHydraulicArtifact(first.bytes, first.payload.binding);
    expect(verifyCivilGravityDrainageHydraulic({ artifact: parsed, ...first.payload.binding })).toMatchObject({ status: 'passed' });
    const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed));
    const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.civil-gravity-drainage-hydraulic-verification.v1', verifierId: 'civil-gravity-drainage-hydraulic-structural.v1', status: 'passed', artifactSha256: first.artifactSha256, contentHash: first.contentHash, releaseReady: false }));
    const receiptBytes = buildCivilGravityDrainageHydraulicReceipt({ artifact: first, parserOutputBytes, verifierEvidenceBytes });
    expect(claimCivilGravityDrainageHydraulicReceipt({ artifact: first, receiptBytes, parserOutputBytes, verifierEvidenceBytes }).claim).toBe('internal-civil-gravity-drainage-hydraulic-verified');
  });

  it('rejects cycles, reverse slope, dangling connectivity, geometry/length, cover and capacity failures', () => {
    const cycle = input(); cycle.pipes[1]!.toNodeId = 'node:inlet';
    expect(() => exportCivilGravityDrainageHydraulicArtifact(cycle)).toThrow('NETWORK_INVALID');
    const reverse = input(); reverse.pipes[0]!.invertEndM = 8.5;
    expect(() => exportCivilGravityDrainageHydraulicArtifact(reverse)).toThrow('HYDRAULIC_CHECK_FAILED');
    const dangling = input(); dangling.pipes[0]!.toNodeId = 'node:missing';
    expect(() => exportCivilGravityDrainageHydraulicArtifact(dangling)).toThrow('NETWORK_INVALID');
    const shortPipe = input(); shortPipe.pipes[0]!.lengthM = 50;
    expect(() => exportCivilGravityDrainageHydraulicArtifact(shortPipe)).toThrow('HYDRAULIC_CHECK_FAILED');
    const lowCover = input(); lowCover.minimumCoverM = 2;
    expect(() => exportCivilGravityDrainageHydraulicArtifact(lowCover)).toThrow('HYDRAULIC_CHECK_FAILED');
    const lowCapacity = input(); lowCapacity.rainfall.intensityMmPerHour = 10_000;
    expect(() => exportCivilGravityDrainageHydraulicArtifact(lowCapacity)).toThrow('HYDRAULIC_CHECK_FAILED');
  });

  it('fails closed on stale revision/artifact, parser tamper and receipt evidence tamper', () => {
    const stale = input(); stale.expectedWorkspaceContentHash = 'c'.repeat(64);
    expect(() => exportCivilGravityDrainageHydraulicArtifact(stale)).toThrow('STALE_REVISION_HASH');
    const artifactTamper = input(); artifactTamper.networkArtifact.bytes = encoder.encode('NETWORK-R5'); artifactTamper.networkArtifact.artifactSha256 = sha(encoder.encode('NETWORK-R4'));
    expect(() => exportCivilGravityDrainageHydraulicArtifact(artifactTamper)).toThrow('ARTIFACT_HASH_MISMATCH');
    const exported = exportCivilGravityDrainageHydraulicArtifact(input());
    const envelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: Record<string, unknown>; contentHash: string };
    envelope.payload.releaseReady = true;
    expect(() => parseCivilGravityDrainageHydraulicArtifact(encoder.encode(canonicalDesignJson(envelope)), exported.payload.binding)).toThrow('INVALID');
    expect(() => parseCivilGravityDrainageHydraulicArtifact(encoder.encode(`${new TextDecoder().decode(exported.bytes)}\n`))).toThrow('NON_CANONICAL');
    const parserOutputBytes = encoder.encode(canonicalDesignJson(parseCivilGravityDrainageHydraulicArtifact(exported.bytes))); const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.civil-gravity-drainage-hydraulic-verification.v1', verifierId: 'civil-gravity-drainage-hydraulic-structural.v1', status: 'passed', artifactSha256: exported.artifactSha256, contentHash: exported.contentHash, releaseReady: false }));
    const receiptBytes = buildCivilGravityDrainageHydraulicReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes });
    expect(() => claimCivilGravityDrainageHydraulicReceipt({ artifact: exported, receiptBytes, parserOutputBytes: encoder.encode('{"tampered":true}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH');
    const payloadSwap = { ...exported, payload: { ...exported.payload, dynamicHydraulics: 'COMPLETE' as never } };
    expect(() => buildCivilGravityDrainageHydraulicReceipt({ artifact: payloadSwap, parserOutputBytes, verifierEvidenceBytes })).toThrow('ARTIFACT_BINDING_MISMATCH');
    expect(() => buildCivilGravityDrainageHydraulicReceipt({ artifact: exported, parserOutputBytes: encoder.encode('{}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH');
  });

  it('rejects a forged recomputed pipe check even when the envelope hash is refreshed', () => {
    const exported = exportCivilGravityDrainageHydraulicArtifact(input());
    const envelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: typeof exported.payload; contentHash: string };
    envelope.payload.pipeChecks[0]!.capacityRatio = 0.01;
    envelope.contentHash = designRevisionSha256(envelope.payload);
    const bytes = encoder.encode(canonicalDesignJson(envelope));
    const parsed = parseCivilGravityDrainageHydraulicArtifact(bytes);
    expect(verifyCivilGravityDrainageHydraulic({ artifact: parsed, ...parsed.payload.binding })).toMatchObject({ status: 'failed', issues: expect.arrayContaining(['hydraulic_pipe_check_computation_mismatch']) });
  });
  it('rejects direct-outfall catchments and provenance substitution', () => {
    const direct = input(); direct.nodes[0]!.kind = 'outfall';
    expect(() => exportCivilGravityDrainageHydraulicArtifact(direct)).toThrow('CATCHMENT_INVALID');
    const exported = exportCivilGravityDrainageHydraulicArtifact(input());
    const envelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: typeof exported.payload; contentHash: string };
    envelope.payload.provenance.catchmentSourceIds = ['forged-source'];
    envelope.contentHash = designRevisionSha256(envelope.payload);
    expect(() => parseCivilGravityDrainageHydraulicArtifact(encoder.encode(canonicalDesignJson(envelope)))).toThrow('hydraulic_provenance_invalid');
  });
});
