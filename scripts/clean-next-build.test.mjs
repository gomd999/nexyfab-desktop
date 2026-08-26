import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanNextBuild, resolveNextBuildTarget } from './clean-next-build.mjs';

test('cleans only the selected safe Next build directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-next-clean-'));
  try {
    mkdirSync(path.join(root, '.next', 'cache'), { recursive: true });
    mkdirSync(path.join(root, '.next-e2e', 'cache'), { recursive: true });
    writeFileSync(path.join(root, '.next', 'cache', 'keep'), 'production');
    writeFileSync(path.join(root, '.next-e2e', 'cache', 'remove'), 'e2e');

    const result = cleanNextBuild({ projectRoot: root, distDir: '.next-e2e' });

    assert.equal(result.distDir, '.next-e2e');
    assert.equal(existsSync(path.join(root, '.next-e2e')), false);
    assert.equal(existsSync(path.join(root, '.next', 'cache', 'keep')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects broad, nested, absolute, and traversal targets', () => {
  const root = path.resolve('fixture-root');
  for (const distDir of ['', '.', 'build', '.next/e2e', '../.next', path.resolve(root, '.next-e2e')]) {
    assert.throws(
      () => resolveNextBuildTarget({ projectRoot: root, distDir }),
      /Refusing to clean unexpected Next/,
    );
  }
});
