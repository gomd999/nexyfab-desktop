import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWindows,
  normalizeMetricsSample,
  parseServiceMap,
  projectReference,
  scopeCostSnapshot,
} from './collect-railway-operations-campaign.mjs';

test('builds contiguous six-hour windows and safe service mappings', () => {
  assert.deepEqual(parseServiceMap('web:nexyfab.com,fea-worker:nexyfab-fea-worker'), [
    { alias: 'web', source: 'nexyfab.com' },
    { alias: 'fea-worker', source: 'nexyfab-fea-worker' },
  ]);
  const windows = buildWindows('2026-08-08T00:00:00.000Z', 6, 2);
  assert.equal(windows[0].until, windows[1].since);
  assert.equal(windows[1].until, '2026-08-08T00:00:00.000Z');
  assert.equal(projectReference(undefined, { id: 'project-id', name: 'project' }), 'project-id');
  assert.throws(() => parseServiceMap('web:a,web:b'), /unique/);
});

test('normalizes metrics and limits cost evidence to an explicit service scope', () => {
  const sample = normalizeMetricsSample('web', {
    service: 'nexyfab.com', environment: 'production',
    window: { since: '2026-08-01T00:00:00Z', until: '2026-08-01T06:00:00Z' },
    cpu: { max: 1 }, memory: { max_mb: 200 },
    http: { total: 10, '5xx': 0 },
    deployments: [{ id: 'ok', status: 'SUCCESS' }, { id: 'old', status: 'REMOVED' }],
  }, '2026-08-01T07:00:00Z', {
    source: 'nexyfab.com', environment: 'production',
    window: { since: '2026-08-01T00:00:00Z', until: '2026-08-01T06:00:00Z' },
  });
  assert.deepEqual(sample.deploymentIds, ['ok']);
  const cost = scopeCostSnapshot({
    project: { id: 'project-id', name: 'nexyfab.com' },
    billingPeriod: { start: '2026-08-01T00:00:00Z', end: '2026-09-01T00:00:00Z' },
    services: [
      { name: 'nexyfab.com', totalDollars: 2 },
      { name: 'unrelated', totalDollars: 20 },
    ],
  }, ['nexyfab.com', 'nexyfab-fea-worker']);
  assert.equal(cost.scope.totalDollars, 2);
  assert.deepEqual(cost.scope.missingServices, ['nexyfab-fea-worker']);
  assert.equal(cost.scope.complete, false);
  assert.throws(() => scopeCostSnapshot({ projects: [] }, ['nexyfab.com']), /service-level usage/);
  assert.throws(() => normalizeMetricsSample('web', {
    service: 'wrong-service', environment: 'production',
    window: { since: '2026-08-01T00:00:00Z', until: '2026-08-01T06:00:00Z' },
    cpu: { max: 1 }, memory: { max_mb: 200 }, http: { total: 1, '5xx': 0 },
  }, undefined, { source: 'nexyfab.com' }), /service mismatch/);
});
