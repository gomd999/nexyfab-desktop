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

// W1-5(260808b) — G7 재캠페인 규정(같은 케이스 재사용 금지) 대비: 도메인당
// 40개 후보가 전부 **상이한 산출물**(artifactHash 중복 0)이어야 한다. 파라미터
// 스윕이 클램프로 뭉개져 중복이 생기면 여기서 잡힌다.
test('W1-5: 40 candidates per domain, all artifacts distinct', () => {
  for (const domain of ['mechanical', 'civil', 'building', 'landscape', 'interior']) {
    const candidates = buildDomainCandidates(domain, 40);
    assert.equal(candidates.length, 40, domain);
    assert.equal(new Set(candidates.map(c => c.artifactHash)).size, 40, `${domain}: duplicate artifacts`);
    assert.equal(new Set(candidates.map(c => c.caseId)).size, 40, `${domain}: duplicate caseIds`);
  }
});
