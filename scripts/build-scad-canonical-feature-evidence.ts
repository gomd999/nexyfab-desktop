import fs from 'node:fs';
import path from 'node:path';
import { convertScadDefinitionToCanonical } from '../src/lib/ai/scadCanonicalFeatureProgram';
import { parseEffectiveScadAssemblySource } from '../src/lib/ai/scadAssemblyBridge';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-canonical-feature-evidence.ts <validation-report.json> <output.json>');
const input = path.resolve(inputArg), output = path.resolve(outputArg);
const report = JSON.parse(fs.readFileSync(input, 'utf8')) as { generatedAt?: string; results?: Array<{ scenarioId?: string; passed?: boolean; finalScadSource?: string }> };
if (!Array.isArray(report.results)) throw new Error('validation_report_results_missing');

const scenarios = report.results.map(result => {
  const scenarioId = result.scenarioId ?? 'unknown';
  const parsed = parseEffectiveScadAssemblySource(result.finalScadSource ?? '');
  const definitions = Object.entries(parsed.modules).map(([name, moduleSource]) => convertScadDefinitionToCanonical({
    definitionId: `scad:def:${name}`,
    moduleSource,
    sourceRef: `${path.relative(process.cwd(), input).replaceAll('\\', '/') }#${scenarioId}/${name}`,
    partNumber: `${scenarioId}-${name}`,
  }));
  return { scenarioId, validationPassed: result.passed === true, definitions };
});
const definitions = scenarios.flatMap(item => item.definitions);
const artifact = {
  schema: 'nexyfab.scad-canonical-feature-evidence.v1', generatedAt: new Date().toISOString(),
  sourceReport: path.relative(process.cwd(), input).replaceAll('\\', '/'), sourceGeneratedAt: report.generatedAt ?? null,
  summary: { scenarios: scenarios.length, definitions: definitions.length, converted: definitions.filter(item => item.status === 'pass').length, notRun: definitions.filter(item => item.status === 'not_run').length, manufacturingReady: definitions.filter(item => item.manufacturingReady).length },
  scenarios,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact.summary));
if (artifact.summary.notRun > 0) process.exitCode = 1;
