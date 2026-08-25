import { createHash, createHmac, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Redis from 'ioredis';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { enqueueCommercialExecutionTransaction, CommercialExecutionOutboxStore } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore';
import { makeEnqueueFixture } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore.testFixture';
import { stageCommercialExecutionInput } from '@/lib/precision-cad-agent/commercialWorkerIo';
import { verifyCommercialWorkerReceipt } from '@/lib/precision-cad-agent/commercialWorkerReceipt';
import { canonicalNativeParserReceipt, type NativeParserReceipt } from '@/lib/precision-cad-agent/commercialPersistenceReceipt';
import { persistCommercialWorkerResult } from '@/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator';
import type { ImmutableArtifactStore } from '@/lib/precision-cad-agent/commercialWorkerArtifactSnapshot';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, hashCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput, type StoredCadWorkspaceEnvelope } from '@/lib/cad/workspaceRevisionStore';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import { DESIGN_WORKSPACE_REVISION_SCHEMA, type DesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import type { CommercialExecutionJob, CommercialOutputArtifact } from '../packages/job-contracts/src/commercialPrecisionExecution';
import { canonical, executeTransport, nativeInvocationSha256 } from './drawing-to-3d/commercial-precision-worker.mjs';
import { POST as claimPost } from '@/app/api/internal/precision-cad-commercial/claim/route';
import { GET as artifactGet, POST as artifactPost, PUT as artifactPut } from '@/app/api/internal/precision-cad-commercial/artifacts/route';
import { POST as callbackPost } from '@/app/api/internal/precision-cad-commercial/callback/route';

const OUTPUT = 'docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json';
const IMAGE_DIGESTS = Object.freeze({
  postgres: 'sha256:32ebb7185baf2c9d38f91684417d140c0745aeff5082dfbb62edb330c2af6197',
  redis: 'sha256:8b81dd37ff027bec4e516d41acfbe9fe2460070dc6d4a4570a2ac5b9d59df065',
  objectStorage: 'sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e',
});
const LOCAL_MODEL_TEXT = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=PRODUCT('LOCAL-DURABILITY','LOCAL-DURABILITY','',());\nENDSEC;\nEND-ISO-10303-21;\n";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function publicWorker(
  identity: string,
  keyPair: ReturnType<typeof generateKeyPairSync>,
  nativeExecutableSha256: string,
  nativeInvocationSha256Value: string,
) {
  const publicKey = createPublicKey(keyPair.privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    workerIdentity: identity,
    publicKeyPem,
    fingerprintSha256: sha256(publicKey.export({ type: 'spki', format: 'der' })),
    nativeExecutableSha256,
    nativeInvocationSha256: nativeInvocationSha256Value,
  };
}

