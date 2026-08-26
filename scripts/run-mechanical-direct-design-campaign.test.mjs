import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto, { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildMechanicalDirectDesignReceipt,
  createMechanicalDirectDesignState,
  inspectMechanicalDirectDesignCampaignPrerequisites,
  mechanicalDesignAdapterApprovalPayload,
  resumeMechanicalDirectDesignState,
  runMechanicalDirectDesignCampaign,
  validateMechanicalDesignAdapterApproval,
} from './run-mechanical-direct-design-campaign.mjs';
import { mechanicalDesignVerificationPayload } from './mechanical-commercial-evidence-v3.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const features = Array.from({ length: 30 }, (_, index) => `feature-${index + 1}`);
const verifierKeys = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [role, generateKeyPairSync('ed25519')]));
const trustedDesignVerifiers = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [`${role}-verifier`, {
  publicKey: verifierKeys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  roles: [`mechanical-${role}-verifier`],
}]));
const adapterApproverKeys = generateKeyPairSync('ed25519');
const trustedAdapterApprovers = {
  'adapter-release-approver': {
    publicKey: adapterApproverKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    roles: ['mechanical-adapter-release-approver'],
  },
};
const campaignOptions = { trustedDesignVerifiers, now: Date.parse('2026-08-12T02:00:00.000Z') };

function workbook() {
  return {
    schema: 'nexyfab.mechanical-direct-design-workbook.v1', releaseChannel: 'mechanical-core',
    generatedAt: '2026-08-12T00:00:00.000Z', evidenceRootId: 'a'.repeat(64),
    cases: features.map((primaryFeature, index) => {
      const caseId = `design-${String(index + 1).padStart(2, '0')}`;
      const names = { requirements: 'requirements.md', nfab: 'design.nfab', step: 'design.step', drawing: 'drawing.pdf', bom: 'bom.csv', manifest: 'manifest.json', intentEvaluation: 'intent.json', verificationReceipt: 'verification.json' };
      return { caseId, family: index < 12 ? 'machined' : index < 20 ? 'sheet_metal' : index < 25 ? 'rotational_sweep_loft' : 'pattern_multibody_boolean', primaryFeature, status: 'evidence_required', artifactPaths: Object.fromEntries(Object.entries(names).map(([role, name]) => [role, `${caseId}/${name}`])), releaseEligible: false };
    }),
  };
}

function signedAdapterApproval(book, adapterSha256, {
  privateKey = adapterApproverKeys.privateKey,
  approvedAt = '2026-08-12T00:30:00.000Z',
  expiresAt = '2026-08-20T00:30:00.000Z',
  approverId = 'adapter-release-approver',
} = {}) {
  const receipt = {
    schema: 'nexyfab.mechanical-design-adapter-approval.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: book.evidenceRootId,
    adapter: { sha256: adapterSha256, version: '1.0.0' },
    approval: {
      approverId,
      role: 'mechanical-adapter-release-approver',
      algorithm: 'Ed25519',
      approvedAt,
      expiresAt,
      signature: '',
    },
    claimBoundary: { importsOnlyApprovedBytes: true, grantsCommercialRelease: false },
  };
  receipt.approval.signature = crypto.sign(
    null,
    Buffer.from(mechanicalDesignAdapterApprovalPayload(receipt)),
    privateKey,
  ).toString('base64');
  return receipt;
}

function writeAdapterApproval(root, book, adapterSha256, options) {
  const approvalPath = path.join(root, 'adapter-approval.json');
  fs.writeFileSync(approvalPath, JSON.stringify(signedAdapterApproval(book, adapterSha256, options)));
  return approvalPath;
}

