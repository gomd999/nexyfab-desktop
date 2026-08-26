#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateRuntimePlacementReadiness } from './platform/evaluate-runtime-placement-readiness.mjs';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
  canonicalTextSha256,
} from './canonical-text-binding.mjs';

export const OUTPUT_REL = 'docs/evidence/cad-independent/local/assembly-drawing-handoff-260813/receipt.json';
export const OUTPUT_SHA_REL = 'docs/evidence/cad-independent/local/assembly-drawing-handoff-260813/receipt.sha256';

export const TEST_FILES = Object.freeze([
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.sqlite.integration.test.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.test.ts',
  'src/lib/cad/assemblyDrawingHandoffStore.test.ts',
]);

export const SOURCE_BINDINGS = Object.freeze([
  'package-lock.json',
  'scripts/build-assembly-drawing-handoff-readiness.mjs',
  'scripts/build-assembly-drawing-handoff-readiness.test.mjs',
  'config/platform/runtime-placement.v1.json',
  'scripts/platform/evaluate-runtime-placement-readiness.mjs',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.test.ts',
  'src/app/[lang]/shape-generator/assembly/serverDrawingHandoff.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.ui.test.tsx',
  'src/app/[lang]/shape-generator/assembly/_content.tsx',
  'src/app/[lang]/shape-generator/drawing/_content.tsx',
  'src/app/[lang]/shape-generator/drawing/assemblyHandoff.test.tsx',
  'src/lib/cad/assemblyDrawingHandoffStore.ts',
  'src/lib/cad/assemblyDrawingHandoffStore.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.sqlite.integration.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/[handoffId]/route.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/[handoffId]/route.test.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.test.ts',
  'src/lib/db-migrations-wave-2-sqlite.sql',
  'src/lib/db-postgres-migrations.sql',
  'src/lib/db-adapter.ts',
  'docs/strategy/RAILWAY_CRON_SETUP.md',
]);

