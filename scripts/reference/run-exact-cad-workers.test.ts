import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('exact CAD worker batch CLI', () => {
  const run = (root: string, queue: unknown, native: unknown, output: string) => {
    const reviewRoot = path.join(root, 'review');
    const corpusRoot = path.join(root, 'corpus');
    fs.mkdirSync(reviewRoot);
    fs.mkdirSync(corpusRoot);
    fs.writeFileSync(path.join(reviewRoot, 'exact-cad-worker-queue.json'), JSON.stringify(queue));
    fs.writeFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), JSON.stringify(native));
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const script = path.resolve('scripts/reference/run-exact-cad-workers.ts');
    return spawnSync(process.execPath, [tsx, script, reviewRoot, corpusRoot, output], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NEXYFAB_EXACT_CAD_WORKER_TIMEOUT_MS: '1000', NEXYFAB_ODA_FILE_CONVERTER_COMMAND: process.execPath },
    });
  };

  it('keeps an empty worklist out of release-ready evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-cli-'));
    roots.push(root);
    const reviewRoot = path.join(root, 'review');
    const corpusRoot = path.join(root, 'corpus');
    const output = path.join(root, 'result.json');
    fs.mkdirSync(reviewRoot);
    fs.mkdirSync(corpusRoot);
    fs.writeFileSync(path.join(reviewRoot, 'exact-cad-worker-queue.json'), JSON.stringify({ jobs: [] }));
    fs.writeFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), JSON.stringify({ requests: [] }));

    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const script = path.resolve('scripts/reference/run-exact-cad-workers.ts');
    const result = spawnSync(process.execPath, [tsx, script, reviewRoot, corpusRoot, output], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NEXYFAB_EXACT_CAD_WORKER_TIMEOUT_MS: '1000' },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      scoreEligible: false,
      releaseReady: false,
      summary: { requested: 0, accepted: 0, notRun: 0, failed: 0 },
    });
  });

  it('rejects a corpus locator that escapes through a junction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-junction-'));
    roots.push(root);
    const reviewRoot = path.join(root, 'review');
    const corpusRoot = path.join(root, 'corpus');
    const outsideRoot = path.join(root, 'outside');
    const output = path.join(root, 'result.json');
    const linkedCorpus = path.join(corpusRoot, 'linked');
    fs.mkdirSync(reviewRoot);
    fs.mkdirSync(corpusRoot);
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, 'source.zip'), 'not a permitted corpus member');
    fs.symlinkSync(outsideRoot, linkedCorpus, 'junction');
    fs.writeFileSync(path.join(reviewRoot, 'exact-cad-worker-queue.json'), JSON.stringify({ jobs: [{
      schema: 'nexyfab.exact-cad-worker-request.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: 'a'.repeat(64),
      sourceMember: { path: 'source.dwg', sha256: 'b'.repeat(64) }, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false },
    }] }));
    fs.writeFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), JSON.stringify({ requests: [{ caseId: 'case-1', sourceHash: 'a'.repeat(64), localLocator: 'linked/source.zip' }] }));

    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const script = path.resolve('scripts/reference/run-exact-cad-workers.ts');
    const result = spawnSync(process.execPath, [tsx, script, reviewRoot, corpusRoot, output], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NEXYFAB_EXACT_CAD_WORKER_TIMEOUT_MS: '1000', NEXYFAB_ODA_FILE_CONVERTER_COMMAND: process.execPath },
    });

    expect(result.status, result.stderr).toBe(4);
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      releaseReady: false,
      summary: { requested: 1, accepted: 0, notRun: 0, failed: 1 },
      failed: [{ jobId: 'job-1', reason: 'unsafe_locator:linked/source.zip' }],
    });
  });

  it('rejects duplicate job/case identities and malformed request fields before workers run', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-contract-'));
    roots.push(root);
    const output = path.join(root, 'result.json');
    const job = {
      schema: 'nexyfab.exact-cad-worker-request.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: 'a'.repeat(64),
      sourceMember: { path: 'source.dwg', sha256: 'b'.repeat(64) }, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false },
    };
    const duplicate = { ...job, caseId: 'case-1' };
    const result = run(root, { jobs: [job, duplicate] }, { requests: [{ caseId: 'case-1', sourceHash: 'a'.repeat(64), localLocator: 'source.zip' }] }, output);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('duplicate_job_id:job-1');
    expect(result.stderr).toContain('duplicate_job_case_id:case-1');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('rejects ambiguous native requests and overlarge queues before any release artifact is written', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-bounds-'));
    roots.push(root);
    const output = path.join(root, 'result.json');
    const jobs = Array.from({ length: 501 }, (_, index) => ({
      schema: 'nexyfab.exact-cad-worker-request.v1', jobId: `job-${index}`, caseId: `case-${index}`, sourceHash: 'a'.repeat(64),
      sourceMember: { path: 'source.dwg', sha256: 'b'.repeat(64) }, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false },
    }));
    const result = run(root, { jobs }, { requests: [
      { caseId: 'case-0', sourceHash: 'a'.repeat(64), localLocator: 'source.zip' },
      { caseId: 'case-0', sourceHash: 'a'.repeat(64), localLocator: 'source-2.zip' },
    ] }, output);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('queue_jobs_limit_exceeded');
    expect(result.stderr).toContain('duplicate_native_case_id:case-0');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('rejects a native request whose archive hash is not bound to its queue job', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-exact-worker-source-binding-'));
    roots.push(root);
    const output = path.join(root, 'result.json');
    const result = run(root, { jobs: [{
      schema: 'nexyfab.exact-cad-worker-request.v1', jobId: 'job-1', caseId: 'case-1', sourceHash: 'a'.repeat(64),
      sourceMember: { path: 'source.dwg', sha256: 'b'.repeat(64) }, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false },
    }] }, { requests: [{ caseId: 'case-1', sourceHash: 'c'.repeat(64), localLocator: 'source.zip' }] }, output);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('native_queue_source_hash_mismatch:case-1');
    expect(fs.existsSync(output)).toBe(false);
  });
});
