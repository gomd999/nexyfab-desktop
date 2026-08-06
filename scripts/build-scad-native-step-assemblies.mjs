import fs from 'node:fs';
import path from 'node:path';
import { ensureReplicad, exportOccurrenceAssemblySTEP } from './drawing-to-3d/to-step.mjs';
import stepEvidenceModule from '../src/lib/reference/stepAssemblyEvidence.ts';

const { analyzeStepAssemblyPlacements } = stepEvidenceModule;
const [bridgeArg, brepArg, outputArg] = process.argv.slice(2);
if (!bridgeArg || !brepArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-native-step-assemblies.mjs <bridge.json> <brep.json> <output.json>');
const bridge = JSON.parse(fs.readFileSync(path.resolve(bridgeArg), 'utf8')), brep = JSON.parse(fs.readFileSync(path.resolve(brepArg), 'utf8'));
const output = path.resolve(outputArg), stepDir = path.join(path.dirname(output), 'step'); fs.mkdirSync(stepDir, { recursive: true });
const brepByScenario = new Map(brep.scenarios.map(item => [item.scenarioId, item.definitions]));
const rc = await ensureReplicad(), results = [];
const signature = matrix => matrix.map(value => Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(7))).join(',');

for (const assembly of bridge.assemblies) {
  const architecture = assembly.bridge.architecture, transforms = new Map(assembly.bridge.transforms.map(item => [item.occurrenceId, item.matrix]));
  const evidence = brepByScenario.get(assembly.scenarioId) ?? [], definitionEvidence = new Map(evidence.map(item => [item.definitionId, item]));
  const partDefinitions = architecture.definitions.filter(item => item.kind === 'part');
  const definitions = [];
  for (const definition of partDefinitions) {
    const item = definitionEvidence.get(definition.id);
    if (!item?.step?.file) throw new Error(`${assembly.scenarioId}: STEP missing for ${definition.id}`);
    const source = fs.readFileSync(path.resolve('docs/evidence/scad-analytic-brep-260806', item.step.file));
    definitions.push({ id: definition.id, name: definition.name, shape: await rc.importSTEP(new Blob([source], { type: 'application/step' })) });
  }
  const occurrences = architecture.occurrences.filter(item => architecture.definitions.find(definition => definition.id === item.definitionId)?.kind === 'part').map(item => ({ id: item.id, definitionId: item.definitionId, matrix: transforms.get(item.id) }));
  const exported = await exportOccurrenceAssemblySTEP(definitions, occurrences, { name: assembly.scenarioId });
  const file = `${assembly.scenarioId}.step`; fs.writeFileSync(path.join(stepDir, file), exported.step, 'latin1');
  const measured = analyzeStepAssemblyPlacements(exported.step);
  const expectedMatrices = occurrences.map(item => signature(item.matrix)).sort();
  const measuredMatrices = measured.occurrences.flatMap(item => item.localToParent.status === 'available' ? [signature(item.localToParent.matrix)] : []).sort();
  const codes = [];
  if (exported.nauo !== occurrences.length || measured.sourceOccurrenceCount !== occurrences.length) codes.push('STEP_ASSEMBLY_OCCURRENCE_COUNT_MISMATCH');
  if (!measured.cycleFree) codes.push('STEP_ASSEMBLY_CYCLE');
  if (measured.invalidTransformCount || measured.missingTransformCount) codes.push('STEP_ASSEMBLY_TRANSFORM_UNAVAILABLE');
  if (JSON.stringify(expectedMatrices) !== JSON.stringify(measuredMatrices)) codes.push('STEP_ASSEMBLY_TRANSFORM_MISMATCH');
  results.push({ scenarioId: assembly.scenarioId, status: codes.length ? 'fail' : 'pass', structuralReady: codes.length === 0, manufacturingReleaseReady: false, reason: 'Material/process assignments remain unresolved.', definitionCount: definitions.length, occurrenceCount: occurrences.length, products: exported.products, nauo: exported.nauo, placementEvidence: measured, stepFile: `step/${file}`, codes });
}
const artifact = { schema: 'nexyfab.scad-native-step-assembly-campaign.v1', generatedAt: new Date().toISOString(), summary: { scenarios: results.length, pass: results.filter(item => item.status === 'pass').length, fail: results.filter(item => item.status === 'fail').length, definitions: results.reduce((sum, item) => sum + item.definitionCount, 0), occurrences: results.reduce((sum, item) => sum + item.occurrenceCount, 0), manufacturingReleaseReady: results.filter(item => item.manufacturingReleaseReady).length }, results };
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(artifact.summary));
if (artifact.summary.fail) process.exitCode = 1;
