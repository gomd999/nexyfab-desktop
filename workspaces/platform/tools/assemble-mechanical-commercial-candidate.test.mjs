import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto, { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateMechanicalBlindChallenge } from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import { validateMechanicalManufacturingReceipt } from '../../../scripts/build-mechanical-product-scope-assessment.mjs';
import { assembleMechanicalCommercialCandidate } from './assemble-mechanical-commercial-candidate.mjs';
import { buildMechanicalSigningPacket } from './build-mechanical-signing-packet.mjs';
import { promoteMechanicalCommercialReceipt } from './promote-mechanical-commercial-receipt.mjs';

const TOOL_PATH = fileURLToPath(new URL('./assemble-mechanical-commercial-candidate.mjs', import.meta.url));
const CONTRACT_PATH = fileURLToPath(new URL('../contracts/mechanical-commercial-signature-response.schema.json', import.meta.url));
const NOW = Date.parse('2026-08-11T05:00:00.000Z');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function temporaryRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeArtifact(root, relative, bytes) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, Buffer.from(bytes));
  return relative;
}

function writeJson(root, relative, value) {
  const absolute = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
  return absolute;
}

function registration(pair, role) {
  return {
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    roles: [role],
  };
}

function blindFixture(t) {
  const root = temporaryRoot(t, 'nexyfab-blind-assembly-');
  const keyA = generateKeyPairSync('ed25519');
  const keyB = generateKeyPairSync('ed25519');
  const keys = { 'reviewer-a': keyA.privateKey, 'reviewer-b': keyB.privateKey };
  const trusted = {
    'reviewer-a': registration(keyA, 'mechanical-blind-reviewer'),
    'reviewer-b': registration(keyB, 'mechanical-blind-reviewer'),
  };
  const request = {
    schema: 'nexyfab.mechanical-blind-signing-request.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('blind-assembly-root'),
    generatedAt: '2026-08-11T04:00:00.000Z',
    cases: Array.from({ length: 20 }, (_, index) => ({
      challengeId: `challenge-${index + 1}`,
      risk: index < 5 ? 'high' : 'standard',
      builderId: `builder-${index + 1}`,
      requirementsLockedAt: '2026-08-11T00:00:00.000Z',
      startedAt: '2026-08-11T01:00:00.000Z',
      completedAt: '2026-08-11T02:00:00.000Z',
      designRevisionSha256: hash(`blind-assembly-revision-${index}`),
      artifactPaths: {
        requirements: writeArtifact(root, `challenge-${index + 1}/requirements.md`, `requirements-${index}`),
        releasePackage: writeArtifact(root, `challenge-${index + 1}/release.zip`, `release-${index}`),
      },
      reviewers: (index < 5 ? ['reviewer-a', 'reviewer-b'] : ['reviewer-a']).map(reviewerId => ({
        reviewerId,
        reviewedAt: '2026-08-11T03:00:00.000Z',
      })),
    })),
  };
  const requestPath = writeJson(root, 'blind-signing-request.json', request);
  const packetPath = path.join(root, 'packets', 'blind-packet.json');
  fs.mkdirSync(path.dirname(packetPath));
  const { packet } = buildMechanicalSigningPacket({
    kind: 'blind', requestPath, evidenceRoot: root, outputPath: packetPath, now: NOW,
  });
  const response = {
    schema: 'nexyfab.mechanical-commercial-signature-response.v1',
    kind: 'blind',
    packetSha256: packet.packetSha256,
    generatedAt: '2026-08-11T04:30:00.000Z',
    signatures: packet.items.flatMap(item => item.reviewPackets.map(review => ({
      challengeId: item.challengeId,
      reviewerId: review.reviewerId,
      targetHash: item.targetHash,
      payloadSha256: review.payloadSha256,
      signature: sign(null, Buffer.from(review.payload), keys[review.reviewerId]).toString('base64'),
    }))),
  };
  const responsePath = writeJson(root, 'responses/blind-response.json', response);
  return { root, request, requestPath, packet, packetPath, response, responsePath, trusted };
}