function writeCase(root, item) {
  const bytes = {
    requirements: Buffer.from('# locked requirements\n'), nfab: Buffer.from('NFAB'), step: Buffer.from('STEP'),
    drawing: Buffer.from('%PDF'), bom: Buffer.from('part,qty\nbody,1\n'),
    intentEvaluation: Buffer.from(JSON.stringify({
      schema: 'nexyfab.mechanical-intent-case-evaluation.v1', caseId: item.caseId, designRevisionSha256: 'b'.repeat(64),
      entries: ['ko_practical', 'en_practical', 'mixed_units', 'missing_required', 'contradictory_or_unmanufacturable'].map(category => ({
        category, outcome: 'executed', falseVerified: false, verified: true,
        stages: { parse: 'pass', requirements: 'pass', plan: 'pass', geometry: 'pass', verification: 'pass' },
      })),
    })),
  };
  const hashes = Object.fromEntries(Object.entries(bytes).map(([role, value]) => [role, hash(value)]));
  const verificationReceipt = { schema: 'nexyfab.mechanical-design-case-verification.v1', caseId: item.caseId, designRevisionSha256: 'b'.repeat(64), requirementsSha256: hashes.requirements, status: 'PASS',
    claimBoundary: { actualManufacturingEvidence: 'NOT_RUN', actualInspectionEvidence: 'NOT_RUN', releaseEligible: false }, artifacts: {
      step: { status: 'PASS', sha256: hashes.step, evidenceSha256: hash(Buffer.from(`step-evidence-${item.caseId}`)), verifierId: 'step-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-12T01:00:00.000Z' },
      drawing: { status: 'PASS', sha256: hashes.drawing, evidenceSha256: hash(Buffer.from(`drawing-evidence-${item.caseId}`)), verifierId: 'drawing-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-12T01:00:00.000Z' },
      bom: { status: 'PASS', sha256: hashes.bom, evidenceSha256: hash(Buffer.from(`bom-evidence-${item.caseId}`)), verifierId: 'bom-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-12T01:00:00.000Z' },
    } };
  for (const role of ['step', 'drawing', 'bom']) {
    verificationReceipt.artifacts[role].signature = crypto.sign(null, Buffer.from(mechanicalDesignVerificationPayload(verificationReceipt, role)), verifierKeys[role].privateKey).toString('base64');
  }
  bytes.verificationReceipt = Buffer.from(JSON.stringify(verificationReceipt));
  hashes.verificationReceipt = hash(bytes.verificationReceipt);
  const manifest = Buffer.from(JSON.stringify({ schema: 'nexyfab.mechanical-design-case-manifest.v1', caseId: item.caseId, designRevisionSha256: 'b'.repeat(64), requirementsSha256: hashes.requirements, artifacts: hashes }));
  for (const [role, value] of Object.entries({ ...bytes, manifest })) {
    const target = path.join(root, item.artifactPaths[role]); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
  }
}

const successfulExecution = () => ({ cycles: { nfab: 3, step: 3 }, checks: {
  kernelValid: true, nonEmpty: true, stableFeatureIds: true, lockedDimensionsPreserved: true,
  nfabThreeCycles: true, stepThreeCycles: true, drawingReleased: true, bomReconciled: true, revisionBound: true,
} });

