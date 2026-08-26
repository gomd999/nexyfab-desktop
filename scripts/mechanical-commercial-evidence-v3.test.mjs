import assert from 'node:assert/strict';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessMechanicalDesignCampaign,
  blindChallengeReviewPayload,
  blindChallengeTargetHash,
  mechanicalDesignVerificationPayload,
  validateMechanicalDesignVerificationReceipt,
  validateMechanicalBlindChallenge,
} from './mechanical-commercial-evidence-v3.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const verifierKeys = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [role, generateKeyPairSync('ed25519')]));
const trustedDesignVerifiers = Object.fromEntries(['step', 'drawing', 'bom'].map(role => [`${role}-verifier`, {
  publicKey: verifierKeys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  roles: [`mechanical-${role}-verifier`],
}]));

function signDesignVerificationReceipt(receipt) {
  for (const role of ['step', 'drawing', 'bom']) {
    receipt.artifacts[role].signature = sign(
      null,
      Buffer.from(mechanicalDesignVerificationPayload(receipt, role)),
      verifierKeys[role].privateKey,
    ).toString('base64');
  }
  return receipt;
}

function writeArtifact(root, relative, bytes) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
  return { path: relative, sha256: hash(bytes) };
}

const familyFor = index => index < 12
  ? 'machined'
  : index < 20
    ? 'sheet_metal'
    : index < 25
      ? 'rotational_sweep_loft'
      : 'pattern_multibody_boolean';

function designCampaign(root, passedCount) {
  const cases = Array.from({ length: 30 }, (_, index) => {
    const caseId = `design-${String(index + 1).padStart(2, '0')}`;
    const base = `${caseId}`;
    const common = {
      caseId,
      family: familyFor(index),
      primaryFeature: `feature-${String(index + 1).padStart(2, '0')}`,
      status: index < passedCount ? 'pass' : 'pending',
    };
    if (index >= passedCount) return common;
    const designRevisionSha256 = hash(`revision-${index}`);
    const requirements = writeArtifact(root, `${base}/requirements.md`, `requirements-${index}`);
    const nfab = writeArtifact(root, `${base}/design.nfab`, `nfab-${index}`);
    const step = writeArtifact(root, `${base}/design.step`, `step-${index}`);
    const drawing = writeArtifact(root, `${base}/drawing.pdf`, `drawing-${index}`);
    const bom = writeArtifact(root, `${base}/bom.csv`, `bom-${index}`);
    const intentValue = {
      schema: 'nexyfab.mechanical-intent-case-evaluation.v1',
      caseId,
      designRevisionSha256,
      entries: [
        ['ko_practical', 'executed'],
        ['en_practical', 'executed'],
        ['mixed_units', 'executed'],
        ['missing_required', 'clarified'],
        ['contradictory_or_unmanufacturable', 'rejected'],
      ].map(([category, outcome]) => ({
        category,
        outcome,
        falseVerified: false,
        verified: outcome === 'executed',
        stages: outcome === 'executed'
          ? { parse: 'pass', requirements: 'pass', plan: 'pass', geometry: 'pass', verification: 'pass' }
          : { parse: 'pass', requirements: 'rejected', plan: 'not_run', geometry: 'not_run', verification: 'not_run' },
      })),
    };
    const intentEvaluation = writeArtifact(root, `${base}/intent.json`, `${JSON.stringify(intentValue)}\n`);
    const verificationReceiptValue = signDesignVerificationReceipt({
      schema: 'nexyfab.mechanical-design-case-verification.v1',
      caseId,
      designRevisionSha256,
      requirementsSha256: requirements.sha256,
      status: 'PASS',
      claimBoundary: { actualManufacturingEvidence: 'NOT_RUN', actualInspectionEvidence: 'NOT_RUN', releaseEligible: false },
      artifacts: {
        step: { status: 'PASS', sha256: step.sha256, evidenceSha256: hash(`step-evidence-${index}`), verifierId: 'step-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-11T02:00:00.000Z' },
        drawing: { status: 'PASS', sha256: drawing.sha256, evidenceSha256: hash(`drawing-evidence-${index}`), verifierId: 'drawing-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-11T02:00:00.000Z' },
        bom: { status: 'PASS', sha256: bom.sha256, evidenceSha256: hash(`bom-evidence-${index}`), verifierId: 'bom-verifier', verifierVersion: '1.0.0', verifiedAt: '2026-08-11T02:00:00.000Z' },
      },
    });
    const verificationReceipt = writeArtifact(root, `${base}/verification.json`, `${JSON.stringify(verificationReceiptValue)}\n`);
    const artifactsWithoutManifest = { requirements, nfab, step, drawing, bom, intentEvaluation, verificationReceipt };
    const manifestValue = {
      schema: 'nexyfab.mechanical-design-case-manifest.v1',
      caseId,
      designRevisionSha256,
      requirementsSha256: requirements.sha256,
      artifacts: Object.fromEntries(Object.entries(artifactsWithoutManifest).map(([role, binding]) => [role, binding.sha256])),
    };
    const manifest = writeArtifact(root, `${base}/manifest.json`, `${JSON.stringify(manifestValue)}\n`);
    return {
      ...common,
      designRevisionSha256,
      requirementsSha256: requirements.sha256,
      cycles: { nfab: 3, step: 3 },
      checks: {
        kernelValid: true,
        nonEmpty: true,
        stableFeatureIds: true,
        lockedDimensionsPreserved: true,
        nfabThreeCycles: true,
        stepThreeCycles: true,
        drawingReleased: true,
        bomReconciled: true,
        revisionBound: true,
      },
      artifacts: { ...artifactsWithoutManifest, manifest },
    };
  });
  return {
    schema: 'nexyfab.mechanical-direct-design-campaign.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('design-root'),
    generatedAt: '2026-08-11T03:00:00.000Z',
    ok: passedCount === 30,
    cases,
    summary: { cases: 30, passed: passedCount, pending: 30 - passedCount, failed: 0, intents: passedCount * 5, falseVerified: 0 },
  };
}

