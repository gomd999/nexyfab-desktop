import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildMechanicalProductScopeAssessment,
  mechanicalManufacturingCaseTargetHash,
  mechanicalManufacturingInspectorPayload,
  validateMechanicalDualExpertReview,
  validateMechanicalManufacturingReceipt,
} from './build-mechanical-product-scope-assessment.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (root, relative, value) => {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
};

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-scope-'));
  const paths = {
    internalVerification: 'evidence/internal.json',
    featureClosedLoopAssessment: 'evidence/features.json',
    directDesignCampaign: 'evidence/direct-design.json',
    blindProductChallenge: 'evidence/blind-challenge.json',
    manufacturingValidation: 'evidence/manufacturing.json',
    output: 'evidence/scope.json',
  };
  const sourcePath = 'src/bound.ts';
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'bound.ts'), 'export const bound = true;\n');
  writeJson(root, paths.internalVerification, {
    schema: 'nexyfab.mechanical-core-internal-verification.v1',
    generatedAt: '2026-08-11T01:00:00.000Z',
    ok: true,
    checks: { losslessDesignGraph: true, threeCycleNfab: true, threeCycleStep: true, mechanicalAccuracy: true, typecheck: true },
    commands: [
      { name: 'direct-cad', exitCode: 0, environment: { RUN_OCCT_FEASIBILITY: '1' } },
      { name: 'mechanical-accuracy', exitCode: 0, environment: {} },
      { name: 'typecheck', exitCode: 0, environment: {} },
    ],
    sourceBindings: [{ path: sourcePath, sha256: hash('export const bound = true;\n') }],
  });
  return { root, paths };
}

test('reports internal CAD verification separately from missing direct product evidence', t => {
  const fixture = fixtureRoot();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = buildMechanicalProductScopeAssessment(fixture.root, fixture.paths);
  assert.equal(result.evidence.artifactRevisionConsistencyVerified, true);
  assert.equal(result.evidence.internalRegressionVerified, true);
  assert.equal(result.evidence.coreThirtyFeatureClosedLoopVerified, false);
  assert.equal(result.evidence.directDesignCandidateVerified, false);
  assert.equal(result.evidence.directDesignThirtyVerified, false);
  assert.equal(result.evidence.intentCampaign150Verified, false);
  assert.equal(result.evidence.standardStepConformanceVerified, false);
  assert.equal(result.evidence.blindProductChallengeVerified, false);
  assert.equal(result.evidence.manufacturingReceiptVerified, false);
  assert.equal(result.decision.privateBetaEligible, false);
  assert.equal(result.decision.selfServiceEligible, false);
  assert.equal(result.decision.manufacturingReleaseVerified, false);
  assert.equal(result.decision.status, 'private_beta_evidence_pending');
  assert.deepEqual(result.blockers, [
    'mechanical_core_30_feature_closed_loop_required',
    'ten_direct_design_packages_required_for_private_beta',
    'thirty_direct_design_packages_required',
    'mechanical_intent_campaign_150_required',
    'standard_step_conformance_required',
    'twenty_blind_product_challenges_required',
    'three_manufactured_pilot_receipts_required',
  ]);
});

test('invalidates internal evidence when any source binding has drifted', t => {
  const fixture = fixtureRoot();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.root, 'src', 'bound.ts'), 'export const bound = false;\n');
  const result = buildMechanicalProductScopeAssessment(fixture.root, fixture.paths);
  assert.equal(result.evidence.artifactRevisionConsistencyVerified, false);
  assert.equal(result.evidence.internalRegressionVerified, false);
  assert.equal(result.decision.status, 'private_beta_evidence_pending');
});

test('rejects internal source evidence reached through a symlinked directory', t => {
  const fixture = fixtureRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-outside-'));
  t.after(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'bound.ts'), 'export const bound = true;\n');
  fs.symlinkSync(outside, path.join(fixture.root, 'src', 'linked'), 'junction');
  const internal = JSON.parse(fs.readFileSync(path.join(fixture.root, fixture.paths.internalVerification), 'utf8'));
  internal.sourceBindings[0].path = 'src/linked/bound.ts';
  internal.sourceBindings[0].sha256 = hash('export const bound = true;\n');
  fs.writeFileSync(path.join(fixture.root, fixture.paths.internalVerification), `${JSON.stringify(internal, null, 2)}\n`);

  const result = buildMechanicalProductScopeAssessment(fixture.root, fixture.paths);
  assert.equal(result.evidence.internalRegressionVerified, false);
  assert.equal(result.evidence.artifactRevisionConsistencyVerified, false);
});

