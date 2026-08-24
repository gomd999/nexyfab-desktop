#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(workspaceDirectory, '..', '..');
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const runAll = process.argv.includes('--all');
const reportFindings = process.argv.includes('--report-findings');
const requestedTimeout = Number.parseInt(process.env.NEXYFAB_PRECISION_TEST_TIMEOUT_MS ?? '', 10);
const timeoutMs = Number.isInteger(requestedTimeout)
  ? Math.min(30 * 60_000, Math.max(60_000, requestedTimeout))
  : runAll ? 15 * 60_000 : 5 * 60_000;

const focusedTests = [
  'src/app/[lang]/shape-generator/hooks/useConfigurationsRuntime.test.ts',
  'src/app/[lang]/shape-generator/_shell/shapeGeneratorRouteSegment.test.ts',
  'src/app/[lang]/shape-generator/io/geometryToStlBase64.test.ts',
  'src/app/[lang]/shape-generator/__tests__/referenceParts/refPartsFindingGate.test.ts',
  'containers/occt-exact/src/singlePartReadiness.integration.test.ts',
  'src/lib/cad/mechanicalSinglePartCandidate.test.ts',
  'src/lib/cad/singlePartCandidateSliceParity.test.ts',
];

const groups = [
  {
    name: 'isolated-single-part-contract',
    command: process.execPath,
    args: ['--test', 'test/server.test.mjs'],
    cwd: path.join(root, 'capabilities', 'precision-cad', 'single-part-candidate'),
  },
  {
    name: runAll ? 'precision-cad-all' : 'precision-cad-focused',
    command: process.execPath,
    args: [vitest, 'run', ...(runAll ? [
      'src/app/[lang]/shape-generator',
      'src/lib/cad',
      'src/lib/cad-ir',
      'src/lib/occt',
      'src/lib/sketch',
      'src/lib/assembly',
      'containers/occt-exact',
    ] : focusedTests), '--reporter=dot'],
    cwd: root,
  },
];

function runGroup(group) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`[precision-verify] START ${group.name} timeoutMs=${timeoutMs}\n`);
    const child = spawn(group.command, group.args, {
      cwd: group.cwd,
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        ...(reportFindings ? { NEXYFAB_REFERENCE_PART_FINDINGS_MODE: 'report' } : {}),
      },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${group.name}:TIMEOUT:${timeoutMs}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${group.name}:EXIT:${code ?? 'unknown'}`));
        return;
      }
      process.stdout.write(`[precision-verify] PASS ${group.name}\n`);
      resolve();
    });
  });
}

try {
  for (const group of groups) await runGroup(group);
  process.stdout.write('[precision-verify] PASS all groups\n');
} catch (error) {
  process.stderr.write(`[precision-verify] FAIL ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
