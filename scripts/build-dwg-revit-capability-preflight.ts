import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateDwgRevitCapability, type DwgRevitExecutor } from '../src/lib/reference/dwgRevitCapability';

const triagePath = path.resolve(process.argv[2] ?? 'docs/evidence/external-step-structure-coverage-260806/unsupported-archive-triage-run-1.json');
const importPath = path.resolve(process.argv[3] ?? 'docs/evidence/complex-holdout-review-260806/dwg-import-results.json');
const output = path.resolve(process.argv[4] ?? 'docs/evidence/external-step-structure-coverage-260806/dwg-revit-capability-preflight-run-1.json');
const progIds = ['AutoCAD.Application', ...Array.from({ length: 16 }, (_, index) => `AutoCAD.Application.${index + 20}`)];
const script = `$ids=@(${progIds.map(item => `'${item}'`).join(',')}); @($ids|?{try{$null-ne[type]::GetTypeFromProgID($_)}catch{$false}})|ConvertTo-Json -Compress`;
const execution = process.platform === 'win32' ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }) : null;
const registeredProgIds = execution?.status === 0 && execution.stdout.trim() ? ([] as string[]).concat(JSON.parse(execution.stdout)) : [];
const probe = {
  platform: process.platform,
  registeredProgIds,
  odaCommandConfigured: Boolean(process.env.NEXYFAB_ODA_FILE_CONVERTER_COMMAND?.trim()),
  revitWorkerConfigured: Boolean(process.env.NEXYFAB_REVIT_WORKER_COMMAND?.trim()),
};
const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8')) as { results: Array<{ route: string }> };
const imported = JSON.parse(fs.readFileSync(importPath, 'utf8')) as { attempts: Array<{ classification: string }> };
const queue: Record<DwgRevitExecutor, number> = {
  'autocad-com': imported.attempts.filter(item => item.classification === 'aabb-approximation').length,
  'oda-file-converter': imported.attempts.filter(item => item.classification === 'aabb-approximation').length,
  'revit-worker': triage.results.filter(item => item.route === 'revit-api').length,
};
const executors: DwgRevitExecutor[] = ['autocad-com', 'oda-file-converter', 'revit-worker'];
const verdicts = executors.map(executor => ({ ...evaluateDwgRevitCapability(executor, probe), queuedCases: queue[executor] }));
const artifact = {
  schema: 'nexyfab.dwg-revit-capability-preflight.v1', generatedAt: new Date().toISOString(), scoreEligible: false,
  probe: { ...probe, probeExitCode: execution?.status ?? null },
  summary: { readyExecutors: verdicts.filter(item => item.status === 'ready').length, notRunExecutors: verdicts.filter(item => item.status === 'not_run').length, exactDwgRecoveryCases: queue['autocad-com'], revitNativeCases: queue['revit-worker'] },
  verdicts,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
