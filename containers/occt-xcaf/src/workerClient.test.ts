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

describe('native OCCT XCAF worker contract', () => {
  it('reports READY only after executing the native version probe', async () => {
    await expect(worker().capabilities()).resolves.toMatchObject({ status: 'READY', nativeAvailable: true });
    const unavailable = createXcafWorker({ nativeCommand: { file: path.join(os.tmpdir(), 'missing-occt-xcaf') } });
    await expect(unavailable.capabilities()).resolves.toMatchObject({ status: 'HOLD', nativeAvailable: false, reason: 'NATIVE_UNAVAILABLE' });
  });

  it('binds a PASS_NATIVE result to the exact input hash', async () => {
    const result = await worker().inspect({ inputBytes: source, sha256: digest(source) });
    expect(result.inputSha256).toBe(digest(source));
    expect(result.nativeBinarySha256).toMatch(/^[a-f0-9]{64}$/);
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
