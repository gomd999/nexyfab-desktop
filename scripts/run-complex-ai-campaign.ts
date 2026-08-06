import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runComplexCampaign, type ComplexCampaignExecutor, type ComplexCampaignState } from '../src/lib/ai/complexCampaignRunner';
import { buildComplexBenchmarkReportV2, type ComplexBenchmarkCaseV2 } from '../src/lib/ai/complexProductBenchmarkV2';

const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => process.argv.includes(`--${name}`);
async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
async function atomicJson(file: string, data: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`); await rename(temporary, file); }

async function main() {
  const casesPath = value('cases'), statePath = value('state'), executorPath = value('executor');
  if (!casesPath || !statePath || !executorPath) throw new Error('Usage: --cases=cases.json --state=campaign-state.json --executor=executor.mjs [--resume]');
  const cases = await json<ComplexBenchmarkCaseV2[]>(path.resolve(casesPath));
  const imported = await import(pathToFileURL(path.resolve(executorPath)).href) as { executeComplexCampaignSlot?: ComplexCampaignExecutor };
  if (typeof imported.executeComplexCampaignSlot !== 'function') throw new Error('campaign_executor_export_missing');
  const resolvedState = path.resolve(statePath), initial = has('resume') ? await json<ComplexCampaignState>(resolvedState) : undefined;
  const state = await runComplexCampaign(cases, imported.executeComplexCampaignSlot, initial, { onCheckpoint: checkpoint => atomicJson(resolvedState, checkpoint) });
  await atomicJson(resolvedState, state);
  const report = buildComplexBenchmarkReportV2(cases, state.results); await atomicJson(`${resolvedState}.report.json`, report);
  const counts = state.slots.reduce((out, slot) => ({ ...out, [slot.status]: (out[slot.status] ?? 0) + 1 }), {} as Record<string, number>);
  process.stdout.write(`${JSON.stringify({ suiteHash: state.suiteHash, slots: counts, results: state.results.length, reportEligible: report.eligible, state: resolvedState })}\n`);
  if (state.slots.some(slot => slot.status !== 'completed') || !report.eligible) process.exitCode = 4;
}
main().catch(error => { process.stderr.write(`complex AI campaign failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