test('separates ten-case candidate readiness from the full 30-case and 150-intent contract', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-design-campaign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = assessMechanicalDesignCampaign(designCampaign(root, 10), {
    evidenceRoot: root,
    trustedDesignVerifiers,
    now: Date.parse('2026-08-11T04:00:00.000Z'),
  });
  assert.equal(candidate.candidateVerified, true);
  assert.equal(candidate.completeVerified, false);
  assert.equal(candidate.passedCases, 10);
  assert.equal(candidate.intents, 50);
});

test('verifies 30 distinct byte-bound design packages and fails after byte drift', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-design-campaign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = designCampaign(root, 30);
  const options = { evidenceRoot: root, trustedDesignVerifiers, now: Date.parse('2026-08-11T04:00:00.000Z') };
  const complete = assessMechanicalDesignCampaign(receipt, options);
  assert.equal(complete.completeVerified, true);
  assert.equal(complete.standardStepConformanceVerified, true);
  assert.equal(complete.intents, 150);
  const withoutVerifierReceipt = structuredClone(receipt);
  withoutVerifierReceipt.cases[0].artifacts.verificationReceipt = undefined;
  assert.equal(assessMechanicalDesignCampaign(withoutVerifierReceipt, options).completeVerified, false);
  fs.writeFileSync(path.join(root, 'design-01', 'design.step'), 'tampered');
  assert.equal(assessMechanicalDesignCampaign(receipt, options).completeVerified, false);
});

