import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SPECIALTY_RELEASE_REVIEW_ROLES,
  attachSpecialtyIndependentReleaseReceiptSha256,
  specialtyIndependentReleaseSha256,
  specialtyIndependentReleaseTargetSha256,
  specialtyIndependentReviewerPayload,
  verifySpecialtyIndependentReleaseReceipt,
} from './verify-specialty-independent-release-receipt.mjs';

const NOW = '2026-08-23T12:00:00.000Z';
const GENERATED = '2026-08-23T00:00:00.000Z';
const EXPIRES = '2026-08-24T00:00:00.000Z';
const GIT_HEAD = 'a'.repeat(40);
const RELEASE = { buildId: 'build-specialty-fixture', deploymentId: 'deployment-specialty-fixture', gitHead: GIT_HEAD };

function qualificationFor(channel, overrides = {}) {
  const track = channel === 'verified-sheet-metal'
    ? 'sheet-metal'
    : channel === 'verified-welded-fabrication'
      ? 'welded-fabrication'
      : channel === 'verified-mold-tooling'
        ? 'mold-tooling'
        : channel === 'verified-ecad-mcad'
          ? 'ecad_mcad'
          : channel.replace('verified-', '');
  if (['sheet-metal', 'welded-fabrication', 'mold-tooling'].includes(track)) {
    return {
      schema: 'nexyfab.specialty-manufacturing-qualification.v1',
      track,
      status: 'QUALIFIED',
      releaseReady: true,
      targetSha256: 'b'.repeat(64),
      contract: { valid: true, issues: [] },
      readback: { valid: true, issues: [] },
      externalAxes: { valid: true, required: ['axis'], present: ['axis'], missing: [], issues: [] },
      reviewers: {
        independent_parser_cad_reviewer: { valid: true },
        manufacturing_reviewer: { valid: true },
      },
      blockers: [],
      ...overrides,
    };
  }
  if (['piping', 'hvac'].includes(track)) {
    return {
      schema: 'nexyfab.mep-fabrication-qualification.v1',
      track,
      status: 'QUALIFIED',
      qualified: true,
      targetHash: 'b'.repeat(64),
      revision: 4,
      internalValidation: { valid: true, issues: [] },
      internalReadback: { valid: true, issues: [] },
      independentAttestation: { valid: true, issues: [], roles: SPECIALTY_RELEASE_REVIEW_ROLES },
      evidence: { valid: true, issues: [], axes: ['axis'] },
      blockers: [],
      ...overrides,
    };
  }
  return {
    schema: 'nexyfab.ecad-mcad-commercial-evidence.v1',
    track,
    status: 'QUALIFIED',
    qualified: true,
    targetHash: 'b'.repeat(64),
    revision: 4,
    buildId: RELEASE.buildId,
    internalValidation: { valid: true, issues: [] },
    internalReadback: { valid: true, issues: [] },
    artifacts: { valid: true, issues: [] },
    nativeParsers: { valid: true, issues: [] },
    reviewers: { valid: true, issues: [] },
    evidence: { valid: true, issues: [] },
    blockers: [],
    ...overrides,
  };
}

function writeFile(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, value);
  return absolute;
}

function reviewerKey(role, index) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKey: pair.privateKey,
    publicKeyPem,
    keyIdSha256: specialtyIndependentReleaseSha256(pair.publicKey.export({ type: 'spki', format: 'der' })),
    reviewerId: `${role}-${index}`,
  };
}

