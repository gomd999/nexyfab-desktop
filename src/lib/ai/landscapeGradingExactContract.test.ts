import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import { exportCivilTinExactSurfaceArtifact } from './civilTinExactSurface';
import {
  buildLandscapeGradingExactReceipt,
  claimLandscapeGradingExactReceipt,
  exportLandscapeGradingExactArtifact,
  parseLandscapeGradingExactArtifact,
  verifyLandscapeGradingExactArtifact,
  type LandscapeGradingExactInput,
} from './landscapeGradingExactContract';

const workspaceRevisionValue = { project: 'landscape-demo', revision: 3, source: 'survey-tin' };
const workspaceRevisionId = 'landscape-workspace:r3';
const workspaceContentHash = designRevisionSha256(workspaceRevisionValue);
const tin = (kind: 'existing' | 'proposed') => exportCivilTinExactSurfaceArtifact({
  workspaceRevisionId,
  expectedWorkspaceRevisionId: workspaceRevisionId,
  workspaceRevisionValue,
  expectedWorkspaceContentHash: workspaceContentHash,
  surface: {
    surfaceId: `${kind}-ground`, kind,
    units: { horizontal: 'm', vertical: 'm' },
    crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002' },
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: -1, maxZ: 3 },
    points: kind === 'existing'
      ? [{ id: 'p1', x: 0, y: 0, z: 0 }, { id: 'p2', x: 10, y: 0, z: 0 }, { id: 'p3', x: 0, y: 10, z: 0 }, { id: 'p4', x: 10, y: 10, z: 0 }]
      : [{ id: 'p1', x: 0, y: 0, z: 2 }, { id: 'p2', x: 10, y: 0, z: 2 }, { id: 'p3', x: 0, y: 10, z: 1 }, { id: 'p4', x: 10, y: 10, z: 1 }],
    triangles: [{ id: 'tri-01', pointIds: ['p1', 'p2', 'p3'] }, { id: 'tri-02', pointIds: ['p2', 'p4', 'p3'] }],
  },
});
const baseTin = tin('existing');
const designTin = tin('proposed');
const tinMm = (kind: 'existing' | 'proposed') => exportCivilTinExactSurfaceArtifact({
  workspaceRevisionId,
  expectedWorkspaceRevisionId: workspaceRevisionId,
  workspaceRevisionValue,
  expectedWorkspaceContentHash: workspaceContentHash,
  surface: {
    surfaceId: `${kind}-ground-mm`, kind,
    units: { horizontal: 'mm', vertical: 'mm' },
    crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002' },
    bounds: { minX: 0, maxX: 10_000, minY: 0, maxY: 10_000, minZ: -1_000, maxZ: 3_000 },
    points: (kind === 'existing'
      ? [{ id: 'p1', x: 0, y: 0, z: 0 }, { id: 'p2', x: 10, y: 0, z: 0 }, { id: 'p3', x: 0, y: 10, z: 0 }, { id: 'p4', x: 10, y: 10, z: 0 }]
      : [{ id: 'p1', x: 0, y: 0, z: 2 }, { id: 'p2', x: 10, y: 0, z: 2 }, { id: 'p3', x: 0, y: 10, z: 1 }, { id: 'p4', x: 10, y: 10, z: 1 }])
      .map(point => ({ ...point, x: point.x * 1000, y: point.y * 1000, z: point.z * 1000 })),
    triangles: [{ id: 'tri-01', pointIds: ['p1', 'p2', 'p3'] }, { id: 'tri-02', pointIds: ['p2', 'p4', 'p3'] }],
  },
});
const grading = (): LandscapeGradingExactInput => ({
  modifiers: [
    { id: 'modifier-pad-01', kind: 'pad', boundaryM: [[1, 1], [3, 1], [3, 3], [1, 3]], targetElevationM: 1 },
    { id: 'modifier-slope-01', kind: 'slope', boundaryM: [[7, 7], [9, 7], [9, 9], [7, 9]], axisStartM: [7, 7], axisEndM: [9, 7], startElevationM: 1, endElevationM: 0.8 },
  ],
  spotGrades: [{ id: 'spot-01', positionM: [5, 5], elevationM: 1.5, toleranceM: 0.01 }],
  breaklines: [{ id: 'breakline-01', kind: 'hard', pointsM: [[0, 5, 1.5], [10, 5, 1.5]] }],
  drainagePaths: [{ id: 'drainage-01', pointsM: [[5, 0], [5, 10]], outletObjectId: 'outfall-01', minimumSlopePercent: 1 }],
  grid: { cellSizeM: 5 },
});
const exportGrading = (input = grading()) => exportLandscapeGradingExactArtifact({ workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue, expectedWorkspaceContentHash: workspaceContentHash, expectedBaseTinArtifactSha256: baseTin.artifactSha256, expectedDesignTinArtifactSha256: designTin.artifactSha256, baseTin, designTin, grading: input });

