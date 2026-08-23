import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCommercialLiveSmokeReceipt,
  LIVE_SMOKE_REQUIRED_CHECKS,
  observationFromResponse,
  verifyCommercialLiveSmokeReceipt,
  writeSmokeObservationArtifact,
} from './build-commercial-live-smoke-receipt-v2.mjs';

const now = Date.parse('2026-08-23T12:00:00.000Z');
const release = { buildId: 'build-live-v2', deploymentId: 'deploy-live-v2', gitHead: 'a'.repeat(40) };

function fixture() {
  const requestById = {
    live: { method: 'GET', pathname: '/api/health/live' },
    ready: { method: 'GET', pathname: '/api/health/ready' },
    capabilities: { method: 'GET', pathname: '/api/cad/v1/capabilities' },
    'scad-agent-route': { method: 'HEAD', pathname: '/api/nexyfab/scad-agent' },
    openscad: { method: 'GET', pathname: '/api/health/openscad' },
  };
  const observations = LIVE_SMOKE_REQUIRED_CHECKS.map((id, index) => observationFromResponse({
    id, ...requestById[id], httpStatus: id === 'scad-agent-route' ? 405 : 200,
    responseBody: Buffer.from(`${id}-exact-body-${index}`), contentType: 'application/json',
  }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-live-smoke-v2-'));
  const generatedAt = new Date(now).toISOString();
  const source = writeSmokeObservationArtifact({ root, artifactPath: 'observations/live.json', generatedAt, observations });
  const results = observations.map(observation => ({ id: observation.id, status: 'pass', httpStatus: observation.httpStatus, observation }));
  const receipt = buildCommercialLiveSmokeReceipt({ root, results, observations, release, generatedAt, now, sourceBindings: [source.binding], ready: {
    status: 'ok', db: { status: 'ok', required: true, backend: 'postgres' }, redis: { status: 'ok', required: true }, commercialBoundary: { status: 'ok', required: true },
  } });
  return { root, receipt, observations };
}

test('builds an immutable production smoke receipt from exact response observations', () => {
  const { root, receipt } = fixture();
  assert.equal(verifyCommercialLiveSmokeReceipt(receipt, release, { root, now }), true);
  assert.equal(receipt.results[0].observation.bodySha256, crypto.createHash('sha256').update('live-exact-body-0').digest('hex'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects observations captured from the wrong endpoint even when rehashed', () => {
  const { root, receipt } = fixture();
  const forged = structuredClone(receipt);
  forged.results[0].observation.request.pathname = '/api/health/ready';
  forged.observations[0].request.pathname = '/api/health/ready';
  const sourcePath = path.join(root, forged.sourceBindings[0].path);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  source.observations = forged.observations;
  const bytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  fs.writeFileSync(sourcePath, bytes);
  forged.sourceBindings[0] = { ...forged.sourceBindings[0], bytes: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  delete forged.sha256;
  forged.sha256 = crypto.createHash('sha256').update(JSON.stringify(forged)).digest('hex');
  assert.equal(verifyCommercialLiveSmokeReceipt(forged, release, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed for synthetic labels, source tampering, stale receipts, and release transplant', () => {
  const { root, receipt } = fixture();
  const synthetic = structuredClone(receipt);
  synthetic.results[0].observation.bodySha256 = 'b'.repeat(64);
  synthetic.sha256 = crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(synthetic).filter(([key]) => key !== 'sha256')))).digest('hex');
  assert.equal(verifyCommercialLiveSmokeReceipt(synthetic, release, { root, now }), false, 'hash alone cannot replace an observation artifact');
  fs.appendFileSync(path.join(root, 'observations/live.json'), 'tampered');
  assert.equal(verifyCommercialLiveSmokeReceipt(receipt, release, { root, now }), false);
  assert.equal(verifyCommercialLiveSmokeReceipt(receipt, release, { root, now: now + 25 * 60 * 60_000 }), false);
  assert.equal(verifyCommercialLiveSmokeReceipt(receipt, { ...release, deploymentId: 'other' }, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('accepts real 64-character git SHA and rejects missing exact observations', () => {
  const { root, receipt } = fixture();
  const long = { ...release, gitHead: 'c'.repeat(64) };
  const rebuilt = { ...receipt, release: long };
  delete rebuilt.sha256;
  rebuilt.sha256 = crypto.createHash('sha256').update(JSON.stringify(rebuilt)).digest('hex');
  assert.equal(verifyCommercialLiveSmokeReceipt(rebuilt, long, { root, now }), true);
  const missing = structuredClone(receipt);
  missing.observations = [];
  delete missing.sha256;
  missing.sha256 = crypto.createHash('sha256').update(JSON.stringify(missing)).digest('hex');
  assert.equal(verifyCommercialLiveSmokeReceipt(missing, release, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});