export const PROPOSED_INTERNAL_VERIFIER_BINDINGS = Object.freeze([
  'scripts/build-assembly-drawing-handoff-readiness.mjs',
  'scripts/build-assembly-drawing-handoff-readiness.test.mjs',
  'src/lib/cad/assemblyDrawingHandoffStore.ts',
  'src/lib/cad/assemblyDrawingHandoffStore.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/route.sqlite.integration.test.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/[handoffId]/route.ts',
  'src/app/api/nexyfab/projects/[id]/drawing-handoffs/[handoffId]/route.test.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.ts',
  'src/app/api/cron/assembly-drawing-handoff-prune/route.test.ts',
  'src/app/[lang]/shape-generator/assembly/serverDrawingHandoff.ts',
  'src/app/[lang]/shape-generator/assembly/drawingHandoff.ui.test.tsx',
  'src/app/[lang]/shape-generator/drawing/assemblyHandoff.test.tsx',
  'src/lib/db-migrations-wave-2-sqlite.sql',
  'src/lib/db-postgres-migrations.sql',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_CLAIMS = Object.freeze({
  local_sqlite_route_store_e2e: 'PASS',
  local_sqlite_bounded_expiry_cleanup: 'PASS',
  production_scheduler_observation: 'NOT_RUN',
  production_browser_cookie_org_switch: 'NOT_RUN',
  production_postgres_transaction_concurrency: 'NOT_RUN',
});
const REQUIRED_ARTIFACT_STATES = Object.freeze({
  exactBrepStep: 'NOT_RUN',
  drawingVerification: 'NOT_RUN',
  bomVerification: 'NOT_RUN',
  gdtPmiVerification: 'NOT_RUN',
  manufacturingPackage: 'BLOCKED',
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function testCommand() {
  return ['npx', 'vitest', 'run', ...TEST_FILES, '--reporter=dot'].join(' ');
}

function defaultRunTests(root) {
  const command = testCommand();
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', command]
    : ['vitest', 'run', ...TEST_FILES, '--reporter=dot'];
  const started = Date.now();
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    command,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    ...(result.error ? { launchError: result.error.message } : {}),
  };
}

function boundFiles(root) {
  return SOURCE_BINDINGS.map(relative => {
    const absolute = path.resolve(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) throw new Error(`ASSEMBLY_HANDOFF_EVIDENCE_SOURCE_MISSING:${relative}`);
    return { path: relative, ...canonicalTextBinding(fs.readFileSync(absolute)) };
  });
}

function evidenceRootTarget(receipt) {
  return {
    schema: receipt.schema,
    status: receipt.status,
    commercialReady: receipt.commercialReady,
    localVerification: {
      scope: receipt.localVerification.scope,
      status: receipt.localVerification.status,
      command: receipt.localVerification.command,
      exitCode: receipt.localVerification.exitCode,
      testFiles: receipt.localVerification.testFiles,
    },
    claims: receipt.claims,
    artifactStates: receipt.artifactStates,
    runtimePlacement: receipt.runtimePlacement,
    textCanonicalization: receipt.textCanonicalization,
    sourceBindings: receipt.sourceBindings,
    proposedInternalVerifierBindings: receipt.proposedInternalVerifierBindings,
  };
}

export function calculateEvidenceRootSha256(receipt) {
  return sha256(JSON.stringify(evidenceRootTarget(receipt)));
}

export function buildAssemblyDrawingHandoffReadinessReceipt({
  root,
  runTests = defaultRunTests,
  evaluatePlacement = options => evaluateRuntimePlacementReadiness(options),
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!root) throw new Error('ASSEMBLY_HANDOFF_EVIDENCE_ROOT_REQUIRED');
  const test = runTests(root);
  const sourceBindings = boundFiles(root);
  const localPass = test.exitCode === 0;
  const placement = evaluatePlacement({ root, readLiveEvidence: false, now: new Date(generatedAt) });
  if (placement.status !== 'HOLD' || placement.evidenceState !== 'NOT_RUN') {
    throw new Error('ASSEMBLY_HANDOFF_RUNTIME_PLACEMENT_NOT_FAIL_CLOSED');
  }
  const receipt = {
    schema: 'nexyfab.assembly-drawing-handoff-local-readiness.v1',
    generatedAt,
    status: 'HOLD',
    commercialReady: false,
    localVerification: {
      scope: 'LOCAL_SQLITE_ROUTE_AUTH_ACCESS_STORE',
      status: localPass ? 'PASS' : 'FAIL',
      command: test.command ?? testCommand(),
      exitCode: test.exitCode,
      durationMs: test.durationMs ?? null,
      testFiles: [...TEST_FILES],
      ...(test.launchError ? { launchError: test.launchError } : {}),
    },
    claims: [
      { id: 'local_sqlite_route_store_e2e', status: localPass ? 'PASS' : 'FAIL', reason: 'Route, signed local auth, org/project access, revision/hash CAS and immutable SQLite bytes were exercised.' },
      { id: 'local_sqlite_bounded_expiry_cleanup', status: localPass ? 'PASS' : 'FAIL', reason: 'Cron authorization, durable-path admission and bounded two-pass expiry cleanup were exercised against SQLite.' },
      { id: 'production_scheduler_observation', status: 'NOT_RUN', reason: 'No production scheduler registration, invocation or repeated drain observation was supplied.' },
      { id: 'production_browser_cookie_org_switch', status: 'NOT_RUN', reason: 'No production browser session-cookie and organization-switch E2E was supplied.' },
      { id: 'production_postgres_transaction_concurrency', status: 'NOT_RUN', reason: 'No production PostgreSQL migration, transaction or concurrent retry E2E was supplied.' },
    ],
    artifactStates: { ...REQUIRED_ARTIFACT_STATES },
    runtimePlacement: {
      status: placement.status,
      evidenceState: placement.evidenceState,
      liveEvidencePath: placement.evidencePath,
      liveEvidenceWritten: false,
      claims: placement.claims,
    },
    textCanonicalization: TEXT_BINDING_CANONICALIZATION,
    sourceBindings,
    proposedInternalVerifierBindings: [...PROPOSED_INTERNAL_VERIFIER_BINDINGS],
  };
  return { ...receipt, evidenceRootSha256: calculateEvidenceRootSha256(receipt) };
}

export function validateAssemblyDrawingHandoffReadinessReceipt(root, receipt) {
  const issues = [];
  if (receipt?.schema !== 'nexyfab.assembly-drawing-handoff-local-readiness.v1') issues.push('schema_mismatch');
  if (receipt?.status !== 'HOLD' || receipt?.commercialReady !== false) issues.push('commercial_boundary_not_hold');
  if (receipt?.localVerification?.scope !== 'LOCAL_SQLITE_ROUTE_AUTH_ACCESS_STORE'
    || receipt?.localVerification?.status !== 'PASS'
    || receipt?.localVerification?.exitCode !== 0) issues.push('local_sqlite_verification_not_passed');
  if (JSON.stringify(receipt?.localVerification?.testFiles) !== JSON.stringify(TEST_FILES)) issues.push('test_files_mismatch');

  const claims = new Map((receipt?.claims ?? []).map(claim => [claim.id, claim.status]));
  for (const [id, status] of Object.entries(REQUIRED_CLAIMS)) {
    if (claims.get(id) !== status) issues.push(`claim_state_mismatch:${id}`);
  }
  for (const [id, status] of Object.entries(REQUIRED_ARTIFACT_STATES)) {
    if (receipt?.artifactStates?.[id] !== status) issues.push(`artifact_state_mismatch:${id}`);
  }
  if (receipt?.runtimePlacement?.status !== 'HOLD'
    || receipt?.runtimePlacement?.evidenceState !== 'NOT_RUN'
    || receipt?.runtimePlacement?.liveEvidenceWritten !== false
    || !Array.isArray(receipt?.runtimePlacement?.claims)
    || receipt.runtimePlacement.claims.some(claim => claim.state !== 'NOT_RUN')) {
    issues.push('runtime_placement_live_evidence_boundary_invalid');
  }
  if (receipt?.textCanonicalization !== TEXT_BINDING_CANONICALIZATION) {
    issues.push('text_canonicalization_mismatch');
  }
  if (JSON.stringify(receipt?.proposedInternalVerifierBindings) !== JSON.stringify(PROPOSED_INTERNAL_VERIFIER_BINDINGS)) {
    issues.push('internal_verifier_binding_proposal_mismatch');
  }

  let expectedBindings = [];
  try { expectedBindings = boundFiles(root); }
  catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  if (JSON.stringify(receipt?.sourceBindings) !== JSON.stringify(expectedBindings)) issues.push('source_binding_hash_mismatch');
  if (!SHA256.test(receipt?.evidenceRootSha256 ?? '')
    || receipt.evidenceRootSha256 !== calculateEvidenceRootSha256(receipt)) issues.push('evidence_root_hash_mismatch');
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function writeReceipt(root, receipt) {
  const output = path.resolve(root, ...OUTPUT_REL.split('/'));
  const shaOutput = path.resolve(root, ...OUTPUT_SHA_REL.split('/'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(output, bytes);
  fs.writeFileSync(shaOutput, `${canonicalTextSha256(bytes)}  receipt.json\n`);
  return { output: OUTPUT_REL, shaOutput: OUTPUT_SHA_REL, receiptSha256: canonicalTextSha256(bytes) };
}

export function verifyWrittenReceipt(root) {
  const output = path.resolve(root, ...OUTPUT_REL.split('/'));
  const shaOutput = path.resolve(root, ...OUTPUT_SHA_REL.split('/'));
  if (!fs.existsSync(output) || !fs.existsSync(shaOutput)) return { ok: false, issues: ['receipt_files_missing'] };
  const bytes = fs.readFileSync(output, 'utf8');
  const expectedSha = fs.readFileSync(shaOutput, 'utf8').trim().split(/\s+/)[0] ?? '';
  let receipt;
  try { receipt = JSON.parse(bytes); }
  catch { return { ok: false, issues: ['receipt_json_invalid'] }; }
  const validation = validateAssemblyDrawingHandoffReadinessReceipt(root, receipt);
  const issues = [...validation.issues];
  if (!SHA256.test(expectedSha) || expectedSha !== canonicalTextSha256(bytes)) issues.push('receipt_file_hash_mismatch');
  return { ok: issues.length === 0, issues: [...new Set(issues)], receipt };
}

async function main(args = process.argv.slice(2), root = process.cwd()) {
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) throw new Error('Use exactly one of --write or --check');
  if (write) {
    const receipt = buildAssemblyDrawingHandoffReadinessReceipt({ root });
    const written = writeReceipt(root, receipt);
    const verified = verifyWrittenReceipt(root);
    process.stdout.write(`${JSON.stringify({ ok: verified.ok, status: receipt.status, localStatus: receipt.localVerification.status, ...written, issues: verified.issues })}\n`);
    return verified.ok ? 0 : 1;
  }

  const existing = verifyWrittenReceipt(root);
  if (!existing.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'ASSEMBLY_HANDOFF_RECEIPT_INVALID', issues: existing.issues })}\n`);
    return 1;
  }
  const rerun = defaultRunTests(root);
  const ok = rerun.exitCode === 0;
  process.stdout.write(`${JSON.stringify({ ok, status: existing.receipt.status, localStatus: ok ? 'PASS' : 'FAIL', receiptRecalculated: true, liveEvidenceWritten: false })}\n`);
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`[assembly-handoff-readiness] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
