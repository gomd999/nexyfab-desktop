// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BOUNDED_WELDMENT_CUT_LIST_SCHEMA,
  BOUNDED_WELDMENT_REQUEST_SCHEMA,
  executeBoundedWeldment,
  validateBoundedWeldmentResult,
  type BoundedWeldmentRequest,
} from './boundedWeldment';

const SHA = 'b'.repeat(64);

function request(): BoundedWeldmentRequest {
  return {
    schema: BOUNDED_WELDMENT_REQUEST_SCHEMA,
    featureId: 'cad.mechanical.weldment',
    operationId: 'weldment-operation-1',
    projectId: 'project-1',
    documentId: 'document-1',
    baseRevisionId: 'revision-9',
    baseSequence: 9,
    baseContentSha256: SHA,
    parameters: {
      unit: 'mm',
      primary: { memberId: 'member-primary', lengthMm: 40, widthMm: 4, heightMm: 6 },
      branch: { memberId: 'member-branch', lengthMm: 30, widthMm: 5, heightMm: 7 },
      joint: {
        kind: 'square-corner-contact',
        primaryEnd: 'positive_x',
        branchSide: 'negative_x',
        weldBead: 'not_modelled',
      },
    },
  };
}

describe('bounded commercial weldment', () => {
  it('binds a native two-solid compound, STEP, and millimetre cut list without claiming weld authority', async () => {
    const result = await executeBoundedWeldment(request());
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    const cutList = JSON.parse(result.cutListArtifact);
    expect(cutList).toMatchObject({
      schema: BOUNDED_WELDMENT_CUT_LIST_SCHEMA,
      unit: 'mm',
      members: [
        {
          role: 'primary', memberId: 'member-primary', quantity: 1,
          profile: { kind: 'rectangular', widthMm: 4, heightMm: 6 },
          cutLengthMm: 40, materialSpecification: 'UNSPECIFIED',
        },
        {
          role: 'branch', memberId: 'member-branch', quantity: 1,
          profile: { kind: 'rectangular', widthMm: 5, heightMm: 7 },
          cutLengthMm: 30, materialSpecification: 'UNSPECIFIED',
        },
      ],
      joint: {
        weldBeadGeometry: 'NOT_MODELLED',
        processSpecification: 'NOT_AUTHORIZED',
      },
    });
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.weldment',
      solidCount: 2,
      compoundCount: 1,
      cutListMemberCount: 2,
      xcafOccurrenceVerification: 'NOT_RUN',
      weldProcessAuthority: 'NOT_CLAIMED',
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
    expect(validateBoundedWeldmentResult(result)).toBe(true);
    expect(validateBoundedWeldmentResult(result, result.stepArtifact, result.cutListArtifact)).toBe(true);
  }, 60_000);

  it('fails closed for unsupported units, geometry, joint semantics, hidden data, and hostile accessors', async () => {
    const base = request();
    await expect(executeBoundedWeldment({
      ...base,
      parameters: { ...base.parameters, unit: 'inch' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeBoundedWeldment({
      ...base,
      parameters: {
        ...base.parameters,
        branch: { ...base.parameters.branch, memberId: base.parameters.primary.memberId },
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeBoundedWeldment({
      ...base,
      parameters: {
        ...base.parameters,
        primary: { ...base.parameters.primary, lengthMm: Number.NaN },
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeBoundedWeldment({
      ...base,
      parameters: {
        ...base.parameters,
        joint: { ...base.parameters.joint, weldBead: 'modelled' },
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeBoundedWeldment({ ...base, hidden: true }))
      .resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const hostile = request() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, 'parameters', {
      enumerable: true,
      get() { throw new Error('hostile getter'); },
    });
    await expect(executeBoundedWeldment(hostile))
      .resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
  });

  it('rejects receipt and independently transported artifact tampering', async () => {
    const result = await executeBoundedWeldment(request());
    if (result.status !== 'EXACT_PASS') return;
    expect(validateBoundedWeldmentResult({
      ...result,
      stepArtifact: `${result.stepArtifact}tampered`,
    })).toBe(false);
    expect(validateBoundedWeldmentResult({
      ...result,
      cutListArtifact: result.cutListArtifact.replace('UNSPECIFIED', 'S355'),
    })).toBe(false);
    expect(validateBoundedWeldmentResult({
      ...result,
      receipt: { ...result.receipt, solidCount: 1 },
    })).toBe(false);
    expect(validateBoundedWeldmentResult(result, `${result.stepArtifact}tampered`, result.cutListArtifact)).toBe(false);
    expect(validateBoundedWeldmentResult(result, result.stepArtifact, `${result.cutListArtifact}tampered`)).toBe(false);
    expect(validateBoundedWeldmentResult({
      status: 'HOLD', blockerCodes: ['INVALID_REQUEST'], receipt: null,
      stepArtifact: null, cutListArtifact: null,
    })).toBe(true);
    expect(validateBoundedWeldmentResult({
      status: 'HOLD', blockerCodes: [], receipt: null,
      stepArtifact: null, cutListArtifact: null,
    })).toBe(false);
  }, 60_000);
});
