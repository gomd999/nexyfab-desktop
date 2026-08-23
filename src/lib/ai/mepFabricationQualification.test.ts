import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalMepAttestationPayload,
  hashMepQualificationTarget,
  MEP_REQUIRED_AXES,
  qualifyMepFabrication,
  type IndependentReviewerAttestation,
  type MepTrack,
  type QualificationEvidenceReceipt,
} from './mepFabricationQualification';
import { parsePipingPlantOutput, type PipingPlantReleaseInputV1 } from './pipingPlantReleaseContract';
import { parseHvacDuctRouteOutput, type HvacDuctRouteReleaseInputV1 } from './hvacDuctRouteReleaseContract';
import { parseCableTrayConduitOutput, type CableTrayConduitReleaseInputV1 } from './cableTrayConduitRouteReleaseContract';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-22T12:00:00.000Z';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const sourceArtifacts = (track: MepTrack) => ({
  primary: Buffer.from(`${track}-primary-source`),
  ...(track === 'piping' ? {} : { raw: Buffer.from(`${track}-raw-source`) }),
});

function output(content: string, targetFormat: 'ifc-neutral' | 'step' | 'json' = 'json') {
  return { format: 'nexyfab-exchange-json' as const, targetFormat, revision: 3, content, bytes: Buffer.byteLength(content, 'utf8'), sha256: sha256(content) };
}

function pipingOutput(content: string) {
  return { format: 'json' as const, revision: 3, content, bytes: Buffer.byteLength(content, 'utf8'), sha256: sha256(content) };
}

function pipingFixture(): { release: PipingPlantReleaseInputV1; readback: ReturnType<typeof parsePipingPlantOutput> } {
  const release = {
    schema: 'nexyfab.piping-plant-release.v1' as const, units: 'mm-MPa-C' as const, revision: 3,
    source: { projectId: 'project-p', modelId: 'model-p', brepPath: 'models/plant.brep', brepBytes: sourceArtifacts('piping').primary.byteLength, brepSha256: sha256('piping-primary-source'), contentHash: HASH_B, revisionSha256: HASH_C, revision: 3 },
    provenance: { designCode: 'ASME-B31.3', fluidId: 'water', fluidState: 'liquid' as const, materialId: 'steel', materialGrade: 'A106', pipingClass: 'C1', sourceId: 'src-p', sourceRef: 'catalog:piping', capturedAt: NOW, revisionSha256: HASH_C },
    ports: [
      { id: 'pp1', ownerType: 'line' as const, ownerId: 'pl1', nominalSizeMm: 50, ratingMPa: 1, positionMm: { xMm: 0, yMm: 0, zMm: 0 } },
      { id: 'pp2', ownerType: 'line' as const, ownerId: 'pl1', nominalSizeMm: 50, ratingMPa: 1, positionMm: { xMm: 1000, yMm: 0, zMm: 0 } },
    ],
    lines: [{ id: 'pl1', fluidId: 'water', nominalSizeMm: 50, schedule: '40', ratingMPa: 1, portIds: ['pp1', 'pp2'], segmentIds: ['ps1'], maximumSupportSpacingMm: 600 }],
    segments: [{ id: 'ps1', lineId: 'pl1', startPortId: 'pp1', endPortId: 'pp2', pointsMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 1000, yMm: 0, zMm: 0 }], lengthMm: 1000, slopePercent: 0, bendRadiusMm: 100 }],
    fittings: [], valves: [], equipment: [], nozzles: [],
    supports: [{ id: 'psup1', segmentId: 'ps1', positionAlongMm: 500, spacingMm: 600, supportType: 'hanger' }],
    welds: [{ id: 'pw1', segmentId: 'ps1', lengthMm: 100, process: 'GTAW', wpsReference: 'WPS-1' }],
    bom: [{ id: 'pb1', itemId: 'pl1', itemType: 'line' as const, quantity: 1 }, { id: 'pb2', itemId: 'ps1', itemType: 'segment' as const, quantity: 1 }, { id: 'pb3', itemId: 'psup1', itemType: 'support' as const, quantity: 1 }, { id: 'pb4', itemId: 'pw1', itemType: 'weld' as const, quantity: 1 }],
    isometricSchedule: [{ id: 'piso1', lineId: 'pl1', segmentIds: ['ps1'], totalLengthMm: 1000 }],
    output: pipingOutput(JSON.stringify({ schema: 'nexyfab.piping-plant-exchange.v1', source: { projectId: 'project-p', modelId: 'model-p', brepSha256: sha256('piping-primary-source'), contentHash: HASH_B }, revision: 3, ids: { lines: ['pl1'], segments: ['ps1'], fittings: [], valves: [], equipment: [], nozzles: [], supports: ['psup1'], welds: ['pw1'] } })),
  } satisfies PipingPlantReleaseInputV1;
  return { release, readback: parsePipingPlantOutput(release) };
}

