import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { MECHANICAL_SINGLE_PART_REQUIRED_AXES } from '../src/contract.mjs';
import { createPrecisionServer } from '../src/server.mjs';

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

async function withHealthService(payload, callback) {
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

test('source-run contract passes only the complete seven-axis receipt', async () => {
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
  await withServer({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/contract/source-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feature: 'fixture', runs: [] }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.eligible, false);
    assert.ok(payload.reasons.includes('axis_missing:create'));
  });
});

test('ready requires canonical Exact Kernel and Job Control bindings plus active probes', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'precision-test' }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  });
  const kernelIdentity = 'occt-0.27.0';
  await withHealthService({
    service: 'exact-cad-kernel',
    state: 'ok',
    exactExecution: 'PASS',
    kernelIdentity,
  }, async exactKernelUrl => {
    await withHealthService({ service: 'job-control', state: 'ok' }, async jobControlUrl => {
      await withServer({
        NEXYFAB_BUILD_ID: 'precision-test',
        EXACT_KERNEL_URL: exactKernelUrl,
        EXACT_KERNEL_AUTH_TOKEN: 'e'.repeat(32),
        JOB_CONTROL_URL: jobControlUrl,
        JOB_CONTROL_AUTH_TOKEN: 'j'.repeat(32),
        EXACT_KERNEL_IDENTITY: kernelIdentity,
      }, async baseUrl => {
        const ready = await fetch(`${baseUrl}/health/ready`);
        const payload = await ready.json();
        assert.equal(ready.status, 200);
        assert.equal(payload.dependencies.exactKernel.state, 'PASS');
        assert.equal(payload.dependencies.jobControl.state, 'PASS');
        assert.equal((await fetch(`${baseUrl}/health/release`)).status, 503);
      });
    });
  });
});

test('ready rejects a kernel identity mismatch', async () => {
  await withHealthService({
    service: 'exact-cad-kernel',
    state: 'ok',
    exactExecution: 'PASS',
    kernelIdentity: 'unexpected-kernel',
  }, async exactKernelUrl => {
    await withHealthService({ service: 'job-control', state: 'ok' }, async jobControlUrl => {
      await withServer({
        NEXYFAB_BUILD_ID: 'precision-test',
        EXACT_KERNEL_URL: exactKernelUrl,
        EXACT_KERNEL_AUTH_TOKEN: 'e'.repeat(32),
        JOB_CONTROL_URL: jobControlUrl,
        JOB_CONTROL_AUTH_TOKEN: 'j'.repeat(32),
        EXACT_KERNEL_IDENTITY: 'expected-kernel',
      }, async baseUrl => {
        const response = await fetch(`${baseUrl}/health/ready`);
        const payload = await response.json();
        assert.equal(response.status, 503);
        assert.match(payload.blockers.join(','), /kernel_identity_mismatch/);
      });
    });
  });
});
