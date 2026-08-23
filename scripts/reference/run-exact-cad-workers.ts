import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { validateExactCadWorkerResult, type ExactCadWorkerRequest, type ExactCadWorkerResult } from '../../src/lib/reference/exactCadWorkerContract';

type NativeRequest = { caseId: string; sourceHash: string; localLocator: string };
const MAX_WORKER_JOBS = 500;
const MAX_ID_LENGTH = 128;
const MAX_MEMBER_PATH_LENGTH = 512;
const MAX_LOCATOR_LENGTH = 512;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const corpusRootInput = process.argv[3] ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!corpusRootInput) throw new Error('reference_corpus_root_required');
const corpusRoot = path.resolve(corpusRootInput);
const output = path.resolve(process.argv[4] ?? path.join(reviewRoot, 'exact-cad-worker-results.json'));
const timeoutMs = Number(process.env.NEXYFAB_EXACT_CAD_WORKER_TIMEOUT_MS ?? 600_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) throw new Error('exact_cad_worker_timeout_invalid');
const commands = { 'dwg-exact': process.env.NEXYFAB_ODA_FILE_CONVERTER_COMMAND?.trim(), 'revit-native': process.env.NEXYFAB_REVIT_WORKER_COMMAND?.trim() } as const;
const repair = (value: string) => { if (!/[Ãìë]/.test(value)) return value; const decoded = Buffer.from(value, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? value : decoded; };
const safePath = (root: string, locator: string) => {
  // Lexical checks do not stop a corpus member from traversing a symlink or
  // junction. Resolve both sides before opening the archive so native workers
  // can only read files physically contained by the configured corpus root.
  const realRoot = fs.realpathSync(root);
  const absolute = path.resolve(realRoot, repair(locator));
  const relative = path.relative(realRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`);
  const realCandidate = fs.realpathSync(absolute);
  const realRelative = path.relative(realRoot, realCandidate);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error(`unsafe_locator:${locator}`);
  return realCandidate;
};
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && SAFE_ID.test(value);
}

function validRelativePath(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || path.isAbsolute(value)) return false;
  return !value.split('/').some(segment => segment === '..' || segment === '');
}

function validateWorkerInputs(queueValue: unknown, nativeValue: unknown): string[] {
  const issues: string[] = [];
  const queue = isRecord(queueValue) ? queueValue.jobs : undefined;
  const native = isRecord(nativeValue) ? nativeValue.requests : undefined;
  if (!Array.isArray(queue)) issues.push('queue_jobs_array_required');
  else if (queue.length > MAX_WORKER_JOBS) issues.push('queue_jobs_limit_exceeded');
  if (!Array.isArray(native)) issues.push('native_requests_array_required');
  else if (native.length > MAX_WORKER_JOBS) issues.push('native_requests_limit_exceeded');
  if (!Array.isArray(queue) || !Array.isArray(native)) return issues;

  const jobIds = new Set<string>();
  const jobCases = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index];
    if (!isRecord(job)) { issues.push(`queue_job_invalid:${index}`); continue; }
    if (job.schema !== 'nexyfab.exact-cad-worker-request.v1') issues.push(`queue_job_schema_invalid:${index}`);
    if (!validId(job.jobId)) issues.push(`queue_job_id_invalid:${index}`);
    else if (jobIds.has(job.jobId)) issues.push(`duplicate_job_id:${job.jobId}`);
    else jobIds.add(job.jobId);
    if (!validId(job.caseId)) issues.push(`queue_case_id_invalid:${index}`);
    else if (jobCases.has(job.caseId)) issues.push(`duplicate_job_case_id:${job.caseId}`);
    else jobCases.add(job.caseId);
    if (!SHA256.test(typeof job.sourceHash === 'string' ? job.sourceHash : '')) issues.push(`queue_source_hash_invalid:${index}`);
    const member = job.sourceMember;
    if (!isRecord(member) || !validRelativePath(member.path, MAX_MEMBER_PATH_LENGTH)) issues.push(`queue_member_path_invalid:${index}`);
    if (!isRecord(member) || !SHA256.test(typeof member.sha256 === 'string' ? member.sha256 : '')) issues.push(`queue_member_hash_invalid:${index}`);
    if (job.workerKind !== 'dwg-exact' && job.workerKind !== 'revit-native') issues.push(`queue_worker_kind_invalid:${index}`);
    if (!isRecord(job.required) || job.required.exactGeometry !== true || typeof job.required.nativeSemantics !== 'boolean') issues.push(`queue_required_invalid:${index}`);
  }

  const nativeCases = new Set<string>();
  for (let index = 0; index < native.length; index += 1) {
    const request = native[index];
    if (!isRecord(request)) { issues.push(`native_request_invalid:${index}`); continue; }
    if (!validId(request.caseId)) issues.push(`native_case_id_invalid:${index}`);
    else if (nativeCases.has(request.caseId)) issues.push(`duplicate_native_case_id:${request.caseId}`);
    else nativeCases.add(request.caseId);
    if (!SHA256.test(typeof request.sourceHash === 'string' ? request.sourceHash : '')) issues.push(`native_source_hash_invalid:${index}`);
    if (!validRelativePath(request.localLocator, MAX_LOCATOR_LENGTH)) issues.push(`native_locator_invalid:${index}`);
  }
  const nativeByCase = new Map(native.flatMap(request => isRecord(request) && validId(request.caseId) ? [[request.caseId, request]] : []));
  for (let index = 0; index < queue.length; index += 1) {
    const job = queue[index];
    if (!isRecord(job) || !validId(job.caseId)) continue;
    const source = nativeByCase.get(job.caseId);
    if (source && source.sourceHash !== job.sourceHash) issues.push(`native_queue_source_hash_mismatch:${job.caseId}`);
  }
  return [...new Set(issues)];
}

async function main() {
  const queueValue = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'exact-cad-worker-queue.json'), 'utf8')) as unknown;
  const nativeValue = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), 'utf8')) as unknown;
  const inputIssues = validateWorkerInputs(queueValue, nativeValue);
  if (inputIssues.length) throw new Error(`exact_worker_input_rejected:${inputIssues.slice(0, 100).join(',')}`);
  const queue = queueValue as { jobs: ExactCadWorkerRequest[] };
  const native = nativeValue as { requests: NativeRequest[] };
  const byCase = new Map(native.requests.map(item => [item.caseId, item]));
  const accepted: Array<{ request: ExactCadWorkerRequest; result: ExactCadWorkerResult; validation: ReturnType<typeof validateExactCadWorkerResult> }> = [];
  const notRun: Array<{ jobId: string; caseId: string; reason: string }> = [];
  const failed: Array<{ jobId: string; caseId: string; reason: string }> = [];
  for (const job of queue.jobs) {
    const command = commands[job.workerKind];
    if (!command) { notRun.push({ jobId: job.jobId, caseId: job.caseId, reason: `${job.workerKind}_command_unconfigured` }); continue; }
    const sourceRequest = byCase.get(job.caseId);
    if (!sourceRequest) { failed.push({ jobId: job.jobId, caseId: job.caseId, reason: 'native_request_missing' }); continue; }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-'));
    try {
      const archiveBytes = fs.readFileSync(safePath(corpusRoot, sourceRequest.localLocator));
      if (sha256(archiveBytes) !== job.sourceHash) throw new Error('archive_hash_mismatch');
      const archive = await JSZip.loadAsync(archiveBytes);
      const member = archive.files[job.sourceMember.path];
      if (!member || member.dir) throw new Error('source_member_missing');
      const memberBytes = await member.async('nodebuffer');
      if (sha256(memberBytes) !== job.sourceMember.sha256) throw new Error('source_member_hash_mismatch');
      if (memberBytes.length > 1024 * 1024 * 1024) throw new Error('source_member_budget_exceeded');
      const sourcePath = path.join(temp, `source${path.extname(job.sourceMember.path).toLowerCase()}`);
      const requestPath = path.join(temp, 'request.json');
      const resultPath = path.join(temp, 'result.json');
      fs.writeFileSync(sourcePath, memberBytes);
      fs.writeFileSync(requestPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
      const execution = spawnSync(command, ['--request', requestPath, '--source', sourcePath, '--output', resultPath], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, shell: false });
      if (execution.error || execution.status !== 0) throw new Error(execution.error?.message ?? `worker_exit:${execution.status}:${execution.stderr.slice(-500)}`);
      if (!fs.existsSync(resultPath)) throw new Error('worker_result_missing');
      const stat = fs.statSync(resultPath);
      if (stat.size < 2 || stat.size > 64 * 1024 * 1024) throw new Error(`worker_result_size_invalid:${stat.size}`);
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as ExactCadWorkerResult;
      const validation = validateExactCadWorkerResult(job, result);
      if (validation.status !== 'pass' || !validation.releaseReady) throw new Error(`worker_result_rejected:${validation.errors.join(',')}`);
      accepted.push({ request: job, result, validation });
    } catch (error) {
      failed.push({ jobId: job.jobId, caseId: job.caseId, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  // An empty worklist is an execution gap, never release evidence.  The
  // equality check alone would make `0 accepted === 0 requested` appear
  // release-ready even though no exact worker ran.
  const releaseReady = queue.jobs.length > 0 && accepted.length === queue.jobs.length;
  const artifact = { schema: 'nexyfab.exact-cad-worker-result-batch.v1', generatedAt: new Date().toISOString(), scoreEligible: accepted.length > 0, releaseReady, sourceBytesEmbedded: false, summary: { requested: queue.jobs.length, accepted: accepted.length, notRun: notRun.length, failed: failed.length }, accepted, notRun, failed };
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
  if (failed.length) process.exitCode = 4;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
