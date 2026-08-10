import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSevenDayOperations } from './build-seven-day-operations-receipt.mjs';

function samples(service) {
  return Array.from({ length: 28 }, (_, index) => ({
    service,
    window: {
      since: new Date(Date.UTC(2026, 7, 1) + index * 6 * 3_600_000).toISOString(),
      until: new Date(Date.UTC(2026, 7, 1) + (index + 1) * 6 * 3_600_000).toISOString(),
    },
    memory: { max_mb: service === 'web' ? 500 : 300 },
    http: { total: 100, '5xx': 0 },
  }));
}

test('passes only with seven days of healthy samples for both services', () => {
  const result = evaluateSevenDayOperations([...samples('web'), ...samples('openscad-worker')]);
  assert.equal(result.ok, true);
});

test('fails closed for incomplete elapsed-time evidence', () => {
  const result = evaluateSevenDayOperations([]);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some(value => value.startsWith('coverage_short:web')));
});
