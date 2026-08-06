import fs from 'node:fs';
import path from 'node:path';
import { buildScadInterfaceEvidence } from '../src/lib/ai/scadInterfaceEvidence';
import { buildProductAssemblyCertificate } from '../src/lib/ai/productAssemblyCertificate';
import type { ScadCanonicalFeatureProgram } from '../src/lib/ai/scadCanonicalFeatureProgram';
import type { ScadAssemblyBridgeResult } from '../src/lib/ai/scadAssemblyBridge';
import type { PartGenerationCertificate } from '../src/lib/ai/partGenerationCertificate';

const [bridgeArg, canonicalArg, brepArg, outputArg, nativeFlowArg] = process.argv.slice(2);
if (!bridgeArg || !canonicalArg || !brepArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-interface-evidence.ts <bridge.json> <canonical.json> <brep.json> <output.json>');
const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const bridge = read(bridgeArg), canonical = read(canonicalArg), brep = read(brepArg);
const nativeFlow = nativeFlowArg ? read(nativeFlowArg) : null;
const flowByScenario = new Map<string, { status: 'pass' | 'fail' | 'not_run'; connectedComponentCount: number | null; blockedJunctionCount: number | null; codes: string[] }>((nativeFlow?.results ?? []).map((item: { scenarioId: string; status: 'pass' | 'fail' | 'not_run'; connectedComponentCount: number | null; blockedJunctionCount: number | null; codes: string[] }) => [item.scenarioId, item]));
const canonicalByScenario = new Map<string, ScadCanonicalFeatureProgram[]>(canonical.scenarios.map((item: { scenarioId: string; definitions: ScadCanonicalFeatureProgram[] }) => [item.scenarioId, item.definitions]));
const brepByScenario = new Map<string, Array<{ partCertificate?: PartGenerationCertificate }>>(brep.scenarios.map((item: { scenarioId: string; definitions: Array<{ partCertificate?: PartGenerationCertificate }> }) => [item.scenarioId, item.definitions]));

const assemblies = bridge.assemblies as Array<{ scenarioId: string; bridge: ScadAssemblyBridgeResult }>;
const results = assemblies.map(assembly => {
  if (assembly.bridge.status !== 'pass' || !assembly.bridge.architecture) return { scenarioId: assembly.scenarioId, status: 'fail', codes: ['SCAD_ASSEMBLY_BRIDGE_FAILED'] };
  const evidence = buildScadInterfaceEvidence({
    scenarioId: assembly.scenarioId,
    architecture: assembly.bridge.architecture,
    transforms: assembly.bridge.transforms,
    programs: canonicalByScenario.get(assembly.scenarioId) ?? [],
    nativeFlow: flowByScenario.get(assembly.scenarioId),
  });
  const partCertificates = (brepByScenario.get(assembly.scenarioId) ?? [])
    .map(item => item.partCertificate)
    .filter((item): item is PartGenerationCertificate => item !== undefined);
  const assemblyCertificate = buildProductAssemblyCertificate(evidence.architecture, { partCertificates, transforms: assembly.bridge.transforms, joints: evidence.joints });
  return { scenarioId: assembly.scenarioId, status: evidence.status, evidence, assemblyCertificate };
});
const count = (status: string) => results.filter(item => item.status === status).length;
const artifact = {
  schema: 'nexyfab.scad-interface-evidence-campaign.v1',
  generatedAt: new Date().toISOString(),
  inputs: { bridge: bridgeArg, canonical: canonicalArg, brep: brepArg },
  summary: { scenarios: results.length, pass: count('pass'), fail: count('fail'), notRun: count('not_run') },
  results,
};
const output = path.resolve(outputArg); fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact.summary));
if (artifact.summary.fail) process.exitCode = 1;
