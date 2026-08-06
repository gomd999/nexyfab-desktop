import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateNativeCadCapability, type NativeCadExecutor } from '../src/lib/reference/nativeCadCapability';

const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const output = path.resolve(process.argv[3] ?? 'docs/evidence/external-step-structure-coverage-260806/native-cad-preflight-run-1.json');
const executors: NativeCadExecutor[] = ['solidworks-com', 'inventor-com', 'parasolid-cad-exchanger', 'creo-or-solid-edge-native', 'catia-com-or-cad-exchanger'];
const progIds = ['SldWorks.Application', 'Inventor.Application', 'SolidEdge.Application', 'Creo.Application', 'CATIA.Application'];
const script = `$ids=@(${progIds.map(item => `'${item}'`).join(',')}); @($ids|?{try{$null-ne[type]::GetTypeFromProgID($_)}catch{$false}})|ConvertTo-Json -Compress`;
const execution = process.platform === 'win32' ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }) : null;
const registeredProgIds = execution?.status === 0 && execution.stdout.trim() ? ([] as string[]).concat(JSON.parse(execution.stdout)) : [];
const exchangerConfigured = Boolean(process.env.NEXYFAB_CAD_EXCHANGER_COMMAND?.trim());
const jobs = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extractor-jobs.json'), 'utf8')) as { partitions: Record<string, Array<{ caseId: string }>> };
const completedBatch = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'external-native-all-results.json'), 'utf8')) as { results: Array<{ caseId: string }> };
const completed = new Set(completedBatch.results.map(item => item.caseId));
const verdicts = executors.map(executor => ({ ...evaluateNativeCadCapability(executor, { platform: process.platform, registeredProgIds, exchangerConfigured }), queuedCases: (jobs.partitions[executor] ?? []).filter(item => !completed.has(item.caseId)).length }));
const artifact = { schema: 'nexyfab.native-cad-capability-preflight.v1', generatedAt: new Date().toISOString(), scoreEligible: false, probe: { platform: process.platform, registeredProgIds, exchangerConfigured, probeExitCode: execution?.status ?? null }, summary: { readyExecutors: verdicts.filter(item => item.status === 'ready').length, notRunExecutors: verdicts.filter(item => item.status === 'not_run').length, readyCases: verdicts.filter(item => item.status === 'ready').reduce((sum, item) => sum + item.queuedCases, 0), notRunCases: verdicts.filter(item => item.status === 'not_run').reduce((sum, item) => sum + item.queuedCases, 0) }, verdicts };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'); console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
