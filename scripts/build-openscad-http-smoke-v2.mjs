#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { attachReceiptSha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

const SCHEMA = 'nexyfab.openscad-http-smoke.v2';
const PRODUCTION_TARGET = 'https://nexyfab.com';
const MAX_AGE_MS = 24 * 60 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedTarget(value) {
  try {
    const url = new URL(String(value));
    return url.origin;
  } catch {
    return null;
  }
}

function releaseBinding(input) {
  const release = input?.release ?? input ?? {};
  const buildId = release.buildId;
  const deploymentId = release.deploymentId;
  const gitHead = release.gitHead ?? release.head;
  if (typeof buildId !== 'string' || !buildId.trim()) throw new Error('release.buildId is required');
  if (typeof deploymentId !== 'string' || !deploymentId.trim()) throw new Error('release.deploymentId is required');
  if (typeof gitHead !== 'string' || !GIT_COMMIT_SHA.test(gitHead.trim())) {
    throw new Error('release.gitHead must be a real 40- or 64-character git SHA');
  }
  return { buildId: buildId.trim(), deploymentId: deploymentId.trim(), gitHead: gitHead.trim() };
}

function relativeArtifactBinding(root, artifactPath, bytes) {
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) throw new Error('artifactPath is required');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, artifactPath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('artifactPath must be inside root');
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('artifactPath must not be a symbolic link');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('artifactPath resolves outside root');
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) throw new Error('artifactPath must be a regular file');
  return {
    path: relative.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function readArtifact(root, artifactPath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, artifactPath);
  const bytes = fs.readFileSync(absolute);
  return { bytes, binding: relativeArtifactBinding(resolvedRoot, artifactPath, bytes) };
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value.trim() || /[^A-Za-z0-9+/=\r\n]/.test(value)) {
    throw new Error('completed.dataBase64 must be a base64 string');
  }
  const compact = value.replace(/[\r\n]/g, '');
  if (compact.length % 4 === 1 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error('completed.dataBase64 is not valid base64');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length) throw new Error('completed.dataBase64 is empty');
  return bytes;
}

function binaryStl(bytes) {
  if (bytes.length < 84) return null;
  const triangles = bytes.readUInt32LE(80);
  const expectedBytes = 84 + triangles * 50;
  if (triangles <= 0 || expectedBytes !== bytes.length) return null;
  return { format: 'binary', triangles };
}

function asciiStl(bytes) {
  const text = bytes.toString('utf8');
  if (!/^\s*solid(?:\s|$)/i.test(text) || !/\bfacet\s+normal\b/i.test(text)
    || !/\bouter\s+loop\b/i.test(text) || !/\bendsolid\b/i.test(text)) return null;
  const vertices = text.match(/\bvertex\s+[-+0-9.eE]+\s+[-+0-9.eE]+\s+[-+0-9.eE]+\b/gi) ?? [];
  const facets = text.match(/\bfacet\s+normal\b/gi) ?? [];
  if (!vertices.length || vertices.length % 3 !== 0 || facets.length !== vertices.length / 3) return null;
  return { format: 'ascii', triangles: facets.length };
}

export function classifyStl(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('STL bytes are required');
  const value = Buffer.from(bytes);
  const detected = binaryStl(value) ?? asciiStl(value);
  if (!detected) throw new Error('response is not a valid non-empty binary or ASCII STL');
  return detected;
}

function responseParts(response) {
  const submitted = response?.submitted ?? response?.submit?.body ?? response?.submit ?? null;
  const completed = response?.completed ?? response?.complete?.body ?? response?.poll?.body ?? response?.poll ?? null;
  const submitStatus = response?.submitStatus ?? response?.submit?.status;
  const pollStatus = response?.pollStatus ?? response?.complete?.status ?? response?.poll?.status;
  if (!submitted || !completed || !Number.isInteger(submitStatus) || !Number.isInteger(pollStatus)) {
    throw new Error('mock HTTP response must include submitted/completed bodies and HTTP statuses');
  }
  if (submitStatus !== 200 || pollStatus !== 200) throw new Error('OpenSCAD HTTP response status must be 200');
  if (submitted.mode !== 'async' || !validPollUrl(submitted.pollUrl)) {
    throw new Error('OpenSCAD submit response must be an async job with pollUrl');
  }
  if (completed.status !== 'complete') throw new Error('OpenSCAD poll response must be complete');
  if (String(completed.format ?? '').toLowerCase() !== 'stl') throw new Error('OpenSCAD poll response format must be stl');
  return { submitted, completed, submitStatus, pollStatus };
}

function validPollUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  try {
    const url = new URL(value, PRODUCTION_TARGET);
    return url.origin === PRODUCTION_TARGET
      && /^\/api\/nexyfab\/openscad-render\/job\/[A-Za-z0-9_-]+$/.test(url.pathname)
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function requestMetadata(request) {
  if (!request || typeof request.scad !== 'string' || !request.scad.trim()
    || request.format !== 'stl' || request.async !== true) throw new Error('OpenSCAD smoke request contract is invalid');
  const scad = Buffer.from(request.scad, 'utf8');
  return { scadBytes: scad.byteLength, scadSha256: sha256(scad), format: 'stl', async: true };
}

function responseTiming(response, generatedAt) {
  const startedAt = Date.parse(response?.startedAt);
  const completedAt = Date.parse(response?.completedAt);
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || !Number.isFinite(generated)
    || startedAt > completedAt || completedAt > generated + 5 * 60_000) throw new Error('OpenSCAD HTTP observation timing is invalid');
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt,
  };
}

function fresh(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= now + 5 * 60_000
    && timestamp >= now - MAX_AGE_MS;
}

