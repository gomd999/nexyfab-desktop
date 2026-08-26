import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  blindChallengeReviewPayload,
  blindChallengeTargetHash,
} from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import {
  mechanicalManufacturingCaseTargetHash,
  mechanicalManufacturingInspectorPayload,
} from '../../../scripts/build-mechanical-product-scope-assessment.mjs';
import { buildMechanicalSigningPacket } from './build-mechanical-signing-packet.mjs';

const TOOL_PATH = fileURLToPath(new URL('./build-mechanical-signing-packet.mjs', import.meta.url));
const CONTRACT_ROOT = fileURLToPath(new URL('../contracts/', import.meta.url));
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

function writeRequest(root, name, request) {
  const requestPath = path.join(root, name);
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return requestPath;
}

function blindFixture(t) {
  const root = temporaryRoot(t, 'nexyfab-blind-signing-');
  const cases = Array.from({ length: 20 }, (_, index) => ({
    challengeId: `challenge-${index + 1}`,
    risk: index < 5 ? 'high' : 'standard',
    builderId: `builder-${index + 1}`,
    requirementsLockedAt: '2026-08-11T00:00:00.000Z',
    startedAt: '2026-08-11T01:00:00.000Z',
    completedAt: '2026-08-11T02:00:00.000Z',
    designRevisionSha256: hash(`blind-revision-${index}`),
    artifactPaths: {
      requirements: writeArtifact(root, `challenge-${index + 1}/requirements.md`, `requirements-${index}`),
      releasePackage: writeArtifact(root, `challenge-${index + 1}/release.zip`, `release-${index}`),
    },
    reviewers: (index < 5 ? ['reviewer-a', 'reviewer-b'] : ['reviewer-a']).map(reviewerId => ({
      reviewerId,
      reviewedAt: '2026-08-11T03:00:00.000Z',
    })),
  }));
  const request = {
    schema: 'nexyfab.mechanical-blind-signing-request.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('blind-signing-root'),
    generatedAt: '2026-08-11T04:00:00.000Z',
    cases,
  };
  return { root, request, requestPath: writeRequest(root, 'blind-signing-request.json', request) };
}

function manufacturingFixture(t) {
  const root = temporaryRoot(t, 'nexyfab-manufacturing-signing-');
  const processes = ['cnc_machining', 'sheet_metal', 'additive_manufacturing'];
  const extensions = {
    nfab: '.nfab', step: '.step', drawing: '.pdf', bom: '.csv',
    manufacturingReceipt: '.pdf', inspectionReport: '.json', photoEvidence: '.jpg',
  };
  const cases = processes.map((process, index) => ({
    caseId: `pilot-${index + 1}`,
    process,
    designRevision: hash(`manufacturing-revision-${index}`),
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
  }));
  const request = {
    schema: 'nexyfab.mechanical-manufacturing-signing-request.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: hash('manufacturing-signing-root'),
    generatedAt: '2026-08-11T03:00:00.000Z',
    cases,
  };
  return { root, request, requestPath: writeRequest(root, 'manufacturing-signing-request.json', request) };
}

function build(kind, fixture, outputPath = null) {
  return buildMechanicalSigningPacket({
    kind,
    requestPath: fixture.requestPath,
    evidenceRoot: fixture.root,
    outputPath,
    now: NOW,
  });
}

function exactSchema(schema, keys) {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), [...keys].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...keys].sort());
}

function assertPatternsCompile(value) {
  if (Array.isArray(value)) return value.forEach(assertPatternsCompile);
  if (!value || typeof value !== 'object') return;
  if (typeof value.pattern === 'string') assert.doesNotThrow(() => new RegExp(value.pattern));
  Object.values(value).forEach(assertPatternsCompile);
}

