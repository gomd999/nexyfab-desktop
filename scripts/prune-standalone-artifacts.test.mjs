import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pruneStandaloneArtifacts } from './prune-standalone-artifacts.mjs';

test('removes only generated mutable state and preserves source state', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-prune-'));
  try {
    const standalone = path.join(root, '.next', 'standalone');
    mkdirSync(path.join(standalone, 'data'), { recursive: true });
    mkdirSync(path.join(root, 'data'), { recursive: true });
    writeFileSync(path.join(standalone, 'data', 'customer.db'), 'copy');
    writeFileSync(path.join(standalone, 'nexyfab.db'), 'copy');
    writeFileSync(path.join(root, 'data', 'customer.db'), 'original');

    const result = pruneStandaloneArtifacts({ projectRoot: root });
    assert.deepEqual(result.removed.sort(), ['data', 'nexyfab.db']);
    assert.equal(readFileSync(path.join(root, 'data', 'customer.db'), 'utf8'), 'original');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('docker mode strips only paths copied explicitly by the Dockerfile', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-prune-'));
  try {
    const standalone = path.join(root, 'build', 'standalone');
    mkdirSync(path.join(standalone, 'public'), { recursive: true });
    mkdirSync(path.join(standalone, 'scripts', 'drawing-to-3d'), { recursive: true });
    mkdirSync(path.join(standalone, 'server'), { recursive: true });
    writeFileSync(path.join(standalone, 'public', 'asset.wasm'), 'asset');
    writeFileSync(path.join(standalone, 'scripts', 'drawing-to-3d', 'run.mjs'), 'script');
    writeFileSync(path.join(standalone, 'server', 'route.js'), 'keep');

    pruneStandaloneArtifacts({ projectRoot: root, distDir: 'build', stripDockerDuplicates: true });
    assert.equal(readFileSync(path.join(standalone, 'server', 'route.js'), 'utf8'), 'keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
