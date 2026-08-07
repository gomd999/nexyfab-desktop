import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainCandidates, parseArgs } from './build-domain-accuracy-candidates.mjs';

for (const domain of ['mechanical', 'civil', 'building', 'landscape', 'interior']) {
  test(`${domain} candidate manifest has 20 unique, non-scoreable cases`, () => {
    const cases = buildDomainCandidates(domain);
    assert.equal(cases.length, 20);
    assert.equal(new Set(cases.map(item => item.caseId)).size, 20);
    assert.equal(new Set(cases.map(item => item.sourceHash)).size, 20);
    assert.ok(cases.every(item => item.split === 'candidate' && item.sourceKind === 'internal-template'));
    assert.ok(cases.every(item => /^[a-f0-9]{64}$/.test(item.sourceHash)));
    assert.ok(cases.every(item => /^[a-f0-9]{64}$/.test(item.artifactHash)));
    assert.ok(cases.every(item => Number.isSafeInteger(item.artifactSummary.partCount)));
    assert.ok(cases.every(item => item.artifactSummary.alignmentErrors.length === 0));
    assert.ok(cases.every(item => item.artifactSummary.unverifiedPartCount === 0));
  });
}

test('candidate CLI requires an explicit domain', () => {
  assert.throws(() => parseArgs([]), /--domain/);
  assert.deepEqual(parseArgs(['--domain', 'civil', '--count', '25']), { domain: 'civil', count: 25 });
});
