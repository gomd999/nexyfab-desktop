#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blindChallengeReviewPayload,
  blindChallengeTargetHash,
} from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import {
  mechanicalManufacturingCaseTargetHash,
  mechanicalManufacturingInspectorPayload,
} from '../../../scripts/build-mechanical-product-scope-assessment.mjs';

const TOOL_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fs.realpathSync(path.resolve(path.dirname(TOOL_PATH), '../../..'));
const SHA256 = /^[a-f0-9]{64}$/;
const KINDS = Object.freeze(['blind', 'manufacturing']);
const MANUFACTURING_PROCESSES = Object.freeze(['cnc_machining', 'sheet_metal', 'additive_manufacturing']);
const MANUFACTURING_ARTIFACTS = Object.freeze([
  'nfab', 'step', 'drawing', 'bom', 'manufacturingReceipt', 'inspectionReport', 'photoEvidence',
]);
const MANUFACTURING_EXTENSIONS = Object.freeze({
  nfab: ['.nfab', '.json'], step: ['.step', '.stp'], drawing: ['.pdf', '.dxf'],
  bom: ['.csv', '.json', '.xlsx'], manufacturingReceipt: ['.pdf', '.json'],
  inspectionReport: ['.pdf', '.json', '.csv'], photoEvidence: ['.jpg', '.jpeg', '.png', '.pdf'],
});
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const render = value => `${JSON.stringify(value, null, 2)}\n`;
const hasExactKeys = (value, keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','));

function option(args, name) {
  const prefix = `--${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function safeExternalRoot(rootValue) {
  if (typeof rootValue !== 'string' || !rootValue.trim()) throw new Error('MECHANICAL_SIGNING_EVIDENCE_ROOT_REQUIRED');
  const resolved = path.resolve(rootValue);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isDirectory()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('MECHANICAL_SIGNING_EVIDENCE_ROOT_NOT_SAFE_DIRECTORY');
  const real = fs.realpathSync(resolved);
  if (real === REPOSITORY_ROOT || real.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error('MECHANICAL_SIGNING_EVIDENCE_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  return real;
}

function safeRequest(root, requestValue) {
  if (typeof requestValue !== 'string' || !requestValue.trim()) throw new Error('MECHANICAL_SIGNING_REQUEST_REQUIRED');
  const resolved = path.resolve(requestValue);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isFile()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('MECHANICAL_SIGNING_REQUEST_NOT_SAFE_FILE');
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(`${root}${path.sep}`)) throw new Error('MECHANICAL_SIGNING_REQUEST_OUTSIDE_ROOT');
  return real;
}

function safeNewOutput(outputValue) {
  if (outputValue === null || outputValue === undefined) return null;
  const resolved = path.resolve(outputValue);
  if (fs.existsSync(resolved)) throw new Error('MECHANICAL_SIGNING_PACKET_OUTPUT_ALREADY_EXISTS');
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)
    || !fs.statSync(parent).isDirectory()
    || fs.lstatSync(parent).isSymbolicLink()) throw new Error('MECHANICAL_SIGNING_PACKET_OUTPUT_PARENT_NOT_SAFE');
  return path.join(fs.realpathSync(parent), path.basename(resolved));
}

function atomicNoReplace(output, bytes) {
  const temporary = `${output}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.linkSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readArtifact(root, relative, extensions, usedPaths) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return null;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..') || usedPaths.has(normalized)) return null;
  const absolute = path.resolve(root, ...normalized.split('/'));
  if (!absolute.startsWith(`${root}${path.sep}`)
    || !fs.existsSync(absolute)
    || !fs.statSync(absolute).isFile()
    || fs.lstatSync(absolute).isSymbolicLink()) return null;
  const real = fs.realpathSync(absolute);
  if (!real.startsWith(`${root}${path.sep}`)
    || !extensions.includes(path.extname(normalized).toLowerCase())) return null;
  const bytes = fs.readFileSync(real);
  usedPaths.add(normalized);
  return { path: normalized, sha256: sha256(bytes) };
}

