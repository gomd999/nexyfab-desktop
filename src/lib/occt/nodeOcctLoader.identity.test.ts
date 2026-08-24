// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetOcctNodeCache, loadOcctNode } from './nodeOcctLoader';

const temporary: string[] = [];

function fakeDist(marker: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-occt-loader-'));
  temporary.push(root);
  const dist = path.join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'opencascade.js', version: '1.1.1' }));
  writeFileSync(
    path.join(dist, 'opencascade.wasm.js'),
    `export default async ({ wasmBinary }) => ({ marker: ${JSON.stringify(marker)}, wasmBytes: wasmBinary.length });\n/*${'x'.repeat(1024)}*/`,
  );
  const wasm = Buffer.alloc(1024 * 1024);
  Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).copy(wasm);
  writeFileSync(path.join(dist, 'opencascade.wasm.wasm'), wasm);
  return dist;
}

afterEach(() => {
  __resetOcctNodeCache();
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('node OCCT identity-bound loader', () => {
  it('imports the exact verified glue buffer and restores global state', async () => {
    const dist = fakeDist('verified-buffer');
    const globalValue = globalThis as typeof globalThis & { __dirname?: string };
    const had = Object.hasOwn(globalValue, '__dirname');
    const before = globalValue.__dirname;
    const loaded = await loadOcctNode({ distDir: dist });
    expect(loaded).toMatchObject({ ok: true, oc: { marker: 'verified-buffer', wasmBytes: 1024 * 1024 } });
    expect(loaded.identity?.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.hasOwn(globalValue, '__dirname')).toBe(had);
    expect(globalValue.__dirname).toBe(before);
  });

  it('does not mix a second dist directory into an existing runtime cache', async () => {
    const first = fakeDist('first');
    const second = fakeDist('second');
    expect(await loadOcctNode({ distDir: first })).toMatchObject({ ok: true, oc: { marker: 'first' } });
    expect(await loadOcctNode({ distDir: second })).toEqual({ ok: false, reason: 'OCCT_RUNTIME_DIST_MISMATCH' });
  });
});
