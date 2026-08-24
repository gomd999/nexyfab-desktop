// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
  preflightCanonicalSketch,
  type CanonicalSketchPlane,
} from '@/lib/cad/canonicalSketchPreflight';
import {
  executeCanonicalSketchOcctGeometry,
  validateCanonicalSketchOcctGeometryResult,
} from './canonicalSketchOcctGeometry';

const SHA = 'a'.repeat(64);

function preflight(plane: CanonicalSketchPlane) {
  return preflightCanonicalSketch({
    schema: CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
    projectId: 'project-1',
    documentId: 'document-1',
    currentRevision: { revisionId: 'revision-7', sequence: 7, contentSha256: SHA },
    sketchId: `sketch-${plane.toLowerCase()}`,
    plane,
    points: [
      { id: 'p0', x: 0, y: 0 }, { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 10, y: 10 }, { id: 'p3', x: 0, y: 10 },
    ],
    lineSegments: [
      { id: 'l0', startPointId: 'p0', endPointId: 'p1' },
      { id: 'l1', startPointId: 'p1', endPointId: 'p2' },
      { id: 'l2', startPointId: 'p2', endPointId: 'p3' },
      { id: 'l3', startPointId: 'p3', endPointId: 'p0' },
    ],
  });
}

describe('canonical sketch actual OCCT geometry evidence', () => {
  it('builds and STEP-roundtrips one planar face on every principal plane', async () => {
    for (const plane of ['XY', 'XZ', 'YZ'] as const) {
      const source = preflight(plane);
      expect(source.status).toBe('PRECHECK_PASS');
      const result = await executeCanonicalSketchOcctGeometry(source);
      expect(result.status, result.status === 'HOLD' ? `${plane}:${result.blockerCodes.join(',')}` : undefined).toBe('GEOMETRY_PASS');
      if (result.status !== 'GEOMETRY_PASS') continue;
      expect(result.receipt).toMatchObject({
        verification: 'ACTUAL_NODE_OCCT_PLANAR_FACE_STEP',
        release: 'HOLD',
        plane,
        areaMm2: 100,
        perimeterMm: 40,
        boundaryEdgeCount: 4,
        commercialReleaseReady: false,
      });
      expect(validateCanonicalSketchOcctGeometryResult(result)).toBe(true);
      expect(validateCanonicalSketchOcctGeometryResult({ ...result, stepArtifact: `${result.stepArtifact}tampered` })).toBe(false);
      expect(validateCanonicalSketchOcctGeometryResult({ ...result, receipt: { ...result.receipt, areaMm2: 101 } })).toBe(false);
    }
  }, 60_000);

  it('fails closed for structural HOLD, getters and fake pass objects', async () => {
    await expect(executeCanonicalSketchOcctGeometry({ status: 'PRECHECK_PASS' }))
      .resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['PREFLIGHT_INVALID'] });
    const source = preflight('XY');
    expect(source.status).toBe('PRECHECK_PASS');
    if (source.status !== 'PRECHECK_PASS') return;
    const getter = { ...source } as Record<string, unknown>;
    Object.defineProperty(getter, 'points', { enumerable: true, get: () => { throw new Error('hostile'); } });
    await expect(executeCanonicalSketchOcctGeometry(getter))
      .resolves.toMatchObject({ status: 'HOLD', blockerCodes: ['PREFLIGHT_INVALID'] });
    expect(validateCanonicalSketchOcctGeometryResult(new Proxy({}, { ownKeys: () => { throw new Error('hostile'); } }))).toBe(false);
  });
});