describe('landscape grading/drainage exact contract', () => {
  it('binds base/design TINs, modifiers, stable IDs, deterministic grid volumes and drainage', () => {
    const artifact = exportGrading();
    expect(artifact.payload.terrain).toEqual({ baseSurfaceId: 'existing-ground', designSurfaceId: 'proposed-ground' });
    expect(artifact.payload.quantities).toMatchObject({ cutM3: 0, fillM3: 150, netM3: 150, integrationMethod: 'grid_triangle_vertex_linear_v1' });
    expect(artifact.payload.grid).toMatchObject({ cellSizeM: 5, cellCount: 4, integratedTriangleCount: 8 });
    expect(artifact.payload.drainage.verifiedPathIds).toEqual(['drainage-01']);
    expect(artifact.payload.drainagePaths[0]!.minObservedSlopePercent).toBeCloseTo(10, 8);
    const parsed = parseLandscapeGradingExactArtifact(artifact.bytes, { workspaceRevisionId, workspaceContentHash, baseTinArtifactSha256: baseTin.artifactSha256, designTinArtifactSha256: designTin.artifactSha256 });
    expect(verifyLandscapeGradingExactArtifact({ artifact: parsed, workspaceRevisionId, workspaceContentHash, baseTinArtifactSha256: baseTin.artifactSha256, designTinArtifactSha256: designTin.artifactSha256 })).toEqual({ status: 'passed', verifierId: 'landscape-grading-exact-structural.v1', issues: [] });
    expect(exportGrading().artifactSha256).toBe(artifact.artifactSha256);
  });

  it('binds raw artifact/parser/verifier bytes and keeps solver/native/field claims closed', () => {
    const artifact = exportGrading();
    const parserOutputBytes = new TextEncoder().encode(canonicalDesignJson({ parser: 'landscape-grading-exact', artifactSha256: artifact.artifactSha256, status: 'verified' }));
    const verifierEvidenceBytes = new TextEncoder().encode(canonicalDesignJson({ stableIds: { modifiers: ['modifier-pad-01', 'modifier-slope-01'], spotGrades: ['spot-01'], breaklines: ['breakline-01'], drainagePaths: ['drainage-01'] }, quantities: artifact.payload.quantities, drainage: artifact.payload.drainage, externalHydraulicSolver: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldSurvey: 'NOT_RUN', releaseReady: false }));
    const receiptBytes = buildLandscapeGradingExactReceipt({ artifact, parserOutputBytes, verifierEvidenceBytes });
    expect(claimLandscapeGradingExactReceipt({ artifact, receiptBytes, parserOutputBytes, verifierEvidenceBytes })).toMatchObject({ artifactSha256: artifact.artifactSha256, parserResult: 'verified', externalHydraulicSolver: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldSurvey: 'NOT_RUN', releaseReady: false, claim: 'internal-landscape-grading-exact-verified' });
    const tamperedParser = new TextEncoder().encode(`${new TextDecoder().decode(parserOutputBytes)} `);
    expect(() => claimLandscapeGradingExactReceipt({ artifact, receiptBytes, parserOutputBytes: tamperedParser, verifierEvidenceBytes })).toThrow('LANDSCAPE_GRADING_RECEIPT_BINDING_MISMATCH');
  });

  it('keeps grading inputs and payload canonical in metres when source TIN coordinates are millimetres', () => {
    const base = tinMm('existing'); const design = tinMm('proposed');
    const artifact = exportLandscapeGradingExactArtifact({ workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue, expectedWorkspaceContentHash: workspaceContentHash, expectedBaseTinArtifactSha256: base.artifactSha256, expectedDesignTinArtifactSha256: design.artifactSha256, baseTin: base, designTin: design, grading: grading() });
    expect(artifact.payload.units).toEqual({ horizontal: 'm', vertical: 'm', volume: 'm3' });
    expect(artifact.payload.quantities).toMatchObject({ cutM3: 0, fillM3: 150, netM3: 150 });
    expect(artifact.payload.drainagePaths[0]!.pointsM).toEqual([{ x: 5, y: 0, z: 2 }, { x: 5, y: 10, z: 1 }]);
  });

  it('rejects closed-polygon violations, modifier overlap, reverse drainage and stale/TIN hash tamper', () => {
    const open = grading(); open.modifiers[0] = { id: 'modifier-pad-01', kind: 'pad', boundaryM: [[1, 1], [3, 1], [1, 3]], targetElevationM: 1 };
    expect(() => exportGrading(open)).not.toThrow();
    const selfCrossing = grading(); selfCrossing.modifiers[0] = { id: 'modifier-pad-01', kind: 'pad', boundaryM: [[1, 1], [3, 3], [1, 3], [3, 1]], targetElevationM: 1 };
    expect(() => exportGrading(selfCrossing)).toThrow('LANDSCAPE_GRADING_MODIFIER_INVALID');
    const overlap = grading(); overlap.modifiers[1] = { id: 'modifier-slope-01', kind: 'slope', boundaryM: [[2, 2], [4, 2], [4, 4], [2, 4]], axisStartM: [2, 2], axisEndM: [4, 2], startElevationM: 1, endElevationM: 0.8 };
    expect(() => exportGrading(overlap)).toThrow('LANDSCAPE_GRADING_MODIFIER_OVERLAP');
    const reverse = grading(); reverse.drainagePaths[0] = { ...reverse.drainagePaths[0]!, pointsM: [[5, 10], [5, 0]] };
    expect(() => exportGrading(reverse)).toThrow('LANDSCAPE_GRADING_REVERSE_SLOPE');
    const stale = grading(); expect(() => exportLandscapeGradingExactArtifact({ workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue, expectedWorkspaceContentHash: 'f'.repeat(64), expectedBaseTinArtifactSha256: baseTin.artifactSha256, expectedDesignTinArtifactSha256: designTin.artifactSha256, baseTin, designTin, grading: stale })).toThrow('LANDSCAPE_GRADING_STALE_REVISION_HASH');
    const forgedDesign = structuredClone(designTin); const forgedEnvelope = JSON.parse(new TextDecoder().decode(forgedDesign.bytes)) as { payload: typeof designTin.payload; contentHash: string }; forgedEnvelope.payload.points[0]!.z += 0.1; forgedDesign.bytes = new TextEncoder().encode(canonicalDesignJson(forgedEnvelope)); forgedDesign.artifactSha256 = designTin.artifactSha256;
    expect(() => exportLandscapeGradingExactArtifact({ workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue, expectedWorkspaceContentHash: workspaceContentHash, expectedBaseTinArtifactSha256: baseTin.artifactSha256, expectedDesignTinArtifactSha256: designTin.artifactSha256, baseTin, designTin: forgedDesign, grading: grading() })).toThrow('LANDSCAPE_GRADING_TIN_HASH_MISMATCH');
  });
});
