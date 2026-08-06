import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { ExactCadWorkerRequest } from '../../src/lib/reference/exactCadWorkerContract';

type DwgAttempt = { caseId: string; route: string; classification: string; sourceMember: { path: string; sha256: string } };
type NativeRequest = { caseId: string; sourceHash: string; localLocator: string };
const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const output = path.resolve(process.argv[3] ?? path.join(reviewRoot, 'exact-cad-worker-queue.json'));
const corpusRoot = path.resolve(process.argv[4] ?? 'C:/Users/gomd9/Downloads/참고파일들');
const dwg = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'dwg-import-results.json'), 'utf8')) as { attempts: DwgAttempt[] };
const native = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), 'utf8')) as { requests: NativeRequest[] };
const byCase = new Map(native.requests.map(item => [item.caseId, item]));
const jobs: ExactCadWorkerRequest[] = [];
const makeId = (kind: string, caseId: string, memberHash: string) => createHash('sha256').update(`${kind}\0${caseId}\0${memberHash}`).digest('hex').slice(0, 24);
const repair = (value: string) => { if (!/[Ãìë]/.test(value)) return value; const decoded = Buffer.from(value, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? value : decoded; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repair(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };

async function main() {
for (const attempt of dwg.attempts.filter(item => item.classification === 'aabb-approximation')) {
  const request = byCase.get(attempt.caseId);
  if (!request) throw new Error(`native_request_missing:${attempt.caseId}`);
  jobs.push({ schema: 'nexyfab.exact-cad-worker-request.v1', jobId: `dwg-${makeId('dwg', attempt.caseId, attempt.sourceMember.sha256)}`, caseId: attempt.caseId, sourceHash: request.sourceHash, sourceMember: attempt.sourceMember, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false } });
}
for (const attempt of dwg.attempts.filter(item => item.route === 'revit-dwg-fallback')) {
  const request = byCase.get(attempt.caseId);
  if (!request) throw new Error(`native_request_missing:${attempt.caseId}`);
  const archive = await JSZip.loadAsync(fs.readFileSync(safePath(corpusRoot, request.localLocator)));
  const member = Object.keys(archive.files).filter(name => !archive.files[name]!.dir && path.extname(name).toLowerCase() === '.rvt').sort()[0];
  if (!member) throw new Error(`revit_member_missing:${attempt.caseId}`);
  const bytes = await archive.files[member]!.async('nodebuffer');
  const sourceMember = { path: member.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') };
  jobs.push({ schema: 'nexyfab.exact-cad-worker-request.v1', jobId: `revit-${makeId('revit', attempt.caseId, sourceMember.sha256)}`, caseId: attempt.caseId, sourceHash: request.sourceHash, sourceMember, workerKind: 'revit-native', required: { exactGeometry: true, nativeSemantics: true } });
}
const duplicateIds = jobs.filter((job, index) => jobs.findIndex(other => other.jobId === job.jobId) !== index);
if (duplicateIds.length) throw new Error('exact_worker_job_id_collision');
const artifact = { schema: 'nexyfab.exact-cad-worker-request-batch.v1', generatedAt: new Date().toISOString(), scoreEligible: false, sourceBytesEmbedded: false, summary: { jobs: jobs.length, dwgExact: jobs.filter(item => item.workerKind === 'dwg-exact').length, revitNative: jobs.filter(item => item.workerKind === 'revit-native').length }, jobs };
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