function localWorkspaceEnvelope(job: CommercialExecutionJob): StoredCadWorkspaceEnvelope & { status: 'PASS' } {
  const revision = job.workspaceRevision + 1;
  const requirementsPayload = { purpose: 'local-durability-authoritative-persistence', targetHash: job.targetHash };
  const semanticPayload = { schema: 'nexyfab.product-decomposition.v1', parts: [{ id: 'local-durability-part', sourceExecutionId: job.executionId }] };
  const relationsPayload = { relations: [] };
  const semanticHash = hashCadPayload(semanticPayload);
  const modelHash = sha256(LOCAL_MODEL_TEXT);
  const workspace: DesignWorkspaceRevision = {
    schema: DESIGN_WORKSPACE_REVISION_SCHEMA,
    projectId: job.projectId,
    lineageId: `commercial:${job.generationRunId}`,
    revision,
    domain: 'mechanical',
    experience: 'expert',
    workMode: 'precision_cad',
    documentHash: semanticHash,
    locks: [],
    history: [{ revision, actor: 'expert', mode: 'precision_cad', documentHash: semanticHash, changedTargets: [{ kind: 'workspace', objectId: job.workspaceId }], retainedLockIds: [] }],
  };
  const artifactGraph: DesignArtifactGraph = {
    schema: DESIGN_ARTIFACT_GRAPH_SCHEMA,
    projectId: job.projectId,
    revision,
    artifacts: [{
      id: `model:${job.executionId}`,
      kind: 'model',
      revision,
      contentHash: modelHash,
      state: 'current',
      inputs: [],
      verification: { status: 'passed', verifierId: 'isolated-local-native-fixture', evidenceHash: job.targetHash, issues: [] },
      staleBecause: [],
    }],
    dependencies: [],
  };
  const input: CadWorkspaceEnvelopeInput & { status: 'PASS' } = {
    status: 'PASS',
    schema: CAD_WORKSPACE_ENVELOPE_SCHEMA,
    workspace,
    requirements: { contentHash: hashCadPayload(requirementsPayload), payload: requirementsPayload },
    semanticDocument: { schema: 'nexyfab.product-decomposition.v1', contentHash: semanticHash, payload: semanticPayload },
    geometry: { fidelity: 'exact_brep', contentHash: modelHash, shapeIdentityHash: sha256(`local-shape:${job.targetHash}`) },
    objectRelations: { contentHash: hashCadPayload(relationsPayload), payload: relationsPayload },
    artifactGraph,
    provenance: [{ sourceId: `execution:${job.executionId}`, kind: 'expert', contentHash: job.commandHash }],
    kernelIdentity: { mode: 'wasm', kernelId: 'isolated-local-native-fixture', buildSha256: sha256('local-native-fixture-build'), wasmSha256: sha256('local-native-fixture-kernel'), stubFallback: false },
  };
  return { ...input, contentHash: hashCadWorkspaceEnvelope(input) };
}

function request(url: string, init: RequestInit = {}): NextRequest {
  const method = init.method ?? 'GET';
  return new NextRequest(url, {
    method,
    headers: init.headers,
    ...(method === 'GET' || method === 'HEAD' || init.body === undefined ? {} : { body: init.body }),
  });
}

async function seedAuthorityRows(db: ReturnType<typeof getDbAdapter>, fixture: Awaited<ReturnType<typeof makeEnqueueFixture>>, at: number) {
  const challenge = fixture.db.readState().challenge;
  await db.execute(
    'INSERT INTO nf_cad_workspace_heads (project_id, revision, content_hash, updated_at) VALUES (?, ?, ?, ?)',
    fixture.input.job.projectId, fixture.input.job.workspaceRevision, fixture.input.job.workspaceContentHash, at,
  );
  await db.execute(
    'INSERT INTO nf_precision_cad_approval_challenges (challenge_id, nonce, actor_id, role, project_id, workspace_id, workspace_revision, workspace_content_hash, tool, scope, call_id, arguments_hash, command_hash, issued_at, expires_at, mac, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    String(challenge.challenge_id), String(challenge.nonce), String(challenge.actor_id), String(challenge.role),
    String(challenge.project_id), String(challenge.workspace_id), Number(challenge.workspace_revision),
    String(challenge.workspace_content_hash), String(challenge.tool), String(challenge.scope), String(challenge.call_id),
    String(challenge.arguments_hash), String(challenge.command_hash), Number(challenge.issued_at),
    Number(challenge.expires_at), String(challenge.mac), null,
  );
  const genesisSha = '7'.repeat(64);
  await db.execute(
    'INSERT INTO nf_commercial_generation_runs (tenant_id, project_id, run_id, workspace_id, workspace_revision, head_revision, head_sha256, state_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    fixture.input.job.tenantId, fixture.input.job.projectId, fixture.input.job.generationRunId,
    fixture.input.job.workspaceId, fixture.input.job.workspaceRevision, fixture.input.job.generationStateRevision,
    fixture.input.job.workspaceContentHash, fixture.input.job.workspaceContentHash, 'ACTIVE', at, at,
  );
  await db.execute(
    'INSERT INTO nf_commercial_generation_revisions (tenant_id, project_id, run_id, revision, previous_revision, previous_sha256, state_sha256, state_json, generation_program_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    fixture.input.job.tenantId, fixture.input.job.projectId, fixture.input.job.generationRunId,
    0, -1, '0'.repeat(64), genesisSha, '{}', fixture.input.job.generationProgramSha256, at,
  );
  await db.execute(
    'INSERT INTO nf_commercial_generation_revisions (tenant_id, project_id, run_id, revision, previous_revision, previous_sha256, state_sha256, state_json, generation_program_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    fixture.input.job.tenantId, fixture.input.job.projectId, fixture.input.job.generationRunId,
    fixture.input.job.generationStateRevision, 0, genesisSha, fixture.input.job.workspaceContentHash,
    '{}', fixture.input.job.generationProgramSha256, at,
  );
}

