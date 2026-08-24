// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNodeOcctRuntimeSnapshotUnchanged,
  readNodeOcctRuntimeSnapshot,
} from './nodeOcctRuntimeIdentity';

const temporary: string[] = [];

function runtimeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-occt-runtime-'));
  temporary.push(root);
  const dist = path.join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'opencascade.js', version: '1.1.1' }));
  const glue = `export default async () => ({})\n/*${'x'.repeat(1024)}*/\n`;
  const wasm = Buffer.alloc(1024 * 1024);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(wasm);
  writeFileSync(path.join(dist, 'opencascade.wasm.js'), glue);
  writeFileSync(path.join(dist, 'opencascade.wasm.wasm'), wasm);
  return { root, dist };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('server OCCT runtime identity', () => {
  it('binds the exact glue, WASM, package manifest and Node runtime deterministically', () => {
    const { dist } = runtimeFixture();
    const first = readNodeOcctRuntimeSnapshot(dist);
    const second = readNodeOcctRuntimeSnapshot(dist);
    expect(first.identity).toEqual(second.identity);
    expect(first.identity).toMatchObject({
      packageName: 'opencascade.js',
      packageVersion: '1.1.1',
      glueBytes: expect.any(Number),
      wasmBytes: 1024 * 1024,
    });
    for (const hash of [
      first.identity.glueSha256,
      first.identity.wasmSha256,
      first.identity.packageManifestSha256,
      first.identity.runtimeIdentitySha256,
    ]) expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertNodeOcctRuntimeSnapshotUnchanged(first)).not.toThrow();
  });

  it('detects asset changes after the snapshot', () => {
    const { dist } = runtimeFixture();
    const snapshot = readNodeOcctRuntimeSnapshot(dist);
    snapshot.glueSource[0] = snapshot.glueSource[0]! ^ 1;
    expect(() => assertNodeOcctRuntimeSnapshotUnchanged(snapshot)).toThrow('OCCT_RUNTIME_ASSET_CHANGED_DURING_LOAD');
    const second = readNodeOcctRuntimeSnapshot(dist);
    second.wasmBinary[0] = second.wasmBinary[0]! ^ 1;
    expect(() => assertNodeOcctRuntimeSnapshotUnchanged(second)).toThrow('OCCT_RUNTIME_ASSET_CHANGED_DURING_LOAD');
    snapshot.wasmBinary[0] = 1;
    expect(() => assertNodeOcctRuntimeSnapshotUnchanged(snapshot)).toThrow('OCCT_RUNTIME_ASSET_CHANGED_DURING_LOAD');
  });

  it('rejects missing, empty and falsely identified assets', () => {
    const { root, dist } = runtimeFixture();
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'other', version: '1.1.1' }));
    expect(() => readNodeOcctRuntimeSnapshot(dist)).toThrow('OCCT_RUNTIME_PACKAGE_IDENTITY_INVALID');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'opencascade.js', version: '1.1.1' }));
    writeFileSync(path.join(dist, 'opencascade.wasm.wasm'), Buffer.alloc(0));
    expect(() => readNodeOcctRuntimeSnapshot(dist)).toThrow('OCCT_RUNTIME_ASSET_SIZE_INVALID');
  });
});