function manufacturingFixture(t) {
  const root = temporaryRoot(t, 'nexyfab-manufacturing-assembly-');
  const keyA = generateKeyPairSync('ed25519');
  const keyB = generateKeyPairSync('ed25519');
  const keys = { 'inspector-a': keyA.privateKey, 'inspector-b': keyB.privateKey };
  const trusted = {
    'inspector-a': registration(keyA, 'manufacturing-inspector'),
    'inspector-b': registration(keyB, 'manufacturing-inspector'),
  };
  const extensions = {
    nfab: '.nfab', step: '.step', drawing: '.pdf', bom: '.csv',
    manufacturingReceipt: '.pdf', inspectionReport: '.json', photoEvidence: '.jpg',
  };
  const processes = ['cnc_machining', 'sheet_metal', 'additive_manufacturing'];
  const request = {
    schema: 'nexyfab.mechanical-manufacturing-signing-request.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('manufacturing-assembly-root'),
    generatedAt: '2026-08-11T03:00:00.000Z',
    cases: processes.map((process, index) => ({
      caseId: `pilot-${index + 1}`,
      process,
      designRevision: hash(`manufacturing-assembly-revision-${index}`),
      noUnapprovedCadChanges: true,
      stepRoundtripVerified: true,
      drawingReleased: true,
      bomReconciled: true,
      inspectionDisposition: 'accepted',
      artifactPaths: Object.fromEntries(Object.entries(extensions).map(([role, extension]) => [
        role,
        writeArtifact(root, `pilot-${index + 1}/${role}${extension}`, `${role}-${index}`),
      ])),
      manufacturer: {
        facilityId: index === 1 ? 'facility-b' : 'facility-a',
        independentFromNexyfab: true,
        completedAt: '2026-08-11T01:00:00.000Z',
      },
      measurements: Array.from({ length: 3 }, (_, measurement) => ({
        characteristic: `dim-${measurement}`,
        nominal: 10,
        actual: 10.01,
        minusTolerance: 0.05,
        plusTolerance: 0.05,
        unit: 'mm',
        result: 'pass',
      })),
      inspector: {
        reviewerId: index === 1 ? 'inspector-b' : 'inspector-a',
        independentFromBuild: true,
        inspectedAt: '2026-08-11T02:00:00.000Z',
      },
    })),
  };
  const requestPath = writeJson(root, 'manufacturing-signing-request.json', request);
  const packetPath = path.join(root, 'packets', 'manufacturing-packet.json');
  fs.mkdirSync(path.dirname(packetPath));
  const { packet } = buildMechanicalSigningPacket({
    kind: 'manufacturing', requestPath, evidenceRoot: root, outputPath: packetPath, now: NOW,
  });
  const response = {
    schema: 'nexyfab.mechanical-commercial-signature-response.v1',
    kind: 'manufacturing',
    packetSha256: packet.packetSha256,
    generatedAt: '2026-08-11T04:00:00.000Z',
    signatures: packet.items.map(item => ({
      caseId: item.caseId,
      reviewerId: item.inspectorPacket.reviewerId,
      targetHash: item.targetHash,
      payloadSha256: item.inspectorPacket.payloadSha256,
      signature: sign(
        null,
        Buffer.from(item.inspectorPacket.payload),
        keys[item.inspectorPacket.reviewerId],
      ).toString('base64'),
    })),
  };
  const responsePath = writeJson(root, 'responses/manufacturing-response.json', response);
  return { root, request, requestPath, packet, packetPath, response, responsePath, trusted };
}

function assemble(kind, fixture, outputPath = null) {
  return assembleMechanicalCommercialCandidate({
    kind,
    packetPath: fixture.packetPath,
    responsePath: fixture.responsePath,
    evidenceRoot: fixture.root,
    outputPath,
    trustedBlindReviewers: kind === 'blind' ? fixture.trusted : {},
    trustedManufacturingInspectors: kind === 'manufacturing' ? fixture.trusted : {},
    now: NOW,
  });
}

test('assembles an exact blind candidate and passes the existing promotion validator', t => {
  const fixture = blindFixture(t);
  const checked = assemble('blind', fixture);
  assert.equal(validateMechanicalBlindChallenge(checked.candidate, {
    evidenceRoot: fixture.root, trustedReviewers: fixture.trusted, now: NOW,
  }), true);
  assert.equal(checked.candidate.cases.length, 20);
  assert.equal(checked.candidate.cases[0].reviews.length, 2);
  assert.equal(checked.claimBoundary.createsSignatures, false);
  assert.equal(checked.claimBoundary.grantsCommercialRelease, false);

  const outputPath = path.join(fixture.root, 'candidates', 'blind-candidate.json');
  fs.mkdirSync(path.dirname(outputPath));
  const written = assemble('blind', fixture, outputPath);
  assert.equal(written.outputSha256, written.candidateSha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), written.candidate);
  const promotion = promoteMechanicalCommercialReceipt({
    kind: 'blind', candidatePath: outputPath, evidenceRoot: fixture.root,
    trustedBlindReviewers: fixture.trusted, now: NOW,
  });
  assert.equal(promotion.valid, true);
  assert.throws(() => assemble('blind', fixture, outputPath), /OUTPUT_ALREADY_EXISTS/);
});

test('assembles an exact manufacturing candidate and passes the existing promotion validator', t => {
  const fixture = manufacturingFixture(t);
  const outputPath = path.join(fixture.root, 'candidates', 'manufacturing-candidate.json');
  fs.mkdirSync(path.dirname(outputPath));
  const result = assemble('manufacturing', fixture, outputPath);
  assert.equal(validateMechanicalManufacturingReceipt(result.candidate, {
    evidenceRoot: fixture.root, trustedInspectors: fixture.trusted, now: NOW,
  }), true);
  assert.equal(result.candidate.summary.measurements, 9);
  const promotion = promoteMechanicalCommercialReceipt({
    kind: 'manufacturing', candidatePath: outputPath, evidenceRoot: fixture.root,
    trustedManufacturingInspectors: fixture.trusted, now: NOW,
  });
  assert.equal(promotion.valid, true);
});

