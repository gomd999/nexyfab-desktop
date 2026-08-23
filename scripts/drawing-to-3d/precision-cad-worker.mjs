#!/usr/bin/env node
/**
 * One-shot Precision CAD worker.
 *
 * The web process deliberately starts a fresh Node process for every tool
 * call.  The worker accepts one JSON line and emits one JSON line; it never
 * receives browser paths, provider credentials, or a storage handle.
 */
import { createInterface } from 'node:readline';
import { callTool } from './mcp-server.mjs';

const MAX_LINE_BYTES = 512 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOLS = new Set([
  'list_domains', 'build_assembly', 'analyze_dfm', 'fab_estimate',
  'resolve_constraints', 'render_preview', 'blade_ring', 'loft_part',
]);
const CAD_OWNERSHIP_KEY = /^(?:cadOwnership|ownership|partId|partIds|canonicalPartId|canonicalPartIds|brepHandle|brepHandles|hostHandle|toolHandle|runtimeHandle|occtHandle|shapeHandle|featureId|featureIds|sketchId|sketchIds|entityId|entityIds|faceId|faceIds|edgeId|edgeIds|mateId|mateIds|cadHydrationBinding|canonicalMappingKey|mappingKey|sourceRecordId|sourceRecordIds)$/i;
const CAD_HYDRATION_SCHEMA = 'nexyfab.precision-cad-worker-hydration.v1';
const SAFE_CAD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;

function validCadHydrationBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    'expiresAt', 'geometryContentHash', 'issuedAt', 'projectId', 'revision',
    'schema', 'shapeIdentityHash', 'signature', 'sourceRecordId', 'userId',
    'workspaceContentHash', 'workspaceId',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (value.schema !== CAD_HYDRATION_SCHEMA || !SAFE_CAD_ID.test(value.userId ?? '') || !SAFE_CAD_ID.test(value.projectId ?? '') || !SAFE_CAD_ID.test(value.workspaceId ?? '') || !SAFE_CAD_ID.test(value.sourceRecordId ?? '')) return false;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.issuedAt) || value.issuedAt <= 0 || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.issuedAt) return false;
  if (!SHA256.test(value.workspaceContentHash ?? '') || !SHA256.test(value.geometryContentHash ?? '') || !SHA256.test(value.shapeIdentityHash ?? '') || !SIGNATURE.test(value.signature ?? '')) return false;
  return true;
}

function hasClientCadOwnershipReference(value, key = '') {
  if (CAD_OWNERSHIP_KEY.test(key)) return true;
  if (Array.isArray(value)) return value.some(item => hasClientCadOwnershipReference(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) => hasClientCadOwnershipReference(child, childKey));
  }
  return false;
}

function boundedJson(value, maxBytes) {
  try {
    const raw = JSON.stringify(value);
    return raw && Buffer.byteLength(raw, 'utf8') <= maxBytes ? raw : null;
  } catch {
    return null;
  }
}

function send(value) {
  const raw = boundedJson(value, MAX_LINE_BYTES);
  if (!raw) return process.exitCode = 1;
  process.stdout.write(`${raw}\n`);
}

async function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let line;
  for await (const candidate of lines) {
    if (line !== undefined) continue;
    line = candidate;
  }
  if (line === undefined || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    send({ ok: false, code: 'INVALID_INPUT' });
    return;
  }
  let request;
  try { request = JSON.parse(line); } catch {
    send({ ok: false, code: 'INVALID_INPUT' });
    return;
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || !SAFE_ID.test(request.projectId ?? '')
    || !Number.isSafeInteger(request.revision) || request.revision < 0
    || !Number.isSafeInteger(request.updatedAt) || request.updatedAt <= 0
    || !SAFE_ID.test(request.userId ?? '')
    || !TOOLS.has(request.tool)
    || !request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)) {
    send({ ok: false, code: 'INVALID_INPUT' });
    return;
  }
  // This child intentionally has no CAD-session/artifact hydration adapter.
  // Reject client ownership/runtime references even when the queue boundary
  // was bypassed; no process-local handle is ever trusted here.
  if (hasClientCadOwnershipReference(request.arguments)) {
    send({ ok: false, code: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
    return;
  }
  // The server may eventually send only this signed CAS key. This worker
  // currently has no DB/storage/OCCT consumer contract, so even a well-shaped
  // server binding must remain an explicit HOLD; it is never treated as a
  // handle and never passed to an installer-core tool.
  if (request.cadHydrationBinding !== undefined) {
    if (!validCadHydrationBinding(request.cadHydrationBinding)) {
      send({ ok: false, code: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
      return;
    }
    send({ ok: false, code: 'CAD_RUNTIME_HYDRATION_REQUIRED' });
    return;
  }
  const delay = Number(process.env.NEXYFAB_PRECISION_CAD_WORKER_DELAY_MS ?? 0);
  if (Number.isFinite(delay) && delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 60_000)));
  try {
    const result = await callTool(request.tool, request.arguments);
    send({ ok: true, result });
  } catch {
    // Do not return module paths, stack traces, or environment values.
    send({ ok: false, code: 'TOOL_FAILED' });
  }
}

main().catch(() => {
  send({ ok: false, code: 'WORKER_FAILED' });
});
