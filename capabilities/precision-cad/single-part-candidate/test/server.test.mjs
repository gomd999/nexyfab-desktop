import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { MECHANICAL_SINGLE_PART_REQUIRED_AXES } from '../src/contract.mjs';
import { createPrecisionServer } from '../src/server.mjs';

const INTERNAL_TOKEN = 'precision-internal-auth-token-0001';
const EXACT_TOKEN = 'exact-compute-auth-token-00000001';
const JOB_TOKEN = 'job-ingress-auth-token-000000001';
const HASH = char => char.repeat(64);
const BUILD_ID = 'a'.repeat(12);

async function withServer(env, callback) {
  const server = createPrecisionServer(env, () => new Date('2026-08-23T00:00:00.000Z'));
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

async function withDependencyService({ health, expectedToken, canaryCode, healthDelayMs = 0, rawHealth }, callback) {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz' && request.method === 'GET') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(rawHealth ?? JSON.stringify(health));
      }, healthDelayMs);
      return;
    }
    if (request.url === '/v1/jobs' && request.method === 'POST') {
      if (request.headers.authorization !== `Bearer ${expectedToken}`) {
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, code: 'FORBIDDEN' }));
        return;
      }
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, code: canaryCode }));
      return;
    }
    response.writeHead(404).end();
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

function readyEnv(exactKernelUrl, jobControlUrl, overrides = {}) {
  return {
    NEXYFAB_BUILD_ID: BUILD_ID,
    EXACT_KERNEL_URL: exactKernelUrl,
    EXACT_KERNEL_AUTH_TOKEN: EXACT_TOKEN,
    JOB_CONTROL_URL: jobControlUrl,
    JOB_CONTROL_AUTH_TOKEN: JOB_TOKEN,
    EXACT_KERNEL_IDENTITY: HASH('c'),
    INTERNAL_AUTH_TOKEN: INTERNAL_TOKEN,
    ...overrides,
  };
}

async function withReadyDependencies(callback, exactOverrides = {}, jobOverrides = {}) {
  await withDependencyService({
    health: {
      ok: true,
      service: 'occt-exact',
      producerBuildId: 'occt-build',
      workerIdentitySha256: HASH('b'),
      kernelIdentitySha256: HASH('c'),
      execution: 'NOT_RUN',
      ...exactOverrides,
    },
    expectedToken: EXACT_TOKEN,
    canaryCode: 'COMPUTE_REQUEST_REJECTED',
  }, async exactKernelUrl => {
    await withDependencyService({
      health: {
        ok: true,
        service: 'job-orchestrator',
        buildId: 'job-build',
        deploymentState: 'RUNNING',
        ...jobOverrides,
      },
      expectedToken: JOB_TOKEN,
      canaryCode: 'JOB_CONTRACT_REJECTED',
    }, jobControlUrl => callback(exactKernelUrl, jobControlUrl));
  });
}

test('source-run contract passes only the complete seven-axis receipt', async () => {
  await withServer({ INTERNAL_AUTH_TOKEN: INTERNAL_TOKEN }, async baseUrl => {
    const response = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${INTERNAL_TOKEN}` },
      body: JSON.stringify({
        feature: 'fixture',
        runs: MECHANICAL_SINGLE_PART_REQUIRED_AXES.map(axis => ({ feature: 'fixture', axis, status: 'PASS' })),
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { eligible: true, reasons: [] });
  });
});

test('source-run contract fails closed for a missing axis', async () => {
  await withServer({ INTERNAL_AUTH_TOKEN: INTERNAL_TOKEN }, async baseUrl => {
    const response = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${INTERNAL_TOKEN}` },
      body: JSON.stringify({ feature: 'fixture', runs: [] }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.eligible, false);
    assert.ok(payload.reasons.includes('axis_missing:create'));
  });
});

test('source-run contract denies missing or invalid internal authentication', async () => {
  await withServer({}, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/contract/source-runs`, { method: 'POST' })).status, 503);
  });
  await withServer({ INTERNAL_AUTH_TOKEN: INTERNAL_TOKEN }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/contract/source-runs`, { method: 'POST' })).status, 401);
  });
});