function buildBlindPacket(request, root, now) {
  if (!hasExactKeys(request, ['schema', 'releaseChannel', 'evidenceRootId', 'generatedAt', 'cases'])
    || request.schema !== 'nexyfab.mechanical-blind-signing-request.v1'
    || request.releaseChannel !== 'mechanical-core'
    || !SHA256.test(String(request.evidenceRootId ?? ''))
    || !Array.isArray(request.cases)
    || request.cases.length !== 20) throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
  const generatedAt = Date.parse(request.generatedAt);
  const ids = new Set();
  const revisions = new Set();
  const usedPaths = new Set();
  const targetReceipt = { releaseChannel: request.releaseChannel, evidenceRootId: request.evidenceRootId };
  const items = request.cases.map(item => {
    if (!hasExactKeys(item, [
      'challengeId', 'risk', 'builderId', 'requirementsLockedAt', 'startedAt',
      'completedAt', 'designRevisionSha256', 'artifactPaths', 'reviewers',
    ])
      || !hasExactKeys(item.artifactPaths, ['requirements', 'releasePackage'])
      || !Array.isArray(item.reviewers)) throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
    const lockedAt = Date.parse(item.requirementsLockedAt);
    const startedAt = Date.parse(item.startedAt);
    const completedAt = Date.parse(item.completedAt);
    const requiredReviewers = item.risk === 'high' ? 2 : 1;
    const reviewerIds = new Set();
    if (!item.challengeId || ids.has(item.challengeId)
      || !['standard', 'high'].includes(item.risk)
      || typeof item.builderId !== 'string'
      || !item.builderId.trim()
      || !SHA256.test(String(item.designRevisionSha256 ?? ''))
      || revisions.has(item.designRevisionSha256)
      || !Number.isFinite(lockedAt)
      || !Number.isFinite(startedAt)
      || !Number.isFinite(completedAt)
      || lockedAt > startedAt
      || startedAt > completedAt
      || completedAt > generatedAt
      || item.reviewers.length < requiredReviewers) throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
    const requirements = readArtifact(root, item.artifactPaths.requirements, ['.json', '.md', '.txt'], usedPaths);
    const releasePackage = readArtifact(root, item.artifactPaths.releasePackage, ['.zip', '.json'], usedPaths);
    if (!requirements || !releasePackage) throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
    const caseTemplate = {
      challengeId: item.challengeId,
      risk: item.risk,
      status: 'pass',
      internalRoleSeparated: true,
      builderId: item.builderId,
      requirementsLockedAt: item.requirementsLockedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      designRevisionSha256: item.designRevisionSha256,
      artifacts: { requirements, releasePackage },
      targetHash: '',
      reviews: [],
    };
    caseTemplate.targetHash = blindChallengeTargetHash(targetReceipt, caseTemplate);
    const reviewPackets = item.reviewers.map(reviewer => {
      if (!hasExactKeys(reviewer, ['reviewerId', 'reviewedAt'])
        || typeof reviewer.reviewerId !== 'string'
        || !reviewer.reviewerId.trim()
        || reviewer.reviewerId === item.builderId
        || reviewerIds.has(reviewer.reviewerId)) throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
      const reviewedAt = Date.parse(reviewer.reviewedAt);
      if (!Number.isFinite(reviewedAt) || reviewedAt < completedAt || reviewedAt > generatedAt || reviewedAt > now) {
        throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
      }
      reviewerIds.add(reviewer.reviewerId);
      const reviewTemplate = {
        reviewerId: reviewer.reviewerId,
        decision: 'approved',
        independentFromBuild: true,
        targetHash: caseTemplate.targetHash,
        reviewedAt: reviewer.reviewedAt,
        signature: '',
      };
      const payload = blindChallengeReviewPayload(targetReceipt, caseTemplate, reviewTemplate);
      return { reviewerId: reviewer.reviewerId, reviewTemplate, payload, payloadSha256: sha256(Buffer.from(payload)) };
    });
    ids.add(item.challengeId);
    revisions.add(item.designRevisionSha256);
    return { challengeId: item.challengeId, targetHash: caseTemplate.targetHash, caseTemplate, reviewPackets };
  });
  if (!Number.isFinite(generatedAt)
    || generatedAt > now
    || request.cases.filter(item => item.risk === 'high').length < 5) {
    throw new Error('MECHANICAL_BLIND_SIGNING_REQUEST_INVALID');
  }
  return items;
}

