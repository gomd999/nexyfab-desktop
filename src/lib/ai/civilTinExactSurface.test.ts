import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import {
  buildCivilTinExactSurfaceReceipt,
  claimCivilTinExactSurfaceReceipt,
  exportCivilTinExactSurfaceArtifact,
  parseCivilTinExactSurfaceArtifact,
  queryCivilTinElevation,
  verifyCivilTinExactSurfaceArtifact,
  type CivilTinExactSurfaceInput,
} from './civilTinExactSurface';

const revisionValue = { workspace: 'civil-demo', revision: 7, source: 'tin' };
const revisionId = 'civil-workspace:r7';
const workspaceContentHash = designRevisionSha256(revisionValue);
const surface = (): CivilTinExactSurfaceInput => ({
  surfaceId: 'existing-ground',
  kind: 'existing',
  units: { horizontal: 'm', vertical: 'm' },
  crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002' },
  bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 30 },
  points: [
    { id: 'p1', x: 0, y: 0, z: 0 },
    { id: 'p2', x: 10, y: 0, z: 10 },
    { id: 'p3', x: 0, y: 10, z: 20 },
    { id: 'p4', x: 10, y: 10, z: 30 },
  ],
  triangles: [
    { id: 'tri-01', pointIds: ['p1', 'p2', 'p3'] },
    { id: 'tri-02', pointIds: ['p2', 'p4', 'p3'] },
  ],
});
const exportSurface = (value = surface()) => exportCivilTinExactSurfaceArtifact({ workspaceRevisionId: revisionId, expectedWorkspaceRevisionId: revisionId, workspaceRevisionValue: revisionValue, expectedWorkspaceContentHash: workspaceContentHash, surface: value });