function hvacFixture(): { release: HvacDuctRouteReleaseInputV1; readback: ReturnType<typeof parseHvacDuctRouteOutput> } {
  const release = {
    schema: 'nexyfab.hvac-duct-route-release.v1' as const, units: 'mm-Pa-m3s' as const, revision: 3,
    source: { workspaceId: 'workspace-h', modelId: 'model-h', modelPath: 'models/hvac.json', modelSha256: sha256('hvac-primary-source'), contentHash: HASH_B, rawArtifactSha256: sha256('hvac-raw-source'), revisionSha256: HASH_A, revision: 3 },
    routes: [{ id: 'hr1', segmentIds: ['hs1'], fittingIds: [], portIds: ['hp1', 'hp2'], maxSupportSpacingMm: 600, minimumClearanceMm: 10 }],
    ports: [{ id: 'hp1', ownerType: 'segment' as const, ownerId: 'hs1', positionMm: { xMm: 0, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: [], shape: 'rectangular' as const, widthMm: 100, heightMm: 100 }, { id: 'hp2', ownerType: 'segment' as const, ownerId: 'hs1', positionMm: { xMm: 1000, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: [], shape: 'rectangular' as const, widthMm: 100, heightMm: 100 }],
    segments: [{ id: 'hs1', routeId: 'hr1', startPortId: 'hp1', endPortId: 'hp2', shape: 'rectangular' as const, widthMm: 100, heightMm: 100, centerlineMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 1000, yMm: 0, zMm: 0 }], lengthMm: 1000, flowM3s: 1, pressureLossPa: 0.1 }],
    fittings: [], supports: [{ id: 'hsup1', segmentId: 'hs1', positionAlongMm: 500, spacingMm: 600, supportType: 'hanger' }], clearanceZones: [],
    output: output(JSON.stringify({ schema: 'nexyfab.hvac-duct-route-exchange.v1', revision: 3, sourceWorkspaceId: 'workspace-h', sourceModelId: 'model-h', sourceModelSha256: sha256('hvac-primary-source'), sourceContentHash: HASH_B, sourceRawArtifactSha256: sha256('hvac-raw-source'), routeIds: ['hr1'], portIds: ['hp1', 'hp2'], segmentIds: ['hs1'], fittingIds: [], supportIds: ['hsup1'] }), 'ifc-neutral'),
  } satisfies HvacDuctRouteReleaseInputV1;
  return { release, readback: parseHvacDuctRouteOutput(release) };
}

