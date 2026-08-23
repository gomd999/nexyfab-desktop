import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildOpenScadHttpSmokeReceipt, classifyStl, verifyOpenScadHttpSmokeReceipt } from './build-openscad-http-smoke-v2.mjs';
import { verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

const gitHead = '0123456789abcdef0123456789abcdef01234567';
const release = { buildId: 'build-http-v2', deploymentId: 'deploy-http-v2', gitHead };
const now = Date.parse('2026-08-23T12:00:00.000Z');
const smokeRequest = { scad: 'cube([2,3,4]);', format: 'stl', async: true };

function binaryTriangle() {
  const bytes = Buffer.alloc(134);
  bytes.write('NexyFab fixture STL', 0, 'ascii');
  bytes.writeUInt32LE(1, 80);
  bytes.writeFloatLE(0, 84); bytes.writeFloatLE(0, 88); bytes.writeFloatLE(1, 92);
  bytes.writeFloatLE(0, 96); bytes.writeFloatLE(0, 100); bytes.writeFloatLE(0, 104);
  bytes.writeFloatLE(1, 108); bytes.writeFloatLE(0, 112); bytes.writeFloatLE(0, 116);
  bytes.writeFloatLE(0, 120); bytes.writeFloatLE(1, 124); bytes.writeFloatLE(0, 128);
  return bytes;
}

const asciiTriangle = Buffer.from(`solid fixture\n  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 0 1 0\n    endloop\n  endfacet\nendsolid fixture\n`, 'ascii');

function response(bytes, overrides = {}) {
  return {
    startedAt: new Date(now - 1_000).toISOString(),
    completedAt: new Date(now - 100).toISOString(),
    submitStatus: 200,
    pollStatus: 200,
    submitted: { mode: 'async', pollUrl: '/api/nexyfab/openscad-render/job/job-1' },
    completed: { status: 'complete', format: 'stl', dataBase64: bytes.toString('base64') },
    ...overrides,
  };
}

function fixture(bytes = binaryTriangle()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-openscad-http-v2-'));
  const artifactPath = path.join(root, 'artifacts', 'result.stl');
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, bytes);
  return { root, artifactPath };
}

test('builds and verifies a production-bound binary STL receipt from exact HTTP bytes', () => {
  const bytes = binaryTriangle();
  const { root } = fixture(bytes);
  const receipt = buildOpenScadHttpSmokeReceipt({
    root,
    artifactPath: 'artifacts/result.stl',
    response: response(bytes),
    request: smokeRequest,
    release,
    target: 'https://nexyfab.com/',
    generatedAt: new Date(now).toISOString(),
    now,
  });
  assert.equal(receipt.schema, 'nexyfab.openscad-http-smoke.v2');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.target, 'https://nexyfab.com');
  assert.equal(receipt.format, 'binary');
  assert.equal(receipt.outputBytes, bytes.length);
  assert.equal(receipt.outputSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(receipt.release, release);
  assert.equal(receipt.sourceBindings[0].path, 'artifacts/result.stl');
  assert.equal(verifyReceiptSha256(receipt), true);
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, release, { root, now }), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('detects ASCII STL and accepts a real 40-character git SHA', () => {
  const { root } = fixture(asciiTriangle);
  const receipt = buildOpenScadHttpSmokeReceipt({
    root,
    artifactPath: 'artifacts/result.stl',
    response: response(asciiTriangle),
    request: smokeRequest,
    release,
    generatedAt: new Date(now).toISOString(),
    now,
  });
  assert.deepEqual(classifyStl(asciiTriangle), { format: 'ascii', triangles: 1 });
  assert.equal(receipt.format, 'ascii');
  assert.equal(receipt.artifact.triangles, 1);
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, { buildId: release.buildId, deploymentId: release.deploymentId, head: gitHead }, { root, now }), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('also accepts a 64-character git SHA without weakening release binding', () => {
  const { root } = fixture();
  const longRelease = { ...release, gitHead: 'a'.repeat(64) };
  const receipt = buildOpenScadHttpSmokeReceipt({
    root,
    artifactPath: 'artifacts/result.stl',
    response: response(binaryTriangle()),
    request: smokeRequest,
    release: longRelease,
    generatedAt: new Date(now).toISOString(),
    now,
  });
  assert.equal(receipt.release.gitHead, longRelease.gitHead);
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, longRelease, { root, now }), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for mismatched response bytes, stale receipt, target transplant, and artifact tampering', () => {
  const bytes = binaryTriangle();
  const other = Buffer.from(bytes); other[10] ^= 1;
  const { root, artifactPath } = fixture(bytes);
  assert.throws(() => buildOpenScadHttpSmokeReceipt({ root, artifactPath: 'artifacts/result.stl', response: response(other), request: smokeRequest, release, now }), /do not match/);
  const receipt = buildOpenScadHttpSmokeReceipt({ root, artifactPath: 'artifacts/result.stl', response: response(bytes), request: smokeRequest, release, generatedAt: new Date(now).toISOString(), now });
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, release, { root, now: now + 25 * 60 * 60_000 }), false);
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, release, { root, now, target: 'https://staging.nexyfab.com' }), false);
  fs.appendFileSync(artifactPath, Buffer.from([0]));
  assert.equal(verifyOpenScadHttpSmokeReceipt(receipt, release, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects non-production targets, invalid HTTP response state, and non-STL artifacts', () => {
  const bytes = Buffer.from('not an stl');
  const { root } = fixture(bytes);
  const common = { root, artifactPath: 'artifacts/result.stl', request: smokeRequest, release, now };
  assert.throws(() => buildOpenScadHttpSmokeReceipt({ ...common, response: response(bytes) }), /not a valid/);
  assert.throws(() => buildOpenScadHttpSmokeReceipt({ ...common, target: 'https://staging.nexyfab.com', response: response(bytes) }), /production/);
  assert.throws(() => buildOpenScadHttpSmokeReceipt({ ...common, response: response(binaryTriangle(), { pollStatus: 500 }) }), /status must be 200/);
  fs.rmSync(root, { recursive: true, force: true });
});
