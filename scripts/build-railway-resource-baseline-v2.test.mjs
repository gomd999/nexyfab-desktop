import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resourceBaselineReceiptEligible } from './commercialization-readiness-gate.mjs';
import { verifyReceiptSha256 } from './immutable-receipt-binding.mjs';
import {
  buildRailwayResourceBaseline,
  captureRailwayResourceBaselineV2,
  normalizeRailwayResourceMetrics,
  railwayResourceMetricsArguments,
  verifyRailwayResourceBaselineDerivation,
} from './build-railway-resource-baseline-v2.mjs';

const gitHead = '0123456789abcdef0123456789abcdef01234567';
const release = { buildId: 'build-20260823', deploymentId: 'deploy-20260823', gitHead };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-baseline-'));
  const sourcePath = path.join(root, 'metrics.json');
  const source = {
    schema: 'nexyfab.railway-resource-baseline.v1',
    capturedAt: '2026-08-23T10:00:00.000Z',
    memory: { maxMb: 488.8, limitMb: 8192 },
    samples: [{ memory: { max_mb: 512 } }, { memory: { currentMb: 256 } }],
    // Deliberately contradictory legacy claims. The builder must not copy
    // these booleans or target values into the v2 assessment.
    assessment: { runtimeMemoryTargetMb: 1, currentMaxWithinTarget: true, sevenDayBaselineRequired: false },
  };
  fs.writeFileSync(sourcePath, JSON.stringify(source), 'utf8');
  return { root, sourcePath, source };
}

