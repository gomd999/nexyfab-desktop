import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NATIVE_WORKER_HOST_REQUIREMENTS, validateNativeWorkerHealth, type ExternalNativeWorkerKind, type NativeWorkerHealth } from '../../src/lib/reference/nativeWorkerHostContract';
import { writeLatestArtifactAtomic } from '../../src/lib/reference/immutableArtifactStore';

const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = path.resolve(value('output') ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-health-probe.json');
const timeoutMs = Number(value('timeout-ms') ?? 30_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error('native_worker_health_timeout_invalid');

const results: Array<{ workerKind: ExternalNativeWorkerKind; status: 'pass' | 'fail' | 'not_run'; reason: string; health?: NativeWorkerHealth; errors?: string[] }> = [];
for (const [kind, requirement] of Object.entries(NATIVE_WORKER_HOST_REQUIREMENTS) as Array<[ExternalNativeWorkerKind, typeof NATIVE_WORKER_HOST_REQUIREMENTS[ExternalNativeWorkerKind]]>) {
  const command = process.env[requirement.environment]?.trim();
  if (!command) { results.push({ workerKind: kind, status: 'not_run', reason: 'worker_command_unconfigured' }); continue; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-worker-health-'));
  try {
    const healthPath = path.join(temp, 'health.json');
    const execution = spawnSync(command, ['--health', '--output', healthPath], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, shell: false });
    if (execution.error || execution.status !== 0) throw new Error(execution.error?.message ?? `health_exit:${execution.status}:${execution.stderr.slice(-500)}`);
    if (!fs.existsSync(healthPath)) throw new Error('health_result_missing');
    const bytes = fs.readFileSync(healthPath); if (bytes.length < 2 || bytes.length > 1024 * 1024) throw new Error(`health_result_size_invalid:${bytes.length}`);
    const health = JSON.parse(bytes.toString('utf8')) as NativeWorkerHealth, validation = validateNativeWorkerHealth(kind, health);
    if (!validation.ready) results.push({ workerKind: kind, status: 'fail', reason: 'health_rejected', health, errors: validation.errors });
    else results.push({ workerKind: kind, status: 'pass', reason: 'health_validated', health });
  } catch (error) { results.push({ workerKind: kind, status: 'fail', reason: error instanceof Error ? error.message : String(error) }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
const artifact = { schema: 'nexyfab.native-worker-health-probe-batch.v1', generatedAt: new Date().toISOString(), releaseReady: results.every(item => item.status === 'pass'), summary: { workers: results.length, pass: results.filter(item => item.status === 'pass').length, fail: results.filter(item => item.status === 'fail').length, notRun: results.filter(item => item.status === 'not_run').length }, results };
writeLatestArtifactAtomic(output, Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`));
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary, releaseReady: artifact.releaseReady }));
if (artifact.summary.fail) process.exitCode = 4;
