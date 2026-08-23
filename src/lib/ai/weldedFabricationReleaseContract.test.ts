import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WELDED_FABRICATION_RELEASE_SCHEMA,
  assessWeldedFabricationRelease,
  weldedFabricationReadbackVerificationSha256,
  validateWeldedFabricationRelease,
  verifyWeldedFabricationReadback,
  type WeldedFabricationParserReadbackV1,
  type WeldedFabricationReleaseInputV1,
} from './weldedFabricationReleaseContract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const revision = 12;
const revisionSha256 = hash('design-revision-12');
const outputContent = JSON.stringify({ assembly: 'frame-1', joints: ['joint-1'], members: ['member-a', 'member-b'] });

function release(): WeldedFabricationReleaseInputV1 {
  const provenance = { sourceId: 'material-cert-1', sourceRef: 'material://lot-1', capturedAt: '2026-08-22T00:00:00.000Z', revisionSha256 };
  return {
    schema: WELDED_FABRICATION_RELEASE_SCHEMA,
    units: 'mm-N',
    revision,
    source: { assemblyId: 'frame-1', brepPath: 'source/frame.step', brepBytes: 4096, brepSha256: hash('frame-brep'), contentHash: hash('frame-content'), revisionSha256, revision },
    members: [
      { id: 'member-a', materialId: 'steel', grade: 'S355', thicknessMm: 6, provenance },
      { id: 'member-b', materialId: 'steel', grade: 'S355', thicknessMm: 6, provenance },
    ],
    joints: [{ id: 'joint-1', memberAId: 'member-a', memberBId: 'member-b', type: 'fillet', sizeMm: 5, lengthMm: 100, continuity: 'continuous', process: 'GMAW', wpsReference: 'WPS-001', weldPathId: 'path-1' }],
    weldPaths: [{ id: 'path-1', jointId: 'joint-1', pointsMm: [{ xMm: 0, yMm: 0, zMm: 0 }, { xMm: 100, yMm: 0, zMm: 0 }], geometryLengthMm: 100 }],
    bom: [{ id: 'bom-a', memberId: 'member-a', quantity: 1 }, { id: 'bom-b', memberId: 'member-b', quantity: 1 }],
    weldSchedule: [{ id: 'schedule-1', jointId: 'joint-1', quantity: 1, totalLengthMm: 100 }],
    output: { format: 'json', revision, content: outputContent, bytes: Buffer.byteLength(outputContent), sha256: hash(outputContent) },
  };
}

function readback(input: WeldedFabricationReleaseInputV1): WeldedFabricationParserReadbackV1 {
  const value: WeldedFabricationParserReadbackV1 = {
    parserId: 'nexyfab.welded-fabrication-independent-parser.v1',
    parserSourceSha256: hash('welded-independent-parser-source'),
    sourceAssemblyId: input.source.assemblyId,
    sourceBrepSha256: input.source.brepSha256,
    sourceContentHash: input.source.contentHash,
    sourceRevision: input.revision,
    outputSha256: input.output.sha256,
    memberIds: input.members.map(item => item.id),
    jointIds: input.joints.map(item => item.id),
    weldPathIds: input.weldPaths.map(item => item.id),
    bomLineIds: input.bom.map(item => item.id),
    scheduleLineIds: input.weldSchedule.map(item => item.id),
    verificationSha256: '',
  };
  value.verificationSha256 = weldedFabricationReadbackVerificationSha256(value);
  return value;
}

describe('welded fabrication release contract', () => {
  it('binds assembly/B-rep hashes, material provenance, ownership, path geometry, BOM, and weld schedule', () => {
    const value = release();
    expect(validateWeldedFabricationRelease(value)).toEqual({ valid: true, issues: [] });
    expect(verifyWeldedFabricationReadback(value, readback(value))).toEqual({ valid: true, issues: [] });
  });

  it('fails closed on stale/tampered source, dangling ownership, duplicate IDs, zero paths, and quantity mismatch', () => {
    const value = release();
    value.source.revision = revision - 1;
    value.source.revisionSha256 = hash('other-revision');
    value.joints[0]!.memberBId = 'missing-member';
    value.weldPaths[0]!.geometryLengthMm = 0;
    value.weldSchedule[0]!.totalLengthMm = 999;
    value.bom = [...value.bom, { id: 'bom-a', memberId: 'member-a', quantity: 1 }];
    const result = validateWeldedFabricationRelease(value);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'stale_source_revision',
      'member_provenance_invalid:member-a',
      'joint_member_ownership_invalid:joint-1',
      'weld_path_length_mismatch:path-1',
      'schedule_length_or_quantity_invalid:schedule-1',
      'bom_line_id_invalid:bom-a',
    ]));
  });

  it('rejects parser identity/output hash drift and keeps fabrication release HOLD', () => {
    const value = release();
    const parsed = readback(value);
    parsed.outputSha256 = hash('tampered-output');
    parsed.weldPathIds = [];
    const result = verifyWeldedFabricationReadback(value, parsed);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['readback_output_hash_mismatch', 'readback_weld_path_identity_mismatch', 'readback_verification_hash_mismatch']));
    const assessment = assessWeldedFabricationRelease(value, readback(value));
    expect(assessment).toMatchObject({ releaseReady: false, status: 'HOLD', parserVerified: true });
    expect(assessment.blockers).toEqual(expect.arrayContaining(['wps_pqr_qualification_not_run', 'welder_qualification_not_verified', 'ndt_and_dimensional_inspection_not_run', 'field_fabrication_receipt_not_available']));
  });

  it('rejects absolute source paths and a joint/path ownership swap', () => {
    const value = release();
    value.source.brepPath = '/private/frame.step';
    value.joints = [...value.joints, { ...value.joints[0]!, id: 'joint-2', weldPathId: 'path-2' }];
    value.weldPaths = [
      { ...value.weldPaths[0]!, jointId: 'joint-2' },
      { ...value.weldPaths[0]!, id: 'path-2', jointId: 'joint-1' },
    ];
    expect(validateWeldedFabricationRelease(value).issues).toEqual(expect.arrayContaining([
      'source_brep_path_invalid',
      'joint_weld_path_ownership_invalid:joint-1',
      'joint_weld_path_ownership_invalid:joint-2',
    ]));
  });

  it('fails closed without throwing on malformed untrusted records', () => {
    const malformed = release() as unknown as Record<string, unknown>;
    malformed.source = { ...release().source, brepPath: undefined };
    malformed.members = [null];
    malformed.joints = [null];
    malformed.weldPaths = [null];
    malformed.bom = [null];
    malformed.weldSchedule = [null];
    expect(() => validateWeldedFabricationRelease(malformed as unknown as WeldedFabricationReleaseInputV1)).not.toThrow();
    expect(validateWeldedFabricationRelease(malformed as unknown as WeldedFabricationReleaseInputV1).valid).toBe(false);
  });
});