function buildManufacturingPacket(request, root, now) {
  if (!hasExactKeys(request, ['schema', 'releaseChannel', 'evidenceRootId', 'generatedAt', 'cases'])
    || request.schema !== 'nexyfab.mechanical-manufacturing-signing-request.v1'
    || request.releaseChannel !== 'mechanical-core'
    || !SHA256.test(String(request.evidenceRootId ?? ''))
    || !Array.isArray(request.cases)
    || request.cases.length !== 3) throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
  const generatedAt = Date.parse(request.generatedAt);
  const ids = new Set();
  const revisions = new Set();
  const processes = new Set();
  const facilities = new Set();
  const inspectors = new Set();
  const usedPaths = new Set();
  const targetReceipt = { releaseChannel: request.releaseChannel, evidenceRootId: request.evidenceRootId };
  const items = request.cases.map(item => {
    if (!hasExactKeys(item, [
      'caseId', 'process', 'designRevision', 'noUnapprovedCadChanges',
      'stepRoundtripVerified', 'drawingReleased', 'bomReconciled',
      'inspectionDisposition', 'artifactPaths', 'manufacturer', 'measurements', 'inspector',
    ])
      || !hasExactKeys(item.artifactPaths, MANUFACTURING_ARTIFACTS)
      || !hasExactKeys(item.manufacturer, ['facilityId', 'independentFromNexyfab', 'completedAt'])
      || !hasExactKeys(item.inspector, ['reviewerId', 'independentFromBuild', 'inspectedAt'])
      || !Array.isArray(item.measurements)) throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
    const completedAt = Date.parse(item.manufacturer.completedAt);
    const inspectedAt = Date.parse(item.inspector.inspectedAt);
    if (!item.caseId
      || ids.has(item.caseId)
      || !MANUFACTURING_PROCESSES.includes(item.process)
      || processes.has(item.process)
      || !SHA256.test(String(item.designRevision ?? ''))
      || revisions.has(item.designRevision)
      || item.noUnapprovedCadChanges !== true
      || item.stepRoundtripVerified !== true
      || item.drawingReleased !== true
      || item.bomReconciled !== true
      || item.inspectionDisposition !== 'accepted'
      || typeof item.manufacturer.facilityId !== 'string'
      || !item.manufacturer.facilityId.trim()
      || item.manufacturer.independentFromNexyfab !== true
      || typeof item.inspector.reviewerId !== 'string'
      || !item.inspector.reviewerId.trim()
      || item.inspector.independentFromBuild !== true
      || !Number.isFinite(completedAt)
      || !Number.isFinite(inspectedAt)
      || inspectedAt < completedAt
      || inspectedAt > generatedAt
      || inspectedAt > now
      || item.measurements.length < 3) throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
    const measurementsValid = item.measurements.every(measurement => hasExactKeys(measurement, [
      'characteristic', 'nominal', 'actual', 'minusTolerance', 'plusTolerance', 'unit', 'result',
    ])
      && typeof measurement.characteristic === 'string'
      && measurement.characteristic.trim()
      && typeof measurement.unit === 'string'
      && measurement.unit.trim()
      && Number.isFinite(measurement.nominal)
      && Number.isFinite(measurement.actual)
      && Number.isFinite(measurement.minusTolerance)
      && measurement.minusTolerance >= 0
      && Number.isFinite(measurement.plusTolerance)
      && measurement.plusTolerance >= 0
      && measurement.result === 'pass'
      && measurement.actual >= measurement.nominal - measurement.minusTolerance
      && measurement.actual <= measurement.nominal + measurement.plusTolerance);
    if (!measurementsValid
      || new Set(item.measurements.map(measurement => measurement.characteristic)).size !== item.measurements.length) {
      throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
    }
    const artifacts = Object.fromEntries(MANUFACTURING_ARTIFACTS.map(role => [
      role,
      readArtifact(root, item.artifactPaths[role], MANUFACTURING_EXTENSIONS[role], usedPaths),
    ]));
    if (Object.values(artifacts).some(binding => binding === null)) {
      throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
    }
    const caseTemplate = {
      caseId: item.caseId,
      process: item.process,
      result: 'pass',
      designRevision: item.designRevision,
      noUnapprovedCadChanges: true,
      stepRoundtripVerified: true,
      drawingReleased: true,
      bomReconciled: true,
      inspectionDisposition: 'accepted',
      artifacts,
      manufacturer: item.manufacturer,
      measurements: item.measurements,
      inspector: {
        reviewerId: item.inspector.reviewerId,
        independentFromBuild: true,
        inspectedAt: item.inspector.inspectedAt,
        targetHash: '',
        signature: '',
      },
    };
    caseTemplate.inspector.targetHash = mechanicalManufacturingCaseTargetHash(targetReceipt, caseTemplate);
    const payload = mechanicalManufacturingInspectorPayload(targetReceipt, caseTemplate, caseTemplate.inspector);
    ids.add(item.caseId);
    revisions.add(item.designRevision);
    processes.add(item.process);
    facilities.add(item.manufacturer.facilityId);
    inspectors.add(item.inspector.reviewerId);
    return {
      caseId: item.caseId,
      targetHash: caseTemplate.inspector.targetHash,
      caseTemplate,
      inspectorPacket: {
        reviewerId: item.inspector.reviewerId,
        payload,
        payloadSha256: sha256(Buffer.from(payload)),
      },
    };
  });
  if (!Number.isFinite(generatedAt)
    || generatedAt > now
    || processes.size !== MANUFACTURING_PROCESSES.length
    || facilities.size < 2
    || inspectors.size < 2) throw new Error('MECHANICAL_MANUFACTURING_SIGNING_REQUEST_INVALID');
  return items;
}

