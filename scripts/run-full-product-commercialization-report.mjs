#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FULL_PRODUCT_GATE_OUTPUT = 'docs/evidence/release/commercialization-readiness-full-product-current.json';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runFullProductCommercializationReport({
  root = DEFAULT_ROOT,
  spawn = spawnSync,
  parentEnv = process.env,
} = {}) {
  const gate = path.resolve(root, 'scripts/commercialization-readiness-gate.mjs');
  const result = spawn(process.execPath, [gate], {
    cwd: path.resolve(root),
    env: {
      ...parentEnv,
      NEXYFAB_RELEASE_CHANNEL: 'platform',
      NEXYFAB_PRODUCT_RELEASE_SCOPE: 'full-product',
      COMMERCIALIZATION_GATE_OUTPUT: FULL_PRODUCT_GATE_OUTPUT,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.stderr.write(`[full-product-commercialization] gate terminated by ${result.signal}\n`);
    return 2;
  }
  return Number.isInteger(result.status) ? result.status : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runFullProductCommercializationReport(); } catch (error) {
    process.stderr.write(`[full-product-commercialization] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
