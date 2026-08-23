import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { DOMAIN_ACCURACY_PROFILES } from '../src/contract.mjs';
import { createAiServer } from '../src/server.mjs';

async function withServer(env, callback) {
  const server = createAiServer(env, () => new Date('2026-08-23T00:00:00.000Z'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function withAnalysisHealth(payload, callback) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/healthz') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function passingEvidence(domain) {
  return {
    domain,
    approvedCases: 20,
    independentReviewers: 2,
    campaigns: 3,
    minimumRepeatsPerCase: 15,
    minimumRepeatsPerCampaign: 5,
    requiredGateRuns: 3,
    requiredGatePasses: 3,
    falseVerified: 0,
    falseClear: 0,
    destructivePartMerge: 0,
    axes: DOMAIN_ACCURACY_PROFILES[domain].requiredAxes.map(axis => ({ axis, expected: 20, measured: 20, passed: 19 })),
  };
}

test('assessment is deterministic and fail-closed', async () => {
  await withServer({}, async baseUrl => {
    const pass = await fetch(`${baseUrl}/contract/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(passingEvidence('mechanical')),
    });
    assert.equal(pass.status, 200);
    assert.equal((await pass.json()).eligible, true);

    const holdEvidence = passingEvidence('mechanical');
    holdEvidence.axes = holdEvidence.axes.slice(1);
    const hold = await fetch(`${baseUrl}/contract/assess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(holdEvidence),
    });
    const payload = await hold.json();
    assert.equal(payload.eligible, false);
    assert.ok(payload.blockers.includes('accuracy:requirements'));
  });
});

test('ready requires the canonical Analysis binding and safe MODEL_NOT_RUN probe', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'ai-test' }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  });
  await withAnalysisHealth({
    service: 'analysis-worker',
    state: 'ok',
    aiQualification: 'MODEL_NOT_RUN',
  }, async analysisUrl => {
    await withServer({
      NEXYFAB_BUILD_ID: 'ai-test',
      ANALYSIS_URL: analysisUrl,
      ANALYSIS_AUTH_TOKEN: 'a'.repeat(32),
      AI_LIVE_ENABLED: 'false',
    }, async baseUrl => {
      const ready = await fetch(`${baseUrl}/health/ready`);
      const payload = await ready.json();
      assert.equal(ready.status, 200);
      assert.equal(payload.dependencies.analysis.state, 'PASS');
      assert.equal(payload.dependencies.analysis.qualification, 'MODEL_NOT_RUN');
      assert.equal((await fetch(`${baseUrl}/health/release`)).status, 503);
    });
  });
});

test('ready rejects live AI execution and an unsafe Analysis qualification', async () => {
  await withServer({
    NEXYFAB_BUILD_ID: 'ai-test',
    ANALYSIS_URL: 'http://analysis.internal',
    ANALYSIS_AUTH_TOKEN: 'a'.repeat(32),
    AI_LIVE_ENABLED: 'true',
  }, async baseUrl => {
    const payload = await (await fetch(`${baseUrl}/health/ready`)).json();
    assert.ok(payload.blockers.includes('live_model_must_remain_disabled'));
  });
  await withAnalysisHealth({
    service: 'analysis-worker',
    state: 'ok',
    aiQualification: 'LIVE_PASS',
  }, async analysisUrl => {
    await withServer({
      NEXYFAB_BUILD_ID: 'ai-test',
      ANALYSIS_URL: analysisUrl,
      ANALYSIS_AUTH_TOKEN: 'a'.repeat(32),
      AI_LIVE_ENABLED: 'false',
    }, async baseUrl => {
      const response = await fetch(`${baseUrl}/health/ready`);
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.match(payload.blockers.join(','), /analysis_safe_state_invalid/);
    });
  });
});