test('builds deterministic blind packets bound to exact artifacts and canonical review payloads', t => {
  const fixture = blindFixture(t);
  const first = build('blind', fixture);
  const second = build('blind', fixture);
  assert.deepEqual(first.packet, second.packet);
  assert.equal(first.packet.items.length, 20);
  assert.equal(first.packet.claimBoundary.createsEvidence, false);
  assert.equal(first.packet.claimBoundary.createsSignatures, false);
  assert.equal(first.packet.claimBoundary.grantsCommercialRelease, false);
  assert.equal(first.packet.items[0].reviewPackets.length, 2);
  assert.equal(first.packet.items[5].reviewPackets.length, 1);
  const item = first.packet.items[0];
  const receiptBinding = { releaseChannel: first.packet.releaseChannel, evidenceRootId: first.packet.evidenceRootId };
  assert.equal(item.targetHash, blindChallengeTargetHash(receiptBinding, item.caseTemplate));
  for (const reviewPacket of item.reviewPackets) {
    const expected = blindChallengeReviewPayload(receiptBinding, item.caseTemplate, reviewPacket.reviewTemplate);
    assert.equal(reviewPacket.payload, expected);
    assert.equal(reviewPacket.payloadSha256, hash(expected));
  }
  const outputRoot = path.join(fixture.root, 'packets');
  fs.mkdirSync(outputRoot);
  const outputPath = path.join(outputRoot, 'blind-signing-packet.json');
  const written = build('blind', fixture, outputPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), written.packet);
  assert.throws(() => build('blind', fixture, outputPath), /OUTPUT_ALREADY_EXISTS/);
});

test('changes blind target and packet hashes when bound artifact bytes change', t => {
  const fixture = blindFixture(t);
  const before = build('blind', fixture).packet;
  fs.writeFileSync(path.join(fixture.root, 'challenge-1', 'requirements.md'), 'requirements-tampered');
  const after = build('blind', fixture).packet;
  assert.notEqual(after.items[0].targetHash, before.items[0].targetHash);
  assert.notEqual(after.packetSha256, before.packetSha256);
  assert.equal(after.sourceRequest.sha256, before.sourceRequest.sha256);
});

test('rejects blind role, reviewer count, chronology, traversal and evidence-root escape violations', t => {
  const fixture = blindFixture(t);
  const original = structuredClone(fixture.request);
  const reject = mutation => {
    fixture.request = structuredClone(original);
    mutation(fixture.request);
    writeRequest(fixture.root, 'blind-signing-request.json', fixture.request);
    assert.throws(() => build('blind', fixture), /BLIND_SIGNING_REQUEST_INVALID/);
  };
  reject(request => { request.cases[0].reviewers[0].reviewerId = request.cases[0].builderId; });
  reject(request => { request.cases[0].reviewers = request.cases[0].reviewers.slice(0, 1); });
  reject(request => { request.cases[0].reviewers[0].reviewedAt = '2026-08-11T06:00:00.000Z'; });
  reject(request => { request.cases[0].artifactPaths.requirements = '../outside.md'; });

  const outside = temporaryRoot(t, 'nexyfab-signing-outside-');
  const outsideRequest = path.join(outside, 'request.json');
  fs.writeFileSync(outsideRequest, JSON.stringify(original));
  assert.throws(() => buildMechanicalSigningPacket({
    kind: 'blind', requestPath: outsideRequest, evidenceRoot: fixture.root, now: NOW,
  }), /REQUEST_OUTSIDE_ROOT/);
});

test('rejects an artifact reached through a directory link outside the evidence root', t => {
  const fixture = blindFixture(t);
  const outside = temporaryRoot(t, 'nexyfab-signing-link-target-');
  fs.writeFileSync(path.join(outside, 'requirements.md'), 'outside-bytes');
  const linkPath = path.join(fixture.root, 'linked-outside');
  try {
    fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`directory links unavailable: ${error.code ?? error.message}`);
    return;
  }
  fixture.request.cases[0].artifactPaths.requirements = 'linked-outside/requirements.md';
  writeRequest(fixture.root, 'blind-signing-request.json', fixture.request);
  assert.throws(() => build('blind', fixture), /BLIND_SIGNING_REQUEST_INVALID/);
});

test('builds deterministic manufacturing targets and canonical inspector payloads', t => {
  const fixture = manufacturingFixture(t);
  const first = build('manufacturing', fixture);
  const second = build('manufacturing', fixture);
  assert.deepEqual(first.packet, second.packet);
  assert.equal(first.packet.items.length, 3);
  const receiptBinding = { releaseChannel: first.packet.releaseChannel, evidenceRootId: first.packet.evidenceRootId };
  for (const item of first.packet.items) {
    assert.equal(item.targetHash, mechanicalManufacturingCaseTargetHash(receiptBinding, item.caseTemplate));
    const expected = mechanicalManufacturingInspectorPayload(
      receiptBinding,
      item.caseTemplate,
      item.caseTemplate.inspector,
    );
    assert.equal(item.inspectorPacket.payload, expected);
    assert.equal(item.inspectorPacket.payloadSha256, hash(expected));
  }
});

