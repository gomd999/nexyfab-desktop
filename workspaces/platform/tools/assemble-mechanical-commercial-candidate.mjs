#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTrustedBlindReviewers,
  validateMechanicalBlindChallenge,
} from '../../../scripts/mechanical-commercial-evidence-v3.mjs';
import {
  parseTrustedManufacturingInspectors,
  validateMechanicalManufacturingReceipt,
} from '../../../scripts/build-mechanical-product-scope-assessment.mjs';
import { buildMechanicalSigningPacket } from './build-mechanical-signing-packet.mjs';

const TOOL_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fs.realpathSync(path.resolve(path.dirname(TOOL_PATH), '../../..'));
const KINDS = Object.freeze(['blind', 'manufacturing']);
const RESPONSE_KEYS = Object.freeze({
  blind: ['challengeId', 'reviewerId', 'targetHash', 'payloadSha256', 'signature'],
  manufacturing: ['caseId', 'reviewerId', 'targetHash', 'payloadSha256', 'signature'],
});
const ROLE = Object.freeze({
  blind: 'mechanical-blind-reviewer',
  manufacturing: 'manufacturing-inspector',
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
  if (typeof rootValue !== 'string' || !rootValue.trim()) throw new Error('MECHANICAL_CANDIDATE_EVIDENCE_ROOT_REQUIRED');
  const resolved = path.resolve(rootValue);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isDirectory()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('MECHANICAL_CANDIDATE_EVIDENCE_ROOT_NOT_SAFE_DIRECTORY');
  const real = fs.realpathSync(resolved);
  if (real === REPOSITORY_ROOT || real.startsWith(`${REPOSITORY_ROOT}${path.sep}`)) {
    throw new Error('MECHANICAL_CANDIDATE_EVIDENCE_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  return real;
}

function safeFile(root, value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`MECHANICAL_CANDIDATE_${label}_REQUIRED`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)
    || !fs.statSync(resolved).isFile()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error(`MECHANICAL_CANDIDATE_${label}_NOT_SAFE_FILE`);
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(`${root}${path.sep}`)) throw new Error(`MECHANICAL_CANDIDATE_${label}_OUTSIDE_ROOT`);
  return real;
}

function safeSourceRequest(root, packet) {
  const relative = packet?.sourceRequest?.path;
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');
  }
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');
  const resolved = path.resolve(root, ...normalized.split('/'));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');
  return resolved;
}

function safeNewOutput(root, outputValue) {
  if (outputValue === null || outputValue === undefined) return null;
  const resolved = path.resolve(outputValue);
  if (fs.existsSync(resolved)) throw new Error('MECHANICAL_CANDIDATE_OUTPUT_ALREADY_EXISTS');
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)
    || !fs.statSync(parent).isDirectory()
    || fs.lstatSync(parent).isSymbolicLink()) throw new Error('MECHANICAL_CANDIDATE_OUTPUT_PARENT_NOT_SAFE');
  const realParent = fs.realpathSync(parent);
  if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) {
    throw new Error('MECHANICAL_CANDIDATE_OUTPUT_OUTSIDE_ROOT');
  }
  return path.join(realParent, path.basename(resolved));
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

function readJson(file, errorCode) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(errorCode);
  }
}

function responseKey(kind, item) {
  const subject = kind === 'blind' ? item.challengeId : item.caseId;
  return `${subject}\u0000${item.reviewerId}`;
}

function expectedSignatures(kind, packet) {
  if (kind === 'blind') {
    return packet.items.flatMap(item => item.reviewPackets.map(review => ({
      challengeId: item.challengeId,
      reviewerId: review.reviewerId,
      targetHash: item.targetHash,
      payloadSha256: review.payloadSha256,
      payload: review.payload,
    })));
  }
  return packet.items.map(item => ({
    caseId: item.caseId,
    reviewerId: item.inspectorPacket.reviewerId,
    targetHash: item.targetHash,
    payloadSha256: item.inspectorPacket.payloadSha256,
    payload: item.inspectorPacket.payload,
  }));
}

