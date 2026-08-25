#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonical, nativeInvocationSha256 } from './commercial-precision-worker.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const DIGEST_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,511}@sha256:[a-f0-9]{64}$/;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const POSIX_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const DOCKERFILE = 'containers/occt-commercial-worker/Dockerfile';
const WORKER_SOURCE = 'scripts/drawing-to-3d/commercial-precision-worker.mjs';

function parseNativeArgs(raw) {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 32
    || value.some(item => typeof item !== 'string' || item.length > 512)) throw new Error('native_args_invalid');
  return value;
}

export function commercialWorkerBuildPlan(input) {
  if (!DIGEST_IMAGE.test(input.adapterImage ?? '')) throw new Error('adapter_image_digest_required');
  if (!SHA256.test(input.nativeExecutableSha256 ?? '')) throw new Error('native_executable_sha256_required');
  if (!TAG.test(input.tag ?? '') || String(input.tag).includes('@')) throw new Error('worker_image_tag_invalid');
  const nativeExecutable = input.nativeExecutable ?? '/opt/nexyfab/bin/native-adapter';
  if (!POSIX_PATH.test(nativeExecutable) || nativeExecutable.split('/').includes('..')) throw new Error('native_executable_path_invalid');
  const nativeArgs = parseNativeArgs(input.nativeArgsJson);
  const workerSourceSha256 = createHash('sha256').update(input.workerSourceBytes).digest('hex');
  const invocationSha256 = nativeInvocationSha256(input.nativeExecutableSha256, nativeArgs);
  const args = [
    'build', '--file', DOCKERFILE, '--tag', input.tag,
    '--build-arg', `NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE=${input.adapterImage}`,
    '--build-arg', `NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE=${nativeExecutable}`,
    '--build-arg', `NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256=${input.nativeExecutableSha256}`,
    '--build-arg', `NEXYFAB_COMMERCIAL_WORKER_SOURCE_SHA256=${workerSourceSha256}`,
    '.',
  ];
  return Object.freeze({
    command: 'docker', args,
    receipt: Object.freeze({
      schema: 'nexyfab.commercial-precision-worker-image-build-plan.v1',
      adapterImage: input.adapterImage,
      nativeExecutable,
      nativeExecutableSha256: input.nativeExecutableSha256,
      nativeArgs,
      nativeInvocationSha256: invocationSha256,
      workerSourceSha256,
      dockerfile: DOCKERFILE,
      tag: input.tag,
      containsRuntimeSecrets: false,
    }),
  });
}

function main() {
  const plan = commercialWorkerBuildPlan({
    adapterImage: process.env.NEXYFAB_COMMERCIAL_NATIVE_ADAPTER_IMAGE,
    nativeExecutable: process.env.NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE,
    nativeExecutableSha256: process.env.NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256,
    nativeArgsJson: process.env.NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON,
    tag: process.env.NEXYFAB_COMMERCIAL_WORKER_IMAGE_TAG,
    workerSourceBytes: readFileSync(WORKER_SOURCE),
  });
  process.stdout.write(`${canonical(plan.receipt)}\n`);
  if (process.argv.includes('--print-only')) return;
  const result = spawnSync(plan.command, plan.args, { stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`commercial_worker_image_build_failed:${result.status ?? 'signal'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (error) {
    process.stderr.write(`[commercial-precision-worker-image] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
