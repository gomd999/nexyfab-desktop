import assert from 'node:assert/strict';
import http from 'node:http';
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

async function withLegacyReady(callback) {
  const server = http.createServer((request, response) => {
    if (request.url !== '/api/health/ready') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
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
      dependencies: { legacyNext: { state: 'NOT_RUN', reason: 'live_probe_skipped' } },
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

  await withLegacyReady(async legacyOrigin => {
    await withServer({ NEXYFAB_BUILD_ID: 'platform-test', LEGACY_NEXT_ORIGIN: legacyOrigin }, async baseUrl => {
      const ready = await fetch(`${baseUrl}/api/health/ready`);
      assert.equal(ready.status, 200);
      const payload = await ready.json();
      assert.equal(payload.status, 'ok');
      assert.equal(payload.dependencies.legacyNext.state, 'PASS');
    });
  });
});

test('release remains blocked even when readiness bindings are complete', async () => {
  await withLegacyReady(async legacyOrigin => {
    await withServer({ NEXYFAB_BUILD_ID: 'platform-test', LEGACY_NEXT_ORIGIN: legacyOrigin }, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/health/release`);
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.releaseEligible, false);
      assert.ok(payload.blockers.includes('deploy_disabled'));
      assert.equal(payload.dependencies.legacyNext.state, 'PASS');
    });
  });
});

test('ready rejects a configured but unreachable legacy origin', async () => {
  await withServer({
    NEXYFAB_BUILD_ID: 'platform-test',
    LEGACY_NEXT_ORIGIN: 'http://127.0.0.1:1',
    NEXYFAB_DEPENDENCY_PROBE_TIMEOUT_MS: '100',
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.dependencies.legacyNext.state, 'FAIL');
    assert.match(payload.blockers.join(','), /legacy_ready_unreachable/);
  });
});