function signatureValid(registration, role, payload, value) {
  try {
    const signature = Buffer.from(value, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== value) return false;
    const publicKey = crypto.createPublicKey(registration?.publicKey);
    return registration?.roles?.includes(role) === true
      && publicKey.asymmetricKeyType === 'ed25519'
      && crypto.verify(null, Buffer.from(payload), publicKey, signature);
  } catch {
    return false;
  }
}

function verifySignatureResponse(kind, response, packet, trustedKeys, now) {
  if (!hasExactKeys(response, ['schema', 'kind', 'packetSha256', 'generatedAt', 'signatures'])
    || response.schema !== 'nexyfab.mechanical-commercial-signature-response.v1'
    || response.kind !== kind
    || response.packetSha256 !== packet.packetSha256
    || !Array.isArray(response.signatures)) throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
  const generatedAt = Date.parse(response.generatedAt);
  const packetGeneratedAt = Date.parse(packet.generatedAt);
  if (!Number.isFinite(generatedAt)
    || !Number.isFinite(packetGeneratedAt)
    || generatedAt < packetGeneratedAt
    || generatedAt > now) throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');

  const expected = expectedSignatures(kind, packet);
  const expectedByKey = new Map(expected.map(item => [responseKey(kind, item), item]));
  const responsesByKey = new Map();
  if (expectedByKey.size !== expected.length || response.signatures.length !== expected.length) {
    throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
  }
  for (const item of response.signatures) {
    if (!hasExactKeys(item, RESPONSE_KEYS[kind])) throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
    const key = responseKey(kind, item);
    const target = expectedByKey.get(key);
    if (!target
      || responsesByKey.has(key)
      || item.targetHash !== target.targetHash
      || item.payloadSha256 !== target.payloadSha256
      || !signatureValid(trustedKeys[item.reviewerId], ROLE[kind], target.payload, item.signature)) {
      throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
    }
    responsesByKey.set(key, item);
  }
  if (responsesByKey.size !== expectedByKey.size) throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
  return responsesByKey;
}

function blindCandidate(packet, response, responsesByKey) {
  const cases = packet.items.map(item => ({
    ...structuredClone(item.caseTemplate),
    reviews: item.reviewPackets.map(review => ({
      ...structuredClone(review.reviewTemplate),
      signature: responsesByKey.get(responseKey('blind', {
        challengeId: item.challengeId,
        reviewerId: review.reviewerId,
      })).signature,
    })),
  }));
  return {
    schema: 'nexyfab.mechanical-blind-product-challenge.v1',
    releaseChannel: packet.releaseChannel,
    evidenceRootId: packet.evidenceRootId,
    generatedAt: response.generatedAt,
    ok: true,
    cases,
    summary: {
      cases: cases.length,
      passed: cases.length,
      pending: 0,
      failed: 0,
      highRisk: cases.filter(item => item.risk === 'high').length,
      falseVerified: 0,
    },
  };
}

function manufacturingCandidate(packet, response, responsesByKey) {
  const cases = packet.items.map(item => {
    const value = structuredClone(item.caseTemplate);
    value.inspector.signature = responsesByKey.get(responseKey('manufacturing', {
      caseId: item.caseId,
      reviewerId: item.inspectorPacket.reviewerId,
    })).signature;
    return value;
  });
  return {
    schema: 'nexyfab.mechanical-manufacturing-validation.v3',
    releaseChannel: packet.releaseChannel,
    generatedAt: response.generatedAt,
    evidenceRootId: packet.evidenceRootId,
    ok: true,
    summary: {
      cases: cases.length,
      passed: cases.length,
      failed: 0,
      pending: 0,
      measurements: cases.reduce((count, item) => count + item.measurements.length, 0),
    },
    cases,
  };
}