function cableFixture(): { release: CableTrayConduitReleaseInputV1; readback: ReturnType<typeof parseCableTrayConduitOutput> } {
  const release = {
    schema: 'nexyfab.cable-tray-conduit-release.v1' as const, units: 'mm-A-V' as const, revision: 3,
    source: { workspaceId: 'workspace-c', modelId: 'model-c', modelPath: 'models/cable.json', modelSha256: sha256('cable-primary-source'), contentHash: HASH_B, rawArtifactSha256: sha256('cable-raw-source'), revisionSha256: HASH_A, revision: 3 },
    routes: [{ id: 'cr1', kind: 'tray' as const, voltageClass: 'low' as const, segmentIds: ['cs1'], fittingIds: [], portIds: ['cp1', 'cp2'], maxSupportSpacingMm: 600, fillRatioLimit: 0.5, minimumClearanceMm: 10 }],
    ports: [{ id: 'cp1', ownerType: 'segment' as const, ownerId: 'cs1', positionMm: { xMm: 0, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: [] }, { id: 'cp2', ownerType: 'segment' as const, ownerId: 'cs1', positionMm: { xMm: 1000, yMm: 0, zMm: 0 }, direction: { xMm: 1, yMm: 0, zMm: 0 }, connectedPortIds: [] }],
    segments: [{ id: 'cs1', routeId: 'cr1', startPortId: 'cp1', endPortId: 'cp2', kind: 'tray' as const, widthMm: 100, depthMm: 100, centerlineMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 1000, yMm: 0, zMm: 0 }], lengthMm: 1000, bendRadiusMm: 100, cableIds: ['cable1'] }],
    fittings: [], cables: [{ id: 'cable1', routeId: 'cr1', voltageClass: 'low' as const, crossSectionAreaMm2: 100, minimumBendRadiusMm: 50 }], supports: [{ id: 'csup1', segmentId: 'cs1', positionAlongMm: 500, spacingMm: 600, supportType: 'hanger' }], clearanceZones: [],
    output: output(JSON.stringify({ schema: 'nexyfab.cable-tray-conduit-exchange.v1', revision: 3, sourceWorkspaceId: 'workspace-c', sourceModelId: 'model-c', sourceModelSha256: sha256('cable-primary-source'), sourceContentHash: HASH_B, sourceRawArtifactSha256: sha256('cable-raw-source'), routeIds: ['cr1'], portIds: ['cp1', 'cp2'], segmentIds: ['cs1'], fittingIds: [], cableIds: ['cable1'], supportIds: ['csup1'] })),
  } satisfies CableTrayConduitReleaseInputV1;
  return { release, readback: parseCableTrayConduitOutput(release) };
}

function fixture(track: MepTrack) {
  if (track === 'piping') return pipingFixture();
  if (track === 'hvac') return hvacFixture();
  return cableFixture();
}

function makeAttestation(track: MepTrack, role: 'independent_parser_cad_reviewer' | 'field_manufacturing_reviewer', targetHash: string, revision: number, evidenceIds: string[], now = NOW) {
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const unsigned: Omit<IndependentReviewerAttestation, 'signatureBase64' | 'publicKeyPem'> = { attestationId: `${role}-${track}`, track, role, reviewerId: `${role}-id`, keyId, targetHash, revision, issuedAt: now, expiresAt: '2026-09-01T12:00:00.000Z', axes: [...MEP_REQUIRED_AXES[track]], evidenceIds };
  const signatureBase64 = sign(null, Buffer.from(canonicalMepAttestationPayload({ ...unsigned, publicKeyPem, signatureBase64: '' }), 'utf8'), keys.privateKey).toString('base64');
  const attestation = { ...unsigned, publicKeyPem, signatureBase64 };
  return { attestation, registration: { keyId: unsigned.keyId, publicKeyPem, roles: [role] } };
}

function qualifiedInput(track: MepTrack) {
  const value = fixture(track);
  const releaseTargetHash = hashMepQualificationTarget(track, value.release);
  const evidenceArtifacts: Record<string, Uint8Array> = {};
  const evidence: QualificationEvidenceReceipt[] = MEP_REQUIRED_AXES[track].map((axis, index) => {
    const artifactId = `${track}-artifact-${index}`;
    const bytes = Buffer.from(`${track}:${axis}:measured-evidence:${index}`, 'utf8');
    evidenceArtifacts[artifactId] = bytes;
    return { evidenceId: `${track}-evidence-${index}`, track, axis, artifactId, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, revision: 3, targetHash: releaseTargetHash, capturedAt: NOW, expiresAt: '2026-09-01T12:00:00.000Z' };
  });
  const targetHash = hashMepQualificationTarget(track, value.release, evidence, value.readback);
  const evidenceIds = evidence.map(item => item.evidenceId);
  const parser = makeAttestation(track, 'independent_parser_cad_reviewer', targetHash, 3, evidenceIds);
  const field = makeAttestation(track, 'field_manufacturing_reviewer', targetHash, 3, evidenceIds);
  return {
    track, release: value.release, readback: value.readback, sourceArtifacts: sourceArtifacts(track), evidence, evidenceArtifacts,
    trustedReviewers: {
      [parser.attestation.reviewerId]: parser.registration,
      [field.attestation.reviewerId]: field.registration,
    },
    attestations: { parserCad: parser.attestation, fieldManufacturing: field.attestation }, now: NOW,
  };
}

