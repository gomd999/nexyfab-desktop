import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createXcafWorker, XcafWorkerError } from './workerClient';

const mock = path.join(process.cwd(), 'containers/occt-xcaf/src/mock-native.mjs');
const source = Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const worker = (timeout = 1_000) => createXcafWorker({
  nativeCommand: { file: process.execPath, args: [mock] },
  defaultTimeoutMs: timeout,
  maxBytes: 1024 * 1024,
});

async function createHardenedNative(directory: string) {
  const executable = path.join(directory, 'hardened-native.mjs');
  await writeFile(executable, `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
if (process.argv.includes('--version')) { process.stdout.write('occt-xcaf-inspect/2\\n'); process.exit(0); }
const input = process.argv[process.argv.indexOf('--input') + 1];
const actual = createHash('sha256').update(readFileSync(input)).digest('hex');
const product = {
  entry: '0:1', role: 'product', occurrencePath: '0:1', referredEntry: null,
  name: 'bounded-part', partNumber: null, partNumberStatus: 'NOT_EXPOSED_BY_BINDING',
  label: '0:1', transformScope: 'local_to_parent',
  transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] },
  color: [0.25, 0.5, 0.75],
  shape: {
    solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12,
    nonManifoldEdgeCount: 0, brepValid: true, volumeMm3: 1000,
    surfaceAreaMm2: 600, maxToleranceMm: 0.001, bboxMm: [0, 0, 0, 10, 10, 10],
    centroidMm: [5, 5, 5], massPropertiesBasis: 'volume',
    inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
  },
};
const receipt = {
  schema: 'nexyfab.occt-xcaf.inspect.v1', status: 'PASS_NATIVE', inputSha256: actual, unit: 'MM',
  programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-build' },
  kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt' },
  productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool', products: [product],
};
const mode = process.env.MOCK_XCAF_HARDENED_MODE ?? 'pass';
if (mode === 'not-run') receipt.status = 'NOT_RUN';
if (mode === 'bad-identity') receipt.kernelIdentity.buildIdentity = '';
if (mode === 'missing-identity') { delete receipt.programIdentity; delete receipt.kernelIdentity; }
if (mode === 'duplicate-path') receipt.products.push({ ...product });
if (mode === 'legacy-shape') {
  for (const key of ['nonManifoldEdgeCount', 'brepValid', 'surfaceAreaMm2', 'maxToleranceMm', 'centroidMm', 'massPropertiesBasis', 'inertiaTensor', 'inertiaUnit']) delete receipt.products[0].shape[key];
}
if (mode === 'future-version') receipt.programIdentity.version = '999';
if (mode === 'extra-key') receipt.unexpected = true;
let output = JSON.stringify(receipt);
if (mode === 'nonfinite') output = output.replace('"maxToleranceMm":0.001', '"maxToleranceMm":1e400');
if (mode === 'oversized') output = JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024 + 1) });
process.stdout.write(output + '\\n');
`, { mode: 0o700 });
  return createXcafWorker({
    nativeCommand: { file: process.execPath, args: [executable] },
    defaultTimeoutMs: 1_000,
    maxBytes: 1024 * 1024,
  });
}

describe('native OCCT XCAF worker contract', () => {
  it('reports READY only after executing the native version probe', async () => {
    await expect(worker().capabilities()).resolves.toMatchObject({ status: 'READY', inspectionStatus: 'NOT_RUN', nativeAvailable: true });
    const unavailable = createXcafWorker({ nativeCommand: { file: path.join(os.tmpdir(), 'missing-occt-xcaf') } });
    await expect(unavailable.capabilities()).resolves.toMatchObject({ status: 'HOLD', nativeAvailable: false, reason: 'NATIVE_UNAVAILABLE' });
  });

  it('binds a PASS_NATIVE result to the exact input hash', async () => {
    const result = await worker().inspect({ inputBytes: source, sha256: digest(source) });
    expect(result.inputSha256).toBe(digest(source));
    expect(result.status).toBe('PASS_NATIVE');
    expect(result.nativeBinarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.nativeInvocationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.nativeInvocationSha256).not.toBe(result.nativeBinarySha256);
    expect(result.native).toMatchObject({ status: 'PASS_NATIVE', inputSha256: digest(source) });
  });

  it('rejects a caller hash mismatch before starting native work', async () => {
    await expect(worker().inspect({ inputBytes: source, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'INPUT_SHA256_MISMATCH' });
  });

  it('rejects malformed native output, wrong native hash, and non-zero exit', async () => {
    try {
      for (const mode of ['malformed', 'wrong-hash', 'exit']) {
        process.env.MOCK_XCAF_MODE = mode;
        await expect(worker().inspect({ inputBytes: source })).rejects.toBeInstanceOf(XcafWorkerError);
      }
    } finally {
      delete process.env.MOCK_XCAF_MODE;
    }
  });

  it('validates extended kernel measurements and explicit build identities', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nexyfab-occt-xcaf-hardened-'));
    try {
      const hardened = await createHardenedNative(directory);
      const result = await hardened.inspect({ inputBytes: source });
      expect(result).toMatchObject({
        status: 'PASS_NATIVE',
        native: {
          status: 'PASS_NATIVE',
          programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-build' },
          kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt' },
          products: [{ shape: { brepValid: true, surfaceAreaMm2: 600, nonManifoldEdgeCount: 0 } }],
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on NOT_RUN, non-finite metrics, incomplete identity, duplicate paths, and oversized output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nexyfab-occt-xcaf-invalid-'));
    try {
      const hardened = await createHardenedNative(directory);
      for (const mode of ['not-run', 'nonfinite', 'bad-identity', 'missing-identity', 'duplicate-path', 'legacy-shape', 'future-version', 'extra-key', 'oversized']) {
        process.env.MOCK_XCAF_HARDENED_MODE = mode;
        await expect(hardened.inspect({ inputBytes: source })).rejects.toBeInstanceOf(XcafWorkerError);
      }
    } finally {
      delete process.env.MOCK_XCAF_HARDENED_MODE;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('kills a timed-out native process and reports HOLD-compatible failure', async () => {
    try {
      process.env.MOCK_XCAF_MODE = 'timeout';
      await expect(worker(100).inspect({ inputBytes: source })).rejects.toMatchObject({ code: 'NATIVE_TIMEOUT' });
    } finally {
      delete process.env.MOCK_XCAF_MODE;
    }
  });

  it('isolates and removes path inputs under the configured root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexyfab-occt-xcaf-root-'));
    try {
      const input = path.join(root, 'fixture.step');
      await writeFile(input, source, { mode: 0o600 });
      const scoped = createXcafWorker({ nativeCommand: { file: process.execPath, args: [mock] }, inputRoot: root, maxBytes: 1024 * 1024 });
      const result = await scoped.inspect({ inputPath: input });
      expect(result.inputSha256).toBe(digest(source));
      const relativeResult = await scoped.inspect({ inputPath: 'fixture.step' });
      expect(relativeResult.inputSha256).toBe(digest(source));
      await expect(scoped.inspect({ inputPath: path.join(root, '..', 'outside.step') })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
      await expect(scoped.inspect({ inputPath: path.join(root, 'fixture.txt') })).rejects.toMatchObject({ code: 'PATH_NOT_REGULAR_FILE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent jobs with independent input hashes', async () => {
    const second = Buffer.from(source.toString('utf8').replace('DATA;', 'DATA;\n/* second */'));
    const outputs = await Promise.all([worker().inspect({ inputBytes: source }), worker().inspect({ inputBytes: second })]);
    expect(outputs.map(item => item.inputSha256)).toEqual([digest(source), digest(second)]);
  });
});
