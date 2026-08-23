import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MOLD_TOOLING_RELEASE_SCHEMA,
  moldToolingReadbackVerificationSha256,
  type MoldToolingParserReadbackV1,
  type MoldToolingReleaseInputV1,
} from './moldToolingReleaseContract';
import {
  SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA,
  sheetMetalFlatPatternReadbackVerificationSha256,
  type SheetMetalFlatPatternParserReadbackV1,
  type SheetMetalFlatPatternReleaseInputV1,
} from './sheetMetalFlatPatternReleaseContract';
import {
  WELDED_FABRICATION_RELEASE_SCHEMA,
  weldedFabricationReadbackVerificationSha256,
  type WeldedFabricationParserReadbackV1,
  type WeldedFabricationReleaseInputV1,
} from './weldedFabricationReleaseContract';
import {
  buildSpecialtyQualificationTarget,
  buildSpecialtyReviewerPayload,
  qualifySpecialtyManufacturing,
  specialtyQualificationTargetSha256,
  specialtyReviewerPayloadCanonical,
  type SpecialtyEvidenceArtifactV1,
  type SpecialtyQualificationInput,
  type SpecialtyReviewerRole,
  type SpecialtyReviewerSignatureV1,
} from './specialtyManufacturingQualification';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const revisionSha256 = hash('revision');
const output = (content: string, revision: number) => ({ format: 'json' as const, revision, content, bytes: Buffer.byteLength(content), sha256: hash(content) });
const evidence = (track: SpecialtyQualificationInput['track']): SpecialtyEvidenceArtifactV1[] => ({
  'sheet-metal': [
    ['press_brake_tooling', 'press'], ['material_lot', 'lot'], ['refold_flat_pattern_roundtrip', 'roundtrip'], ['manufacturing_receipt', 'mfg'],
  ],
  'welded-fabrication': [['wps', 'wps'], ['nde_fatigue', 'nde'], ['fabrication_receipt', 'fab']],
  'mold-tooling': [['native_core_cavity', 'core-cavity'], ['cooling_ejector_cam', 'cam'], ['tryout_receipt', 'tryout']],
}[track].map(([kind, id]) => {
  const artifactId = `${track}-${id}`;
  return { artifactId, kind, sha256: hash(artifactId), bytes: Buffer.byteLength(artifactId) };
}));

function sheetInput(): { input: SheetMetalFlatPatternReleaseInputV1; readback: SheetMetalFlatPatternParserReadbackV1 } {
  const revision = 7; const thicknessMm = 2; const kFactor = 0.42; const innerRadiusMm = 3; const angleDeg = 90;
  const neutralAxisRadiusMm = innerRadiusMm + kFactor * thicknessMm; const bendAllowanceMm = (Math.PI / 2) * neutralAxisRadiusMm;
  const bendDeductionMm = 2 * (innerRadiusMm + thicknessMm) - bendAllowanceMm;
  const content = JSON.stringify({ outline: ['o1', 'o2', 'o3', 'o4'], hole: 'h1', bend: 'b1' });
  const input: SheetMetalFlatPatternReleaseInputV1 = {
    schema: SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA, revision,
    source: { brepPath: 'source/bracket.step', brepBytes: Buffer.byteLength('sheet-brep'), brepSha256: hash('sheet-brep'), contentHash: hash('sheet-content'), revision },
    parameters: { units: 'mm', thicknessMm, materialId: 'steel', kFactor, bendRadiusMm: innerRadiusMm, neutralAxisConvention: 'inner_radius_plus_k_factor_times_thickness' },
    bends: [{ id: 'b1', angleDeg, innerRadiusMm, positionMm: 20, neutralAxisRadiusMm, bendAllowanceMm, bendDeductionMm }],
    outline: [
      { id: 'o1', start: { xMm: 0, yMm: 0 }, end: { xMm: 100, yMm: 0 } }, { id: 'o2', start: { xMm: 100, yMm: 0 }, end: { xMm: 100, yMm: 60 } },
      { id: 'o3', start: { xMm: 100, yMm: 60 }, end: { xMm: 0, yMm: 60 } }, { id: 'o4', start: { xMm: 0, yMm: 60 }, end: { xMm: 0, yMm: 0 } },
    ],
    holes: [{ id: 'h1', center: { xMm: 25, yMm: 25 }, radiusMm: 4 }],
    bendLines: [{ id: 'bl1', bendId: 'b1', start: { xMm: 20, yMm: 0 }, end: { xMm: 20, yMm: 60 } }],
    output: output(content, revision),
  };
  const readback: SheetMetalFlatPatternParserReadbackV1 = {
    parserId: 'nexyfab.sheet-metal-flat-pattern-independent-parser.v1', parserSourceSha256: hash('sheet-parser'), sourceBrepSha256: input.source.brepSha256,
    sourceContentHash: input.source.contentHash, sourceRevision: revision, outputSha256: input.output.sha256, outlineIds: ['o1', 'o2', 'o3', 'o4'], holeIds: ['h1'], bendLineIds: ['bl1'], bendIds: ['b1'], verificationSha256: '',
  };
  readback.verificationSha256 = sheetMetalFlatPatternReadbackVerificationSha256(readback);
  return { input, readback };
}