const qualify = (input: Parameters<typeof qualifyMepFabrication>[0]) => qualifyMepFabrication(input, NOW);

describe('MEP fabrication qualification', () => {
  it.each(['piping', 'hvac', 'cable'] as const)('qualifies %s only with both independent signed reviewers and every required axis', track => {
    const result = qualify(qualifiedInput(track));
    expect(result).toMatchObject({ schema: 'nexyfab.mep-fabrication-qualification.v1', track, status: 'QUALIFIED', qualified: true, internalValidation: { valid: true }, internalReadback: { valid: true }, independentAttestation: { valid: true }, evidence: { valid: true } });
    expect(result.blockers).toEqual([]);
  });

  it('holds when any real evidence axis is missing or an internal readback is absent', () => {
    const input = qualifiedInput('hvac');
    input.evidence = input.evidence.filter(item => item.axis !== 'tab_field');
    expect(qualify(input)).toMatchObject({ status: 'HOLD', qualified: false, blockers: expect.arrayContaining(['evidence_axis_missing:tab_field', 'independent_parser_cad_reviewer:evidence_axes_incomplete']) });
    const noReadback = qualifiedInput('piping') as any; noReadback.readback = null;
    expect(qualify(noReadback)).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining(['internal_readback:readback_missing']) });
  });

  it('blocks cross-track, cross-role, same-key, stale, and replayed attestations', () => {
    const input = qualifiedInput('cable');
    input.attestations.parserCad = { ...input.attestations.parserCad, track: 'hvac' };
    expect(qualify(input).blockers).toContain('independent_parser_cad_reviewer:cross_track');
    const role = qualifiedInput('cable'); role.attestations.fieldManufacturing = { ...role.attestations.fieldManufacturing, role: 'independent_parser_cad_reviewer' };
    expect(qualify(role).blockers).toContain('field_manufacturing_reviewer:cross_role');
    const sameKey = qualifiedInput('cable'); sameKey.attestations.fieldManufacturing = { ...sameKey.attestations.fieldManufacturing, keyId: sameKey.attestations.parserCad.keyId, publicKeyPem: sameKey.attestations.parserCad.publicKeyPem };
    expect(qualify(sameKey).blockers).toContain('attestation_keys_must_be_distinct');
    const stale = qualifiedInput('cable'); stale.attestations.parserCad = { ...stale.attestations.parserCad, revision: 2 };
    expect(qualify(stale).blockers).toContain('independent_parser_cad_reviewer:stale_revision');
    const replay = qualifiedInput('cable'); replay.attestations.fieldManufacturing = { ...replay.attestations.fieldManufacturing, attestationId: replay.attestations.parserCad.attestationId };
    expect(qualify(replay).blockers).toContain('attestation_replay_duplicate_id');
  });

  it('blocks signature tampering, target tampering, source/output SHA drift, and stale evidence', () => {
    const signature = qualifiedInput('piping'); signature.attestations.parserCad = { ...signature.attestations.parserCad, signatureBase64: `${signature.attestations.parserCad.signatureBase64.slice(0, -2)}AA` };
    expect(qualify(signature).blockers).toContain('independent_parser_cad_reviewer:signature_invalid');
    const target = qualifiedInput('hvac'); target.attestations.parserCad = { ...target.attestations.parserCad, targetHash: HASH_C };
    expect(qualify(target).blockers).toContain('independent_parser_cad_reviewer:target_hash_mismatch');
    const drift = qualifiedInput('cable') as any; drift.release = { ...drift.release, output: { ...drift.release.output, sha256: HASH_C } };
    expect(qualify(drift).blockers).toEqual(expect.arrayContaining(['internal_validation:output_binding_invalid', 'independent_parser_cad_reviewer:target_hash_mismatch']));
    const staleEvidence = qualifiedInput('hvac'); staleEvidence.evidence = staleEvidence.evidence.map(item => ({ ...item, expiresAt: '2026-08-01T00:00:00.000Z' }));
    expect(qualify(staleEvidence).blockers).toContain('evidence_stale_or_invalid_freshness:hvac-evidence-0');
  });

  it('does not trust a self-declared key and verifies the actual evidence bytes', () => {
    const untrusted = qualifiedInput('piping');
    untrusted.trustedReviewers = {};
    expect(qualify(untrusted).blockers).toContain('independent_parser_cad_reviewer:reviewer_not_trusted_for_role');

    const bytes = qualifiedInput('hvac');
    bytes.evidenceArtifacts[bytes.evidence[0]!.artifactId] = Buffer.from('tampered');
    expect(qualify(bytes).blockers).toContain(`evidence_artifact_bytes_mismatch:${bytes.evidence[0]!.artifactId}`);

    const source = qualifiedInput('piping');
    source.sourceArtifacts.primary = Buffer.from('tampered-source');
    expect(qualify(source).blockers).toContain('source_primary_artifact_mismatch');

    const reused = qualifiedInput('cable');
    reused.evidence[1] = { ...reused.evidence[1]!, sha256: reused.evidence[0]!.sha256 };
    expect(qualify(reused).blockers).toContain(`evidence_artifact_hash_reused:${reused.evidence[0]!.sha256}`);
  });

  it('uses verifier time, normalized key identity, and the exact signed evidence set', () => {
    const stale = qualifiedInput('piping');
    stale.now = '2026-07-01T00:00:00.000Z';
    stale.evidence = stale.evidence.map(item => ({ ...item, expiresAt: '2026-08-01T00:00:00.000Z' }));
    expect(qualify(stale).blockers).toContain('evidence_stale_or_invalid_freshness:piping-evidence-0');

    const sameKey = qualifiedInput('cable');
    sameKey.attestations.fieldManufacturing = {
      ...sameKey.attestations.fieldManufacturing,
      keyId: sameKey.attestations.parserCad.keyId,
      publicKeyPem: sameKey.attestations.parserCad.publicKeyPem.replace(/\n/g, '\r\n'),
    };
    expect(qualify(sameKey).blockers).toContain('attestation_keys_must_be_distinct');

    const subset = qualifiedInput('hvac');
    subset.attestations.parserCad = { ...subset.attestations.parserCad, evidenceIds: subset.attestations.parserCad.evidenceIds.slice(1) };
    expect(qualify(subset).blockers).toContain('independent_parser_cad_reviewer:evidence_set_mismatch');
  });

  it('binds readback identity and fails closed for malformed runtime input and source/evidence role reuse', () => {
    const value = qualifiedInput('piping');
    const originalTarget = value.attestations.parserCad.targetHash;
    const readbackChanged = { ...value.readback, parserSourceSha256: HASH_A } as typeof value.readback;
    expect(hashMepQualificationTarget(value.track, value.release, value.evidence, readbackChanged)).not.toBe(originalTarget);

    const missingAttestation = qualifiedInput('cable') as any;
    delete missingAttestation.attestations.parserCad;
    expect(() => qualify(missingAttestation)).not.toThrow();
    expect(qualify(missingAttestation)).toMatchObject({ status: 'HOLD', qualified: false, blockers: expect.arrayContaining(['independent_parser_cad_reviewer:attestation_missing']) });
    expect(qualifyMepFabrication(null, NOW)).toMatchObject({ status: 'HOLD', qualified: false, blockers: ['input_missing'] });

    const reused = qualifiedInput('hvac');
    const sourceBytes = reused.sourceArtifacts.primary;
    reused.evidenceArtifacts[reused.evidence[0]!.artifactId] = sourceBytes;
    reused.evidence[0] = { ...reused.evidence[0]!, sha256: createHash('sha256').update(sourceBytes).digest('hex'), bytes: sourceBytes.byteLength };
    expect(qualify(reused).blockers).toContain(`evidence_artifact_hash_reuses_source_or_output:${reused.evidence[0]!.sha256}`);
  });
});