export function assembleMechanicalCommercialCandidate({
  kind,
  packetPath,
  responsePath,
  evidenceRoot,
  outputPath = null,
  trustedBlindReviewers = parseTrustedBlindReviewers(),
  trustedManufacturingInspectors = parseTrustedManufacturingInspectors(),
  now = Date.now(),
}) {
  if (!KINDS.includes(kind)) throw new Error('MECHANICAL_CANDIDATE_KIND_INVALID');
  const root = safeExternalRoot(evidenceRoot);
  const realPacket = safeFile(root, packetPath, 'PACKET');
  const realResponse = safeFile(root, responsePath, 'SIGNATURE_RESPONSE');
  if (realPacket === realResponse) throw new Error('MECHANICAL_SIGNATURE_RESPONSE_INVALID');
  const output = safeNewOutput(root, outputPath);
  const packet = readJson(realPacket, 'MECHANICAL_SIGNING_PACKET_INVALID');
  if (packet.kind !== kind) throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');
  let rebuilt;
  try {
    rebuilt = buildMechanicalSigningPacket({
      kind,
      requestPath: safeSourceRequest(root, packet),
      evidenceRoot: root,
      now,
    }).packet;
  } catch {
    throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');
  }
  if (canonical(packet) !== canonical(rebuilt)) throw new Error('MECHANICAL_SIGNING_PACKET_INVALID');

  const response = readJson(realResponse, 'MECHANICAL_SIGNATURE_RESPONSE_INVALID');
  const trustedKeys = kind === 'blind' ? trustedBlindReviewers : trustedManufacturingInspectors;
  const responsesByKey = verifySignatureResponse(kind, response, packet, trustedKeys, now);
  const candidate = kind === 'blind'
    ? blindCandidate(packet, response, responsesByKey)
    : manufacturingCandidate(packet, response, responsesByKey);
  const valid = kind === 'blind'
    ? validateMechanicalBlindChallenge(candidate, { evidenceRoot: root, trustedReviewers: trustedKeys, now })
    : validateMechanicalManufacturingReceipt(candidate, { evidenceRoot: root, trustedInspectors: trustedKeys, now });
  if (!valid) throw new Error('MECHANICAL_CANDIDATE_RECEIPT_INVALID');

  const candidateBytes = Buffer.from(render(candidate));
  let outputSha256 = null;
  if (output !== null) {
    atomicNoReplace(output, candidateBytes);
    outputSha256 = sha256(candidateBytes);
  }
  return {
    candidate,
    candidateSha256: sha256(candidateBytes),
    output,
    outputSha256,
    claimBoundary: {
      assemblesCandidateReceipt: true,
      createsUnderlyingEvidence: false,
      createsSignatures: false,
      grantsCommercialRelease: false,
    },
  };
}

export function main(args = process.argv.slice(2)) {
  const kind = option(args, 'kind');
  const packetPath = option(args, 'packet');
  const responsePath = option(args, 'response');
  const evidenceRoot = option(args, 'evidence-root');
  const outputPath = option(args, 'output');
  const checkOnly = args.includes('--check');
  if (!checkOnly && !outputPath) {
    throw new Error('Usage: --kind=blind|manufacturing --packet=<packet.json> --response=<signature-response.json> --evidence-root=<external-root> (--check | --output=<candidate.json>)');
  }
  const result = assembleMechanicalCommercialCandidate({
    kind,
    packetPath,
    responsePath,
    evidenceRoot,
    outputPath: checkOnly ? null : outputPath,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    kind,
    candidateSchema: result.candidate.schema,
    candidateSha256: result.candidateSha256,
    output: result.output,
    outputSha256: result.outputSha256,
    claimBoundary: result.claimBoundary,
  })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === TOOL_PATH) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mechanical-candidate-assembler] ${message}\n`);
    process.exitCode = message.endsWith('_INVALID') ? 4 : 2;
  }
}
