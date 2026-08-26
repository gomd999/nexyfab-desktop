import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildMechanicalProductScopeAssessment,
  checkOrWriteMechanicalProductScopeAssessment,
  mechanicalManufacturingCaseTargetHash,
  mechanicalManufacturingInspectorPayload,
  validateMechanicalDualExpertReview,
  validateMechanicalManufacturingReceipt,
} from './build-mechanical-product-scope-assessment.mjs';
import { TEXT_BINDING_CANONICALIZATION, canonicalTextBinding } from './canonical-text-binding.mjs';
import { EVIDENCE_BINDING_ROOTS } from './run-mechanical-core-internal-verification.mjs';

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
  const evidenceBindings = EVIDENCE_BINDING_ROOTS.map((evidenceRoot, index) => {
    const relative = `${evidenceRoot}/fixture-${index + 1}.json`;
    const absolute = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `{"fixture":${index + 1}}\n`);
    return { path: relative, ...canonicalTextBinding(`{"fixture":${index + 1}}\n`) };
  });
  writeJson(root, paths.internalVerification, {
    schema: 'nexyfab.mechanical-core-internal-verification.v1',
    generatedAt: '2026-08-11T01:00:00.000Z',
    ok: true,
    bindingPolicy: { text: TEXT_BINDING_CANONICALIZATION, binary: 'raw', evidenceRoots: [...EVIDENCE_BINDING_ROOTS] },
    checks: {
      losslessDesignGraph: true, coreThirtyImplementationCoverage: true, threeCycleNfab: true,
      threeCycleStep: true, mechanicalAccuracy: true, intentIntakeQualification: true,
      intentExactRuntimeRepresentative: true, assemblyDrawingHandoffLocalReadiness: true, typecheck: true,
    },
    commands: [
      { name: 'direct-cad', exitCode: 0, environment: { RUN_OCCT_FEASIBILITY: '1' } },
      { name: 'mechanical-accuracy', exitCode: 0, environment: {} },
      { name: 'intent-qualification', exitCode: 0, environment: {} },
      { name: 'intent-runtime', exitCode: 0, environment: {} },
      { name: 'assembly-handoff-readiness', exitCode: 0, environment: {} },
      { name: 'typecheck', exitCode: 0, environment: {} },
    ],
    sourceBindings: [{ path: sourcePath, ...canonicalTextBinding('export const bound = true;\n') }, ...evidenceBindings],
  });
  return { root, paths };
}

test('reports internal CAD verification separately from missing direct product evidence', t => {
  const fixture = fixtureRoot();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = buildMechanicalProductScopeAssessment(fixture.root, fixture.paths);
  assert.equal(result.evidence.artifactRevisionConsistencyVerified, true);
  assert.equal(result.evidence.internalRegressionVerified, true);
  assert.equal(result.evidence.intentQualification150Verified, true);
  assert.equal(result.evidence.intentRuntimeRepresentativeVerified, true);
  assert.equal(result.evidence.assemblyDrawingHandoffLocalVerified, true);
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

test('invalidates every internal stage when checked intent evidence bytes drift', t => {
  const fixture = fixtureRoot();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const evidenceFile = path.join(fixture.root, ...EVIDENCE_BINDING_ROOTS[0].split('/'), 'fixture-1.json');
  fs.appendFileSync(evidenceFile, 'tampered\n');
  const result = buildMechanicalProductScopeAssessment(fixture.root, fixture.paths);
  assert.equal(result.evidence.internalRegressionVerified, false);
  assert.equal(result.evidence.intentQualification150Verified, false);
  assert.equal(result.evidence.intentRuntimeRepresentativeVerified, false);
  assert.equal(result.evidence.assemblyDrawingHandoffLocalVerified, false);
});

test('published scope schema matches the emitted v4 evidence hierarchy', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../docs/process/mechanical-product-scope-assessment.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schema.const, 'nexyfab.mechanical-product-scope-assessment.v4');
  for (const key of ['intentQualification150Verified', 'intentRuntimeRepresentativeVerified', 'assemblyDrawingHandoffLocalVerified']) {
    assert.equal(schema.properties.evidence.required.includes(key), true);
    assert.deepEqual(schema.properties.evidence.properties[key], { type: 'boolean' });
  }
  assert.equal(schema.properties.sources.items.required.includes('canonicalization'), true);
});

test('accepts the same emitted scope receipt through an LF or CRLF checkout', t => {
  const fixture = fixtureRoot();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const written = checkOrWriteMechanicalProductScopeAssessment({ root: fixture.root, write: true, paths: fixture.paths });
  assert.equal(written.ok, true);
  const output = path.join(fixture.root, ...fixture.paths.output.split('/'));
  fs.writeFileSync(output, fs.readFileSync(output, 'utf8').replaceAll('\n', '\r\n'));
  const checked = checkOrWriteMechanicalProductScopeAssessment({ root: fixture.root, write: false, paths: fixture.paths });
  assert.equal(checked.ok, true);
  assert.equal(checked.error, null);
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
  const extraReceiptClaim = structuredClone(receipt);
  extraReceiptClaim.commercialRelease = true;
  assert.equal(validateMechanicalManufacturingReceipt(extraReceiptClaim, options), false);
  const extraArtifactClaim = structuredClone(receipt);
  extraArtifactClaim.cases[0].artifacts.certificate = extraArtifactClaim.cases[0].artifacts.inspectionReport;
  assert.equal(validateMechanicalManufacturingReceipt(extraArtifactClaim, options), false);
  const extraMeasurementClaim = structuredClone(receipt);
  extraMeasurementClaim.cases[0].measurements[0].calibrationAssumed = true;
  assert.equal(validateMechanicalManufacturingReceipt(extraMeasurementClaim, options), false);
  const extraInspectorClaim = structuredClone(receipt);
  extraInspectorClaim.cases[0].inspector.releaseAuthority = true;
  assert.equal(validateMechanicalManufacturingReceipt(extraInspectorClaim, options), false);
  const generatedBeforeInspection = structuredClone(receipt);
  generatedBeforeInspection.generatedAt = '2026-08-11T01:30:00.000Z';
  assert.equal(validateMechanicalManufacturingReceipt(generatedBeforeInspection, options), false);
  const tampered = structuredClone(receipt);
  tampered.cases[0].measurements[0].actual = 99;
  assert.equal(validateMechanicalManufacturingReceipt(tampered, options), false);
  fs.writeFileSync(path.join(evidenceRoot, 'pilot-1', 'step.step'), 'tampered');
  assert.equal(validateMechanicalManufacturingReceipt(receipt, options), false);
});