describe('civil exact TIN surface contract', () => {
  it('exports, parses, verifies and receipts a deterministic revision-bound TIN', () => {
    const artifact = exportSurface();
    const parsed = parseCivilTinExactSurfaceArtifact(artifact.bytes, { workspaceRevisionId: revisionId, workspaceContentHash });
    expect(parsed.artifactSha256).toBe(artifact.artifactSha256);
    expect(verifyCivilTinExactSurfaceArtifact({ artifact: parsed, workspaceRevisionId: revisionId, workspaceContentHash })).toEqual({ status: 'passed', verifierId: 'civil-tin-exact-surface-structural.v1', issues: [] });
    expect(artifact.payload.units).toEqual({ horizontal: 'm', vertical: 'm' });
    expect(artifact.payload.crs).toMatchObject({ epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002' });
    expect(artifact.payload.points.map(point => point.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(artifact.payload.triangles.map(triangle => triangle.id)).toEqual(['tri-01', 'tri-02']);
    const receiptBytes = buildCivilTinExactSurfaceReceipt({ artifact });
    expect(claimCivilTinExactSurfaceReceipt({ artifact, receiptBytes })).toMatchObject({ artifactSha256: artifact.artifactSha256, workspaceRevisionId: revisionId, externalSurvey: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldValidation: 'NOT_RUN', releaseReady: false, claim: 'internal-tin-exact-surface-verified' });
    expect(exportSurface().artifactSha256).toBe(artifact.artifactSha256);
  });

  it('answers barycentric elevation deterministically, including a shared edge', () => {
    const payload = exportSurface().payload;
    const interior = queryCivilTinElevation(payload, { x: 2.5, y: 2.5 });
    expect(interior).toMatchObject({ triangleId: 'tri-01', elevation: 7.5, unit: 'm' });
    expect(interior.barycentric.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    const edge = queryCivilTinElevation(payload, { x: 5, y: 5 });
    expect(edge.triangleId).toBe('tri-01');
    expect(edge.elevation).toBe(15);
    expect(() => queryCivilTinElevation(payload, { x: 11, y: 5 })).toThrow('CIVIL_TIN_QUERY_OUT_OF_RANGE');
  });

  it('supports explicit millimetre coordinates/elevations without losing provenance', () => {
    const value = surface();
    value.units = { horizontal: 'mm', vertical: 'mm' };
    value.bounds = { minX: 0, maxX: 10_000, minY: 0, maxY: 10_000, minZ: 0, maxZ: 30_000 };
    value.points = value.points.map(point => ({ ...point, x: point.x * 1000, y: point.y * 1000, z: point.z * 1000 }));
    const artifact = exportSurface(value);
    expect(queryCivilTinElevation(artifact.payload, { x: 2500, y: 2500, unit: 'mm' })).toMatchObject({ elevation: 7500, unit: 'mm' });
    expect(artifact.payload.units).toEqual({ horizontal: 'mm', vertical: 'mm' });
  });

  it('accepts a valid flat TIN whose vertical bounds have zero range', () => {
    const value = surface();
    value.bounds.minZ = 12;
    value.bounds.maxZ = 12;
    value.points = value.points.map(point => ({ ...point, z: 12 }));
    expect(queryCivilTinElevation(exportSurface(value).payload, { x: 5, y: 5 })).toMatchObject({ elevation: 12, unit: 'm' });
  });

  it('fails closed for duplicate/degenerate/overlapping/non-manifold/out-of-range geometry', () => {
    const duplicatePoint = surface(); duplicatePoint.points[3] = { ...duplicatePoint.points[3]!, x: 0, y: 0 };
    expect(() => exportSurface(duplicatePoint)).toThrow('surface_duplicate_point_coordinate');
    const degenerate = surface(); degenerate.triangles[0] = { id: 'tri-01', pointIds: ['p1', 'p2', 'p2'] as [string, string, string] };
    expect(() => exportSurface(degenerate)).toThrow('surface_triangle_reference_invalid');
    const overlap = surface(); overlap.triangles[1] = { id: 'tri-02', pointIds: ['p1', 'p2', 'p4'] };
    expect(() => exportSurface(overlap)).toThrow('surface_triangle_overlap');
    const nonManifold = surface(); nonManifold.bounds.minY = -10; nonManifold.points.push({ id: 'p5', x: 5, y: -10, z: 0 }); nonManifold.triangles[1] = { id: 'tri-02', pointIds: ['p1', 'p2', 'p4'] }; nonManifold.triangles.push({ id: 'tri-03', pointIds: ['p1', 'p2', 'p5'] });
    expect(() => exportSurface(nonManifold)).toThrow('surface_non_manifold_edge');
    const unknown = surface(); unknown.triangles[0] = { id: 'tri-01', pointIds: ['p1', 'p2', 'missing'] as [string, string, string] };
    expect(() => exportSurface(unknown)).toThrow('surface_triangle_reference_invalid');
    const outside = surface(); outside.points[0] = { ...outside.points[0]!, x: -1 };
    expect(() => exportSurface(outside)).toThrow('surface_point_out_of_bounds');
  });

  it('rejects stale revisions, non-canonical/tampered artifacts and receipt tampering', () => {
    expect(() => exportCivilTinExactSurfaceArtifact({ workspaceRevisionId: revisionId, expectedWorkspaceRevisionId: revisionId, workspaceRevisionValue: revisionValue, expectedWorkspaceContentHash: 'f'.repeat(64), surface: surface() })).toThrow('CIVIL_TIN_EXACT_SURFACE_STALE_REVISION_HASH');
    const artifact = exportSurface();
    const tampered = structuredClone(artifact.payload); tampered.points[0]!.z = 1;
    const tamperedBytes = new TextEncoder().encode(canonicalDesignJson({ payload: tampered, contentHash: artifact.contentHash }));
    expect(() => parseCivilTinExactSurfaceArtifact(tamperedBytes)).toThrow('CIVIL_TIN_EXACT_SURFACE_CONTENT_HASH_MISMATCH');
    const receipt = JSON.parse(new TextDecoder().decode(buildCivilTinExactSurfaceReceipt({ artifact }))) as Record<string, unknown>;
    receipt.releaseReady = true;
    const forgedReceipt = new TextEncoder().encode(canonicalDesignJson(receipt));
    expect(() => claimCivilTinExactSurfaceReceipt({ artifact, receiptBytes: forgedReceipt })).toThrow('CIVIL_TIN_RECEIPT_BINDING_MISMATCH');
    const mismatchedPayload = structuredClone(artifact);
    mismatchedPayload.payload.surfaceId = 'different-surface';
    expect(() => buildCivilTinExactSurfaceReceipt({ artifact: mismatchedPayload })).toThrow('CIVIL_TIN_RECEIPT_ARTIFACT_BINDING_MISMATCH');
    expect(createHash('sha256').update(artifact.bytes).digest('hex')).toBe(artifact.artifactSha256);
  });
});
