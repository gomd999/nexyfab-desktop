import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SOURCE_BINDINGS,
  buildAssemblyDrawingHandoffReadinessReceipt,
  calculateEvidenceRootSha256,
  validateAssemblyDrawingHandoffReadinessReceipt,
  verifyWrittenReceipt,
  writeReceipt,
} from './build-assembly-drawing-handoff-readiness.mjs';

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-handoff-readiness-'));
  for (const relative of SOURCE_BINDINGS) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `fixture:${relative}\n`);
  }
  return root;
}

const placement = () => ({
  schema: 'nexyfab.runtime-placement-readiness.v1',
  status: 'HOLD',
  evidenceState: 'NOT_RUN',
  evidencePath: 'docs/evidence/platform-runtime/live-observation-current.json',
  claims: [{ id: 'cloudflare-staging-deploy', state: 'NOT_RUN', reason: 'live evidence file is absent' }],
});

function receipt(root) {
  return buildAssemblyDrawingHandoffReadinessReceipt({
    root,
    runTests: () => ({ command: 'fixture-vitest', exitCode: 0, durationMs: 10 }),
    evaluatePlacement: placement,
    generatedAt: '2026-08-13T00:00:00.000Z',
  });
}

test('builds a local PASS while preserving production and runtime placement NOT_RUN', () => {
  const root = fixtureRoot();
  const value = receipt(root);
  assert.equal(value.status, 'HOLD');
  assert.equal(value.commercialReady, false);
  assert.equal(value.localVerification.status, 'PASS');
  assert.equal(value.runtimePlacement.evidenceState, 'NOT_RUN');
  assert.equal(value.runtimePlacement.liveEvidenceWritten, false);
  assert.equal(value.claims.find(item => item.id === 'production_scheduler_observation').status, 'NOT_RUN');
  assert.equal(value.artifactStates.manufacturingPackage, 'BLOCKED');
  assert.equal(value.textCanonicalization, 'utf8-crlf-to-lf');
  assert.ok(value.sourceBindings.every(binding => binding.canonicalization === 'utf8-crlf-to-lf'));
  assert.equal(value.evidenceRootSha256, calculateEvidenceRootSha256(value));
  assert.deepEqual(validateAssemblyDrawingHandoffReadinessReceipt(root, value), { ok: true, issues: [] });
});

test('accepts LF and CRLF source and receipt checkouts as the same text evidence', () => {
  const root = fixtureRoot();
  const value = receipt(root);
  for (const relative of SOURCE_BINDINGS) {
    const target = path.join(root, ...relative.split('/'));
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replaceAll('\n', '\r\n'));
  }
  assert.deepEqual(validateAssemblyDrawingHandoffReadinessReceipt(root, value), { ok: true, issues: [] });

  writeReceipt(root, value);
  const receiptPath = path.join(root, 'docs/evidence/cad-independent/local/assembly-drawing-handoff-260813/receipt.json');
  fs.writeFileSync(receiptPath, fs.readFileSync(receiptPath, 'utf8').replaceAll('\n', '\r\n'));
  assert.deepEqual(verifyWrittenReceipt(root).issues, []);
});

test('fails source tampering and any attempted production PASS promotion', () => {
  const root = fixtureRoot();
  const value = receipt(root);
  fs.appendFileSync(path.join(root, ...SOURCE_BINDINGS[0].split('/')), 'tampered\n');
  assert.ok(validateAssemblyDrawingHandoffReadinessReceipt(root, value).issues.includes('source_binding_hash_mismatch'));
  const promoted = structuredClone(value);
  promoted.claims.find(item => item.id === 'production_scheduler_observation').status = 'PASS';
  promoted.runtimePlacement.evidenceState = 'PASS';
  promoted.evidenceRootSha256 = calculateEvidenceRootSha256(promoted);
  const issues = validateAssemblyDrawingHandoffReadinessReceipt(fixtureRoot(), promoted).issues;
  assert.ok(issues.includes('claim_state_mismatch:production_scheduler_observation'));
  assert.ok(issues.includes('runtime_placement_live_evidence_boundary_invalid'));
});

test('verifies both the machine-readable receipt and its detached SHA-256', () => {
  const root = fixtureRoot();
  writeReceipt(root, receipt(root));
  assert.deepEqual(verifyWrittenReceipt(root).issues, []);
  const receiptPath = path.join(root, 'docs/evidence/cad-independent/local/assembly-drawing-handoff-260813/receipt.json');
  fs.appendFileSync(receiptPath, 'x');
  assert.ok(verifyWrittenReceipt(root).issues.includes('receipt_json_invalid'));
});