test('builds an eligible v2 receipt from exact source bytes and derives assessment', () => {
  const { root, sourcePath } = fixture();
  const now = Date.parse('2026-08-23T10:05:00.000Z');
  const receipt = buildRailwayResourceBaseline({
    root,
    sourcePath: 'metrics.json',
    release,
    runtimeMemoryTargetMb: 768,
    now,
    generatedAt: new Date(now).toISOString(),
  });
  const sourceBytes = fs.readFileSync(sourcePath);
  assert.equal(receipt.schema, 'nexyfab.railway-resource-baseline.v2');
  assert.equal(receipt.memory.maxMb, 512);
  assert.equal(receipt.assessment.runtimeMemoryTargetMb, 768);
  assert.equal(receipt.assessment.currentMaxWithinTarget, true);
  assert.equal(receipt.assessment.sevenDayBaselineRequired, true);
  assert.deepEqual(receipt.release, release);
  assert.deepEqual(receipt.sourceBindings, [{
    path: 'metrics.json',
    bytes: sourceBytes.byteLength,
    sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  }]);
  assert.equal(verifyReceiptSha256(receipt), true);
  assert.equal(resourceBaselineReceiptEligible(receipt, {
    buildId: release.buildId,
    deploymentId: release.deploymentId,
    head: gitHead,
  }, { root, now }), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('supports a real 40-character git SHA and rejects self-asserted target booleans', () => {
  const { root } = fixture();
  const now = Date.parse('2026-08-23T10:05:00.000Z');
  const receipt = buildRailwayResourceBaseline({ root, sourcePath: 'metrics.json', release, targetMb: 400, now });
  assert.equal(receipt.release.gitHead.length, 40);
  assert.equal(receipt.memory.maxMb, 512);
  assert.equal(receipt.assessment.currentMaxWithinTarget, false);
  assert.equal(receipt.assessment.sevenDayBaselineRequired, true);
  assert.equal(resourceBaselineReceiptEligible(receipt, { ...release, head: undefined }, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('binds the exact source bytes and fails eligibility after source mutation or receipt tampering', () => {
  const { root, sourcePath } = fixture();
  const now = Date.parse('2026-08-23T10:05:00.000Z');
  const receipt = buildRailwayResourceBaseline({ root, sourcePath: 'metrics.json', release, now });
  assert.equal(resourceBaselineReceiptEligible(receipt, { ...release, head: gitHead }, { root, now }), true);

  fs.appendFileSync(sourcePath, '\n');
  assert.equal(resourceBaselineReceiptEligible(receipt, { ...release, head: gitHead }, { root, now }), false);

  const tampered = structuredClone(receipt);
  tampered.memory.maxMb = 1;
  assert.equal(resourceBaselineReceiptEligible(tampered, { ...release, head: gitHead }, { root, now }), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('does not manufacture a receipt from legacy/current booleans without measurements', () => {
  const { root, sourcePath } = fixture();
  fs.writeFileSync(sourcePath, JSON.stringify({ assessment: { currentMaxWithinTarget: true, sevenDayBaselineRequired: true } }));
  assert.throws(() => buildRailwayResourceBaseline({ root, sourcePath: 'metrics.json', release }), /no memory measurements/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('captures fixture metrics into a normalized non-secret source bound by exact bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-capture-'));
  const now = Date.parse('2026-08-23T10:05:00.000Z');
  const receipt = captureRailwayResourceBaselineV2({
    root,
    sourcePath: 'capture/metrics.json',
    metrics: {
      service: 'nexyfab.com',
      environment: 'production',
      memory: { max_mb: 640, current_mb: 512, limit_mb: 8192 },
      DATABASE_URL: 'postgres://user:password@example.invalid/secret',
      variables: { OPENAI_API_KEY: 'secret-token' },
    },
    release,
    runtimeMemoryTargetMb: 768,
    capturedAt: new Date(now).toISOString(),
    generatedAt: new Date(now).toISOString(),
    now,
  });
  const sourcePath = path.join(root, 'capture/metrics.json');
  const sourceBytes = fs.readFileSync(sourcePath);
  const source = JSON.parse(sourceBytes.toString('utf8'));
  assert.equal(source.schema, 'nexyfab.railway-resource-metrics.v1');
  assert.equal(source.memory.maxMb, 640);
  assert.deepEqual(source.memory.samples, [{ memoryMb: 512 }]);
  assert.equal(source.DATABASE_URL, undefined);
  assert.equal(source.variables, undefined);
  assert.deepEqual(receipt.sourceBindings, [{
    path: 'capture/metrics.json',
    bytes: sourceBytes.byteLength,
    sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  }]);
  assert.equal(verifyRailwayResourceBaselineDerivation(receipt, { root }), true);
  assert.equal(verifyReceiptSha256(receipt), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('captures through an injected loader without exposing raw payload fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-loader-'));
  const calls = [];
  const now = Date.parse('2026-08-23T10:05:00.000Z');
  const receipt = captureRailwayResourceBaselineV2({
    root,
    sourcePath: 'metrics.json',
    service: 'worker.example',
    loadMetrics: (...args) => {
      calls.push(args);
      return { memory: { rss_mb: 128 }, secret: 'must-not-persist' };
    },
    release,
    capturedAt: new Date(now).toISOString(),
    generatedAt: new Date(now).toISOString(),
    now,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'worker.example');
  assert.equal(calls[0][1], 'production');
  assert.equal(calls[0][2].since, '2026-08-23T04:05:00.000Z');
  assert.equal(calls[0][2].until, '2026-08-23T10:05:00.000Z');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'metrics.json'), 'utf8')).secret, undefined);
  assert.equal(receipt.memory.maxMb, 128);
  fs.rmSync(root, { recursive: true, force: true });
});

test('builds a memory-only raw JSON Railway metrics command without a shell', () => {
  assert.deepEqual(railwayResourceMetricsArguments('nexyfab.com', 'production', {
    since: '2026-08-23T04:05:00.000Z',
    until: '2026-08-23T10:05:00.000Z',
    project: 'project-id',
  }), [
    'metrics', '--service', 'nexyfab.com', '--environment', 'production',
    '--since', '2026-08-23T04:05:00.000Z', '--until', '2026-08-23T10:05:00.000Z',
    '--project', 'project-id', '--memory', '--raw', '--json',
  ]);
  assert.throws(() => railwayResourceMetricsArguments('unsafe service', 'production'), /safe name/);
  assert.throws(() => railwayResourceMetricsArguments('nexyfab.com', 'staging'), /must be production/);
});

test('rejects unsafe metrics and source paths before writing evidence', () => {
  assert.throws(() => normalizeRailwayResourceMetrics({ metrics: { memory: { max_mb: -1 } } }), /no memory measurements/);
  assert.throws(() => normalizeRailwayResourceMetrics({ metrics: { memory: { max_mb: Number.NaN } } }), /no memory measurements/);
  assert.throws(() => normalizeRailwayResourceMetrics({ metrics: { memory: { max_mb: '512' } } }), /no memory measurements/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-path-'));
  assert.throws(() => captureRailwayResourceBaselineV2({
    root,
    sourcePath: '../escape.json',
    metrics: { memory: { max_mb: 1 } },
    release,
  }), /sourcePath must be inside root/);

  assert.throws(() => captureRailwayResourceBaselineV2({
    root,
    sourcePath: 'metrics.json',
    service: 'nexyfab.com',
    metrics: { service: 'other-service', memory: { max_mb: 1 } },
    release,
  }), /service mismatch/);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escape.json')), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects a parent junction or symlink that resolves outside the evidence root', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-junction-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-resource-junction-outside-'));
  const link = path.join(root, 'linked');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    t.skip(`directory link creation unavailable: ${error.code ?? error.message}`);
    return;
  }

  assert.throws(() => captureRailwayResourceBaselineV2({
    root,
    sourcePath: 'linked/metrics.json',
    metrics: { memory: { max_mb: 1 } },
    release,
  }), /parent resolves outside root/);
  assert.equal(fs.existsSync(path.join(outside, 'metrics.json')), false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});
