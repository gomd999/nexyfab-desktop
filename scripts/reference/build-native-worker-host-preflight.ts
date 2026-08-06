import fs from 'node:fs';
import path from 'node:path';
import { NATIVE_WORKER_HOST_REQUIREMENTS, type ExternalNativeWorkerKind } from '../../src/lib/reference/nativeWorkerHostContract';

const manifestPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json');
const output = path.resolve(process.argv[3] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-host-preflight.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { jobs: Array<{ workerKind: string; availability: string }> };
const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
const resolveCommand = (command: string) => {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? path.resolve(command) : null;
  for (const root of pathEntries) { const candidate = path.join(root, command); if (fs.existsSync(candidate)) return path.resolve(candidate); }
  return null;
};

const results = Object.entries(NATIVE_WORKER_HOST_REQUIREMENTS).map(([workerKind, requirement]) => {
  const jobs = manifest.jobs.filter(job => job.workerKind === workerKind).length;
  const configured = process.env[requirement.environment]?.trim();
  const executable = configured ? resolveCommand(configured) : null;
  const status = !configured ? 'not_run' : executable ? 'ready_to_probe' : 'fail';
  const reason = !configured ? 'worker_command_unconfigured' : executable ? 'worker_executable_resolved_health_not_run' : 'worker_executable_missing';
  return { workerKind: workerKind as ExternalNativeWorkerKind, jobs, status, reason, requirement, configured: Boolean(configured), executable };
});
const artifact = { schema: 'nexyfab.native-worker-host-preflight.v1', scoreEligible: false, releaseReady: false, policy: { commandPresenceIsNotHealthProof: true, licenseMustBeValidatedByHealthProbe: true, noSilentFallback: true }, summary: { workers: results.length, jobs: results.reduce((sum, item) => sum + item.jobs, 0), readyToProbe: results.filter(item => item.status === 'ready_to_probe').length, notRun: results.filter(item => item.status === 'not_run').length, fail: results.filter(item => item.status === 'fail').length }, results };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
if (artifact.summary.fail) process.exitCode = 4;