test('rejects forged, missing, duplicate and transplanted response entries with zero output', t => {
  const fixture = blindFixture(t);
  const outputPath = path.join(fixture.root, 'forbidden-candidate.json');
  const original = structuredClone(fixture.response);
  const reject = mutation => {
    const response = structuredClone(original);
    mutation(response);
    writeJson(fixture.root, 'responses/blind-response.json', response);
    assert.throws(() => assemble('blind', fixture, outputPath), /SIGNATURE_RESPONSE_INVALID/);
    assert.equal(fs.existsSync(outputPath), false);
  };
  reject(response => { response.signatures[0].signature = response.signatures[1].signature; });
  reject(response => { response.signatures.pop(); });
  reject(response => { response.signatures[1] = structuredClone(response.signatures[0]); });
  reject(response => { response.signatures[0].targetHash = hash('other-target'); });
  reject(response => { response.unapprovedRelease = true; });
});

test('rebuilds the packet and rejects packet claims, request drift and artifact drift', t => {
  const fixture = manufacturingFixture(t);
  const outputPath = path.join(fixture.root, 'forbidden-candidate.json');
  const originalPacket = structuredClone(fixture.packet);
  const reject = mutation => {
    const packet = structuredClone(originalPacket);
    mutation(packet);
    writeJson(fixture.root, 'packets/manufacturing-packet.json', packet);
    assert.throws(() => assemble('manufacturing', fixture, outputPath), /SIGNING_PACKET_INVALID/);
    assert.equal(fs.existsSync(outputPath), false);
  };
  reject(packet => { packet.commercialRelease = true; });
  reject(packet => { packet.items[0].targetHash = hash('other-packet-target'); });

  writeJson(fixture.root, 'packets/manufacturing-packet.json', originalPacket);
  fixture.request.generatedAt = '2026-08-11T03:01:00.000Z';
  writeJson(fixture.root, 'manufacturing-signing-request.json', fixture.request);
  assert.throws(() => assemble('manufacturing', fixture, outputPath), /SIGNING_PACKET_INVALID/);

  writeJson(fixture.root, 'manufacturing-signing-request.json', {
    ...fixture.request,
    generatedAt: '2026-08-11T03:00:00.000Z',
  });
  fs.writeFileSync(path.join(fixture.root, 'pilot-1', 'step.step'), 'artifact-drift');
  assert.throws(() => assemble('manufacturing', fixture, outputPath), /SIGNING_PACKET_INVALID/);
  assert.equal(fs.existsSync(outputPath), false);
});

test('rejects response and output paths outside the external evidence root', t => {
  const fixture = blindFixture(t);
  const outside = temporaryRoot(t, 'nexyfab-assembly-outside-');
  const outsideResponse = writeJson(outside, 'response.json', fixture.response);
  assert.throws(() => assembleMechanicalCommercialCandidate({
    kind: 'blind', packetPath: fixture.packetPath, responsePath: outsideResponse,
    evidenceRoot: fixture.root, trustedBlindReviewers: fixture.trusted, now: NOW,
  }), /SIGNATURE_RESPONSE_OUTSIDE_ROOT/);
  assert.throws(() => assemble('blind', fixture, path.join(outside, 'candidate.json')), /OUTPUT_OUTSIDE_ROOT/);
});

test('publishes an exact closed signature-response contract', () => {
  const schema = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schema', 'kind', 'packetSha256', 'generatedAt', 'signatures']);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  for (const name of ['blindSignature', 'manufacturingSignature']) {
    const definition = schema.$defs[name];
    assert.equal(definition.additionalProperties, false);
    assert.deepEqual(Object.keys(definition.properties).sort(), [...definition.required].sort());
  }
  assert.doesNotThrow(() => new RegExp(schema.$defs.signature.pattern));
});

test('CLI check is read-only and forged signatures exit 4 without output', t => {
  const fixture = manufacturingFixture(t);
  const env = {
    ...process.env,
    NEXYFAB_MANUFACTURING_REVIEWER_KEYS: JSON.stringify(fixture.trusted),
  };
  const check = spawnSync(process.execPath, [
    TOOL_PATH,
    '--kind=manufacturing',
    `--packet=${fixture.packetPath}`,
    `--response=${fixture.responsePath}`,
    `--evidence-root=${fixture.root}`,
    '--check',
  ], { encoding: 'utf8', env });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).output, null);

  fixture.response.signatures[0].signature = fixture.response.signatures[1].signature;
  writeJson(fixture.root, 'responses/manufacturing-response.json', fixture.response);
  const outputPath = path.join(fixture.root, 'must-not-exist.json');
  const invalid = spawnSync(process.execPath, [
    TOOL_PATH,
    '--kind=manufacturing',
    `--packet=${fixture.packetPath}`,
    `--response=${fixture.responsePath}`,
    `--evidence-root=${fixture.root}`,
    `--output=${outputPath}`,
  ], { encoding: 'utf8', env });
  assert.equal(invalid.status, 4, invalid.stderr);
  assert.equal(fs.existsSync(outputPath), false);
});
