import fs from 'node:fs';
import path from 'node:path';
import { bridgeEffectiveScadSource } from '../src/lib/ai/scadAssemblyBridge';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  throw new Error('usage: tsx scripts/bridge-scad-validation-assemblies.ts <validation-report.json> <output.json>');
}
const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const report = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  generatedAt?: string;
  results?: Array<{ scenarioId?: string; passed?: boolean; finalScadSource?: string }>;
};
if (!Array.isArray(report.results)) throw new Error('validation_report_results_missing');
const assemblies = report.results.map(result => ({
  scenarioId: result.scenarioId ?? 'unknown',
  validationPassed: result.passed === true,
  bridge: typeof result.finalScadSource === 'string'
    ? bridgeEffectiveScadSource(result.finalScadSource, result.scenarioId ?? 'SCAD Assembly')
    : { schema: 'nexyfab.scad-assembly-bridge.v1', status: 'fail', architecture: null, transforms: [], codes: ['SCAD_ASSEMBLY_FULL_SOURCE_MISSING'] },
}));
const artifact = {
  schema: 'nexyfab.scad-validation-assembly-evidence.v1',
  generatedAt: new Date().toISOString(),
  sourceReport: path.relative(process.cwd(), input).replaceAll('\\', '/'),
  sourceGeneratedAt: report.generatedAt ?? null,
  summary: {
    total: assemblies.length,
    pass: assemblies.filter(item => item.validationPassed && item.bridge.status === 'pass').length,
    fail: assemblies.filter(item => !item.validationPassed || item.bridge.status !== 'pass').length,
  },
  assemblies,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact.summary));
if (artifact.summary.fail > 0) process.exitCode = 1;
