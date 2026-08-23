import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MOLD_TOOLING_RELEASE_SCHEMA,
  assessMoldToolingRelease,
  moldToolingReadbackVerificationSha256,
  validateMoldToolingRelease,
  verifyMoldToolingReadback,
  type MoldToolingParserReadbackV1,
  type MoldToolingReleaseInputV1,
} from './moldToolingReleaseContract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const revision = 4;
const revisionSha256 = hash('revision-4');
const outputContent = JSON.stringify({ part: 'housing-1', faces: ['face-1', 'face-2'], sliders: ['slider-1'] });

function release(): MoldToolingReleaseInputV1 {
  const material = { materialId: 'PA66-GF30', shrinkAllowancePercent: 1.2, sourceId: 'mat-datasheet-1', sourceRef: 'material://pa66-gf30', capturedAt: '2026-08-22T00:00:00.000Z', revisionSha256 };
  return {
    schema: MOLD_TOOLING_RELEASE_SCHEMA,
    units: 'mm-deg',
    revision,
    source: { partId: 'housing-1', brepPath: 'source/housing.step', brepBytes: 8192, brepSha256: hash('housing-brep'), contentHash: hash('housing-content'), revisionSha256, revision },
    material,
    pullDirection: { x: 0, y: 0, z: 1, frame: 'global_cartesian', normalized: true },
    faces: [
      { id: 'face-1', partId: 'housing-1', draftAngleDeg: 2, requiredDraftDeg: 1, wallThicknessMm: 2.5 },
      { id: 'face-2', partId: 'housing-1', draftAngleDeg: 3, requiredDraftDeg: 1, wallThicknessMm: 2.5 },
    ],
    partingLine: [
      { id: 'parting-1', startMm: [0, 0, 0], endMm: [100, 0, 0] },
      { id: 'parting-2', startMm: [100, 0, 0], endMm: [100, 60, 0] },
      { id: 'parting-3', startMm: [100, 60, 0], endMm: [0, 60, 0] },
      { id: 'parting-4', startMm: [0, 60, 0], endMm: [0, 0, 0] },
    ],
    coreCavities: [
      { id: 'core-1', kind: 'core', partId: 'housing-1', faceIds: ['face-1'] },
      { id: 'cavity-1', kind: 'cavity', partId: 'housing-1', faceIds: ['face-2'] },
    ],
    undercuts: [{ id: 'undercut-1', faceId: 'face-2', response: 'slider', responseId: 'slider-1' }],
    sliders: [{ id: 'slider-1', partId: 'housing-1', undercutId: 'undercut-1', travelMm: 12 }],
    ejectors: [{ id: 'ejector-1', partId: 'housing-1', faceId: 'face-1', positionMm: [20, 20, 0], diameterMm: 4 }],
    cooling: [{ id: 'cooling-1', partId: 'housing-1', pointsMm: [[10, 10, 5], [90, 10, 5]], lengthMm: 80 }],
    output: { format: 'json', revision, content: outputContent, bytes: Buffer.byteLength(outputContent), sha256: hash(outputContent) },
  };
}

function readback(input: MoldToolingReleaseInputV1): MoldToolingParserReadbackV1 {
  const value: MoldToolingParserReadbackV1 = {
    parserId: 'nexyfab.mold-tooling-independent-parser.v1',
    parserSourceSha256: hash('mold-independent-parser-source'),
    sourcePartId: input.source.partId,
    sourceBrepSha256: input.source.brepSha256,
    sourceContentHash: input.source.contentHash,
    sourceRevision: input.revision,
    outputSha256: input.output.sha256,
    faceIds: input.faces.map(item => item.id),
    partingSegmentIds: input.partingLine.map(item => item.id),
    coreCavityIds: input.coreCavities.map(item => item.id),
    undercutIds: input.undercuts.map(item => item.id),
    sliderIds: input.sliders.map(item => item.id),
    ejectorIds: input.ejectors.map(item => item.id),
    coolingIds: input.cooling.map(item => item.id),
    verificationSha256: '',
  };
  value.verificationSha256 = moldToolingReadbackVerificationSha256(value);
  return value;
}

describe('mold tooling DFM release contract', () => {
  it('binds part B-rep/revision, shrink provenance, pull direction, DFM ownership, and output identity', () => {
    const value = release();
    expect(validateMoldToolingRelease(value)).toEqual({ valid: true, issues: [] });
    expect(verifyMoldToolingReadback(value, readback(value))).toEqual({ valid: true, issues: [] });
  });

  it('fails closed on stale/tampered source, draft/wall issues, open parting, dangling undercut, and duplicate IDs', () => {
    const value = release();
    value.source.revision = revision - 1;
    value.material.revisionSha256 = hash('other-revision');
    value.faces[0]!.draftAngleDeg = 0;
    value.faces[1]!.wallThicknessMm = 0;
    value.partingLine[3]!.endMm = [2, 2, 2];
    value.undercuts[0]!.responseId = 'missing-slider';
    value.sliders = [...value.sliders, { id: 'slider-1', partId: 'housing-1', undercutId: 'undercut-1', travelMm: 12 }];
    const result = validateMoldToolingRelease(value);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'stale_source_revision',
      'material_provenance_invalid',
      'draft_invalid:face-1',
      'wall_thickness_invalid:face-2',
      'parting_line_not_closed:parting-4',
      'undercut_response_missing:undercut-1',
      'slider_id_invalid:slider-1',
    ]));
  });

  it('rejects parser hash/identity drift and never marks production tooling release ready', () => {
    const value = release();
    const parsed = readback(value);
    parsed.outputSha256 = hash('tampered-output');
    parsed.coolingIds = [];
    const result = verifyMoldToolingReadback(value, parsed);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['readback_output_hash_mismatch', 'readback_cooling_identity_mismatch', 'readback_verification_hash_mismatch']));
    const assessment = assessMoldToolingRelease(value, readback(value));
    expect(assessment).toMatchObject({ releaseReady: false, status: 'HOLD', parserVerified: true });
    expect(assessment.blockers).toEqual(expect.arrayContaining(['moldflow_cae_not_run', 'tool_steel_and_heat_treatment_not_verified', 'machine_tryout_t0_not_run', 'metrology_and_production_receipt_not_available']));
  });

  it('rejects absolute sources, incomplete core/cavity splits, reverse ownership drift, and forged cooling length', () => {
    const value = release();
    value.source.brepPath = 'C:\\private\\housing.step';
    value.coreCavities = value.coreCavities.filter(item => item.kind === 'core');
    value.sliders[0]!.undercutId = 'other-undercut';
    value.cooling[0]!.lengthMm = 79;
    expect(validateMoldToolingRelease(value).issues).toEqual(expect.arrayContaining([
      'source_brep_path_invalid',
      'core_and_cavity_required',
      'undercut_slider_ownership_invalid:undercut-1',
      'cooling_length_mismatch:cooling-1',
    ]));
  });

  it('fails closed without throwing on malformed untrusted records', () => {
    const malformed = release() as unknown as Record<string, unknown>;
    malformed.source = { ...release().source, brepPath: undefined };
    malformed.faces = [null];
    malformed.partingLine = [null];
    malformed.coreCavities = [null];
    malformed.undercuts = [null];
    malformed.sliders = [null];
    malformed.ejectors = [null];
    malformed.cooling = [null];
    expect(() => validateMoldToolingRelease(malformed as unknown as MoldToolingReleaseInputV1)).not.toThrow();
    expect(validateMoldToolingRelease(malformed as unknown as MoldToolingReleaseInputV1).valid).toBe(false);
  });
});
