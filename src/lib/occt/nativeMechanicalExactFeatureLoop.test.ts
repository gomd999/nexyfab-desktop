// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA,
  executeNativeMechanicalExactFeature,
  validateNativeMechanicalExactFeatureResult,
  validateNativeMechanicalExactReceipt,
  type NativeMechanicalExactFeatureRequest,
} from './nativeMechanicalExactFeatureLoop';

const SHA = 'a'.repeat(64);
const host = {
  loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  depth: 5,
} as const;

function binding(featureId: NativeMechanicalExactFeatureRequest['featureId']) {
  return {
    schema: NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA,
    featureId,
    operationId: `operation-${featureId.split('.').at(-1)}`,
    projectId: 'project-1',
    documentId: 'document-1',
    baseRevisionId: 'revision-7',
    baseSequence: 7,
    baseContentSha256: SHA,
  } as const;
}

describe('native mechanical exact feature closed loop', () => {
  it('closes variable fillet through real B-rep inspection and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.variable-fillet'),
      parameters: {
        host,
        edgeRadii: [
          { edgeId: 'e.vert.0', radius: 1 },
          { edgeId: 'e.vert.1', radius: 1.5 },
          { edgeId: 'e.vert.2', radius: 0.5 },
          { edgeId: 'e.vert.3', radius: 2 },
        ],
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.variable-fillet',
      baseRevisionId: 'revision-7',
      baseSequence: 7,
      baseContentSha256: SHA,
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
    expect(result.receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it('closes bounded draft without accepting a mesh substitute', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.draft'),
      parameters: { host, angleDeg: 5, pullDirection: [0, 0, 1], neutralZ: 0 },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.receipt.featureId).toBe('cad.mechanical.draft');
    expect(result.receipt.stepSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it('closes a bounded external cylindrical thread and keeps release on HOLD', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.thread'),
      parameters: {
        center: [0, 0, 0], axis: [0, 0, 1], nominalDiameter: 8,
        minorDiameter: 6.6, hostDepth: 4, pitch: 1.25, threadLength: 2.5,
        direction: 'right_hand',
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.receipt.featureId).toBe('cad.mechanical.thread');
    expect(result.receipt.authoritativeCommit).toBe(false);
    expect(result.receipt.commercialReleaseReady).toBe(false);
  }, 60_000);

  it('closes uniform positive scale through native B-rep inspection and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.scale'),
      parameters: { host, factor: 2 },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.scale',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes bounded single-body move-copy through native B-rep inspection and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.move-copy'),
      parameters: { host, translation: [25, -7, 11] },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.move-copy',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes bounded single-body plane mirror through native B-rep inspection and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.mirror'),
      parameters: { host, planeOrigin: [20, 0, 0], planeNormal: [4, 0, 0] },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.mirror',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes one top-face rectangular rib through native prism+union and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host: { loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], depth: 5 },
        start: { x: 5, y: 10 }, end: { x: 15, y: 10 }, thickness: 2, height: 3, centered: true,
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.rib',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes positive f.cap.top offset through native pushPull, volume and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.cap.top', distance: 2 },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.offset-face',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes one strictly interior rectangular through-cut through native prism+subtract and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: {
        host,
        toolLoop: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }],
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.cut',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes a connected fused axis-aligned linear pattern through native translate+union and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: 4 },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.linear-pattern',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes a connected fused circular pattern around a safe Z axis through native rotate+union and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0],
        axisDirection: [0, 0, 1],
        count: 3,
        totalAngleDeg: 60,
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.circular-pattern',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('holds a symmetric duplicate circular copy when native union adds no volume', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0],
        axisDirection: [0, 0, 1],
        count: 2,
        totalAngleDeg: 180,
      },
    });
    expect(result).toMatchObject({ status: 'HOLD', blockerCodes: ['FEATURE_INVARIANT_MISMATCH'] });
  }, 60_000);

  it('closes a bounded ruled convex loft directly through native OCCT and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: {
        sections: [
          { z: 0, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
          { z: 5, loop: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }] },
        ],
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.loft',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes a true non-straight orthogonal polyline sweep through native OCCT and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: {
        path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]],
        widthMm: 2,
        heightMm: 2,
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.sweep',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes a versioned path sweep without promoting the broad FeatureTree alias', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep-path'),
      parameters: {
        path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]],
        widthMm: 2,
        heightMm: 2,
        profileFrame: 'normal_to_first_segment',
        transition: 'right_corner',
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.sweep-path',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes strict-interior XY/XZ/YZ keep-one-side splits through native intersection and STEP re-import', async () => {
    const cases = [
      { plane: 'XY', offset: 2, keepSide: 'positive' },
      { plane: 'XY', offset: 3, keepSide: 'negative' },
      { plane: 'XZ', offset: 4, keepSide: 'positive' },
      { plane: 'XZ', offset: 6, keepSide: 'negative' },
      { plane: 'YZ', offset: 3, keepSide: 'positive' },
      { plane: 'YZ', offset: 7, keepSide: 'negative' },
    ] as const;
    for (const parameters of cases) {
      const result = await executeNativeMechanicalExactFeature({
        ...binding('cad.mechanical.split-body'),
        parameters: { host, ...parameters },
      });
      expect(result.status, result.status === 'HOLD' ? `${parameters.plane}:${parameters.keepSide}:${result.blockerCodes.join(',')}` : undefined).toBe('EXACT_PASS');
      if (result.status !== 'EXACT_PASS') continue;
      expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
      expect(result.receipt).toMatchObject({
        featureId: 'cad.mechanical.split-body',
        blockerCodes: [],
        authoritativeCommit: false,
        commercialReleaseReady: false,
      });
    }
  }, 120_000);

  it('closes bounded blind-hole delete-face through actual face removal, cap solidification, and STEP re-import', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: {
        host: {
          loop: [
            { x: 0, y: 0 }, { x: 40, y: 0 },
            { x: 40, y: 30 }, { x: 0, y: 30 },
          ],
          depth: 10,
        },
        hole: { center: { x: 20, y: 15 }, radiusMm: 3, depthMm: 6 },
        faceSet: ['f.hole.wall', 'f.hole.floor', 'f.cap.top.perforated'],
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.delete-face',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes one idealized constant-thickness circular sheet bend with analytic and STEP evidence', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: {
        host: { lengthMm: 60, widthMm: 30, thicknessMm: 2 },
        fixedLengthMm: 20,
        innerRadiusMm: 3,
        angleDeg: 90,
        direction: 'up',
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.bend',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('closes one material-adding positive-end circular flange with analytic and STEP evidence', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: {
        host: { lengthMm: 40, widthMm: 30, thicknessMm: 2 },
        straightLegLengthMm: 12,
        innerRadiusMm: 3,
        angleDeg: 90,
        edge: 'positive_length_end',
        direction: 'up',
      },
    });
    expect(result.status, result.status === 'HOLD' ? result.blockerCodes.join(',') : undefined).toBe('EXACT_PASS');
    if (result.status !== 'EXACT_PASS') return;
    expect(result.stepArtifact).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(result.receipt).toMatchObject({
      featureId: 'cad.mechanical.flange',
      blockerCodes: [],
      authoritativeCommit: false,
      commercialReleaseReady: false,
    });
  }, 60_000);

  it('rejects partial, hostile, non-finite and unsupported thread requests before runtime execution', async () => {
    await expect(executeNativeMechanicalExactFeature({ status: 'PASS' })).resolves.toEqual({
      status: 'HOLD', blockerCodes: ['INVALID_REQUEST'], receipt: null, stepArtifact: null,
    });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
    await expect(executeNativeMechanicalExactFeature(hostile)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.thread'),
      parameters: {
        center: [0, 0, 0], axis: [0, 0, 1], nominalDiameter: 8,
        minorDiameter: 6.6, hostDepth: 4, pitch: 0, threadLength: 2.5,
        direction: 'right_hand',
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.scale'),
      parameters: { host, factor: 0 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.move-copy'),
      parameters: { host, translation: [Number.NaN, 0, 0] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.mirror'),
      parameters: { host, planeOrigin: [0, 0, 0], planeNormal: [0, 0, 0] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host,
        start: { x: 1, y: 1 }, end: { x: 1, y: 1 }, thickness: 2, height: 3, centered: true,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.side.0', distance: 2 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: { host, toolLoop: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: { host, toolLoop: [{ x: 0, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 0, y: 7 }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: { host, toolLoop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: { host, toolLoop: [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }], hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.cut'),
      parameters: { host, toolLoop: [{ x: 3, y: 3 }, { x: Number.NaN, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: 4, hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: Number.NaN },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 1, direction: [1, 0, 0], spacing: 4 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 9, direction: [1, 0, 0], spacing: 4 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: 10 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: 11 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 1, 0], spacing: 4 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [0, 0, 0], spacing: 4 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: { host, count: 3, direction: [1, 0, 0], spacing: 4_000_000 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.linear-pattern'),
      parameters: {
        host: { loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 5 },
        count: 3, direction: [1, 0, 0], spacing: 4,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0], axisDirection: [0, 0, 1], count: 3, totalAngleDeg: 360,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0], axisDirection: [0, 0, 1], count: 3, totalAngleDeg: Number.NaN,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0], axisDirection: [0, 0, 1], count: 3, totalAngleDeg: 90, hidden: true,
      },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0], axisDirection: [1, 0, 0], count: 3, totalAngleDeg: 90,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [5, 5, 0], axisDirection: [0, 0, 0], count: 3, totalAngleDeg: 90,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [0, 0, 0], axisDirection: [0, 0, 1], count: 3, totalAngleDeg: 90,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.circular-pattern'),
      parameters: {
        host,
        axisPoint: [1_000_001, 5, 0], axisDirection: [0, 0, 1], count: 3, totalAngleDeg: 90,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const loftSections = [
      { z: 0, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { z: 5, loop: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }] },
    ];
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [...loftSections, { z: 10, loop: [...loftSections[1]!.loop].reverse() }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [{ ...loftSections[0]!, z: 0 }, { ...loftSections[1]!, z: 0 }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [loftSections[0], { z: 5, loop: [...loftSections[1]!.loop, { x: 5, y: 5 }] }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [loftSections[0], { z: 5, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }] }] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [{ z: Number.NaN, loop: loftSections[0]!.loop }, loftSections[1]] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [{ z: 0, loop: [{ x: 1_000_001, y: 0 }, { x: 1_000_002, y: 0 }, { x: 1_000_002, y: 1 }, { x: 1_000_001, y: 1 }] }, loftSections[1]] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.loft'),
      parameters: { sections: [loftSections[0], loftSections[1]], hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: { path: [[0, 0, 0], [20, 0, 0], [30, 0, 0]], widthMm: 2, heightMm: 2 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: { path: [[0, 0, 0], [20, 0, 0], [30, 10, 0]], widthMm: 2, heightMm: 2 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: { path: [[0, 0, 0], [4, 0, 0], [4, 0, 4]], widthMm: 4, heightMm: 4 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: { path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]], widthMm: Number.NaN, heightMm: 2 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep'),
      parameters: { path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]], widthMm: 2, heightMm: 2, hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const sweepPathParameters = {
      path: [[0, 0, 0], [20, 0, 0], [20, 0, 15]],
      widthMm: 2,
      heightMm: 2,
      profileFrame: 'normal_to_first_segment',
      transition: 'right_corner',
    } as const;
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep-path'),
      parameters: { ...sweepPathParameters, profileFrame: 'free' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep-path'),
      parameters: { ...sweepPathParameters, transition: 'round_corner' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.sweep-path'),
      parameters: { ...sweepPathParameters, hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'XY', offset: 0, keepSide: 'positive' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'XY', offset: host.depth, keepSide: 'negative' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'ARBITRARY', offset: 2, keepSide: 'positive' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'YZ', offset: 2, keepSide: 'both' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'XZ', offset: Number.NaN, keepSide: 'negative' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: { host, plane: 'XZ', offset: 2, keepSide: 'negative', hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.split-body'),
      parameters: {
        host: { loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 10 }], depth: 5 },
        plane: 'YZ', offset: 2, keepSide: 'negative',
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const deleteFaceBase = {
      host: {
        loop: [
          { x: 0, y: 0 }, { x: 40, y: 0 },
          { x: 40, y: 30 }, { x: 0, y: 30 },
        ],
        depth: 10,
      },
      hole: { center: { x: 20, y: 15 }, radiusMm: 3, depthMm: 6 },
      faceSet: ['f.hole.wall', 'f.hole.floor', 'f.cap.top.perforated'],
    } as const;
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: { ...deleteFaceBase, hole: { ...deleteFaceBase.hole, center: { x: 3, y: 15 } } },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: { ...deleteFaceBase, hole: { ...deleteFaceBase.hole, depthMm: 10 } },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: { ...deleteFaceBase, faceSet: ['f.hole.wall', 'f.hole.floor'] },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: { ...deleteFaceBase, hole: { ...deleteFaceBase.hole, radiusMm: Number.NaN } },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.delete-face'),
      parameters: { ...deleteFaceBase, hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const bendHost = { lengthMm: 60, widthMm: 30, thicknessMm: 2 } as const;
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: bendHost, fixedLengthMm: 20, innerRadiusMm: 3, angleDeg: 0, direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: bendHost, fixedLengthMm: 20, innerRadiusMm: 3, angleDeg: 91, direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: bendHost, fixedLengthMm: 60, innerRadiusMm: 3, angleDeg: 90, direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: { ...bendHost, lengthMm: 10 }, fixedLengthMm: 5, innerRadiusMm: 10, angleDeg: 90, direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: bendHost, fixedLengthMm: 20, innerRadiusMm: 3, angleDeg: 45, direction: 'down' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.bend'),
      parameters: { host: bendHost, fixedLengthMm: 20, innerRadiusMm: 3, angleDeg: 45, direction: 'up', hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const flangeHost = { lengthMm: 40, widthMm: 30, thicknessMm: 2 } as const;
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: { host: flangeHost, straightLegLengthMm: 0, innerRadiusMm: 3, angleDeg: 90, edge: 'positive_length_end', direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: { host: flangeHost, straightLegLengthMm: 12, innerRadiusMm: 3, angleDeg: 91, edge: 'positive_length_end', direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: { host: flangeHost, straightLegLengthMm: 12, innerRadiusMm: 3, angleDeg: 90, edge: 'negative_length_end', direction: 'up' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: { host: flangeHost, straightLegLengthMm: 12, innerRadiusMm: 3, angleDeg: 45, edge: 'positive_length_end', direction: 'down' },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.flange'),
      parameters: { host: flangeHost, straightLegLengthMm: 12, innerRadiusMm: Number.NaN, angleDeg: 45, edge: 'positive_length_end', direction: 'up' },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    const getterRequest = {
      ...binding('cad.mechanical.loft'),
      parameters: { sections: loftSections },
    } as Record<string, unknown>;
    Object.defineProperty(getterRequest.parameters, 'sections', { enumerable: true, get: () => { throw new Error('hostile getter'); } });
    await expect(executeNativeMechanicalExactFeature(getterRequest)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.cap.top', distance: 0 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.cap.top', distance: Number.NaN },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.cap.top', distance: 100_001 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: {
        host: { loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }, { x: 0, y: 10 }], depth: 5 },
        faceId: 'f.cap.top', distance: 2,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.offset-face'),
      parameters: { host, faceId: 'f.cap.top', distance: 2, hidden: true },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host,
        start: { x: 2, y: 5 }, end: { x: 8, y: 5 }, thickness: 2, height: 3, centered: false,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host,
        start: { x: -100, y: 5 }, end: { x: -90, y: 5 }, thickness: 2, height: 3, centered: true,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host,
        start: { x: 2, y: 5 }, end: { x: 8, y: 5 }, thickness: 2, height: 3, centered: true,
        hidden: true,
      },
    } as unknown)).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.rib'),
      parameters: {
        host,
        start: { x: 2, y: 5 }, end: { x: 8, y: 5 }, thickness: 2, height: 1_000_001, centered: true,
      },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.mirror'),
      parameters: { host, planeOrigin: [1_000_000, 0, 0], planeNormal: [1, 0, 0] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.move-copy'),
      parameters: { host, translation: [0, 0, 0] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.move-copy'),
      parameters: { host, translation: [1_000_000, 0, 0] },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
    await expect(executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.scale'),
      parameters: { host, factor: 1 },
    })).resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'] });
  });

  it('fails closed for receipt/result tampering, extra keys, getters, and artifact mismatch', async () => {
    const result = await executeNativeMechanicalExactFeature({
      ...binding('cad.mechanical.draft'),
      parameters: { host, angleDeg: 5, pullDirection: [0, 0, 1], neutralZ: 0 },
    });
    if (result.status !== 'EXACT_PASS') return;
    expect(validateNativeMechanicalExactFeatureResult(result)).toBe(true);
    expect(validateNativeMechanicalExactFeatureResult(result, result.stepArtifact)).toBe(true);
    expect(validateNativeMechanicalExactReceipt(result.receipt, result.stepArtifact)).toBe(true);
    expect(validateNativeMechanicalExactFeatureResult({ ...result, stepArtifact: `${result.stepArtifact}tampered` })).toBe(false);
    expect(validateNativeMechanicalExactFeatureResult({ ...result, receipt: { ...result.receipt, operationId: 'tampered' } })).toBe(false);
    expect(validateNativeMechanicalExactFeatureResult({ ...result, extra: true })).toBe(false);
    const hidden = { ...result };
    Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
    expect(validateNativeMechanicalExactFeatureResult(hidden)).toBe(false);
    const symbol = { ...result, [Symbol('hidden')]: true };
    expect(validateNativeMechanicalExactFeatureResult(symbol)).toBe(false);
    const hostile = Object.create(result);
    Object.defineProperty(hostile, 'status', { get() { throw new Error('hostile getter'); }, enumerable: true });
    expect(() => validateNativeMechanicalExactFeatureResult(hostile)).not.toThrow();
    expect(validateNativeMechanicalExactFeatureResult(hostile)).toBe(false);
    expect(validateNativeMechanicalExactFeatureResult({ status: 'HOLD', blockerCodes: ['INVALID_REQUEST'], receipt: null, stepArtifact: null })).toBe(true);
    expect(validateNativeMechanicalExactFeatureResult({ status: 'HOLD', blockerCodes: [], receipt: null, stepArtifact: null })).toBe(false);
  }, 60_000);
});
