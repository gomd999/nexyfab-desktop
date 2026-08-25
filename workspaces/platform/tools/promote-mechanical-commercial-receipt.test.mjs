import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  blindChallengeReviewPayload,
  blindChallengeTargetHash,
  validateMechanicalBlindChallenge,
} from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import {
  mechanicalManufacturingCaseTargetHash,
  mechanicalManufacturingInspectorPayload,
} from '../../../scripts/build-mechanical-product-scope-assessment.mjs';
import { promoteMechanicalCommercialReceipt } from './promote-mechanical-commercial-receipt.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function writeArtifact(root, relative, bytes) {
  const value = Buffer.from(bytes);
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, value);
  return { path: relative, sha256: hash(value) };
}

function blindFixture(root) {
  const reviewerA = generateKeyPairSync('ed25519');
  const reviewerB = generateKeyPairSync('ed25519');
  const trustedReviewers = {
    'reviewer-a': {
      publicKey: reviewerA.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      roles: ['mechanical-blind-reviewer'],
    },
    'reviewer-b': {
      publicKey: reviewerB.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      roles: ['mechanical-blind-reviewer'],
    },
  };
  const cases = Array.from({ length: 20 }, (_, index) => ({
    challengeId: `challenge-${index + 1}`,
    risk: index < 5 ? 'high' : 'standard',
    status: 'pass',
    internalRoleSeparated: true,
    builderId: 'builder',
    requirementsLockedAt: '2026-08-11T00:00:00.000Z',
    startedAt: '2026-08-11T01:00:00.000Z',
    completedAt: '2026-08-11T02:00:00.000Z',
    designRevisionSha256: hash(`blind-revision-${index}`),
    artifacts: {
      requirements: writeArtifact(root, `challenge-${index + 1}/requirements.md`, `requirements-${index}`),
      releasePackage: writeArtifact(root, `challenge-${index + 1}/release.zip`, `release-${index}`),
    },
    targetHash: '',
    reviews: [],
  }));
  const receipt = {
    schema: 'nexyfab.mechanical-blind-product-challenge.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('blind-promotion-root'),
    generatedAt: '2026-08-11T04:00:00.000Z',
    ok: true,
    cases,
    summary: { cases: 20, passed: 20, pending: 0, failed: 0, highRisk: 5, falseVerified: 0 },
  };
  for (const item of cases) {
    item.targetHash = blindChallengeTargetHash(receipt, item);
    const reviewerIds = item.risk === 'high' ? ['reviewer-a', 'reviewer-b'] : ['reviewer-a'];
    item.reviews = reviewerIds.map(reviewerId => {
      const review = {
        reviewerId,
        decision: 'approved',
        independentFromBuild: true,
        targetHash: item.targetHash,
        reviewedAt: '2026-08-11T03:00:00.000Z',
        signature: '',
      };
      const key = reviewerId === 'reviewer-a' ? reviewerA.privateKey : reviewerB.privateKey;
      review.signature = sign(null, Buffer.from(blindChallengeReviewPayload(receipt, item, review)), key).toString('base64');
      return review;
    });
  }
  const candidatePath = path.join(root, 'blind-candidate.json');
  fs.writeFileSync(candidatePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, candidatePath, trustedReviewers };
}