test('runs selected cases from real artifact bytes and leaves every unselected case pending', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-'));
  try {
    const book = workbook(); const initial = createMechanicalDirectDesignState(book, '2026-08-12T00:00:00.000Z');
    let calls = 0;
    const state = await runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: initial, caseIds: [book.cases[0].caseId], executeCase: async ({ caseValue }) => { calls += 1; writeCase(root, caseValue); return successfulExecution(); }, ...campaignOptions });
    assert.equal(calls, 1); assert.equal(state.slots[0].status, 'completed', state.slots[0].error); assert.equal(state.slots[1].status, 'pending');
    const receipt = buildMechanicalDirectDesignReceipt(book, state, root, '2026-08-12T01:00:00.000Z');
    assert.deepEqual(receipt.summary, { cases: 30, passed: 1, pending: 29, failed: 0, intents: 5, falseVerified: 0 });
    assert.equal(receipt.ok, false); assert.equal(receipt.cases[0].artifacts.nfab.sha256, hash(Buffer.from('NFAB')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('resumes without rerunning completed cases and rejects artifact or state tampering', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-'));
  try {
    const book = workbook(); let calls = 0; const id = book.cases[0].caseId;
    const first = await runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: createMechanicalDirectDesignState(book), caseIds: [id], executeCase: async ({ caseValue }) => { calls += 1; writeCase(root, caseValue); return successfulExecution(); }, ...campaignOptions });
    await runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: first, caseIds: [id], executeCase: async () => { calls += 1; return successfulExecution(); }, ...campaignOptions });
    assert.equal(calls, 1);
    fs.appendFileSync(path.join(root, book.cases[0].artifactPaths.step), 'tampered');
    await assert.rejects(() => runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: first, executeCase: async () => successfulExecution(), ...campaignOptions }), /ARTIFACT_TAMPERED/);
    const changed = structuredClone(first); changed.slots[0].attempts = 99;
    assert.throws(() => resumeMechanicalDirectDesignState(book, changed), /RESUME_MISMATCH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('checkpoints a partial failure and retries only that slot on resume', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-'));
  try {
    const book = workbook(); const ids = book.cases.slice(0, 2).map(item => item.caseId); let failOnce = true; const checkpoints = [];
    const executeCase = async ({ caseValue }) => {
      if (caseValue.caseId === ids[1] && failOnce) { failOnce = false; throw new Error('runtime unavailable'); }
      writeCase(root, caseValue); return successfulExecution();
    };
    const first = await runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: createMechanicalDirectDesignState(book), caseIds: ids, executeCase, onCheckpoint: value => checkpoints.push(value), ...campaignOptions });
    assert.deepEqual(first.slots.slice(0, 2).map(item => item.status), ['completed', 'failed'], first.slots.slice(0, 2).map(item => item.error).join('; ')); assert.ok(checkpoints.length >= 4);
    const resumed = await runMechanicalDirectDesignCampaign({ workbook: book, evidenceRoot: root, state: first, caseIds: ids, executeCase, ...campaignOptions });
    assert.deepEqual(resumed.slots.slice(0, 2).map(item => item.status), ['completed', 'completed']); assert.equal(resumed.slots[1].attempts, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('does not mark correctly hashed but semantically invalid intent evidence as completed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-'));
  try {
    const book = workbook(); const item = book.cases[0];
    const state = await runMechanicalDirectDesignCampaign({
      workbook: book, evidenceRoot: root, state: createMechanicalDirectDesignState(book), caseIds: [item.caseId],
      executeCase: async ({ caseValue }) => {
        writeCase(root, caseValue);
        const intentPath = path.join(root, caseValue.artifactPaths.intentEvaluation);
        const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8')); intent.entries[0].falseVerified = true;
        fs.writeFileSync(intentPath, JSON.stringify(intent));
        const manifestPath = path.join(root, caseValue.artifactPaths.manifest);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.artifacts.intentEvaluation = hash(fs.readFileSync(intentPath)); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        return successfulExecution();
      }, ...campaignOptions,
    });
    assert.equal(state.slots[0].status, 'failed');
    assert.match(state.slots[0].error, /CASE_EVIDENCE_INVALID/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('does not mark a package complete without a revision-bound verification receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-'));
  try {
    const book = workbook(); const item = book.cases[0];
    const state = await runMechanicalDirectDesignCampaign({
      workbook: book, evidenceRoot: root, state: createMechanicalDirectDesignState(book), caseIds: [item.caseId],
      executeCase: async ({ caseValue }) => {
        writeCase(root, caseValue);
        fs.rmSync(path.join(root, caseValue.artifactPaths.verificationReceipt));
        return successfulExecution();
      }, ...campaignOptions,
    });
    assert.equal(state.slots[0].status, 'failed');
    assert.match(state.slots[0].error, /VERIFICATION_RECEIPT_INVALID|ARTIFACT_MISSING/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('published receipt schema requires the signed verification receipt accepted by the runner', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../docs/process/mechanical-direct-design-campaign.schema.json', import.meta.url), 'utf8'));
  const artifacts = schema.properties.cases.items.properties.artifacts;
  assert.equal(artifacts.additionalProperties, false);
  assert.equal(artifacts.required.includes('verificationReceipt'), true);
  assert.deepEqual(artifacts.properties.verificationReceipt, { $ref: '#/$defs/artifact' });
});

test('rejects changed workbooks and artifact paths outside the evidence root', () => {
  const book = workbook(); const state = createMechanicalDirectDesignState(book); const changed = structuredClone(book); changed.cases[0].primaryFeature = 'changed';
  assert.throws(() => resumeMechanicalDirectDesignState(changed, state), /RESUME_MISMATCH/);
  const unsafe = workbook(); unsafe.cases[0].artifactPaths.step = '../outside.step';
  assert.throws(() => createMechanicalDirectDesignState(unsafe), /CASE_INVALID/);
});

test('preflight reports a fresh pending scaffold without creating state or evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-preflight-'));
  try {
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'throw new Error("must not load");\n');
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: workbook(), evidenceRoot: root, adapterPath, trustedDesignVerifiers,
    });
    assert.equal(result.schema, 'nexyfab.mechanical-direct-design-campaign-preflight.v2');
    assert.equal(result.workbook.valid, true);
    assert.equal(result.workbook.cases, 30);
    assert.equal(result.artifacts.expected, 240);
    assert.equal(result.artifacts.present, 0);
    assert.equal(result.artifacts.missing, 240);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.equal(result.verifiers.roleSeparated, true);
    assert.deepEqual(result.blockers, [
      'trusted_runtime_adapter_sha256_not_supplied_or_invalid',
      'trusted_runtime_adapter_release_approver_missing',
      'trusted_runtime_adapter_approval_not_supplied',
      'required_artifacts_missing',
    ]);
    assert.equal(result.readyToExecute, false);
    assert.equal(result.readyForFinalVerification, false);
    assert.deepEqual(fs.readdirSync(root), ['adapter.mjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight allows a trusted campaign to start before the adapter creates case artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-start-'));
  try {
    const book = workbook();
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'throw new Error("must not load");\n');
    const trustedAdapterSha256 = hash(fs.readFileSync(adapterPath));
    const adapterApprovalPath = writeAdapterApproval(root, book, trustedAdapterSha256);
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: book, evidenceRoot: root, adapterPath, trustedAdapterSha256,
      adapterApprovalPath, trustedAdapterApprovers, trustedDesignVerifiers,
      now: campaignOptions.now,
    });
    assert.equal(result.artifacts.present, 0);
    assert.equal(result.artifacts.missing, 240);
    assert.equal(result.adapter.digestMatches, true);
    assert.equal(result.adapter.approval.valid, true);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.deepEqual(result.executionBlockers, []);
    assert.deepEqual(result.evidenceBlockers, ['required_artifacts_missing']);
    assert.deepEqual(result.blockers, ['required_artifacts_missing']);
    assert.equal(result.readyToExecute, true);
    assert.equal(result.readyForFinalVerification, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight becomes final-verification-ready only when all 240 files are present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-ready-'));
  try {
    const book = workbook();
    for (const item of book.cases) writeCase(root, item);
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'throw new Error("must not load");\n');
    const trustedAdapterSha256 = hash(fs.readFileSync(adapterPath));
    const adapterApprovalPath = writeAdapterApproval(root, book, trustedAdapterSha256);
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: book, evidenceRoot: root, adapterPath, trustedAdapterSha256,
      adapterApprovalPath, trustedAdapterApprovers, trustedDesignVerifiers,
      now: campaignOptions.now,
    });
    assert.equal(result.artifacts.expected, 240);
    assert.equal(result.artifacts.present, 240);
    assert.equal(result.artifacts.missing, 0);
    assert.equal(result.artifacts.invalid, 0);
    assert.equal(result.verifiers.roleSeparated, true);
    assert.equal(result.adapter.regularFile, true);
    assert.equal(result.adapter.digestMatches, true);
    assert.equal(result.adapter.approval.valid, true);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.readyToExecute, true);
    assert.equal(result.readyForFinalVerification, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight rejects adapter byte substitution before import or execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-adapter-'));
  try {
    const book = workbook();
    for (const item of book.cases) writeCase(root, item);
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'export const executeMechanicalDesignCase = true;\n');
    const trustedAdapterSha256 = hash(fs.readFileSync(adapterPath));
    const adapterApprovalPath = writeAdapterApproval(root, book, trustedAdapterSha256);
    fs.appendFileSync(adapterPath, '// substituted\n');
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: book, evidenceRoot: root, adapterPath,
      trustedAdapterSha256, adapterApprovalPath, trustedAdapterApprovers, trustedDesignVerifiers,
      now: campaignOptions.now,
    });
    assert.equal(result.adapter.regularFile, true);
    assert.equal(result.adapter.digestMatches, false);
    assert.equal(result.adapter.approval.valid, false);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.deepEqual(result.blockers, [
      'trusted_runtime_adapter_sha256_mismatch',
      'trusted_runtime_adapter_approval_invalid',
    ]);
    assert.equal(result.readyToExecute, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adapter approval rejects forged, expired, or campaign-transplanted receipts', () => {
  const book = workbook();
  const adapterSha256 = 'd'.repeat(64);
  const options = {
    adapterSha256, evidenceRootId: book.evidenceRootId, trustedAdapterApprovers,
    now: campaignOptions.now,
  };
  assert.equal(validateMechanicalDesignAdapterApproval(signedAdapterApproval(book, adapterSha256), options), true);
  const attacker = generateKeyPairSync('ed25519');
  assert.equal(validateMechanicalDesignAdapterApproval(signedAdapterApproval(book, adapterSha256, { privateKey: attacker.privateKey }), options), false);
  assert.equal(validateMechanicalDesignAdapterApproval(signedAdapterApproval(book, adapterSha256, {
    approvedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z',
  }), options), false);
  const transplanted = signedAdapterApproval(book, adapterSha256); transplanted.evidenceRootId = 'e'.repeat(64);
  assert.equal(validateMechanicalDesignAdapterApproval(transplanted, options), false);
});

