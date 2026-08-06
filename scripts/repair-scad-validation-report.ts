import fs from 'node:fs';
import path from 'node:path';
import { repairScadScenario } from '../src/lib/ai/scadDeterministicRepair';

const [reportArg, evidenceArg, outputArg] = process.argv.slice(2);
if (!reportArg || !evidenceArg || !outputArg) throw new Error('usage: tsx scripts/repair-scad-validation-report.ts <report.json> <interface-evidence.json> <output.json>');
const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const report = read(reportArg), evidence = read(evidenceArg);
const codesByScenario = new Map<string, string[]>(evidence.results.map((item: { scenarioId: string; evidence: { codes: string[] } }) => [item.scenarioId, item.evidence.codes]));
const repairs: Array<{ scenarioId: string; status: string; mutations: unknown[]; unresolvedCodes: string[] }> = [];
const results = report.results.map((result: { scenarioId: string; finalScadSource: string; finalScadPreview?: string; finalScadBytes?: number }) => {
  const codes = codesByScenario.get(result.scenarioId) ?? [];
  const repairable = codes.filter(code => ['CAR_WHEEL_AXIS_MISMATCH', 'CAR_DUPLICATE_WINDOW_OCCURRENCE', 'GEAR_SUPPORT_JOINTS_NOT_MODELED', 'PIPE_FLOW_PATH_BLOCKED'].includes(code));
  if (!repairable.length) return result;
  const repaired = repairScadScenario(result.scenarioId, result.finalScadSource, repairable);
  repairs.push({ scenarioId: result.scenarioId, status: repaired.status, mutations: repaired.mutations, unresolvedCodes: repaired.unresolvedCodes });
  if (repaired.status !== 'repaired') return result;
  return { ...result, finalScadSource: repaired.source, finalScadPreview: repaired.source.slice(0, 400), finalScadBytes: repaired.source.length, notes: [...((result as { notes?: string[] }).notes ?? []), `deterministic-repair:${repaired.mutations.map(item => item.code).join(',')}`] };
});
const artifact = { ...report, generatedAt: new Date().toISOString(), repairedFrom: path.relative(process.cwd(), path.resolve(reportArg)).replaceAll('\\', '/'), repairs, results };
const output = path.resolve(outputArg); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ repaired: repairs.filter(item => item.status === 'repaired').length, notRun: repairs.filter(item => item.status === 'not_run').length }));
if (repairs.some(item => item.status !== 'repaired')) process.exitCode = 1;