function weldInput(): { input: WeldedFabricationReleaseInputV1; readback: WeldedFabricationParserReadbackV1 } {
  const revision = 12; const content = JSON.stringify({ frame: 'frame', joints: ['j1'] });
  const provenance = { sourceId: 'cert', sourceRef: 'material://lot', capturedAt: '2026-08-22T00:00:00.000Z', revisionSha256 };
  const input: WeldedFabricationReleaseInputV1 = {
    schema: WELDED_FABRICATION_RELEASE_SCHEMA, units: 'mm-N', revision,
    source: { assemblyId: 'frame', brepPath: 'source/frame.step', brepBytes: Buffer.byteLength('weld-brep'), brepSha256: hash('weld-brep'), contentHash: hash('weld-content'), revisionSha256, revision },
    members: [{ id: 'm1', materialId: 'steel', grade: 'S355', thicknessMm: 6, provenance }, { id: 'm2', materialId: 'steel', grade: 'S355', thicknessMm: 6, provenance }],
    joints: [{ id: 'j1', memberAId: 'm1', memberBId: 'm2', type: 'fillet', sizeMm: 5, lengthMm: 100, continuity: 'continuous', process: 'GMAW', wpsReference: 'WPS-1', weldPathId: 'p1' }],
    weldPaths: [{ id: 'p1', jointId: 'j1', pointsMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 100, yMm: 0, zMm: 0 }], geometryLengthMm: 100 }],
    bom: [{ id: 'bom1', memberId: 'm1', quantity: 1 }, { id: 'bom2', memberId: 'm2', quantity: 1 }], weldSchedule: [{ id: 's1', jointId: 'j1', quantity: 1, totalLengthMm: 100 }], output: output(content, revision),
  };
  const readback: WeldedFabricationParserReadbackV1 = {
    parserId: 'nexyfab.welded-fabrication-independent-parser.v1', parserSourceSha256: hash('weld-parser'), sourceAssemblyId: 'frame', sourceBrepSha256: input.source.brepSha256, sourceContentHash: input.source.contentHash, sourceRevision: revision, outputSha256: input.output.sha256,
    memberIds: ['m1', 'm2'], jointIds: ['j1'], weldPathIds: ['p1'], bomLineIds: ['bom1', 'bom2'], scheduleLineIds: ['s1'], verificationSha256: '',
  };
  readback.verificationSha256 = weldedFabricationReadbackVerificationSha256(readback);
  return { input, readback };
}

