import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from '../../src/lib/reference/nativeWorkerExecution';

const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const manifestPath = path.resolve(value('manifest') ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json');
const corpusRoot = path.resolve(value('root') ?? 'C:/Users/gomd9/Downloads/참고파일들');
const output = path.resolve(value('output') ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-execution-results.json');
const resumePath = value('resume') ? path.resolve(value('resume')!) : undefined;
const selectedJob = value('job');
const selectedWorker = value('worker');
const timeoutMs = Number(value('timeout-ms') ?? 600_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) throw new Error('native_worker_timeout_invalid');
const COMMAND_ENV = {
  'solidworks-native': 'NEXYFAB_SOLIDWORKS_WORKER_COMMAND',
  'inventor-native': 'NEXYFAB_INVENTOR_WORKER_COMMAND',
  'catia-native': 'NEXYFAB_CATIA_WORKER_COMMAND',
  'creo-native': 'NEXYFAB_CREO_WORKER_COMMAND',
  'parasolid-native': 'NEXYFAB_PARASOLID_WORKER_COMMAND',
  'dwg-exact': 'NEXYFAB_DWG_WORKER_COMMAND',
  'revit-native': 'NEXYFAB_REVIT_WORKER_COMMAND',
} as const;
const repair = (text: string) => { if (!/[ÃƒÃ¬Ã«]/.test(text)) return text; const decoded = Buffer.from(text, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? text : decoded; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repair(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function sourceBytes(job: NativeWorkerExecutionJob) {
  const outer = fs.readFileSync(safePath(corpusRoot, job.source.locator));
  if (job.source.kind === 'direct') return outer;
  if (!job.source.member) throw new Error('zip_member_path_missing');
  const archive = await JSZip.loadAsync(outer), member = archive.files[job.source.member];
  if (!member || member.dir) throw new Error('zip_member_missing');
  return member.async('nodebuffer');
}

async function main() {
  const manifestBytes = fs.readFileSync(manifestPath), manifestSha256 = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { jobs: NativeWorkerExecutionJob[] };
  const externalJobs = manifest.jobs.filter(job => job.availability === 'external-required');
  const jobs = externalJobs.filter(job => (!selectedJob || job.jobId === selectedJob) && (!selectedWorker || job.workerKind === selectedWorker));
  if ((selectedJob || selectedWorker) && !jobs.length) throw new Error('native_worker_selection_empty');
  const accepted: Array<{ job: NativeWorkerExecutionJob; result: NativeWorkerExecutionResult; resultSha256: string }> = [];
  const notRun: Array<{ jobId: string; caseId: string; reason: string }> = [];
  const failed: Array<{ jobId: string; caseId: string; reason: string }> = [];
  const resumed = new Map<string, { job: NativeWorkerExecutionJob; result: NativeWorkerExecutionResult; resultSha256: string }>();
  if (resumePath) {
    const prior = JSON.parse(fs.readFileSync(resumePath, 'utf8')) as { manifestSha256: string; accepted: Array<{ job: NativeWorkerExecutionJob; result: NativeWorkerExecutionResult; resultSha256: string }> };
    if (prior.manifestSha256 !== manifestSha256) throw new Error('resume_manifest_hash_mismatch');
    for (const item of prior.accepted ?? []) resumed.set(item.job.jobId, item);
  }
  for (const job of jobs) {
    const prior = resumed.get(job.jobId);
    if (prior) {
      const validation = validateNativeWorkerExecutionResult(job, prior.result);
      if (validation.releaseReady && sha256(Buffer.from(`${JSON.stringify(prior.result)}\n`)) === prior.resultSha256) { accepted.push(prior); continue; }
      failed.push({ jobId: job.jobId, caseId: job.caseId, reason: 'resume_result_invalid' });
      continue;
    }
    const envName = COMMAND_ENV[job.workerKind as keyof typeof COMMAND_ENV], command = envName ? process.env[envName]?.trim() : undefined;
    if (!command) { notRun.push({ jobId: job.jobId, caseId: job.caseId, reason: `${envName ?? 'worker'}_unconfigured` }); continue; }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-native-worker-'));
    try {
      const bytes = await sourceBytes(job);
      if (bytes.length !== job.source.bytes || sha256(bytes) !== job.source.sha256) throw new Error('source_payload_mismatch');
      const source = path.join(temp, `source.${job.source.extension}`), request = path.join(temp, 'request.json'), resultPath = path.join(temp, 'result.json');
      fs.writeFileSync(source, bytes); fs.writeFileSync(request, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
      const execution = spawnSync(command, ['--request', request, '--source', source, '--output', resultPath], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, shell: false });
      if (execution.error || execution.status !== 0) throw new Error(execution.error?.message ?? `worker_exit:${execution.status}:${execution.stderr.slice(-500)}`);
      if (!fs.existsSync(resultPath)) throw new Error('worker_result_missing');
      const resultBytes = fs.readFileSync(resultPath); if (resultBytes.length < 2 || resultBytes.length > 64 * 1024 * 1024) throw new Error(`worker_result_size_invalid:${resultBytes.length}`);
      const result = JSON.parse(resultBytes.toString('utf8')) as NativeWorkerExecutionResult, validation = validateNativeWorkerExecutionResult(job, result);
      if (!validation.releaseReady) throw new Error(`worker_result_rejected:${validation.errors.join(',')}`);
      const canonical = Buffer.from(`${JSON.stringify(result)}\n`); accepted.push({ job, result, resultSha256: sha256(canonical) });
    } catch (error) { failed.push({ jobId: job.jobId, caseId: job.caseId, reason: error instanceof Error ? error.message : String(error) }); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  const report = { schema: 'nexyfab.native-worker-execution-batch.v1', manifestSha256, selection: { jobId: selectedJob ?? null, workerKind: selectedWorker ?? null }, releaseReady: accepted.length === jobs.length && failed.length === 0 && notRun.length === 0, summary: { requested: jobs.length, accepted: accepted.length, resumed: accepted.filter(item => resumed.has(item.job.jobId)).length, notRun: notRun.length, failed: failed.length }, accepted, notRun, failed };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...report.summary, releaseReady: report.releaseReady }));
  if (failed.length) process.exitCode = 4;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
