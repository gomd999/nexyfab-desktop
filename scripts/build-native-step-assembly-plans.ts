import fs from 'node:fs';
import path from 'node:path';
import { buildNativeStepAssemblyPlan } from '../src/lib/ai/nativeStepAssemblyPlan';
import type { ManufacturingAssignment } from '../src/lib/ai/manufacturingAssignment';

const [bridgeArg, brepArg, outputArg, assignmentsArg] = process.argv.slice(2);
if (!bridgeArg || !brepArg || !outputArg) throw new Error('usage: tsx scripts/build-native-step-assembly-plans.ts <bridge.json> <brep.json> <output.json> [assignments.json]');
const bridgePath = path.resolve(bridgeArg), brepPath = path.resolve(brepArg), outputPath = path.resolve(outputArg);
const bridge = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
const brep = JSON.parse(fs.readFileSync(brepPath, 'utf8'));
const assignments: ManufacturingAssignment[] = assignmentsArg ? JSON.parse(fs.readFileSync(path.resolve(assignmentsArg), 'utf8')) : [];
const brepByScenario = new Map(brep.scenarios.map((item: { scenarioId: string; definitions: unknown[] }) => [item.scenarioId, item.definitions]));
const plans: Array<{ scenarioId: string; plan: ReturnType<typeof buildNativeStepAssemblyPlan> }> = bridge.assemblies.map((assembly: { scenarioId: string; bridge: { architecture: Parameters<typeof buildNativeStepAssemblyPlan>[0]['architecture']; transforms: Parameters<typeof buildNativeStepAssemblyPlan>[0]['transforms'] } }) => {
  const definitions = (brepByScenario.get(assembly.scenarioId) ?? []) as Array<{ definitionId: string; step?: { file?: string; sha256?: string } }>;
  const artifacts = definitions.flatMap(item => item.step?.file && item.step.sha256 ? [{ definitionId: item.definitionId, stepPath: path.posix.join('docs/evidence/scad-analytic-brep-260806', item.step.file), sha256: item.step.sha256 }] : []);
  return { scenarioId: assembly.scenarioId, plan: buildNativeStepAssemblyPlan({ architecture: assembly.bridge.architecture, transforms: assembly.bridge.transforms, artifacts, assignments }) };
});
const artifact = { schema: 'nexyfab.native-step-assembly-plan-campaign.v1', generatedAt: new Date().toISOString(), assignmentsProvided: assignments.length, summary: { scenarios: plans.length, pass: plans.filter(item => item.plan.status === 'pass').length, notRun: plans.filter(item => item.plan.status === 'not_run').length, fail: plans.filter(item => item.plan.status === 'fail').length }, plans };
fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'); console.log(JSON.stringify(artifact.summary));
if (artifact.summary.fail > 0) process.exitCode = 1;
