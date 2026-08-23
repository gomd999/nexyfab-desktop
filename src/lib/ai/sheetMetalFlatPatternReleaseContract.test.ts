import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA,
  assessSheetMetalFlatPatternRelease,
  sheetMetalFlatPatternReadbackVerificationSha256,
  validateSheetMetalFlatPatternRelease,
  verifySheetMetalFlatPatternReadback,
  type SheetMetalFlatPatternReleaseInputV1,
  type SheetMetalFlatPatternParserReadbackV1,
} from './sheetMetalFlatPatternReleaseContract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const revision = 7;
const outputContent = JSON.stringify({ format: 'json', outline: ['outline-1', 'outline-2', 'outline-3', 'outline-4'], holes: ['hole-1'], bendLines: ['bend-line-1'] });

function release(): SheetMetalFlatPatternReleaseInputV1 {
  const thicknessMm = 2;
  const kFactor = 0.42;
  const innerRadiusMm = 3;
  const angleDeg = 90;
  const theta = Math.PI / 2;
  const neutralAxisRadiusMm = innerRadiusMm + kFactor * thicknessMm;
  const bendAllowanceMm = theta * neutralAxisRadiusMm;
  const bendDeductionMm = 2 * (innerRadiusMm + thicknessMm) * Math.tan(theta / 2) - bendAllowanceMm;
  return {
    schema: SHEET_METAL_FLAT_PATTERN_RELEASE_SCHEMA,
    revision,
    source: { brepPath: 'source/bracket.step', brepBytes: 1280, brepSha256: hash('source-brep'), contentHash: hash('source-content'), revision },
    parameters: { units: 'mm', thicknessMm, materialId: 'steel-mild', kFactor, bendRadiusMm: innerRadiusMm, neutralAxisConvention: 'inner_radius_plus_k_factor_times_thickness' },
    bends: [{ id: 'bend-1', angleDeg, innerRadiusMm, positionMm: 20, neutralAxisRadiusMm, bendAllowanceMm, bendDeductionMm }],
    outline: [
      { id: 'outline-1', start: { xMm: 0, yMm: 0 }, end: { xMm: 100, yMm: 0 } },
      { id: 'outline-2', start: { xMm: 100, yMm: 0 }, end: { xMm: 100, yMm: 60 } },
      { id: 'outline-3', start: { xMm: 100, yMm: 60 }, end: { xMm: 0, yMm: 60 } },
      { id: 'outline-4', start: { xMm: 0, yMm: 60 }, end: { xMm: 0, yMm: 0 } },
    ],
    holes: [{ id: 'hole-1', center: { xMm: 25, yMm: 25 }, radiusMm: 4 }],
    bendLines: [{ id: 'bend-line-1', bendId: 'bend-1', start: { xMm: 20, yMm: 0 }, end: { xMm: 20, yMm: 60 } }],
    output: { format: 'json', revision, content: outputContent, bytes: Buffer.byteLength(outputContent), sha256: hash(outputContent) },
  };
}

function readback(input: SheetMetalFlatPatternReleaseInputV1): SheetMetalFlatPatternParserReadbackV1 {
  const value: SheetMetalFlatPatternParserReadbackV1 = {
    parserId: 'nexyfab.sheet-metal-flat-pattern-independent-parser.v1',
    parserSourceSha256: hash('independent-parser-source'),
    sourceBrepSha256: input.source.brepSha256,
    sourceContentHash: input.source.contentHash,
    sourceRevision: input.revision,
    outputSha256: input.output.sha256,
    outlineIds: input.outline.map(item => item.id),
    holeIds: input.holes.map(item => item.id),
    bendLineIds: input.bendLines.map(item => item.id),
    bendIds: input.bends.map(item => item.id),
    verificationSha256: '',
  };
  value.verificationSha256 = sheetMetalFlatPatternReadbackVerificationSha256(value);
  return value;
}

describe('sheet-metal flat-pattern release contract', () => {
  it('validates source binding, canonical bend math, stable flat topology, and output bytes hash', () => {
    const value = release();
    expect(validateSheetMetalFlatPatternRelease(value)).toEqual({ valid: true, issues: [] });
    expect(verifySheetMetalFlatPatternReadback(value, readback(value))).toEqual({ valid: true, issues: [] });
  });

  it('fails closed for stale source/output, wrong neutral-axis math, missing bends, and self-intersection', () => {
    const value = release();
    value.source.revision = revision - 1;
    value.output.revision = revision - 1;
    value.bends[0]!.bendDeductionMm += 1;
    value.bendLines = [];
    value.outline = [
      { id: 'outline-1', start: { xMm: 0, yMm: 0 }, end: { xMm: 100, yMm: 60 } },
      { id: 'outline-2', start: { xMm: 100, yMm: 60 }, end: { xMm: 100, yMm: 0 } },
      { id: 'outline-3', start: { xMm: 100, yMm: 0 }, end: { xMm: 0, yMm: 60 } },
      { id: 'outline-4', start: { xMm: 0, yMm: 60 }, end: { xMm: 0, yMm: 0 } },
    ];
    const result = validateSheetMetalFlatPatternRelease(value);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'stale_source_revision',
      'stale_output_revision',
      'bend_deduction_mismatch:bend-1',
      'bend_missing_from_output:bend-1',
      'outline_self_intersection',
    ]));
  });

  it('rejects parser readback identity/hash drift and never marks manufacturing release ready', () => {
    const value = release();
    const parsed = readback(value);
    parsed.outputSha256 = hash('different-output');
    parsed.holeIds = [];
    const readbackResult = verifySheetMetalFlatPatternReadback(value, parsed);
    expect(readbackResult.valid).toBe(false);
    expect(readbackResult.issues).toEqual(expect.arrayContaining(['readback_output_hash_mismatch', 'readback_hole_identity_mismatch', 'readback_verification_hash_mismatch']));
    const assessment = assessSheetMetalFlatPatternRelease(value, readback(value));
    expect(assessment).toMatchObject({ releaseReady: false, status: 'HOLD', parserVerified: true });
    expect(assessment.blockers).toEqual(expect.arrayContaining(['press_brake_and_tooling_not_run', 'material_lot_not_verified', 'manufacturing_receipt_not_available']));
  });

  it('rejects absolute source paths, edge-breaking holes, overlaps, and bend-radius drift', () => {
    const value = release();
    value.source.brepPath = 'C:\\private\\source.step';
    value.holes[0]!.center = { xMm: 2, yMm: 2 };
    value.holes = [...value.holes, { id: 'hole-2', center: { xMm: 3, yMm: 3 }, radiusMm: 4 }];
    value.bends[0]!.innerRadiusMm = 4;
    expect(validateSheetMetalFlatPatternRelease(value).issues).toEqual(expect.arrayContaining([
      'source_brep_path_invalid',
      'hole_invalid:hole-1',
      'hole_overlap:hole-1:hole-2',
      'bend_radius_parameter_mismatch:bend-1',
    ]));
  });

  it('fails closed without throwing on malformed untrusted records', () => {
    const malformed = release() as unknown as Record<string, unknown>;
    malformed.source = { ...release().source, brepPath: undefined };
    malformed.bends = [null];
    malformed.outline = [null, null, null];
    malformed.holes = [null];
    malformed.bendLines = [null];
    expect(() => validateSheetMetalFlatPatternRelease(malformed as unknown as SheetMetalFlatPatternReleaseInputV1)).not.toThrow();
    expect(validateSheetMetalFlatPatternRelease(malformed as unknown as SheetMetalFlatPatternReleaseInputV1).valid).toBe(false);
  });
});
