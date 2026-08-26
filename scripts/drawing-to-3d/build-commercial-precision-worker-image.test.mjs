import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { commercialWorkerBuildPlan } from './build-commercial-precision-worker-image.mjs';

const base = {
  adapterImage: `registry.example.test/nexyfab/occt-adapter@sha256:${'a'.repeat(64)}`,
  nativeExecutableSha256: 'b'.repeat(64),
  tag: 'nexyfab-commercial-worker:test',
  workerSourceBytes: Buffer.from('worker-source'),
};

test('build plan requires immutable adapter identity and emits no runtime secret', () => {
  const plan = commercialWorkerBuildPlan(base);
  assert.equal(plan.command, 'docker');
  assert.equal(plan.receipt.containsRuntimeSecrets, false);
  assert.match(plan.receipt.nativeInvocationSha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.args.some(value => /SECRET|PRIVATE_KEY|DATABASE|REDIS|S3_/i.test(value)), false);
  assert.throws(() => commercialWorkerBuildPlan({ ...base, adapterImage: 'registry.example.test/nexyfab/occt-adapter:latest' }), /adapter_image_digest_required/);
  assert.throws(() => commercialWorkerBuildPlan({ ...base, nativeExecutableSha256: 'bad' }), /native_executable_sha256_required/);
});

test('native invocation digest binds ordered arguments', () => {
  const left = commercialWorkerBuildPlan({ ...base, nativeArgsJson: '["--kernel","occt-7.8.1"]' });
  const right = commercialWorkerBuildPlan({ ...base, nativeArgsJson: '["occt-7.8.1","--kernel"]' });
  assert.notEqual(left.receipt.nativeInvocationSha256, right.receipt.nativeInvocationSha256);
  assert.throws(() => commercialWorkerBuildPlan({ ...base, nativeArgsJson: '{"shell":true}' }), /native_args_invalid/);
});

test('container stays non-root and separates liveness from self-test readiness', () => {
  const dockerfile = readFileSync('containers/occt-commercial-worker/Dockerfile', 'utf8');
  const worker = readFileSync('scripts/drawing-to-3d/commercial-precision-worker.mjs', 'utf8');
  assert.match(dockerfile, /FROM \$\{NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE\}/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(dockerfile, /USER 65532:65532/);
  assert.match(dockerfile, /\/live/);
  assert.match(worker, /state\.selfTest \? 200 : 503/);
});
