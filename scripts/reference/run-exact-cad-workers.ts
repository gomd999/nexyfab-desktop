import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { validateExactCadWorkerResult, type ExactCadWorkerRequest, type ExactCadWorkerResult } from '../../src/lib/reference/exactCadWorkerContract';

type NativeRequest = { caseId: string; sourceHash: string; localLocator: string };
const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const corpusRootInput = process.argv[3] ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!corpusRootInput) throw new Error('reference_corpus_root_required');
const corpusRoot = path.resolve(corpusRootInput);
const output = path.resolve(process.argv[4] ?? path.join(reviewRoot, 'exact-cad-worker-results.json'));
const timeoutMs = Number(process.env.NEXYFAB_EXACT_CAD_WORKER_TIMEOUT_MS ?? 600_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) throw new Error('exact_cad_worker_timeout_invalid');
const commands = { 'dwg-exact': process.env.NEXYFAB_ODA_FILE_CONVERTER_COMMAND?.trim(), 'revit-native': process.env.NEXYFAB_REVIT_WORKER_COMMAND?.trim() } as const;
const repair = (value: string) => { if (!/[Ãìë]/.test(value)) return value; const decoded = Buffer.from(value, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? value : decoded; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repair(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const queue = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'exact-cad-worker-queue.json'), 'utf8')) as { jobs: ExactCadWorkerRequest[] };
  const native = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), 'utf8')) as { requests: NativeRequest[] };
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
  const artifact = { schema: 'nexyfab.exact-cad-worker-result-batch.v1', generatedAt: new Date().toISOString(), scoreEligible: accepted.length > 0, releaseReady: accepted.length === queue.jobs.length, sourceBytesEmbedded: false, summary: { requested: queue.jobs.length, accepted: accepted.length, notRun: notRun.length, failed: failed.length }, accepted, notRun, failed };
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
  if (failed.length) process.exitCode = 4;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
