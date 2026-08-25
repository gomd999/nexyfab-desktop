import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildMechanicalDirectDesignReceipt,
  createMechanicalDirectDesignState,
  inspectMechanicalDirectDesignCampaignPrerequisites,
  resumeMechanicalDirectDesignState,
  runMechanicalDirectDesignCampaign,
} from './run-mechanical-direct-design-campaign.mjs';
import { mechanicalDesignVerificationPayload } from './mechanical-commercial-evidence-v3.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const features = Array.from({ length: 30 }, (_, index) => `feature-${index + 1}`);
const verifierKeys = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [role, generateKeyPairSync('ed25519')]));
const trustedDesignVerifiers = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [`${role}-verifier`, {
  publicKey: verifierKeys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  roles: [`mechanical-${role}-verifier`],
}]));
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
    assert.equal(result.workbook.valid, true);
    assert.equal(result.workbook.cases, 30);
    assert.equal(result.artifacts.expected, 240);
    assert.equal(result.artifacts.present, 0);
    assert.equal(result.artifacts.missing, 240);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.equal(result.verifiers.roleSeparated, true);
    assert.deepEqual(result.blockers, [
      'required_artifacts_missing',
      'trusted_runtime_adapter_sha256_not_supplied_or_invalid',
    ]);
    assert.equal(result.readyToExecute, false);
    assert.deepEqual(fs.readdirSync(root), ['adapter.mjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight becomes execution-ready only when all files, role-separated keys, and adapter are present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-ready-'));
  try {
    const book = workbook();
    for (const item of book.cases) writeCase(root, item);
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'throw new Error("must not load");\n');
    const trustedAdapterSha256 = hash(fs.readFileSync(adapterPath));
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: book, evidenceRoot: root, adapterPath, trustedAdapterSha256, trustedDesignVerifiers,
    });
    assert.equal(result.artifacts.expected, 240);
    assert.equal(result.artifacts.present, 240);
    assert.equal(result.artifacts.missing, 0);
    assert.equal(result.artifacts.invalid, 0);
    assert.equal(result.verifiers.roleSeparated, true);
    assert.equal(result.adapter.regularFile, true);
    assert.equal(result.adapter.digestMatches, true);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.deepEqual(result.blockers, []);
    assert.equal(result.readyToExecute, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preflight rejects adapter byte substitution before import or execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-direct-design-adapter-'));
  try {
    const book = workbook();
    for (const item of book.cases) writeCase(root, item);
    const adapterPath = path.join(root, 'adapter.mjs'); fs.writeFileSync(adapterPath, 'export const executeMechanicalDesignCase = true;\n');
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook: book, evidenceRoot: root, adapterPath,
      trustedAdapterSha256: 'c'.repeat(64), trustedDesignVerifiers,
    });
    assert.equal(result.adapter.regularFile, true);
    assert.equal(result.adapter.digestMatches, false);
    assert.equal(result.adapter.loadedOrExecuted, false);
    assert.deepEqual(result.blockers, ['trusted_runtime_adapter_sha256_mismatch']);
    assert.equal(result.readyToExecute, false);
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
    assert.equal(result.readyToExecute, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
