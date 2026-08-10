import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { routeNativeCadExtension, supportedNativeCadExtensions } from '../../src/lib/reference/nativeWorkerRouting';

type NativeRequest = { caseId: string; family: string; sourceHash: string; localLocator: string; format: string };
const requestsPath = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-extraction-requests.json');
const corpusRootInput = process.argv[3] ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!corpusRootInput) throw new Error('reference_corpus_root_required');
const corpusRoot = path.resolve(corpusRootInput);
const output = path.resolve(process.argv[4] ?? 'docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json');
const repair = (value: string) => { if (!/[ÃƒÃ¬Ã«]/.test(value)) return value; const decoded = Buffer.from(value, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? value : decoded; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repair(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const jobId = (caseId: string, hash: string, worker: string) => createHash('sha256').update(`${caseId}\0${hash}\0${worker}`).digest('hex').slice(0, 24);

async function main() {
  const batch = JSON.parse(fs.readFileSync(requestsPath, 'utf8')) as { requests: NativeRequest[] };
  const jobs: unknown[] = [], unrouted: Array<{ caseId: string; reason: string }> = [], caseCoverage = new Map<string, number>();
  for (const request of batch.requests) {
    const source = safePath(corpusRoot, request.localLocator);
    const sourceBytes = fs.readFileSync(source);
    if (sha256(sourceBytes) !== request.sourceHash) throw new Error(`source_hash_mismatch:${request.caseId}`);
    if (request.format.toLowerCase() !== 'zip') {
      const route = routeNativeCadExtension(request.format);
      if (!route) { unrouted.push({ caseId: request.caseId, reason: `unsupported_direct_format:${request.format}` }); continue; }
      jobs.push({ schema: 'nexyfab.native-worker-routing-job.v1', jobId: jobId(request.caseId, request.sourceHash, route.workerKind), caseId: request.caseId, family: request.family, sourceHash: request.sourceHash, source: { kind: 'direct', locator: request.localLocator, sha256: request.sourceHash, bytes: (await stat(source)).size, extension: request.format.toLowerCase() }, ...route, status: route.availability === 'local' ? 'locally-routable' : 'not_run' });
      caseCoverage.set(request.caseId, 1);
      continue;
    }
    const archive = await JSZip.loadAsync(sourceBytes);
    const members = Object.keys(archive.files).filter(name => !archive.files[name]!.dir).sort();
    let routedMembers = 0;
    for (const member of members) {
      const extension = path.extname(member).slice(1).toLowerCase();
      const route = routeNativeCadExtension(extension);
      if (!route) continue;
      const bytes = await archive.files[member]!.async('nodebuffer');
      const memberHash = sha256(bytes);
      jobs.push({ schema: 'nexyfab.native-worker-routing-job.v1', jobId: jobId(request.caseId, memberHash, route.workerKind), caseId: request.caseId, family: request.family, sourceHash: request.sourceHash, source: { kind: 'zip-member', locator: request.localLocator, member: member.replaceAll('\\', '/'), sha256: memberHash, bytes: bytes.length, extension }, ...route, status: route.availability === 'local' ? 'locally-routable' : 'not_run' });
      routedMembers += 1;
    }
    if (!routedMembers) unrouted.push({ caseId: request.caseId, reason: 'supported_cad_member_missing' });
    else caseCoverage.set(request.caseId, routedMembers);
  }
  const duplicates = jobs.filter((job, index) => jobs.findIndex(other => (other as { jobId: string }).jobId === (job as { jobId: string }).jobId) !== index);
  if (duplicates.length) throw new Error(`routing_job_id_collision:${duplicates.length}`);
  const typedJobs = jobs as Array<{ workerKind: string; availability: string; status: string }>;
  const byWorker = Object.fromEntries([...new Set(typedJobs.map(item => item.workerKind))].sort().map(worker => [worker, typedJobs.filter(item => item.workerKind === worker).length]));
  const artifact = { schema: 'nexyfab.native-worker-routing-manifest.v1', policy: { sourceHashesRequired: true, archiveMemberHashesRequired: true, unsupportedFailsClosed: true, supportedExtensions: supportedNativeCadExtensions() }, summary: { requestCases: batch.requests.length, routedCases: caseCoverage.size, unroutedCases: unrouted.length, jobs: jobs.length, localJobs: typedJobs.filter(item => item.availability === 'local').length, externalRequiredJobs: typedJobs.filter(item => item.availability === 'external-required').length, byWorker }, jobs, unrouted };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
  if (unrouted.length) process.exitCode = 4;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