function moldInput(): { input: MoldToolingReleaseInputV1; readback: MoldToolingParserReadbackV1 } {
  const revision = 4; const content = JSON.stringify({ part: 'housing', core: 'core1', cavity: 'cavity1' });
  const material = { materialId: 'PA66', shrinkAllowancePercent: 1.2, sourceId: 'datasheet', sourceRef: 'material://pa66', capturedAt: '2026-08-22T00:00:00.000Z', revisionSha256 };
  const input: MoldToolingReleaseInputV1 = {
    schema: MOLD_TOOLING_RELEASE_SCHEMA, units: 'mm-deg', revision,
    source: { partId: 'housing', brepPath: 'source/housing.step', brepBytes: Buffer.byteLength('mold-brep'), brepSha256: hash('mold-brep'), contentHash: hash('mold-content'), revisionSha256, revision }, material,
    pullDirection: { x: 0, y: 0, z: 1, frame: 'global_cartesian', normalized: true },
    faces: [{ id: 'f1', partId: 'housing', draftAngleDeg: 2, requiredDraftDeg: 1, wallThicknessMm: 2.5 }, { id: 'f2', partId: 'housing', draftAngleDeg: 3, requiredDraftDeg: 1, wallThicknessMm: 2.5 }],
    partingLine: [{ id: 'pl1', startMm: [0, 0, 0], endMm: [100, 0, 0] }, { id: 'pl2', startMm: [100, 0, 0], endMm: [100, 60, 0] }, { id: 'pl3', startMm: [100, 60, 0], endMm: [0, 60, 0] }, { id: 'pl4', startMm: [0, 60, 0], endMm: [0, 0, 0] }],
    coreCavities: [{ id: 'core1', kind: 'core', partId: 'housing', faceIds: ['f1'] }, { id: 'cavity1', kind: 'cavity', partId: 'housing', faceIds: ['f2'] }], undercuts: [{ id: 'u1', faceId: 'f2', response: 'slider', responseId: 'sl1' }], sliders: [{ id: 'sl1', partId: 'housing', undercutId: 'u1', travelMm: 12 }], ejectors: [{ id: 'e1', partId: 'housing', faceId: 'f1', positionMm: [20, 20, 0], diameterMm: 4 }], cooling: [{ id: 'c1', partId: 'housing', pointsMm: [[10, 10, 5], [90, 10, 5]], lengthMm: 80 }], output: output(content, revision),
  };
  const readback: MoldToolingParserReadbackV1 = {
    parserId: 'nexyfab.mold-tooling-independent-parser.v1', parserSourceSha256: hash('mold-parser'), sourcePartId: 'housing', sourceBrepSha256: input.source.brepSha256, sourceContentHash: input.source.contentHash, sourceRevision: revision, outputSha256: input.output.sha256,
    faceIds: ['f1', 'f2'], partingSegmentIds: ['pl1', 'pl2', 'pl3', 'pl4'], coreCavityIds: ['core1', 'cavity1'], undercutIds: ['u1'], sliderIds: ['sl1'], ejectorIds: ['e1'], coolingIds: ['c1'], verificationSha256: '',
  };
  readback.verificationSha256 = moldToolingReadbackVerificationSha256(readback);
  return { input, readback };
}

function fixtures(track: SpecialtyQualificationInput['track']): SpecialtyQualificationInput {
  if (track === 'sheet-metal') { const value = sheetInput(); return { track, contractInput: value.input, readback: value.readback, evidence: evidence(track) }; }
  if (track === 'welded-fabrication') { const value = weldInput(); return { track, contractInput: value.input, readback: value.readback, evidence: evidence(track) }; }
  const value = moldInput(); return { track, contractInput: value.input, readback: value.readback, evidence: evidence(track) };
}

