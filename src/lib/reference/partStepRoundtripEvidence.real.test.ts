import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeTriangles, type TriangleSoup, type Vec3 } from '@/lib/cad-ir/meshAnalysis';
import { comparePartStepRoundtrip, type PartGeometryMeasurement } from './partStepRoundtripEvidence';
import { ensureReplicad } from '../../../scripts/drawing-to-3d/to-step.mjs';

type Rc = Awaited<ReturnType<typeof ensureReplicad>>;
let rc: Rc;
beforeAll(async () => { rc = await ensureReplicad(); }, 60_000);

describe('real isolated part STEP roundtrip', () => {
  it('exports authoring OCCT B-Rep and verifies imported geometry with occt-import-js', async () => {
    const shape = rc.makeCylinder(10, 40);
    const [sourceMin, sourceMax] = shape.boundingBox.bounds;
    const source: PartGeometryMeasurement = {
      engineIdentity: 'replicad-opencascadejs', role: 'authoring-brep', unit: 'mm', solidCount: 1,
      volumeMm3: rc.measureVolume(shape), surfaceAreaMm2: rc.measureShapeSurfaceProperties(shape).area,
      bbox: { min: sourceMin, max: sourceMax }, validSolid: true, watertight: true,
    };
    const stepBytes = new Uint8Array(await shape.blobSTEP().arrayBuffer());
    const occtImport = (await import('occt-import-js')).default;
    const occt = await occtImport({ locateFile: file => file.endsWith('.wasm') ? path.join(process.cwd(), 'node_modules/occt-import-js/dist/occt-import-js.wasm') : file });
    const imported = occt.ReadStepFile(stepBytes, null);
    expect(imported.success).toBe(true);

    const soup: TriangleSoup = [];
    for (const mesh of imported.meshes) {
      const positions = mesh.attributes.position.array;
      const indices = mesh.index?.array ?? new Uint32Array();
      const point = (vertex: number): Vec3 => [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!];
      for (let index = 0; index < indices.length; index += 3) soup.push([point(indices[index]!), point(indices[index + 1]!), point(indices[index + 2]!)]);
    }
    const measured = analyzeTriangles(soup);
    expect(measured.ok).toBe(true);
    const evidence = comparePartStepRoundtrip(source, {
      engineIdentity: 'occt-import-js', role: 'isolated-step-import', unit: 'mm', solidCount: measured.bodyCount,
      volumeMm3: measured.volume ?? Number.NaN, surfaceAreaMm2: measured.area ?? undefined,
      bbox: { min: measured.bboxMin!, max: measured.bboxMax! }, validSolid: measured.ok && !measured.nonManifold, watertight: measured.watertight,
    }, { volumeRelative: 0.002, surfaceAreaRelative: 0.002, bboxAbsoluteMm: 0.02, centroidAbsoluteMm: 0.01 });
    expect(evidence.status, JSON.stringify({ blockers: evidence.blockers, comparisons: evidence.comparisons })).toBe('pass');
  }, 60_000);
});