function manufacturingFixture(root) {
  const processes = ['cnc_machining', 'sheet_metal', 'additive_manufacturing'];
  const extensions = {
    nfab: '.nfab', step: '.step', drawing: '.pdf', bom: '.csv',
    manufacturingReceipt: '.pdf', inspectionReport: '.json', photoEvidence: '.jpg',
  };
  const inspectorA = generateKeyPairSync('ed25519');
  const inspectorB = generateKeyPairSync('ed25519');
  const trustedInspectors = {
    'inspector-a': {
      publicKey: inspectorA.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      roles: ['manufacturing-inspector'],
    },
    'inspector-b': {
      publicKey: inspectorB.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      roles: ['manufacturing-inspector'],
    },
  };
  const cases = processes.map((process, index) => ({
    caseId: `pilot-${index + 1}`,
    process,
    result: 'pass',
    designRevision: hash(`pilot-revision-${index}`),
    noUnapprovedCadChanges: true,
    stepRoundtripVerified: true,
    drawingReleased: true,
    bomReconciled: true,
    inspectionDisposition: 'accepted',
    artifacts: Object.fromEntries(Object.entries(extensions).map(([role, extension]) => [
      role,
      writeArtifact(root, `pilot-${index + 1}/${role}${extension}`, `${role}-${index}`),
    ])),
    manufacturer: {
      facilityId: index === 1 ? 'facility-b' : 'facility-a',
      independentFromNexyfab: true,
      completedAt: '2026-08-11T01:00:00.000Z',
    },
    measurements: Array.from({ length: 3 }, (_, measurement) => ({
      characteristic: `dim-${measurement}`, nominal: 10, actual: 10.01,
      minusTolerance: 0.05, plusTolerance: 0.05, unit: 'mm', result: 'pass',
    })),
    inspector: {
      reviewerId: index === 1 ? 'inspector-b' : 'inspector-a',
      independentFromBuild: true,
      inspectedAt: '2026-08-11T02:00:00.000Z',
      targetHash: '',
      signature: '',
    },
  }));
  const receipt = {
    schema: 'nexyfab.mechanical-manufacturing-validation.v3',
    releaseChannel: 'mechanical-core',
    generatedAt: '2026-08-11T03:00:00.000Z',
    evidenceRootId: hash('manufacturing-promotion-root'),
    ok: true,
    summary: { cases: 3, passed: 3, failed: 0, pending: 0, measurements: 9 },
    cases,
  };
  for (const item of cases) {
    item.inspector.targetHash = mechanicalManufacturingCaseTargetHash(receipt, item);
    const key = item.inspector.reviewerId === 'inspector-a' ? inspectorA.privateKey : inspectorB.privateKey;
    item.inspector.signature = sign(
      null,
      Buffer.from(mechanicalManufacturingInspectorPayload(receipt, item, item.inspector)),
      key,
    ).toString('base64');
  }
  const candidatePath = path.join(root, 'manufacturing-candidate.json');
  fs.writeFileSync(candidatePath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, candidatePath, trustedInspectors };
}

test('promotes an exact signed blind receipt without modifying source evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-blind-promotion-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-blind-output-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
  const fixture = blindFixture(root);
  const sourceBefore = fs.readFileSync(fixture.candidatePath);
  const outputPath = path.join(outputRoot, 'validated-blind.json');
  const result = promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: fixture.candidatePath, evidenceRoot: root,
    outputPath, trustedBlindReviewers: fixture.trustedReviewers,
    now: Date.parse('2026-08-11T05:00:00.000Z'),
  });
  assert.equal(result.valid, true);
  assert.equal(result.promoted, true);
  assert.equal(fs.existsSync(outputPath), true);
  assert.deepEqual(fs.readFileSync(fixture.candidatePath), sourceBefore);
  assert.equal(validateMechanicalBlindChallenge(JSON.parse(fs.readFileSync(outputPath, 'utf8')), {
    evidenceRoot: root,
    trustedReviewers: fixture.trustedReviewers,
    now: Date.parse('2026-08-11T05:00:00.000Z'),
  }), true);
  assert.throws(() => promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: fixture.candidatePath, evidenceRoot: root,
    outputPath, trustedBlindReviewers: fixture.trustedReviewers,
    now: Date.parse('2026-08-11T05:00:00.000Z'),
  }), /OUTPUT_ALREADY_EXISTS/);
});

test('invalid or outside-root blind candidates never create promotion output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-blind-invalid-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-blind-invalid-output-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
  const fixture = blindFixture(root);
  const invalid = structuredClone(fixture.receipt); invalid.commercialRelease = true;
  fs.writeFileSync(fixture.candidatePath, JSON.stringify(invalid));
  const outputPath = path.join(outputRoot, 'must-not-exist.json');
  const result = promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: fixture.candidatePath, evidenceRoot: root,
    outputPath, trustedBlindReviewers: fixture.trustedReviewers,
    now: Date.parse('2026-08-11T05:00:00.000Z'),
  });
  assert.equal(result.valid, false);
  assert.equal(result.promoted, false);
  assert.deepEqual(result.blockers, ['candidate_receipt_invalid']);
  assert.equal(fs.existsSync(outputPath), false);
  const outside = path.join(outputRoot, 'outside-candidate.json'); fs.writeFileSync(outside, '{}');
  assert.throws(() => promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: outside, evidenceRoot: root,
    trustedBlindReviewers: fixture.trustedReviewers,
  }), /CANDIDATE_OUTSIDE_ROOT/);
});