function validLocalBinding(binding, root) {
  if (typeof binding?.path !== 'string' || !binding.path || path.isAbsolute(binding.path)
    || binding.path === '.' || binding.path.split(/[\\/]+/).includes('..')
    || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !SHA256.test(String(binding.sha256 ?? ''))) return false;
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, binding.path);
  if (absolute === resolvedRoot || !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) return false;
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realFile = fs.realpathSync.native(absolute);
    const realRelative = path.relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
    const bytes = fs.readFileSync(realFile);
    return fs.statSync(realFile).isFile() && bytes.byteLength === binding.bytes && sha256(bytes) === binding.sha256;
  } catch {
    return false;
  }
}

/**
 * Build a v2 receipt from mocked HTTP submit/poll responses and an exact local
 * artifact file. No HTTP request is made by this function.
 */
export function buildOpenScadHttpSmokeReceipt({
  response,
  request,
  artifactPath,
  root = process.cwd(),
  release,
  buildId,
  deploymentId,
  gitHead,
  target = PRODUCTION_TARGET,
  generatedAt,
  now = Date.now(),
} = {}) {
  const targetOrigin = normalizedTarget(target);
  if (targetOrigin !== PRODUCTION_TARGET) throw new Error('target must be the production https://nexyfab.com origin');
  if (!Number.isFinite(now)) throw new Error('now must be a finite epoch timestamp');
  const releaseValue = releaseBinding(release ?? { buildId, deploymentId, gitHead });
  const parts = responseParts(response);
  const requestValue = requestMetadata(request);
  const responseBytes = decodeBase64(parts.completed.dataBase64);
  const artifact = readArtifact(root, artifactPath);
  if (!responseBytes.equals(artifact.bytes)) throw new Error('local artifact bytes do not match HTTP response bytes');
  const detected = classifyStl(responseBytes);
  const generated = generatedAt ?? new Date(now).toISOString();
  if (!Number.isFinite(Date.parse(generated))) throw new Error('generatedAt must be an ISO-parseable timestamp');
  const timing = responseTiming(response, generated);
  const receipt = {
    schema: SCHEMA,
    generatedAt: new Date(Date.parse(generated)).toISOString(),
    target: PRODUCTION_TARGET,
    ok: true,
    release: releaseValue,
    request: requestValue,
    timing,
    http: {
      submitStatus: parts.submitStatus,
      pollStatus: parts.pollStatus,
      mode: parts.submitted.mode,
      pollUrl: parts.submitted.pollUrl,
      completionStatus: parts.completed.status,
      declaredFormat: 'stl',
    },
    artifact: {
      path: artifact.binding.path,
      bytes: artifact.binding.bytes,
      sha256: artifact.binding.sha256,
      format: detected.format,
      triangles: detected.triangles,
    },
    sourceBindings: [artifact.binding],
    outputBytes: artifact.binding.bytes,
    outputSha256: artifact.binding.sha256,
    format: detected.format,
  };
  return attachReceiptSha256(receipt);
}

/** Fail closed: malformed, stale, transplanted, tampered, or non-STL receipts return false. */
export function verifyOpenScadHttpSmokeReceipt(receipt, expectedRelease, {
  root = process.cwd(),
  now = Date.now(),
  target = PRODUCTION_TARGET,
} = {}) {
  try {
    if (!receipt || typeof receipt !== 'object' || !Number.isFinite(now)) return false;
    const expected = releaseBinding(expectedRelease);
    if (receipt.schema !== SCHEMA || receipt.ok !== true || normalizedTarget(receipt.target) !== PRODUCTION_TARGET
      || normalizedTarget(target) !== PRODUCTION_TARGET || !fresh(receipt.generatedAt, now)
      || !verifyReceiptSha256(receipt)) return false;
    const release = receipt.release;
    if (release?.buildId !== expected.buildId || release?.deploymentId !== expected.deploymentId || release?.gitHead !== expected.gitHead) return false;
    const binding = receipt.sourceBindings?.length === 1 ? receipt.sourceBindings[0] : null;
    if (!binding || !validLocalBinding(binding, root)) return false;
    const absolute = path.resolve(root, binding.path);
    const artifactBytes = fs.readFileSync(absolute);
    const detected = classifyStl(artifactBytes);
    if (binding.bytes !== artifactBytes.byteLength || binding.sha256 !== sha256(artifactBytes)
      || receipt.artifact?.path !== binding.path || receipt.artifact?.bytes !== binding.bytes
      || receipt.artifact?.sha256 !== binding.sha256 || receipt.outputBytes !== binding.bytes
      || receipt.outputSha256 !== binding.sha256 || receipt.format !== detected.format
      || receipt.artifact?.format !== detected.format || receipt.artifact?.triangles !== detected.triangles) return false;
    const http = receipt.http;
    return http?.submitStatus === 200 && http?.pollStatus === 200 && http?.mode === 'async'
      && validPollUrl(http.pollUrl)
      && http.completionStatus === 'complete' && http.declaredFormat === 'stl'
      && receipt?.request?.format === 'stl' && receipt.request.async === true
      && Number.isInteger(receipt.request.scadBytes) && receipt.request.scadBytes > 0
      && SHA256.test(String(receipt.request.scadSha256 ?? ''))
      && Number.isFinite(Date.parse(receipt?.timing?.startedAt))
      && Number.isFinite(Date.parse(receipt?.timing?.completedAt))
      && Date.parse(receipt.timing.startedAt) <= Date.parse(receipt.timing.completedAt)
      && receipt.timing.durationMs === Date.parse(receipt.timing.completedAt) - Date.parse(receipt.timing.startedAt);
  } catch {
    return false;
  }
}

export const buildOpenScadHttpSmokeV2Receipt = buildOpenScadHttpSmokeReceipt;
