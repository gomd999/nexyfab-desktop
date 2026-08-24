// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA } from './nativeMechanicalExactFeatureLoop';
import {
  BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA,
  createBoundedFlatPatternDxf,
  executeBoundedSheetMetalFlatPattern,
  parseBoundedFlatPatternDxf,
  validateBoundedSheetMetalFlatPatternResult,
} from './boundedSheetMetalFlatPattern';

const SHA = 'a'.repeat(64);
const binding = (featureId: 'cad.mechanical.bend' | 'cad.mechanical.flange') => ({
  schema: NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA,
  featureId,
  operationId: `source-${featureId.split('.').at(-1)}`,
  projectId: 'project-1', documentId: 'document-1', baseRevisionId: 'revision-7',
  baseSequence: 7, baseContentSha256: SHA,
} as const);

describe('bounded single-bend sheet-metal flat pattern', () => {
  it('creates a revision-bound OCCT face, STEP and reparsed mm DXF from a trusted bend', async () => {
    const result = await executeBoundedSheetMetalFlatPattern({
      schema: BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA,
      operationId: 'flat-pattern-bend-1',
      sourceRequest: {
        ...binding('cad.mechanical.bend'),
        parameters: {
          host: { lengthMm: 60, widthMm: 30, thicknessMm: 2 },
          fixedLengthMm: 20, innerRadiusMm: 3, angleDeg: 90, direction: 'up',
        },
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_FLAT_PATTERN_PASS');
    if (result.status !== 'EXACT_FLAT_PATTERN_PASS') return;
    expect(result.receipt).toMatchObject({
      sourceFeatureId: 'cad.mechanical.bend', developedLengthMm: 60,
      widthMm: 30, bendLineMm: 20, release: 'HOLD', commercialReleaseReady: false,
    });
    expect(parseBoundedFlatPatternDxf(result.dxfArtifact)).toMatchObject({ units: 'mm', lines: expect.any(Array) });
    expect(validateBoundedSheetMetalFlatPatternResult(result)).toBe(true);
    expect(validateBoundedSheetMetalFlatPatternResult({ ...result, dxfArtifact: `${result.dxfArtifact}0\nLINE\n` })).toBe(false);
    expect(validateBoundedSheetMetalFlatPatternResult({ ...result, receipt: { ...result.receipt, bendLineMm: 21 } })).toBe(false);
  }, 60_000);

  it('includes the neutral-axis arc and straight leg in a flange developed length', async () => {
    const result = await executeBoundedSheetMetalFlatPattern({
      schema: BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA,
      operationId: 'flat-pattern-flange-1',
      sourceRequest: {
        ...binding('cad.mechanical.flange'),
        parameters: {
          host: { lengthMm: 40, widthMm: 30, thicknessMm: 2 },
          straightLegLengthMm: 12, innerRadiusMm: 3, angleDeg: 90,
          edge: 'positive_length_end', direction: 'up',
        },
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_FLAT_PATTERN_PASS');
    if (result.status !== 'EXACT_FLAT_PATTERN_PASS') return;
    expect(result.receipt.developedLengthMm).toBeCloseTo(40 + 12 + 2 * Math.PI, 9);
    expect(result.receipt.bendLineMm).toBe(40);
    expect(validateBoundedSheetMetalFlatPatternResult(result)).toBe(true);
  }, 60_000);

  it('rejects malformed source requests and hostile or non-mm DXF', async () => {
    await expect(executeBoundedSheetMetalFlatPattern({
      schema: BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA,
      operationId: 'flat-invalid', sourceRequest: { featureId: 'cad.mechanical.bend' },
    })).resolves.toMatchObject({ status: 'HOLD' });
    const dxf = createBoundedFlatPatternDxf(60, 30, 20);
    expect(parseBoundedFlatPatternDxf(dxf)).not.toBeNull();
    expect(parseBoundedFlatPatternDxf(dxf.replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n1'))).toBeNull();
    expect(parseBoundedFlatPatternDxf(new Proxy({}, { get: () => { throw new Error('hostile'); } }))).toBeNull();
  });
});
