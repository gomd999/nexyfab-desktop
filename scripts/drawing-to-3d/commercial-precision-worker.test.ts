import { createHash, createHmac, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonical, executeTransport, EXECUTION_CONTRACT, INPUT_SCHEMA, nativeInvocationSha256 } from './commercial-precision-worker.mjs';
import type { CommercialExecutionJob } from '../../packages/job-contracts/src/commercialPrecisionExecution';

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const responseJson = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('commercial precision worker client', () => {
  it('consumes v3 input, executes a native process, commits exactly three outputs, and signs PASS', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexyfab-worker-test-'));
    try {
      const executor = join(directory, 'native-executor.mjs');
      await writeFile(executor, `import { writeFile } from 'node:fs/promises';\nimport { join } from 'node:path';\nconst output = process.argv[process.argv.indexOf('--output-dir') + 1];\nawait writeFile(join(output, 'model.step'), 'ISO-10303-21;\\nHEADER;\\nENDSEC;\\nDATA;\\nENDSEC;\\nEND-ISO-10303-21;\\n');\nawait writeFile(join(output, 'report.json'), JSON.stringify({ status: 'PASS', engine: 'test-native' }));\n`, 'utf8');
      const { privateKey } = generateKeyPairSync('ed25519');
      const publicKey = createPublicKey(privateKey);
      const workerIdentity = 'worker-test-1';
      const leaseCapability = 'x'.repeat(43);
      const transportSecret = 't'.repeat(32);
      const callbackSecret = 'c'.repeat(32);
      const args = { amount: 2 };
      const jobBase: Omit<CommercialExecutionJob, 'inputArtifact'> = {
        contractVersion: EXECUTION_CONTRACT, jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1',
        generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64),
        tool: 'build_assembly', scope: 'apply', callId: 'call-1', argumentsHash: sha256(Buffer.from(canonical(args), 'utf8')), commandHash: 'b'.repeat(64),
        targetHash: 'd'.repeat(64), journalVersion: 3, attempt: 1, leaseGeneration: 2,
      };
      const { attempt: _attempt, leaseGeneration: _leaseGeneration, ...immutableJobBinding } = jobBase;
      const inputBytes = Buffer.from(canonical({ schema: INPUT_SCHEMA, job: immutableJobBinding, arguments: args }), 'utf8');
      const job: CommercialExecutionJob = { ...jobBase, inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial/input.json', contentSha256: sha256(inputBytes), byteLength: inputBytes.length, mediaType: 'application/json' } };
      const unsigned = {
        schema: EXECUTION_CONTRACT, job, issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
        callbackUrl: 'https://core.example.test/callback', inputDownloadUrl: 'https://core.example.test/input', artifactGatewayUrl: 'https://core.example.test/artifacts', leaseCapability,
      };
      const transport = { ...unsigned, transportHmac: createHmac('sha256', transportSecret).update(canonical(unsigned), 'utf8').digest('base64url') };
      const uploads = new Map();
      let callbackBody = '';
      vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
        const target = String(url);
        if (target.endsWith('/input')) return new Response(inputBytes, { headers: { 'content-length': String(inputBytes.length), 'x-content-sha256': job.inputArtifact!.contentSha256 } });
        if (target.endsWith('/artifacts')) {
          const body = JSON.parse(String(init.body));
          if (body.action === 'output-intent') return responseJson({ ok: true, grant: { uploadMode: 'CORE_PUT', uploadUrl: `https://storage.example.test/${body.intent.role}` } });
          const role = body.intent.role;
          return responseJson({ ok: true, artifact: { artifactId: body.intent.artifactId, role, objectKey: `private/commercial/${role}`, contentSha256: body.intent.contentSha256, byteLength: body.intent.byteLength } });
        }
        if (target.startsWith('https://storage.example.test/')) { uploads.set(target.split('/').at(-1), Buffer.from(init.body)); return new Response(null, { status: 200 }); }
        if (target.endsWith('/callback')) { callbackBody = String(init.body); expect(init.headers['x-commercial-callback-hmac']).toBe(createHmac('sha256', callbackSecret).update(callbackBody, 'utf8').digest('base64url')); return responseJson({ ok: true }); }
        return responseJson({ ok: false }, 404);
      }));
      const nativeExecutableSha256 = sha256(await readFile(process.execPath));
      const nativeArgs = [executor];
      const config = { workerIdentity, transportSecret, callbackSecret, nativeExecutable: process.execPath, nativeExecutableSha256, nativeInvocationSha256: nativeInvocationSha256(nativeExecutableSha256, nativeArgs), nativeArgs, nativeTimeoutMs: 30_000, privateKey, publicKeyFingerprint: sha256(publicKey.export({ type: 'spki', format: 'der' })) };
      const result = await executeTransport(config, transport);
      expect([...uploads.keys()].sort()).toEqual(['model', 'report', 'verification']);
      expect(result.receipt).toMatchObject({ schema: EXECUTION_CONTRACT, status: 'PASS', workerIdentity, inputArtifactSha256: job.inputArtifact!.contentSha256, nativeExecutableSha256, nativeInvocationSha256: config.nativeInvocationSha256 });
      expect(result.receipt.outputArtifacts.map((item: { role: string }) => item.role).sort()).toEqual(['model', 'report', 'verification']);
      expect(callbackBody).toBe(canonical(result.receipt));
      const unsignedReceipt = { ...result.receipt }; delete unsignedReceipt.signatureBase64;
      expect(verify(null, Buffer.from(canonical({ schema: EXECUTION_CONTRACT, purpose: 'worker-receipt', receipt: unsignedReceipt }), 'utf8'), publicKey, Buffer.from(result.receipt.signatureBase64, 'base64'))).toBe(true);
      await expect(executeTransport({ ...config, nativeExecutableSha256: '0'.repeat(64) }, transport)).rejects.toThrow('native_executable_hash_mismatch');
      expect(JSON.parse(callbackBody)).toMatchObject({ status: 'HOLD', failureReasons: ['native_executable_hash_mismatch'] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
