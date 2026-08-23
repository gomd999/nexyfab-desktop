import assert from 'node:assert/strict';
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

test('ready requires Exact CAD and Job Control bindings', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'precision-test' }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  });
  await withServer({
    NEXYFAB_BUILD_ID: 'precision-test',
    EXACT_CAD_URL: 'http://exact.internal',
    JOB_CONTROL_URL: 'http://job.internal',
    EXACT_KERNEL_IDENTITY: 'occt-0.27.0',
  }, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/health/release`)).status, 503);
  });
});