test('requires two independent signed reviewers over at least twenty cases', () => {
  const receipt = {
    schema: 'nexyfab.mechanical-dual-expert-review.v2', releaseChannel: 'mechanical-core', ok: true,
    reviewKitSchema: 'nexyfab.independent-domain-review-kit.v3',
    holdoutCorpusSha256: hash('holdout'),
    reviewers: [
      { reviewerId: 'reviewer-a', independentFromBuild: true, signedAt: '2026-08-11T00:00:00Z', signatureRef: `sha256:${hash('sig-a')}` },
      { reviewerId: 'reviewer-b', independentFromBuild: true, signedAt: '2026-08-11T00:00:00Z', signatureRef: `sha256:${hash('sig-b')}` },
    ],
    summary: { cases: 20, dualApproved: 20, pending: 0, rejected: 0, changesRequested: 0 },
  };
  assert.equal(validateMechanicalDualExpertReview(receipt), true);
  assert.equal(validateMechanicalDualExpertReview({ ...receipt, reviewers: receipt.reviewers.slice(0, 1) }), false);
  assert.equal(validateMechanicalDualExpertReview({ ...receipt, summary: { ...receipt.summary, dualApproved: 19 } }), false);
});

test('requires three byte-bound manufactured and cryptographically inspected pilot processes', t => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-mechanical-pilots-'));
  t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  const processes = ['cnc_machining', 'sheet_metal', 'additive_manufacturing'];
  const extensions = { nfab: '.nfab', step: '.step', drawing: '.pdf', bom: '.csv', manufacturingReceipt: '.pdf', inspectionReport: '.json', photoEvidence: '.jpg' };
  const inspectorA = generateKeyPairSync('ed25519');
  const inspectorB = generateKeyPairSync('ed25519');
  const trustedInspectors = {
    'inspector-a': { publicKey: inspectorA.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['manufacturing-inspector'] },
    'inspector-b': { publicKey: inspectorB.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['manufacturing-inspector'] },
  };
  const cases = Array.from({ length: 3 }, (_, index) => {
    const artifacts = Object.fromEntries(Object.entries(extensions).map(([role, extension]) => {
      const relative = `pilot-${index + 1}/${role}${extension}`;
      const bytes = Buffer.from(`${role}-${index}`);
      const absolute = path.join(evidenceRoot, ...relative.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, bytes);
      return [role, { path: relative, sha256: hash(bytes) }];
    }));
    return {
      caseId: `pilot-${index + 1}`,
      process: processes[index],
      result: 'pass',
      designRevision: hash(`design-${index}`),
      noUnapprovedCadChanges: true,
      stepRoundtripVerified: true,
      drawingReleased: true,
      bomReconciled: true,
      inspectionDisposition: 'accepted',
      artifacts,
      manufacturer: { facilityId: index === 1 ? 'facility-b' : 'facility-a', independentFromNexyfab: true, completedAt: '2026-08-11T01:00:00.000Z' },
      measurements: Array.from({ length: 3 }, (_, measurement) => ({ characteristic: `dim-${measurement}`, nominal: 10, actual: 10.01, minusTolerance: 0.05, plusTolerance: 0.05, unit: 'mm', result: 'pass' })),
      inspector: { reviewerId: index === 1 ? 'inspector-b' : 'inspector-a', independentFromBuild: true, inspectedAt: '2026-08-11T02:00:00.000Z', targetHash: '', signature: '' },
    };
  });
  const receipt = {
    schema: 'nexyfab.mechanical-manufacturing-validation.v3', releaseChannel: 'mechanical-core', generatedAt: '2026-08-11T03:00:00.000Z', evidenceRootId: hash('pilot-root'), ok: true,
    summary: { cases: 3, passed: 3, failed: 0, pending: 0, measurements: 9 }, cases,
  };
  for (const item of cases) {
    item.inspector.targetHash = mechanicalManufacturingCaseTargetHash(receipt, item);
    const privateKey = item.inspector.reviewerId === 'inspector-a' ? inspectorA.privateKey : inspectorB.privateKey;
    item.inspector.signature = sign(null, Buffer.from(mechanicalManufacturingInspectorPayload(receipt, item, item.inspector)), privateKey).toString('base64');
  }
  const options = { evidenceRoot, trustedInspectors, now: Date.parse('2026-08-11T04:00:00.000Z') };
  assert.equal(validateMechanicalManufacturingReceipt(receipt, options), true);
  assert.equal(validateMechanicalManufacturingReceipt({ ...receipt, cases: cases.slice(0, 2), summary: { ...receipt.summary, cases: 2, passed: 2, measurements: 6 } }, options), false);
  const tampered = structuredClone(receipt);
  tampered.cases[0].measurements[0].actual = 99;
  assert.equal(validateMechanicalManufacturingReceipt(tampered, options), false);
  fs.writeFileSync(path.join(evidenceRoot, 'pilot-1', 'step.step'), 'tampered');
  assert.equal(validateMechanicalManufacturingReceipt(receipt, options), false);
});
