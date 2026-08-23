import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { collectRollbackResponses, evaluateRollbackResponses } from './verify-rollback-target.mjs';

const healthy = {
  live: { status: 'ok', build: 'abc123' },
  ready: { status: 'ok', db: { status: 'ok', backend: 'postgres' } },
  occt: { ok: true, mode: 'wasm', wasm: { sha256: 'a'.repeat(64), sizeBytes: 65_000_000 } },
  release: { migrationVersion: 2026082208, migrationChecksums: { 2026082202: '2'.repeat(64), 2026082203: '3'.repeat(64), 2026082204: '4'.repeat(64), 2026082205: '5'.repeat(64), 2026082206: '6'.repeat(64), 2026082207: '7'.repeat(64), 2026082208: '8'.repeat(64) }, registryRoles: 3, registryFingerprintsUnique: true, i18n: { status: 'QUALIFIED', sourcePairs: 2711, translatedPairs: 2711 }, sevenDay: { status: 'QUALIFIED' } },
};

test('rollback verifier accepts matching healthy release', () => {
  assert.deepEqual(evaluateRollbackResponses(healthy, 'abc123'), []);
});

test('rollback verifier rejects wrong build, unavailable DB and stub OCCT', () => {
  const issues = evaluateRollbackResponses({
    live: { status: 'ok', build: 'old' },
    ready: { status: 'error', db: { status: 'error' } },
    occt: { ok: false, mode: 'stub', wasm: { sha256: null } },
  }, 'expected');
  assert.ok(issues.some(issue => issue.includes('build mismatch')));
  assert.ok(issues.some(issue => issue.includes('database')));
  assert.ok(issues.some(issue => issue.includes('real wasm')));
  assert.ok(issues.some(issue => issue.includes('sha256')));
});

test('rollback verifier requires the exact append-only commercial migration set when release evidence is supplied', () => {
  const issues = evaluateRollbackResponses({
    ...healthy,
    release: { migrationVersion: 2026082207, migrationChecksums: { 2026082202: '2'.repeat(64), 2026082203: '3'.repeat(64), 2026082204: '4'.repeat(64), 2026082205: '5'.repeat(64), 2026082206: '6'.repeat(64), 2026082207: '7'.repeat(64) }, registryRoles: 3, registryFingerprintsUnique: true, i18n: { status: 'QUALIFIED', sourcePairs: 2711, translatedPairs: 2711 }, sevenDay: { status: 'QUALIFIED' } },
  }, 'abc123');
  assert.ok(issues.some(issue => issue.includes('2026082208/checksum')));
});

test('rollback verifier fails closed when the expected build ID is omitted', () => {
  const issues = evaluateRollbackResponses(healthy);
  assert.ok(issues.some(issue => issue.includes('expected build ID is required')));
});

test('rollback CLI collection fetches release and receipt evidence and binds it to live build', async () => {
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    response.setHeader('content-type', 'application/json');
    const body = request.url === '/api/health/live'
      ? { status: 'ok', build: 'abc123' }
      : request.url === '/api/health/ready'
        ? { status: 'ok', db: { status: 'ok', backend: 'postgres' } }
        : request.url === '/api/occt/diagnostic'
          ? { ok: true, mode: 'wasm', wasm: { sha256: 'a'.repeat(64), sizeBytes: 65_000_000 } }
          : {
            release: healthy.release,
            receipt: {
              buildId: 'abc123',
              i18n: { status: 'QUALIFIED', sourcePairs: 2711, translatedPairs: 2711 },
              sevenDay: { status: 'QUALIFIED' },
            },
          };
    response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const responses = await collectRollbackResponses(`http://127.0.0.1:${address.port}`, 'abc123');
    assert.deepEqual(responses.releaseBindingIssues, []);
    assert.deepEqual(evaluateRollbackResponses(responses, 'abc123'), []);
    assert.deepEqual(paths.sort(), ['/api/health/live', '/api/health/ready', '/api/health/release', '/api/occt/diagnostic'].sort());
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