test('rejects self-attested, role-reused, future-dated, or release-claiming design verification receipts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-design-verifier-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const campaign = designCampaign(root, 1);
  const item = campaign.cases[0];
  const verification = JSON.parse(fs.readFileSync(path.join(root, item.artifacts.verificationReceipt.path), 'utf8'));
  const now = Date.parse('2026-08-11T04:00:00.000Z');
  assert.equal(validateMechanicalDesignVerificationReceipt(verification, item, trustedDesignVerifiers, now), true);

  const selfAttested = structuredClone(verification);
  selfAttested.artifacts.step.verifierId = 'arbitrary-parser';
  assert.equal(validateMechanicalDesignVerificationReceipt(selfAttested, item, trustedDesignVerifiers, now), false);

  const roleReused = structuredClone(verification);
  roleReused.artifacts.drawing.verifierId = roleReused.artifacts.step.verifierId;
  assert.equal(validateMechanicalDesignVerificationReceipt(roleReused, item, trustedDesignVerifiers, now), false);

  const futureDated = structuredClone(verification);
  futureDated.artifacts.step.verifiedAt = '2026-08-12T00:00:00.000Z';
  assert.equal(validateMechanicalDesignVerificationReceipt(futureDated, item, trustedDesignVerifiers, now), false);

  const releaseClaiming = structuredClone(verification);
  releaseClaiming.claimBoundary.releaseEligible = true;
  assert.equal(validateMechanicalDesignVerificationReceipt(releaseClaiming, item, trustedDesignVerifiers, now), false);
});

test('requires 20 locked blind challenges with role-separated signed review', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-blind-campaign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reviewerA = generateKeyPairSync('ed25519');
  const reviewerB = generateKeyPairSync('ed25519');
  const trustedReviewers = {
    'reviewer-a': { publicKey: reviewerA.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['mechanical-blind-reviewer'] },
    'reviewer-b': { publicKey: reviewerB.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: ['mechanical-blind-reviewer'] },
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
      requirements: writeArtifact(root, `challenge-${index + 1}/requirements.md`, `blind-requirements-${index}`),
      releasePackage: writeArtifact(root, `challenge-${index + 1}/release.zip`, `release-package-${index}`),
    },
    targetHash: '',
    reviews: [],
  }));
  const receipt = {
    schema: 'nexyfab.mechanical-blind-product-challenge.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('blind-root'),
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
      const privateKey = reviewerId === 'reviewer-a' ? reviewerA.privateKey : reviewerB.privateKey;
      review.signature = sign(null, Buffer.from(blindChallengeReviewPayload(receipt, item, review)), privateKey).toString('base64');
      return review;
    });
  }
  const options = { evidenceRoot: root, trustedReviewers, now: Date.parse('2026-08-11T05:00:00.000Z') };
  assert.equal(validateMechanicalBlindChallenge(receipt, options), true);
  const conflicting = structuredClone(receipt);
  conflicting.cases[0].reviews = conflicting.cases[0].reviews.slice(0, 1);
  assert.equal(validateMechanicalBlindChallenge(conflicting, options), false);
  const extraReceiptClaim = structuredClone(receipt);
  extraReceiptClaim.commercialRelease = true;
  assert.equal(validateMechanicalBlindChallenge(extraReceiptClaim, options), false);
  const extraCaseClaim = structuredClone(receipt);
  extraCaseClaim.cases[0].releaseApproved = true;
  assert.equal(validateMechanicalBlindChallenge(extraCaseClaim, options), false);
  const invalidExtraReview = structuredClone(receipt);
  invalidExtraReview.cases[5].reviews.push({
    reviewerId: 'reviewer-b', decision: 'approved', independentFromBuild: true,
    targetHash: invalidExtraReview.cases[5].targetHash,
    reviewedAt: '2026-08-11T03:00:00.000Z', signature: 'forged',
  });
  assert.equal(validateMechanicalBlindChallenge(invalidExtraReview, options), false);
  const impossibleSummary = structuredClone(receipt);
  impossibleSummary.summary.highRisk = 999;
  assert.equal(validateMechanicalBlindChallenge(impossibleSummary, options), false);
  const generatedBeforeReview = structuredClone(receipt);
  generatedBeforeReview.generatedAt = '2026-08-11T02:30:00.000Z';
  assert.equal(validateMechanicalBlindChallenge(generatedBeforeReview, options), false);
  fs.writeFileSync(path.join(root, 'challenge-1', 'release.zip'), 'tampered');
  assert.equal(validateMechanicalBlindChallenge(receipt, options), false);
});