test('published adapter approval schema preserves exact authority and claim boundaries', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../workspaces/platform/contracts/mechanical-design-adapter-approval.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.approval.properties.role, { const: 'mechanical-adapter-release-approver' });
  assert.deepEqual(schema.properties.approval.properties.algorithm, { const: 'Ed25519' });
  assert.deepEqual(schema.properties.claimBoundary.properties.importsOnlyApprovedBytes, { const: true });
  assert.deepEqual(schema.properties.claimBoundary.properties.grantsCommercialRelease, { const: false });
});

test('CLI rejects an invalid adapter approval before module import or state creation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-cli-'));
  try {
    const book = workbook();
    const workbookPath = path.join(root, 'workbook.json'); fs.writeFileSync(workbookPath, JSON.stringify(book));
    const adapterPath = path.join(root, 'adapter.mjs');
    fs.writeFileSync(adapterPath, 'import fs from "node:fs"; fs.writeFileSync(new URL("./adapter-loaded", import.meta.url), "loaded"); export async function executeMechanicalDesignCase() {}\n');
    const adapterSha256 = hash(fs.readFileSync(adapterPath));
    const attacker = generateKeyPairSync('ed25519');
    const approvalPath = writeAdapterApproval(root, book, adapterSha256, { privateKey: attacker.privateKey });
    const statePath = path.join(root, 'campaign-state.json');
    const runnerPath = fileURLToPath(new URL('./run-mechanical-direct-design-campaign.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      runnerPath,
      `--workbook=${workbookPath}`,
      `--state=${statePath}`,
      `--adapter=${adapterPath}`,
      `--adapter-sha256=${adapterSha256}`,
      `--adapter-approval=${approvalPath}`,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NEXYFAB_MECHANICAL_ADAPTER_APPROVER_KEYS: JSON.stringify(trustedAdapterApprovers),
      },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /ADAPTER_APPROVAL_INVALID/);
    assert.equal(fs.existsSync(path.join(root, 'adapter-loaded')), false);
    assert.equal(fs.existsSync(statePath), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight rejects a stale workbook that omits the signed verification receipt path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-stale-'));
  try {
    const stale = workbook(); delete stale.cases[0].artifactPaths.verificationReceipt;
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: stale, evidenceRoot: root, trustedDesignVerifiers,
    });
    assert.equal(result.workbook.valid, false);
    assert.match(result.workbook.error, /CASE_INVALID/);
    assert.equal(result.artifacts.expected, 0);
    assert.ok(result.blockers.includes('direct_design_workbook_invalid'));
    assert.ok(result.blockers.includes('trusted_runtime_adapter_not_supplied'));
    assert.ok(result.blockers.includes('trusted_runtime_adapter_sha256_not_supplied_or_invalid'));
    assert.ok(result.blockers.includes('trusted_runtime_adapter_release_approver_missing'));
    assert.ok(result.blockers.includes('trusted_runtime_adapter_approval_not_supplied'));
    assert.equal(result.readyToExecute, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