async function main() {
  const databaseUrl = required('LOCAL_DURABILITY_DATABASE_URL');
  const redisUrl = required('LOCAL_DURABILITY_REDIS_URL');
  const s3Endpoint = required('LOCAL_DURABILITY_S3_ENDPOINT');
  const generatedAt = new Date().toISOString();
  const claimSecret = 'local-claim-secret-20260825-only-0001';
  const transportSecret = 'local-transport-secret-20260825-001';
  const callbackSecret = 'local-callback-secret-20260825-0001';
  const bucket = 'nexyfab-local-durability';

  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.S3_BUCKET = bucket;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_ACCESS_KEY_ID = 'nexyfab-local';
  process.env.S3_SECRET_ACCESS_KEY = 'local-durability-secret-only';
  process.env.NEXYFAB_COMMERCIAL_MODE = '1';
  process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE = '1';
  process.env.NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET = claimSecret;
  process.env.NEXYFAB_COMMERCIAL_TRANSPORT_SECRET = transportSecret;
  process.env.NEXYFAB_COMMERCIAL_CALLBACK_SECRET = callbackSecret;
  process.env.NEXYFAB_COMMERCIAL_CALLBACK_URL = 'https://core.local/api/internal/precision-cad-commercial/callback';
  process.env.NEXYFAB_COMMERCIAL_WORKER_LEASE_MS = '60000';

  const nativeDirectory = await mkdtemp(path.join(tmpdir(), 'nexyfab-local-durability-native-'));
  const nativeExecutable = path.join(nativeDirectory, 'native-adapter.mjs');
  const nativeArgs = [nativeExecutable];
  const nativeExecutableSha256 = sha256(await readFile(process.execPath));
  const nativeInvocationSha256Value = nativeInvocationSha256(nativeExecutableSha256, nativeArgs);

  const workerPairs = {
    'local-worker-a': generateKeyPairSync('ed25519'),
    'local-worker-b': generateKeyPairSync('ed25519'),
  };
  const workers = Object.fromEntries(Object.entries(workerPairs).map(([identity, pair]) => [identity, publicWorker(identity, pair, nativeExecutableSha256, nativeInvocationSha256Value)]));
  process.env.NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON = JSON.stringify(workers);

  const s3 = new S3Client({
    region: 'us-east-1', endpoint: s3Endpoint, forcePathStyle: true,
    credentials: { accessKeyId: 'nexyfab-local', secretAccessKey: 'local-durability-secret-only' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  const migrationModule = await import('./run-postgres-migrations.mjs');
  const migration = await migrationModule.runPostgresMigration({ databaseUrl, sqlPath: undefined });
  const latestMigration = migration.migrations.find((item: { version: number }) => item.version === 2026082502);
  if (!latestMigration?.checksum) throw new Error('migration_2026082502_missing');
  for (const item of migration.migrations as Array<{ version: number; checksum: string }>) {
    process.env[`POSTGRES_MIGRATION_CHECKSUM_${item.version}`] = item.checksum;
  }

  const redisA = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const redisB = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await Promise.all([redisA.connect(), redisB.connect()]);
  if (await redisA.ping() !== 'PONG' || await redisB.ping() !== 'PONG') throw new Error('redis_ping_failed');
  const redisKey = 'nexyfab:local-durability:lease';
  const redisFirst = await redisA.set(redisKey, 'instance-a', 'PX', 150, 'NX');
  const redisExcluded = await redisB.set(redisKey, 'instance-b', 'PX', 150, 'NX');
  await new Promise(resolve => setTimeout(resolve, 200));
  const redisRecovered = await redisB.set(redisKey, 'instance-b', 'PX', 1000, 'NX');
  if (redisFirst !== 'OK' || redisExcluded !== null || redisRecovered !== 'OK') throw new Error('redis_lease_exclusion_failed');

  const db = getDbAdapter();
  const storage = getStorage();
  const fixture = await makeEnqueueFixture();
  const at = Date.now();
  await seedAuthorityRows(db, fixture, at);
  const { inputArtifact: _discardedInput, ...jobWithoutInput } = fixture.input.job;
  const staged = await stageCommercialExecutionInput({
    job: jobWithoutInput,
    arguments: fixture.approvalBinding.arguments,
    storage,
  });
  const enqueueInput = { ...fixture.input, db, job: staged.job };
  const enqueued = await enqueueCommercialExecutionTransaction(enqueueInput);
  if (!enqueued.ok) throw new Error(`outbox_enqueue_failed:${enqueued.code}`);
  const replay = await enqueueCommercialExecutionTransaction(enqueueInput);
  if (!replay.ok || !replay.replayed) throw new Error('outbox_exact_replay_failed');
  let immutableConflictRejected = false;
  try {
    await storage.uploadRawImmutable?.(Buffer.from('substituted-input'), staged.job.inputArtifact!.objectKey, 'application/json');
  } catch {
    immutableConflictRejected = true;
  }
  if (!immutableConflictRejected) throw new Error('immutable_input_substitution_not_rejected');

  const claimRequest = (owner: string) => claimPost(request('https://core.local/api/internal/precision-cad-commercial/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${claimSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ owner }),
  }));
  const claimResponses = await Promise.all([claimRequest('local-worker-a'), claimRequest('local-worker-b')]);
  const successfulClaims = claimResponses.filter(response => response.status === 200);
  if (successfulClaims.length !== 1) throw new Error(`multi_instance_claim_exclusion_failed:${claimResponses.map(value => value.status).join(',')}`);
  const claimBody = await successfulClaims[0]!.json() as { transport: Record<string, any> };
  const transport = claimBody.transport;
  const outbox = new CommercialExecutionOutboxStore(db);
  const claimedRow = await outbox.read(staged.job.jobId);
  const workerIdentity = claimedRow?.leaseOwner;
  if (!workerIdentity || !(workerIdentity in workerPairs)) throw new Error('claimed_worker_identity_missing');

  const authHeaders = {
    authorization: `Bearer ${transport.leaseCapability}`,
    'x-commercial-worker-identity': workerIdentity,
  };
  const wrongWorkerResponse = await artifactGet(request(transport.inputDownloadUrl, {
    headers: { ...authHeaders, 'x-commercial-worker-identity': workerIdentity === 'local-worker-a' ? 'local-worker-b' : 'local-worker-a' },
  }));
  const substitutedInputUrl = new URL(transport.inputDownloadUrl);
  substitutedInputUrl.searchParams.set('artifactId', 'substituted-input');
  const inputSubstitutionResponse = await artifactGet(request(substitutedInputUrl.toString(), { headers: authHeaders }));
  if (wrongWorkerResponse.status !== 403 || inputSubstitutionResponse.status !== 403) {
    throw new Error(`negative_input_campaign_failed:${wrongWorkerResponse.status},${inputSubstitutionResponse.status}`);
  }

  const originalFetch = globalThis.fetch;
  let outputSubstitutionStatus: number | null = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const pathname = new URL(url).pathname;
    const nextRequest = request(url, init);
    if (pathname.endsWith('/artifacts')) {
      if ((init.method ?? 'GET') === 'PUT') return artifactPut(nextRequest);
      if ((init.method ?? 'GET') === 'POST') {
        const response = await artifactPost(nextRequest);
        const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, any> : null;
        if (response.ok && body?.action === 'commit-output' && body?.intent?.role === 'model' && outputSubstitutionStatus === null) {
          const substituted = {
            ...body,
            action: 'output-intent',
            intent: { ...body.intent, contentSha256: '0'.repeat(64) },
          };
          const hostile = await artifactPost(request(url, {
            method: 'POST', headers: init.headers, body: canonical(substituted),
          }));
          outputSubstitutionStatus = hostile.status;
        }
        return response;
      }
      return artifactGet(nextRequest);
    }
    if (pathname.endsWith('/callback')) return callbackPost(nextRequest);
    return new Response(JSON.stringify({ ok: false, code: 'LOCAL_ROUTE_NOT_FOUND' }), { status: 404 });
  };

  const workspaceEnvelope = localWorkspaceEnvelope(transport.job as CommercialExecutionJob);
  const workspaceEnvelopeJson = canonical(workspaceEnvelope);
  await writeFile(nativeExecutable, [
    "import { writeFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    "const output = process.argv[process.argv.indexOf('--output-dir') + 1];",
    `await writeFile(join(output, 'model.step'), ${JSON.stringify(LOCAL_MODEL_TEXT)});`,
    `await writeFile(join(output, 'report.json'), ${JSON.stringify(workspaceEnvelopeJson)});`,
  ].join('\n'), 'utf8');

  let workerResult: Awaited<ReturnType<typeof executeTransport>>;
  try {
    const pair = workerPairs[workerIdentity as keyof typeof workerPairs];
    workerResult = await executeTransport({
      workerIdentity,
      transportSecret,
      callbackSecret,
      nativeExecutable: process.execPath,
      nativeExecutableSha256,
      nativeInvocationSha256: nativeInvocationSha256Value,
      nativeArgs,
      nativeTimeoutMs: 30_000,
      privateKey: pair.privateKey,
      publicKeyFingerprint: workers[workerIdentity]!.fingerprintSha256,
    }, transport);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(nativeDirectory, { recursive: true, force: true });
  }

  const committedOutputs = await db.queryAll<Record<string, unknown>>(
    'SELECT artifact_role, object_key, content_sha256, byte_length, status FROM nf_precision_cad_commercial_output_intents WHERE job_id = ? ORDER BY artifact_role',
    staged.job.jobId,
  );
  if (committedOutputs.length !== 3 || committedOutputs.some(row => row.status !== 'COMMITTED')) throw new Error('three_output_commit_failed');
  for (const row of committedOutputs) {
    const stored = await storage.sha256?.(String(row.object_key));
    if (!stored || stored.size !== Number(row.byte_length) || stored.contentSha256 !== row.content_sha256) throw new Error('three_output_readback_failed');
  }
  const afterCallback = await outbox.read(staged.job.jobId);
  if (afterCallback?.status !== 'VERIFIED_UNKNOWN') throw new Error('callback_did_not_quarantine_pass');
  if (outputSubstitutionStatus !== 409) throw new Error(`output_substitution_campaign_failed:${outputSubstitutionStatus}`);

  const callbackBody = canonical(workerResult.receipt);
  const callbackHeaders = {
    'content-type': 'application/json',
    'x-commercial-callback-hmac': createHmac('sha256', callbackSecret).update(callbackBody).digest('base64url'),
  };
  const exactRetry = await callbackPost(request(process.env.NEXYFAB_COMMERCIAL_CALLBACK_URL, {
    method: 'POST', headers: callbackHeaders, body: callbackBody,
  }));
  if (exactRetry.status !== 200) throw new Error('exact_callback_retry_not_idempotent');
  const conflictingReceipt = { ...workerResult.receipt, status: 'FAIL' as const, failureReasons: ['conflicting-replay'], signatureBase64: '' };
  const unsignedConflict = { ...conflictingReceipt };
  delete (unsignedConflict as { signatureBase64?: string }).signatureBase64;
  conflictingReceipt.signatureBase64 = sign(
    null,
    Buffer.from(canonical({ schema: conflictingReceipt.schema, purpose: 'worker-receipt', receipt: unsignedConflict })),
    workerPairs[workerIdentity as keyof typeof workerPairs].privateKey,
  ).toString('base64');
  const conflictBody = canonical(conflictingReceipt);
  const conflictReplay = await callbackPost(request(process.env.NEXYFAB_COMMERCIAL_CALLBACK_URL, {
    method: 'POST', headers: {
      'content-type': 'application/json',
      'x-commercial-callback-hmac': createHmac('sha256', callbackSecret).update(conflictBody).digest('base64url'),
    }, body: conflictBody,
  }));
  if (conflictReplay.status !== 409 || (await conflictReplay.json()).code !== 'RECEIPT_REPLAY') throw new Error('callback_conflict_replay_not_rejected');

  const expectedReceipt = {
    ...staged.job,
    attempt: workerResult.receipt.attempt,
    leaseGeneration: workerResult.receipt.leaseGeneration,
    inputArtifactSha256: staged.job.inputArtifact!.contentSha256,
    leaseCapabilityHash: workerResult.receipt.leaseCapabilityHash,
  };
  const trustedResult = verifyCommercialWorkerReceipt({
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: workers,
  });
  const rotatedPair = generateKeyPairSync('ed25519');
  const rotatedWorker = publicWorker(workerIdentity, rotatedPair, nativeExecutableSha256, nativeInvocationSha256Value);
  const rotatedResult = verifyCommercialWorkerReceipt({
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: { [workerIdentity]: rotatedWorker },
  });
  const substitutedExecutableResult = verifyCommercialWorkerReceipt({
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: { [workerIdentity]: { ...workers[workerIdentity]!, nativeExecutableSha256: '0'.repeat(64) } },
  });
  const substitutedInvocationResult = verifyCommercialWorkerReceipt({
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: { [workerIdentity]: { ...workers[workerIdentity]!, nativeInvocationSha256: '0'.repeat(64) } },
  });
  if (!trustedResult.ok || rotatedResult.ok) throw new Error('credential_rotation_boundary_failed');
  if (substitutedExecutableResult.ok || !substitutedExecutableResult.issues.includes('native_executable_not_trusted')
    || substitutedInvocationResult.ok || !substitutedInvocationResult.issues.includes('native_invocation_not_trusted')) {
    throw new Error('native_adapter_binding_boundary_failed');
  }

  // Exercise an expired in-flight lease after the authoritative callback is
  // already present. Recovery must quarantine both outbox and journal and
  // must never make the job claimable again.
  await db.execute(
    'UPDATE nf_precision_cad_commercial_outbox SET status = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE job_id = ?',
    'CLAIMED', workerIdentity, Date.now() - 1, Date.now(), staged.job.jobId,
  );
  const recovered = await outbox.recoverExpiredClaims(Date.now());
  const recoveredRow = await outbox.read(staged.job.jobId);
  const noReplayClaim = await outbox.claim(workerIdentity, transportSecret, Date.now(), 60_000);
  if (recovered !== 1 || recoveredRow?.status !== 'VERIFIED_UNKNOWN' || noReplayClaim.ok || noReplayClaim.code !== 'NOT_FOUND') {
    throw new Error('expired_lease_verified_unknown_recovery_failed');
  }

  if (!storage.download || !storage.uploadRawImmutable) throw new Error('immutable_artifact_store_required');
  const artifactStore: ImmutableArtifactStore = {
    read: async key => storage.download!(key).then(bytes => new Uint8Array(bytes)).catch(() => null),
    putImmutable: async (key, bytes) => { await storage.uploadRawImmutable!(Buffer.from(bytes), key, 'application/octet-stream'); },
  };
  const workerReceiptHash = trustedResult.receiptHash;
  const parserPair = generateKeyPairSync('ed25519');
  const parserPublicKey = createPublicKey(parserPair.privateKey);
  const parserPublicKeyPem = parserPublicKey.export({ type: 'spki', format: 'pem' }).toString();
  const parserFingerprint = sha256(parserPublicKey.export({ type: 'spki', format: 'der' }));
  const snapshots = workerResult.receipt.outputArtifacts.map((artifact: CommercialOutputArtifact) => ({
    artifactId: artifact.artifactId,
    role: artifact.role,
    objectKey: `private/commercial-snapshots/${workerResult.receipt.tenantId}/${workerResult.receipt.projectId}/${workerResult.receipt.executionId}/${workerReceiptHash}/${artifact.artifactId}`,
    contentSha256: artifact.contentSha256,
    byteLength: artifact.byteLength,
  }));
  const modelArtifact = workerResult.receipt.outputArtifacts.find((artifact: CommercialOutputArtifact) => artifact.role === 'model');
  const reportArtifact = workerResult.receipt.outputArtifacts.find((artifact: CommercialOutputArtifact) => artifact.role === 'report');
  if (!modelArtifact || !reportArtifact) throw new Error('parser_artifact_roles_missing');
  const parserReceipt: NativeParserReceipt = {
    schema: 'nexyfab.precision-cad-native-parser-receipt.v1',
    parserIdentity: 'isolated-local-native-parser',
    parserPublicKeyFingerprint: parserFingerprint,
    parserRole: 'native_parser',
    format: 'STEP',
    kernelIdentity: 'isolated-local-native-fixture',
    modelArtifactId: modelArtifact.artifactId,
    workspaceEnvelopeArtifactId: reportArtifact.artifactId,
    modelContentSha256: modelArtifact.contentSha256,
    targetHash: workerResult.receipt.targetHash,
    workspaceAfter: {
      workspaceId: workerResult.receipt.workspaceId,
      projectId: workerResult.receipt.projectId,
      revision: workerResult.receipt.workspaceRevision + 1,
      contentHash: workspaceEnvelope.contentHash,
    },
    manifest: snapshots,
    issuedAt: workerResult.receipt.startedAt,
    completedAt: workerResult.receipt.completedAt,
    signatureBase64: '',
  };
  parserReceipt.signatureBase64 = sign(null, Buffer.from(canonicalNativeParserReceipt(parserReceipt)), parserPair.privateKey).toString('base64');
  const persistence = await persistCommercialWorkerResult({
    db,
    artifactStore,
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: workers,
    metadata: workerResult.receipt.outputArtifacts,
    parserReceipt,
    trustedParser: { parserIdentity: parserReceipt.parserIdentity, publicKeyPem: parserPublicKeyPem, fingerprintSha256: parserFingerprint },
  });
  if (!persistence.ok || persistence.status !== 'COMMITTED') throw new Error(`authoritative_persistence_failed:${canonical(persistence)}`);
  const persistenceReplay = await persistCommercialWorkerResult({
    db,
    artifactStore,
    receipt: workerResult.receipt,
    expected: expectedReceipt,
    trustedWorkers: workers,
    metadata: workerResult.receipt.outputArtifacts,
    parserReceipt,
    trustedParser: { parserIdentity: parserReceipt.parserIdentity, publicKeyPem: parserPublicKeyPem, fingerprintSha256: parserFingerprint },
  });
  if (!persistenceReplay.ok || persistenceReplay.status !== 'REPLAY' || persistenceReplay.snapshots.length !== 0) throw new Error('authoritative_persistence_exact_replay_failed');
  const authoritativeHead = await db.queryOne<Record<string, unknown>>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', staged.job.projectId);
  const authoritativeRows = await db.queryOne<Record<string, unknown>>(
    'SELECT o.status AS outbox_status, j.lifecycle AS journal_lifecycle, p.persistence_receipt_hash, c.after_revision, c.after_content_hash FROM nf_precision_cad_commercial_outbox o JOIN nf_precision_cad_execution_journal j ON j.execution_id = o.execution_id JOIN nf_precision_cad_commercial_persistence_receipts p ON p.execution_id = o.execution_id JOIN nf_precision_cad_commercial_workspace_commits c ON c.execution_id = o.execution_id WHERE o.execution_id = ?',
    staged.job.executionId,
  );
  if (!authoritativeHead
    || Number(authoritativeHead.revision) !== workspaceEnvelope.workspace.revision
    || authoritativeHead.content_hash !== workspaceEnvelope.contentHash
    || authoritativeRows?.outbox_status !== 'DONE'
    || authoritativeRows.journal_lifecycle !== 'COMMITTED'
    || authoritativeRows.persistence_receipt_hash !== persistence.persistenceReceiptHash
    || Number(authoritativeRows.after_revision) !== workspaceEnvelope.workspace.revision
    || authoritativeRows.after_content_hash !== workspaceEnvelope.contentHash) throw new Error('authoritative_commit_readback_failed');

  const checks = {
    postgresMigration: 'PASS', redisPing: 'PASS', redisLeaseExclusion: 'PASS', redisExpiryRecovery: 'PASS',
    immutableInputWriteReadback: 'PASS', immutableInputSubstitutionRejected: 'PASS',
    transactionalOutboxEnqueue: 'PASS', exactOutboxReplay: 'PASS', multiInstanceClaimExclusion: 'PASS',
    nativeProcessExecution: 'PASS', threeOutputCommitReadback: 'PASS', workerReceiptSignature: 'PASS',
    signedCallback: 'PASS', wrongWorkerRejected: 'PASS', inputSubstitutionRejected: 'PASS',
    outputSubstitutionRejected: 'PASS', callbackExactRetryIdempotent: 'PASS',
    callbackReplayConflictRejected: 'PASS', expiredLeaseRecovery: 'PASS', verifiedUnknownNoReplay: 'PASS',
    credentialRotationTrustBoundary: 'PASS', nativeAdapterBinding: 'PASS', authoritativePersistence: 'PASS', workspaceCasCommit: 'PASS',
  } as const;
  const unsignedReceipt = {
    schema: 'nexyfab.commercial-precision-local-durability.v1',
    generatedAt,
    status: 'LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS',
    source: {
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim(),
      migrationVersion: latestMigration.version,
      migrationSourceSha256: latestMigration.checksum,
      imageDigests: IMAGE_DIGESTS,
    },
    execution: {
      jobId: workerResult.receipt.jobId,
      executionId: workerResult.receipt.executionId,
      workerIdentity,
      workerFingerprintSha256: workers[workerIdentity]!.fingerprintSha256,
      nativeExecutableSha256,
      nativeInvocationSha256: nativeInvocationSha256Value,
      inputArtifactSha256: staged.job.inputArtifact!.contentSha256,
      workerReceiptSha256: sha256(Buffer.from(canonical(workerResult.receipt))),
      persistenceReceiptSha256: persistence.persistenceReceiptHash,
      workspaceAfterRevision: workspaceEnvelope.workspace.revision,
      workspaceAfterContentHash: workspaceEnvelope.contentHash,
      outputArtifacts: workerResult.receipt.outputArtifacts,
    },
    checks,
    claimBoundary: {
      usesRealEphemeralPostgres: true,
      usesRealEphemeralRedisAof: true,
      usesRealEphemeralS3CompatibleStorage: true,
      usesIsolatedNativeFixtureProcess: true,
      authoritativeParserPersistenceExercised: true,
      workspaceCasCommitExercised: true,
      fixtureIsCommercialRuntimeEvidence: false,
      privateBetaEligible: false,
      commercialGaEligible: false,
      independentCadOrManufacturingCertified: false,
    },
  };
  const receipt = { ...unsignedReceipt, receiptSha256: sha256(Buffer.from(canonical(unsignedReceipt))) };
  if (process.argv.includes('--write')) {
    const output = path.resolve(OUTPUT);
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ status: receipt.status, output: process.argv.includes('--write') ? OUTPUT : null, checks })}\n`);

  await Promise.all([redisA.quit(), redisB.quit(), db.close(), s3.destroy()]);
}

main().catch(error => {
  process.stderr.write(`[commercial-precision-local-durability-campaign] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});