function makeFixture(channel, qualificationOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-specialty-receipt-'));
  const qualification = qualificationFor(channel, qualificationOverrides);
  const qualificationPath = 'qualification.json';
  const qualificationBytes = Buffer.from(`${JSON.stringify(qualification, null, 2)}\n`);
  writeFile(root, qualificationPath, qualificationBytes);
  const evidenceValues = [Buffer.from('independent evidence bytes\n'), Buffer.from('manufacturing evidence bytes\n')];
  const evidenceArtifacts = evidenceValues.map((bytes, index) => {
    const relativePath = `evidence/evidence-${index + 1}.bin`;
    writeFile(root, relativePath, bytes);
    return {
      artifactId: `evidence-${index + 1}`,
      kind: index === 0 ? 'independent_review' : 'manufacturing_receipt',
      relativePath,
      bytes: bytes.byteLength,
      sha256: specialtyIndependentReleaseSha256(bytes),
    };
  });
  const receipt = {
    schema: 'nexyfab.specialty-independent-release-receipt.v1',
    channel,
    track: qualification.track,
    release: { ...RELEASE },
    generatedAt: GENERATED,
    expiresAt: EXPIRES,
    qualificationArtifact: {
      relativePath: qualificationPath,
      bytes: qualificationBytes.byteLength,
      sha256: specialtyIndependentReleaseSha256(qualificationBytes),
    },
    evidenceArtifacts,
    reviewers: [],
  };
  const reviewerKeys = SPECIALTY_RELEASE_REVIEW_ROLES.map((role, index) => reviewerKey(role, index + 1));
  const targetSha256 = specialtyIndependentReleaseTargetSha256(receipt);
  receipt.reviewers = reviewerKeys.map((key, index) => {
    const reviewer = {
      role: SPECIALTY_RELEASE_REVIEW_ROLES[index],
      reviewerId: key.reviewerId,
      publicKeyPem: key.publicKeyPem,
      keyIdSha256: key.keyIdSha256,
      issuedAt: '2026-08-22T23:00:00.000Z',
      expiresAt: EXPIRES,
      targetSha256,
    };
    reviewer.signatureBase64 = crypto.sign(
      null,
      Buffer.from(canonicalForTest(specialtyIndependentReviewerPayload(receipt, reviewer))),
      key.privateKey,
    ).toString('base64');
    return reviewer;
  });
  const complete = attachSpecialtyIndependentReleaseReceiptSha256(receipt);
  const trustedReviewers = Object.fromEntries(reviewerKeys.map((key, index) => [key.reviewerId, {
    publicKeyPem: key.publicKeyPem,
    roles: [SPECIALTY_RELEASE_REVIEW_ROLES[index]],
  }]));
  return { root, receipt: complete, trustedReviewers };
}

function canonicalForTest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalForTest(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('accepts all six independent channels across the three qualification schema families', () => {
  for (const channel of [
    'verified-sheet-metal', 'verified-welded-fabrication', 'verified-mold-tooling',
    'verified-piping', 'verified-hvac', 'verified-ecad-mcad',
  ]) {
    const fixture = makeFixture(channel);
    const result = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, {
      channel, ...RELEASE,
    }, fixture.trustedReviewers, NOW);
    assert.equal(result.ok, true, `${channel}: ${result.blockers.join(',')}`);
  }
});

test('rejects wrong track, schema, and self-asserted qualification booleans', () => {
  for (const [channel, mutation, expectedBlocker] of [
    ['verified-sheet-metal', { track: 'welded-fabrication' }, 'qualification_track_invalid'],
    ['verified-piping', { schema: 'nexyfab.specialty-manufacturing-qualification.v1' }, 'qualification_schema_invalid'],
    ['verified-hvac', { qualified: false }, 'qualification_qualified_invalid'],
  ]) {
    const fixture = makeFixture(channel, mutation);
    const result = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, { channel, ...RELEASE }, fixture.trustedReviewers, NOW);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes(expectedBlocker), result.blockers.join(','));
  }
});

test('rejects a piping qualification whose status contradicts qualified=true', () => {
  const fixture = makeFixture('verified-piping', { status: 'HOLD' });
  const result = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, { channel: 'verified-piping', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('qualification_status_or_blockers_invalid'), result.blockers.join(','));
});