test('source-run endpoint rejects malformed, oversized, and incorrectly typed input', async () => {
  await withServer({ INTERNAL_AUTH_TOKEN: INTERNAL_TOKEN }, async baseUrl => {
    const headers = { authorization: `Bearer ${INTERNAL_TOKEN}` };
    const malformed = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'invalid_json' });

    const wrongType = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const invalidContract = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(invalidContract.status, 422);

    const oversized = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ feature: 'fixture', padding: 'x'.repeat(256 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});

test('ready requires immutable bindings plus authenticated Exact and Job probes', async () => {
  await withServer({ NEXYFAB_BUILD_ID: BUILD_ID }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  });
  await withReadyDependencies(async (exactKernelUrl, jobControlUrl) => {
      await withServer(readyEnv(exactKernelUrl, jobControlUrl), async baseUrl => {
        const ready = await fetch(`${baseUrl}/health/ready`);
        const payload = await ready.json();
        assert.equal(ready.status, 200);
        assert.deepEqual(payload.dependencies.exactKernel, {
          state: 'PASS', httpStatus: 200, authentication: 'VERIFIED',
        });
        assert.deepEqual(payload.dependencies.jobControl, {
          state: 'PASS', httpStatus: 200, authentication: 'VERIFIED',
        });
        assert.equal((await fetch(`${baseUrl}/health/release`)).status, 503);
      });
  });
});

test('ready rejects a kernel identity mismatch', async () => {
  await withReadyDependencies(async (exactKernelUrl, jobControlUrl) => {
      await withServer(readyEnv(exactKernelUrl, jobControlUrl, {
        EXACT_KERNEL_IDENTITY: HASH('d'),
      }), async baseUrl => {
        const response = await fetch(`${baseUrl}/health/ready`);
        const payload = await response.json();
        assert.equal(response.status, 503);
        assert.match(payload.blockers.join(','), /kernel_identity_mismatch/);
      });
  });
});

test('ready rejects placeholder build identities and unverified dependency tokens', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'local' }, async baseUrl => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.ok(payload.blockers.includes('runtime_binding_missing_or_invalid:buildId'));
  });

  await withReadyDependencies(async (exactKernelUrl, jobControlUrl) => {
    await withServer(readyEnv(exactKernelUrl, jobControlUrl, {
      EXACT_KERNEL_AUTH_TOKEN: 'wrong-exact-auth-token-000000000',
    }), async baseUrl => {
      const response = await fetch(`${baseUrl}/health/ready`);
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.match(payload.blockers.join(','), /dependency_authentication_not_verified/);
    });
  });
});

test('ready fails closed on invalid dependency JSON and timeouts', async () => {
  await withDependencyService({
    health: {}, expectedToken: EXACT_TOKEN, canaryCode: 'COMPUTE_REQUEST_REJECTED', rawHealth: '{',
  }, async exactKernelUrl => {
    await withDependencyService({
      health: { ok: true, service: 'job-orchestrator', deploymentState: 'RUNNING' },
      expectedToken: JOB_TOKEN,
      canaryCode: 'JOB_CONTRACT_REJECTED',
    }, async jobControlUrl => {
      await withServer(readyEnv(exactKernelUrl, jobControlUrl), async baseUrl => {
        const payload = await (await fetch(`${baseUrl}/health/ready`)).json();
        assert.match(payload.blockers.join(','), /response_invalid_json/);
      });
    });
  });

  await withDependencyService({
    health: {}, expectedToken: EXACT_TOKEN, canaryCode: 'COMPUTE_REQUEST_REJECTED', healthDelayMs: 250,
  }, async exactKernelUrl => {
    await withDependencyService({
      health: { ok: true, service: 'job-orchestrator', deploymentState: 'RUNNING' },
      expectedToken: JOB_TOKEN,
      canaryCode: 'JOB_CONTRACT_REJECTED',
    }, async jobControlUrl => {
      await withServer(readyEnv(exactKernelUrl, jobControlUrl, {
        NEXYFAB_DEPENDENCY_PROBE_TIMEOUT_MS: '100',
      }), async baseUrl => {
        const payload = await (await fetch(`${baseUrl}/health/ready`)).json();
        assert.match(payload.blockers.join(','), /dependency_unreachable/);
      });
    });
  });
});
