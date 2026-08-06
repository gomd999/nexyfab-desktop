import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureOC, ensureReplicad } from './drawing-to-3d/to-step.mjs';
import canonicalBrep from '../src/lib/ai/scadCanonicalBrep.ts';
import partCertificateModule from '../src/lib/ai/partGenerationCertificate.ts';
import nodeOcctBridgeModule from '../src/lib/occt/nodeOcctBridge.ts';

const { compareCanonicalBrepToMesh, executeScadCanonicalBrep, measureCanonicalGoverningDimensions, scadMeshDiscretizationTolerance } = canonicalBrep;
const { buildPartGenerationCertificate } = partCertificateModule;
const { createNodeOcctBridge } = nodeOcctBridgeModule;

const [canonicalArg, meshArg, outputArg] = process.argv.slice(2);
if (!canonicalArg || !meshArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-analytic-brep-evidence.mjs <canonical.json> <mesh.json> <output.json>');
const canonicalPath = path.resolve(canonicalArg), meshPath = path.resolve(meshArg), outputPath = path.resolve(outputArg);
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const meshCampaign = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
const meshes = new Map(meshCampaign.assemblies.flatMap(assembly => assembly.evidence?.definitions ?? []).map(item => [item.definitionId, item]));
const rc = await ensureReplicad();
const nativeBridge = createNodeOcctBridge(await ensureOC());
const kernel = {
  makeBaseBox: (...args) => rc.makeBaseBox(...args), makeCylinder: (...args) => rc.makeCylinder(...args), measureVolume: shape => rc.measureVolume(shape),
  makePolygonExtrude: (points, height) => {
    let drawing = rc.draw(points[0]);
    for (let index = 1; index < points.length; index++) drawing = drawing.lineTo(points[index]);
    return drawing.close().sketchOnPlane('XY').extrude(height);
  },
};
const stepDir = path.join(path.dirname(outputPath), 'step');
fs.mkdirSync(stepDir, { recursive: true });

const scenarios = [];
for (const scenario of canonical.scenarios) {
  const definitions = [];
  for (const program of scenario.definitions) {
    const execution = executeScadCanonicalBrep(program, kernel);
    const mesh = meshes.get(program.definitionId);
    let crossCheck = null, step = null, roundtrip = null, nativeTopology = null, nativeTopologyError = null, partCertificate = null;
    if (execution.status === 'pass' && execution.shape && execution.measurement) {
      crossCheck = mesh?.bbox && typeof mesh.volumeMm3 === 'number'
        ? compareCanonicalBrepToMesh(execution.measurement, { bbox: mesh.bbox, volumeMm3: mesh.volumeMm3 }, scadMeshDiscretizationTolerance(program))
        : { status: 'fail', bboxMaxErrorMm: null, volumeRelativeError: null, codes: ['SCAD_BREP_MESH_EVIDENCE_MISSING'] };
      const text = await execution.shape.blobSTEP().text();
      const valid = text.includes('MANIFOLD_SOLID_BREP') && text.includes('ADVANCED_FACE');
      const file = `${scenario.scenarioId}-${program.definitionId.replace(/^scad:def:/, '')}.step`;
      fs.writeFileSync(path.join(stepDir, file), text, 'latin1');
      step = { valid, bytes: Buffer.byteLength(text, 'latin1'), sha256: createHash('sha256').update(text, 'latin1').digest('hex'), file: `step/${file}` };
      const imported = await rc.importSTEP(new Blob([text], { type: 'application/step' }));
      const importedBox = imported.boundingBox;
      const importedMeasurement = {
        bboxSize: [importedBox.width, importedBox.height, importedBox.depth],
        volumeMm3: rc.measureVolume(typeof imported.asShape3D === 'function' ? imported.asShape3D() : imported),
        solidCount: typeof imported._listTopo === 'function' ? imported._listTopo('solid').length : 0,
        faceCount: Array.isArray(imported.faces) ? imported.faces.length : 0,
      };
      const bboxMaxErrorMm = Math.max(...execution.measurement.bboxSize.map((value, index) => Math.abs(value - importedMeasurement.bboxSize[index])));
      const volumeRelativeError = Math.abs(execution.measurement.volumeMm3 - importedMeasurement.volumeMm3) / Math.max(execution.measurement.volumeMm3, 1e-12);
      const roundtripCodes = [bboxMaxErrorMm > 0.001 ? 'SCAD_BREP_STEP_BBOX_MISMATCH' : null, volumeRelativeError > 1e-6 ? 'SCAD_BREP_STEP_VOLUME_MISMATCH' : null, importedMeasurement.solidCount !== execution.measurement.solidCount ? 'SCAD_BREP_STEP_SOLID_COUNT_MISMATCH' : null].filter(Boolean);
      roundtrip = { status: roundtripCodes.length ? 'fail' : 'pass', bboxMaxErrorMm, volumeRelativeError, importedMeasurement, codes: roundtripCodes };
      const nativeImport = await nativeBridge.importSTEP(text);
      if (nativeImport.ok && nativeImport.shape && nativeBridge.inspectShapeDetailed) {
        const detail = await nativeBridge.inspectShapeDetailed(nativeImport.shape);
        nativeTopology = detail;
        nativeBridge.release(nativeImport.shape);
      } else nativeTopologyError = nativeImport.ok ? 'SCAD_NATIVE_DETAILED_INSPECTION_UNAVAILABLE' : nativeImport.error;
      const adjacency = nativeTopology?.faceAdjacency;
      const topology = nativeTopology && adjacency?.status === 'available' && typeof nativeTopology.minEdgeLength === 'number'
        ? { solidCount: nativeTopology.solidCount, watertight: nativeTopology.valid && adjacency.boundaryEdgeCount === 0, nonManifoldEdges: adjacency.nonManifoldEdgeCount, degenerateFaces: nativeTopology.minEdgeLength > 1e-9 ? 0 : 1 }
        : undefined;
      const dimensions = measureCanonicalGoverningDimensions(program, execution.measurement, nativeTopology ?? undefined);
      partCertificate = buildPartGenerationCertificate(
        { partId: program.definitionId, intent: 'general', bodyPolicy: 'single_body', expectedBodies: 1, dimensions: program.governingDimensions.map(item => ({ id: item.path, expected: item.value, tolerance: item.unit === 'count' ? 0 : 0.001, unit: item.unit })), features: [] },
        { kernel: { available: true, valid: valid && roundtrip.status === 'pass' && nativeTopology?.valid === true, source: 'analytic_kernel', artifactClass: 'analytic_brep', artifactHash: step.sha256 }, topology, dimensions },
      );
    }
    definitions.push({ definitionId: program.definitionId, status: execution.status, artifactClass: execution.artifactClass, measurement: execution.measurement, codes: execution.codes, crossCheck, step, roundtrip, nativeTopology, nativeTopologyError, partCertificate, manufacturingReady: execution.status === 'pass' && crossCheck?.status === 'pass' && step?.valid === true && roundtrip?.status === 'pass' && partCertificate?.releaseReady === true && program.unresolvedMetadata.length === 0 });
  }
  scenarios.push({ scenarioId: scenario.scenarioId, definitions });
}
const all = scenarios.flatMap(item => item.definitions);
const artifact = { schema: 'nexyfab.scad-analytic-brep-campaign.v1', generatedAt: new Date().toISOString(), sourceCanonical: path.relative(process.cwd(), canonicalPath).replaceAll('\\', '/'), sourceMesh: path.relative(process.cwd(), meshPath).replaceAll('\\', '/'), summary: { definitions: all.length, analyticPass: all.filter(item => item.status === 'pass').length, notRun: all.filter(item => item.status === 'not_run').length, fail: all.filter(item => item.status === 'fail').length, crossCheckPass: all.filter(item => item.crossCheck?.status === 'pass').length, stepRoundtripPass: all.filter(item => item.roundtrip?.status === 'pass').length, nativeTopologyPass: all.filter(item => item.nativeTopology?.valid === true).length, nativeTopologyNotRun: all.filter(item => item.nativeTopology === null).length, partCertificatePass: all.filter(item => item.partCertificate?.status === 'pass').length, partCertificateNotRun: all.filter(item => item.partCertificate?.status === 'not_run').length, partCertificateFail: all.filter(item => item.partCertificate?.status === 'fail').length, manufacturingReady: all.filter(item => item.manufacturingReady).length }, scenarios };
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact.summary));
if (artifact.summary.fail > 0) process.exitCode = 1;