function signaturesFor(input: SpecialtyQualificationInput, now: Date, sameKey = false): SpecialtyReviewerSignatureV1[] {
  const targetSha256 = specialtyQualificationTargetSha256(input);
  const roles: SpecialtyReviewerRole[] = ['independent_parser_cad_reviewer', 'manufacturing_reviewer'];
  const keys = roles.map(() => generateKeyPairSync('ed25519'));
  if (sameKey) keys[1] = keys[0]!;
  return roles.map((role, index) => {
    const reviewerId = `${role}-reviewer`;
    const publicKeyPem = keys[index]!.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyIdSha256 = hash(keys[index]!.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
    const reviewedAt = now.toISOString();
    const payload = buildSpecialtyReviewerPayload(input.track, role, reviewerId, reviewedAt, targetSha256, keyIdSha256);
    return { reviewerRole: role, reviewerId, reviewedAt, publicKeyPem, keyIdSha256, signatureBase64: sign(null, Buffer.from(specialtyReviewerPayloadCanonical(payload)), keys[index]!.privateKey).toString('base64') };
  });
}

function verificationContext(input: SpecialtyQualificationInput, signatures: SpecialtyReviewerSignatureV1[]) {
  const sourceValue = input.track === 'sheet-metal' ? 'sheet-brep' : input.track === 'welded-fabrication' ? 'weld-brep' : 'mold-brep';
  return {
    sourceBrepBytes: Buffer.from(sourceValue),
    evidenceArtifacts: Object.fromEntries(input.evidence.map(item => [item.artifactId, Buffer.from(item.artifactId)])),
    trustedReviewers: Object.fromEntries(signatures.map(item => [item.reviewerId, {
      keyIdSha256: item.keyIdSha256,
      publicKeyPem: item.publicKeyPem,
      roles: [item.reviewerRole],
    }])),
  };
}

function qualify(input: SpecialtyQualificationInput, signatures: SpecialtyReviewerSignatureV1[], now: Date) {
  return qualifySpecialtyManufacturing(input, signatures, now, verificationContext(input, signatures));
}

describe('specialty manufacturing qualification', () => {
  it.each(['sheet-metal', 'welded-fabrication', 'mold-tooling'] as const)('qualifies %s only with contract/readback, axes, and two independent reviews', track => {
    const input = fixtures(track); const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(input, now); const receipt = qualify(input, signatures, now);
    expect(receipt).toMatchObject({ status: 'QUALIFIED', releaseReady: true, blockers: [] });
    expect(receipt.targetSha256).toBe(specialtyQualificationTargetSha256(input));
    expect(receipt.reviewers.independent_parser_cad_reviewer.valid).toBe(true);
    expect(receipt.reviewers.manufacturing_reviewer.valid).toBe(true);
  });

  it.each(['sheet-metal', 'welded-fabrication', 'mold-tooling'] as const)('holds %s when any external manufacturing axis is absent', track => {
    const input = fixtures(track); input.evidence = input.evidence.slice(1);
    const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(input, now); const receipt = qualify(input, signatures, now);
    expect(receipt.status).toBe('HOLD');
    expect(receipt.releaseReady).toBe(false);
    expect(receipt.blockers).toContain(`external_axis_missing:${receipt.externalAxes.required[0]}`);
  });

  it('rejects replay, cross-track, cross-role, same-key, stale, and tampered target signatures', () => {
    const input = fixtures('sheet-metal') as Extract<SpecialtyQualificationInput, { track: 'sheet-metal' }>; const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(input, now);
    const replayInput: SpecialtyQualificationInput = { track: 'sheet-metal', contractInput: { ...input.contractInput, revision: 8 }, readback: input.readback, evidence: input.evidence };
    const replay = qualify(replayInput, signatures, now);
    expect(replay.status).toBe('HOLD');
    expect(replay.blockers).toContain('independent_parser_cad_reviewer_signature_invalid');
    const crossTrack = fixtures('mold-tooling');
    const crossTrackReceipt = qualify(crossTrack, signatures, now);
    expect(crossTrackReceipt.status).toBe('HOLD');
    expect(crossTrackReceipt.blockers).toContain('independent_parser_cad_reviewer_signature_invalid');
    const swappedSignatures = [signatures[0]!, { ...signatures[1]!, reviewerRole: 'independent_parser_cad_reviewer' as const }];
    const swapped = qualify(input, swappedSignatures, now);
    expect(swapped.status).toBe('HOLD');
    expect(swapped.blockers).toContain('manufacturing_reviewer_signature_missing');
    const sameKeySignatures = signaturesFor(input, now, true); const sameKey = qualify(input, sameKeySignatures, now);
    expect(sameKey.blockers).toContain('reviewer_keys_must_be_distinct');
    const staleAt = new Date('2026-08-01T12:00:00.000Z');
    const staleSignatures = signaturesFor(input, staleAt); const stale = qualify(input, staleSignatures, now);
    expect(stale.blockers).toContain('independent_parser_cad_reviewer_reviewed_at_stale_or_invalid');
    const tampered: SpecialtyQualificationInput = { track: 'sheet-metal', contractInput: input.contractInput, readback: input.readback, evidence: input.evidence.map((item, index) => index === 0 ? { ...item, sha256: hash('tampered') } : item) };
    expect(qualify(tampered, signatures, now).status).toBe('HOLD');
    const sourceTampered: SpecialtyQualificationInput = { track: 'sheet-metal', contractInput: { ...input.contractInput, source: { ...input.contractInput.source, brepSha256: hash('other-source') } }, readback: input.readback, evidence: input.evidence };
    expect(qualify(sourceTampered, signatures, now).status).toBe('HOLD');
    const outputTampered: SpecialtyQualificationInput = { track: 'sheet-metal', contractInput: { ...input.contractInput, output: { ...input.contractInput.output, sha256: hash('other-output') } }, readback: input.readback, evidence: input.evidence };
    expect(qualify(outputTampered, signatures, now).status).toBe('HOLD');
  });

  it('canonicalizes evidence ordering and changes target on source/output tamper', () => {
    const input = fixtures('mold-tooling') as Extract<SpecialtyQualificationInput, { track: 'mold-tooling' }>;
    const reversed = { ...input, evidence: [...input.evidence].reverse() };
    expect(buildSpecialtyQualificationTarget(input)).toEqual(buildSpecialtyQualificationTarget(reversed));
    const changed: SpecialtyQualificationInput = {
      track: 'mold-tooling', readback: input.readback, evidence: input.evidence,
      contractInput: { ...input.contractInput, output: { ...input.contractInput.output, content: 'tampered', sha256: hash('tampered'), bytes: 8 } },
    };
    expect(specialtyQualificationTargetSha256(changed)).not.toBe(specialtyQualificationTargetSha256(input));
  });

  it('requires configured trust and verifies source and evidence bytes', () => {
    const input = fixtures('welded-fabrication'); const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(input, now);
    expect(qualifySpecialtyManufacturing(input, signatures, now).blockers).toEqual(expect.arrayContaining([
      'source_brep_bytes_mismatch',
      'independent_parser_cad_reviewer_reviewer_not_trusted_for_role',
    ]));
    const untrusted = verificationContext(input, signatures); untrusted.trustedReviewers = {};
    expect(qualifySpecialtyManufacturing(input, signatures, now, untrusted).blockers).toContain('manufacturing_reviewer_reviewer_not_trusted_for_role');
    const tampered = verificationContext(input, signatures); tampered.evidenceArtifacts[input.evidence[0]!.artifactId] = Buffer.from('tampered');
    expect(qualifySpecialtyManufacturing(input, signatures, now, tampered).blockers).toContain(`evidence_artifact_bytes_mismatch:${input.evidence[0]!.artifactId}`);
    const sourceTampered = verificationContext(input, signatures); sourceTampered.sourceBrepBytes = Buffer.from('wrong');
    expect(qualifySpecialtyManufacturing(input, signatures, now, sourceTampered).blockers).toContain('source_brep_bytes_mismatch');
  });

  it('binds the complete contract and readback so valid internal mutations cannot replay reviews', () => {
    const original = fixtures('sheet-metal') as Extract<SpecialtyQualificationInput, { track: 'sheet-metal' }>;
    const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(original, now);
    const geometryChanged: typeof original = {
      ...original,
      contractInput: {
        ...original.contractInput,
        bends: original.contractInput.bends.map(item => ({ ...item, positionMm: item.positionMm + 1 })),
      },
    };
    expect(specialtyQualificationTargetSha256(geometryChanged)).not.toBe(specialtyQualificationTargetSha256(original));
    expect(qualify(geometryChanged, signatures, now)).toMatchObject({ status: 'HOLD', releaseReady: false, blockers: expect.arrayContaining(['independent_parser_cad_reviewer_signature_invalid']) });

    const readbackChanged: typeof original = {
      ...original,
      readback: { ...original.readback!, parserSourceSha256: hash('alternate-parser'), verificationSha256: '' },
    };
    readbackChanged.readback!.verificationSha256 = sheetMetalFlatPatternReadbackVerificationSha256(readbackChanged.readback!);
    expect(specialtyQualificationTargetSha256(readbackChanged)).not.toBe(specialtyQualificationTargetSha256(original));
    expect(qualify(readbackChanged, signatures, now).status).toBe('HOLD');
  });

  it('fails closed for unknown reviewer roles, invalid verifier time, malformed evidence, and evidence role reuse', () => {
    const input = fixtures('welded-fabrication');
    const now = new Date('2026-08-22T12:00:00.000Z');
    const signatures = signaturesFor(input, now);
    const unknownRole = { ...signatures[0], reviewerRole: 'release_manager' } as unknown as SpecialtyReviewerSignatureV1;
    expect(qualify(input, [...signatures, unknownRole], now)).toMatchObject({ status: 'HOLD', releaseReady: false, blockers: expect.arrayContaining(['reviewer_role_invalid']) });
    expect(qualifySpecialtyManufacturing(input, signatures, new Date(Number.NaN), verificationContext(input, signatures))).toMatchObject({ status: 'HOLD', blockers: expect.arrayContaining(['qualification_clock_invalid']) });

    const reused = fixtures('mold-tooling');
    const reusedSignatures = signaturesFor(reused, now);
    reused.evidence = reused.evidence.map((item, index) => index === 0 ? { ...item, sha256: reused.contractInput.source.brepSha256, bytes: Buffer.byteLength('mold-brep') } : item);
    const context = verificationContext(reused, reusedSignatures);
    context.evidenceArtifacts[reused.evidence[0]!.artifactId] = Buffer.from('mold-brep');
    expect(qualifySpecialtyManufacturing(reused, reusedSignatures, now, context).blockers).toContain(`evidence_hash_reuses_source_or_output:${reused.contractInput.source.brepSha256}`);

    const malformed = { ...input, evidence: [null] } as unknown as SpecialtyQualificationInput;
    expect(() => qualifySpecialtyManufacturing(malformed, signatures, now, verificationContext(input, signatures))).not.toThrow();
    expect(qualifySpecialtyManufacturing(malformed, signatures, now, verificationContext(input, signatures)).status).toBe('HOLD');
  });
});