test('manufacturing promotion checks exact artifacts and supports read-only verification', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-manufacturing-promotion-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-manufacturing-output-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
  const fixture = manufacturingFixture(root);
  const check = promoteMechanicalCommercialReceipt({
    kind: 'manufacturing', candidatePath: fixture.candidatePath, evidenceRoot: root,
    trustedManufacturingInspectors: fixture.trustedInspectors,
    now: Date.parse('2026-08-11T04:00:00.000Z'),
  });
  assert.equal(check.valid, true);
  assert.equal(check.promoted, false);
  assert.equal(check.output, null);
  const promotedPath = path.join(outputRoot, 'validated-manufacturing.json');
  const promoted = promoteMechanicalCommercialReceipt({
    kind: 'manufacturing', candidatePath: fixture.candidatePath, evidenceRoot: root,
    outputPath: promotedPath, trustedManufacturingInspectors: fixture.trustedInspectors,
    now: Date.parse('2026-08-11T04:00:00.000Z'),
  });
  assert.equal(promoted.valid, true);
  assert.equal(promoted.promoted, true);
  assert.equal(fs.existsSync(promotedPath), true);
  fs.writeFileSync(path.join(root, 'pilot-1', 'step.step'), 'tampered');
  const outputPath = path.join(outputRoot, 'must-not-exist.json');
  const drifted = promoteMechanicalCommercialReceipt({
    kind: 'manufacturing', candidatePath: fixture.candidatePath, evidenceRoot: root,
    outputPath, trustedManufacturingInspectors: fixture.trustedInspectors,
    now: Date.parse('2026-08-11T04:00:00.000Z'),
  });
  assert.equal(drifted.valid, false);
  assert.equal(drifted.promoted, false);
  assert.equal(fs.existsSync(outputPath), false);
});

test('candidate symlinks fail closed before validation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-symlink-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target.json'); fs.writeFileSync(target, '{}');
  const link = path.join(root, 'candidate-link.json');
  try {
    fs.symlinkSync(target, link, 'file');
  } catch (error) {
    if (error?.code === 'EPERM') return;
    throw error;
  }
  assert.throws(() => promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: link, evidenceRoot: root,
  }), /CANDIDATE_NOT_SAFE_FILE/);
});

test('CLI returns zero for read-only validation and four without output for invalid evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-cli-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-promotion-cli-output-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
  const fixture = blindFixture(root);
  const toolPath = fileURLToPath(new URL('./promote-mechanical-commercial-receipt.mjs', import.meta.url));
  const env = { ...process.env, NEXYFAB_BLIND_REVIEWER_KEYS: JSON.stringify(fixture.trustedReviewers) };
  const check = spawnSync(process.execPath, [
    toolPath,
    '--kind=blind',
    `--candidate=${fixture.candidatePath}`,
    `--evidence-root=${root}`,
    '--check',
  ], { encoding: 'utf8', env });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).valid, true);
  const invalid = structuredClone(fixture.receipt); invalid.commercialRelease = true;
  fs.writeFileSync(fixture.candidatePath, JSON.stringify(invalid));
  const outputPath = path.join(outputRoot, 'must-not-exist.json');
  const rejected = spawnSync(process.execPath, [
    toolPath,
    '--kind=blind',
    `--candidate=${fixture.candidatePath}`,
    `--evidence-root=${root}`,
    `--output=${outputPath}`,
  ], { encoding: 'utf8', env });
  assert.equal(rejected.status, 4, rejected.stderr);
  assert.deepEqual(JSON.parse(rejected.stdout).blockers, ['candidate_receipt_invalid']);
  assert.equal(fs.existsSync(outputPath), false);
});