test('rejects actual artifact tampering and traversal before trusting qualification fields', () => {
  const fixture = makeFixture('verified-sheet-metal');
  writeFile(fixture.root, 'evidence/evidence-1.bin', Buffer.alloc(fixture.receipt.evidenceArtifacts[0].bytes, 0x58));
  const tampered = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, { channel: 'verified-sheet-metal', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.blockers.includes('evidence_artifact_sha256_mismatch'));

  const traversal = structuredClone(fixture.receipt);
  traversal.qualificationArtifact.relativePath = '../qualification.json';
  const escaped = verifySpecialtyIndependentReleaseReceipt(traversal, fixture.root, { channel: 'verified-sheet-metal', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(escaped.ok, false);
  assert.ok(escaped.blockers.includes('qualification_artifact_path_invalid'));
});

test('rejects duplicate IDs, paths, and hashes', () => {
  const fixture = makeFixture('verified-piping');
  for (const [mutation, expectedBlocker] of [
    [receipt => { receipt.evidenceArtifacts[1].artifactId = receipt.evidenceArtifacts[0].artifactId; }, 'artifact_id_duplicate'],
    [receipt => { receipt.evidenceArtifacts[1].relativePath = receipt.evidenceArtifacts[0].relativePath; }, 'artifact_path_duplicate'],
    [receipt => { receipt.evidenceArtifacts[1].sha256 = receipt.evidenceArtifacts[0].sha256; }, 'artifact_hash_duplicate'],
  ]) {
    const duplicate = structuredClone(fixture.receipt);
    mutation(duplicate);
    const result = verifySpecialtyIndependentReleaseReceipt(duplicate, fixture.root, { channel: 'verified-piping', ...RELEASE }, fixture.trustedReviewers, NOW);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes(expectedBlocker), result.blockers.join(','));
  }
});

test('rejects stale receipts and release transplantation', () => {
  const fixture = makeFixture('verified-mold-tooling');
  const stale = structuredClone(fixture.receipt);
  stale.generatedAt = '2026-01-01T00:00:00.000Z';
  const staleResult = verifySpecialtyIndependentReleaseReceipt(stale, fixture.root, { channel: 'verified-mold-tooling', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(staleResult.ok, false);
  assert.ok(staleResult.blockers.includes('receipt_freshness_invalid'));
  const transplanted = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, { channel: 'verified-mold-tooling', ...RELEASE, buildId: 'other-build' }, fixture.trustedReviewers, NOW);
  assert.equal(transplanted.ok, false);
  assert.ok(transplanted.blockers.includes('release_binding_invalid'));
});

test('rejects signature, key, role replay, target tamper, and receipt self-hash tamper', () => {
  const fixture = makeFixture('verified-ecad-mcad');
  const badSignature = structuredClone(fixture.receipt);
  badSignature.reviewers[0].signatureBase64 = fixture.receipt.reviewers[1].signatureBase64;
  const signatureResult = verifySpecialtyIndependentReleaseReceipt(badSignature, fixture.root, { channel: 'verified-ecad-mcad', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(signatureResult.ok, false);
  assert.ok(signatureResult.blockers.includes('reviewer_signature_invalid'));

  const badKey = structuredClone(fixture.receipt);
  badKey.reviewers[0].publicKeyPem = badKey.reviewers[1].publicKeyPem;
  const keyResult = verifySpecialtyIndependentReleaseReceipt(badKey, fixture.root, { channel: 'verified-ecad-mcad', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(keyResult.ok, false);
  assert.ok(keyResult.blockers.includes('reviewer_key_invalid_or_reused') || keyResult.blockers.includes('reviewer_not_trusted'));

  const badRole = structuredClone(fixture.receipt);
  badRole.reviewers[1].role = badRole.reviewers[0].role;
  const roleResult = verifySpecialtyIndependentReleaseReceipt(badRole, fixture.root, { channel: 'verified-ecad-mcad', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(roleResult.ok, false);
  assert.ok(roleResult.blockers.includes('reviewer_role_invalid'));

  const targetTamper = structuredClone(fixture.receipt);
  targetTamper.reviewers[0].targetSha256 = 'c'.repeat(64);
  const targetResult = verifySpecialtyIndependentReleaseReceipt(targetTamper, fixture.root, { channel: 'verified-ecad-mcad', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(targetResult.ok, false);
  assert.ok(targetResult.blockers.includes('target_binding_invalid') || targetResult.blockers.includes('reviewer_target_invalid'));

  const receiptTamper = structuredClone(fixture.receipt);
  receiptTamper.receiptSha256 = 'd'.repeat(64);
  const receiptResult = verifySpecialtyIndependentReleaseReceipt(receiptTamper, fixture.root, { channel: 'verified-ecad-mcad', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(receiptResult.ok, false);
  assert.ok(receiptResult.blockers.includes('receipt_sha256_invalid'));
});

test('rejects a symlinked artifact when the platform permits creating one', (t) => {
  const fixture = makeFixture('verified-sheet-metal');
  const target = path.join(fixture.root, 'evidence', 'evidence-1.bin');
  const moved = path.join(fixture.root, 'evidence', 'real-evidence.bin');
  fs.renameSync(target, moved);
  try {
    fs.symlinkSync('real-evidence.bin', target);
  } catch {
    t.skip('symlink creation is unavailable in this fixture environment');
    return;
  }
  const result = verifySpecialtyIndependentReleaseReceipt(fixture.receipt, fixture.root, { channel: 'verified-sheet-metal', ...RELEASE }, fixture.trustedReviewers, NOW);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('artifact_path_symlink_or_junction'));
});
