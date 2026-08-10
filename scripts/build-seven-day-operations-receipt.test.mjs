import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSevenDayOperations } from './build-seven-day-operations-receipt.mjs';

function samples(service) {
  return Array.from({ length: 28 }, (_, index) => ({
    schema: 'nexyfab.railway-operations-sample.v1',
    service,
    sourceService: service === 'web' ? 'nexyfab.com' : `nexyfab-${service}`,
    environment: 'production',
    capturedAt: '2026-08-08T01:00:00.000Z',
    deploymentIds: [`${service}-deployment`],
    window: {
      since: new Date(Date.UTC(2026, 7, 1) + index * 6 * 3_600_000).toISOString(),
      until: new Date(Date.UTC(2026, 7, 1) + (index + 1) * 6 * 3_600_000).toISOString(),
    },
    memory: { max_mb: service === 'web' ? 500 : 300 },
    cpu: { max: 0.5 },
    http: { total: 100, '5xx': 0 },
  }));
}

function costSnapshots() {
  return [0, 7].map(day => ({
    capturedAt: new Date(Date.UTC(2026, 7, 1 + day)).toISOString(),
    billingPeriod: { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
    project: { id: 'project-id', name: 'nexyfab.com' },
    scope: {
      services: ['nexyfab.com', 'nexyfab-openscad-worker', 'nexyfab-fea-worker', 'Postgres-KN2x', 'Redis-IrVt'],
      missingServices: [],
      complete: true,
      totalDollars: day === 0 ? 1 : 3,
      breakdown: [
        { name: 'nexyfab.com', totalDollars: day === 0 ? 0.2 : 0.6 },
        { name: 'nexyfab-openscad-worker', totalDollars: day === 0 ? 0.1 : 0.3 },
        { name: 'nexyfab-fea-worker', totalDollars: day === 0 ? 0.1 : 0.3 },
        { name: 'Postgres-KN2x', totalDollars: day === 0 ? 0.4 : 1.2 },
        { name: 'Redis-IrVt', totalDollars: day === 0 ? 0.2 : 0.6 },
      ],
    },
  }));
}

test('passes only with seven days of healthy samples for all runtime services and cost', () => {
  const result = evaluateSevenDayOperations(
    [...samples('web'), ...samples('openscad-worker'), ...samples('fea-worker')],
    { costSnapshots: costSnapshots() },
  );
  assert.equal(result.ok, true);
});

test('fails closed for incomplete elapsed-time evidence', () => {
  const result = evaluateSevenDayOperations([]);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(value => value.startsWith('coverage_short:web')));
});

test('does not double count duplicate or overlapping metric windows', () => {
  const web = samples('web');
  web[27] = { ...web[26] };
  const result = evaluateSevenDayOperations(
    [...web, ...samples('openscad-worker'), ...samples('fea-worker')],
    { costSnapshots: costSnapshots() },
  );
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(value => value.startsWith('window_overlap:web')));
  assert.ok(result.blockers.some(value => value.startsWith('coverage_short:web')));
});

test('fails when any required service is absent from a cost snapshot', () => {
  const costs = costSnapshots();
  costs[1].scope.services = costs[1].scope.services.filter(name => name !== 'Redis-IrVt');
  costs[1].scope.missingServices = ['Redis-IrVt'];
  costs[1].scope.complete = false;
  const result = evaluateSevenDayOperations(
    [...samples('web'), ...samples('openscad-worker'), ...samples('fea-worker')],
    { costSnapshots: costs },
  );
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('cost_scope_incomplete'));
});