test('rejects out-of-tolerance and non-diverse manufacturing requests', t => {
  const fixture = manufacturingFixture(t);
  const original = structuredClone(fixture.request);
  const reject = mutation => {
    fixture.request = structuredClone(original);
    mutation(fixture.request);
    writeRequest(fixture.root, 'manufacturing-signing-request.json', fixture.request);
    assert.throws(() => build('manufacturing', fixture), /MANUFACTURING_SIGNING_REQUEST_INVALID/);
  };
  reject(request => { request.cases[0].measurements[0].actual = 10.2; });
  reject(request => { request.cases[1].process = request.cases[0].process; });
  reject(request => { request.cases.forEach(item => { item.manufacturer.facilityId = 'facility-a'; }); });
  reject(request => { request.cases.forEach(item => { item.inspector.reviewerId = 'inspector-a'; }); });
});

test('publishes exact request and packet schema field sets with compilable patterns', () => {
  const blind = JSON.parse(fs.readFileSync(path.join(CONTRACT_ROOT, 'mechanical-blind-signing-request.schema.json'), 'utf8'));
  const manufacturing = JSON.parse(fs.readFileSync(path.join(CONTRACT_ROOT, 'mechanical-manufacturing-signing-request.schema.json'), 'utf8'));
  const packet = JSON.parse(fs.readFileSync(path.join(CONTRACT_ROOT, 'mechanical-commercial-signing-packet.schema.json'), 'utf8'));
  exactSchema(blind, ['schema', 'releaseChannel', 'evidenceRootId', 'generatedAt', 'cases']);
  exactSchema(blind.$defs.case, [
    'challengeId', 'risk', 'builderId', 'requirementsLockedAt', 'startedAt',
    'completedAt', 'designRevisionSha256', 'artifactPaths', 'reviewers',
  ]);
  exactSchema(blind.$defs.reviewer, ['reviewerId', 'reviewedAt']);
  exactSchema(manufacturing, ['schema', 'releaseChannel', 'evidenceRootId', 'generatedAt', 'cases']);
  exactSchema(manufacturing.$defs.case, [
    'caseId', 'process', 'designRevision', 'noUnapprovedCadChanges', 'stepRoundtripVerified',
    'drawingReleased', 'bomReconciled', 'inspectionDisposition', 'artifactPaths',
    'manufacturer', 'measurements', 'inspector',
  ]);
  exactSchema(manufacturing.$defs.measurement, [
    'characteristic', 'nominal', 'actual', 'minusTolerance', 'plusTolerance', 'unit', 'result',
  ]);
  exactSchema(packet, [
    'schema', 'kind', 'releaseChannel', 'evidenceRootId', 'generatedAt',
    'sourceRequest', 'items', 'claimBoundary', 'packetSha256',
  ]);
  exactSchema(packet.$defs.blindItem, ['challengeId', 'targetHash', 'caseTemplate', 'reviewPackets']);
  exactSchema(packet.$defs.manufacturingItem, ['caseId', 'targetHash', 'caseTemplate', 'inspectorPacket']);
  assertPatternsCompile(blind);
  assertPatternsCompile(manufacturing);
  assertPatternsCompile(packet);
});

test('CLI check is read-only and malformed requests exit 4 without output', t => {
  const fixture = blindFixture(t);
  const check = spawnSync(process.execPath, [
    TOOL_PATH,
    '--kind=blind',
    `--request=${fixture.requestPath}`,
    `--evidence-root=${fixture.root}`,
    '--check',
  ], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).output, null);

  fixture.request.unapprovedClaim = true;
  writeRequest(fixture.root, 'blind-signing-request.json', fixture.request);
  const outputPath = path.join(fixture.root, 'must-not-exist.json');
  const invalid = spawnSync(process.execPath, [
    TOOL_PATH,
    '--kind=blind',
    `--request=${fixture.requestPath}`,
    `--evidence-root=${fixture.root}`,
    `--output=${outputPath}`,
  ], { encoding: 'utf8' });
  assert.equal(invalid.status, 4, invalid.stderr);
  assert.equal(fs.existsSync(outputPath), false);
});
