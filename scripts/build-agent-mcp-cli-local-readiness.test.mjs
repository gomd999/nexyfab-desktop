import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AGENT_MCP_CLI_COMMAND_SPECS,
  buildAgentMcpCliLocalReadiness,
  verifyAgentMcpCliLocalReadiness,
} from './build-agent-mcp-cli-local-readiness.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-agent-local-'));
  fs.writeFileSync(path.join(root, 'source.mjs'), 'export const capability = true;\n');
  const externalPath = 'windows-release.json';
  fs.writeFileSync(path.join(root, externalPath), `${JSON.stringify({
    status: 'PASS',
    releaseEligible: true,
    receiptSha256: crypto.createHash('sha256').update('external').digest('hex'),
    blockers: [],
  })}\n`);
  return { root, sourcePaths: ['source.mjs'], externalPath };
}

function passingRunner() {
  return { exitCode: 0, signal: null, error: null, stdout: 'ok\n', stderr: '' };
}

function options(fx) {
  return {
    root: fx.root,
    sourcePaths: fx.sourcePaths,
    externalReceiptPath: fx.externalPath,
    outputDir: 'raw',
    receiptPath: 'receipt.json',
    generatedAt: '2026-08-23T00:00:00.000Z',
  };
}

function verify(receipt, fx) {
  return verifyAgentMcpCliLocalReadiness(receipt, {
    root: fx.root,
    requiredSourcePaths: fx.sourcePaths,
    externalReceiptPath: fx.externalPath,
  });
}

test('builds a bound PASS_LOCAL receipt without promoting external SEA evidence', () => {
  const fx = fixture();
  const receipt = buildAgentMcpCliLocalReadiness({ ...options(fx), runner: passingRunner });
  assert.equal(receipt.status, 'PASS_LOCAL');
  assert.equal(receipt.localReady, true);
  assert.equal(receipt.commercialReleaseEligible, false);
  assert.equal(receipt.externalWindowsSea.status, 'HOLD');
  assert.equal(receipt.externalWindowsSea.releaseEligible, false);
  assert.equal(receipt.externalWindowsSea.observedReceiptStatus, 'PASS');
  assert.equal(receipt.externalWindowsSea.observedReleaseEligible, true);
  assert.equal(verify(receipt, fx), true);
});

test('reports command failures as HOLD and verifies the truthful HOLD receipt', () => {
  const fx = fixture();
  const failedId = AGENT_MCP_CLI_COMMAND_SPECS[1].id;
  const receipt = buildAgentMcpCliLocalReadiness({
    ...options(fx),
    runner: (_root, spec) => spec.id === failedId
      ? { exitCode: 1, signal: null, error: null, stdout: '', stderr: 'failed' }
      : passingRunner(),
  });
  assert.equal(receipt.status, 'HOLD');
  assert.equal(receipt.localReady, false);
  assert.deepEqual(receipt.blockers, [`local_command_failed:${failedId}`]);
  assert.equal(verify(receipt, fx), true);
});

test('can pass locally when external SEA evidence is absent while preserving external HOLD', () => {
  const fx = fixture();
  fs.unlinkSync(path.join(fx.root, fx.externalPath));
  const receipt = buildAgentMcpCliLocalReadiness({ ...options(fx), runner: passingRunner });
  assert.equal(receipt.status, 'PASS_LOCAL');
  assert.equal(receipt.externalWindowsSea.status, 'HOLD');
  assert.equal(receipt.externalWindowsSea.evidence, null);
  assert.equal(receipt.externalWindowsSea.observedReceiptStatus, 'MISSING');
  assert.equal(verify(receipt, fx), true);
});

test('rejects command artifact, source, receipt, and external authority tampering', () => {
  for (const mutation of ['artifact', 'source', 'receipt', 'external']) {
    const fx = fixture();
    const receipt = buildAgentMcpCliLocalReadiness({ ...options(fx), runner: passingRunner });
    if (mutation === 'artifact') fs.appendFileSync(path.join(fx.root, receipt.commandResults[0].evidence.path), ' ');
    if (mutation === 'source') fs.appendFileSync(path.join(fx.root, 'source.mjs'), '// changed\n');
    if (mutation === 'receipt') receipt.commercialReleaseEligible = true;
    if (mutation === 'external') fs.writeFileSync(path.join(fx.root, fx.externalPath), '{"status":"HOLD"}\n');
    assert.equal(verify(receipt, fx), false, mutation);
  }
});

test('rejects source-inventory reduction and unsafe output paths', () => {
  const fx = fixture();
  const receipt = buildAgentMcpCliLocalReadiness({ ...options(fx), runner: passingRunner });
  receipt.sourceInventory = [fx.externalPath];
  assert.equal(verify(receipt, fx), false);
  assert.throws(() => buildAgentMcpCliLocalReadiness({
    ...options(fx),
    receiptPath: '../escape.json',
    runner: passingRunner,
  }), /unsafe_output_path/);
});