export function buildMechanicalSigningPacket({
  kind,
  requestPath,
  evidenceRoot,
  outputPath = null,
  now = Date.now(),
}) {
  if (!KINDS.includes(kind)) throw new Error('MECHANICAL_SIGNING_KIND_INVALID');
  const realRoot = safeExternalRoot(evidenceRoot);
  const realRequest = safeRequest(realRoot, requestPath);
  const output = safeNewOutput(outputPath);
  const requestBytes = fs.readFileSync(realRequest);
  let request;
  try {
    request = JSON.parse(requestBytes.toString('utf8'));
  } catch {
    throw new Error(`MECHANICAL_${kind.toUpperCase()}_SIGNING_REQUEST_INVALID`);
  }
  const items = kind === 'blind'
    ? buildBlindPacket(request, realRoot, now)
    : buildManufacturingPacket(request, realRoot, now);
  const packetBase = {
    schema: 'nexyfab.mechanical-commercial-signing-packet.v1',
    kind,
    releaseChannel: 'mechanical-core',
    evidenceRootId: request.evidenceRootId,
    generatedAt: request.generatedAt,
    sourceRequest: {
      path: path.relative(realRoot, realRequest).replaceAll('\\', '/'),
      bytes: requestBytes.byteLength,
      sha256: sha256(requestBytes),
    },
    items,
    claimBoundary: {
      createsEvidence: false,
      createsSignatures: false,
      grantsCommercialRelease: false,
    },
  };
  const packet = { ...packetBase, packetSha256: sha256(Buffer.from(canonical(packetBase))) };
  let outputSha256 = null;
  if (output !== null) {
    const outputBytes = Buffer.from(render(packet));
    atomicNoReplace(output, outputBytes);
    outputSha256 = sha256(outputBytes);
  }
  return { packet, output, outputSha256 };
}

export function main(args = process.argv.slice(2)) {
  const kind = option(args, 'kind');
  const requestPath = option(args, 'request');
  const evidenceRoot = option(args, 'evidence-root');
  const outputPath = option(args, 'output');
  const checkOnly = args.includes('--check');
  if (!checkOnly && !outputPath) {
    throw new Error('Usage: --kind=blind|manufacturing --request=<request.json> --evidence-root=<external-root> (--check | --output=<signing-packet.json>)');
  }
  const result = buildMechanicalSigningPacket({
    kind,
    requestPath,
    evidenceRoot,
    outputPath: checkOnly ? null : outputPath,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema: result.packet.schema,
    kind: result.packet.kind,
    items: result.packet.items.length,
    packetSha256: result.packet.packetSha256,
    output: result.output,
    outputSha256: result.outputSha256,
    claimBoundary: result.packet.claimBoundary,
  })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_PATH) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mechanical-signing-packet] ${message}\n`);
    process.exitCode = message.includes('SIGNING_REQUEST_INVALID') ? 4 : 2;
  }
}
