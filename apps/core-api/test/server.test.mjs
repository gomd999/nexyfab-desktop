import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreApiServer } from '../src/server.mjs';

async function withServer(env, callback) {
  const server = createCoreApiServer(env, () => new Date('2026-08-23T00:00:00.000Z'));
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

test('live health exposes the immutable build binding', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'platform-test' }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      schema: 'nexyfab.slice-health.v1',
      scope: 'platform',
      unit: 'core-api',
      phase: 'live',
      status: 'ok',
      timestamp: '2026-08-23T00:00:00.000Z',
      build: 'platform-test',
      implementationState: 'COMPATIBILITY_BOUNDARY',
      deployEnabled: false,
      releaseEligible: false,
      bindings: { buildId: true, legacyNextOrigin: false },
      blockers: [],
    });
  });
});

test('ready is fail-closed until the legacy origin is bound', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'platform-test' }, async baseUrl => {
    const blocked = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(blocked.status, 503);
    assert.match((await blocked.json()).blockers.join(','), /legacy_next_origin/);
  });

  await withServer({ NEXYFAB_BUILD_ID: 'platform-test', LEGACY_NEXT_ORIGIN: 'https://staging.example.test' }, async baseUrl => {
    const ready = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ok');
  });
});

test('release remains blocked even when readiness bindings are complete', async () => {
  await withServer({ NEXYFAB_BUILD_ID: 'platform-test', LEGACY_NEXT_ORIGIN: 'https://staging.example.test' }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health/release`);
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.releaseEligible, false);
    assert.ok(payload.blockers.includes('deploy_disabled'));
  });
});
