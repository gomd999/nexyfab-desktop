import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const requirements = JSON.parse(readFileSync(path.join(root, 'docs/cad-program/requirements/manual-requirements.json'), 'utf8'));
const manuals = JSON.parse(readFileSync(path.join(root, 'docs/cad-program/requirements/manual-index.json'), 'utf8'));

test('atomic manual requirements are traceable and status-honest', () => {
  const manualIds = new Set(manuals.documents.map(item => item.documentId));
  const atomic = requirements.requirements.filter(item => item.atomic === true);
  assert.ok(atomic.length >= 20);
  assert.ok(atomic.some(item => item.domain.startsWith('architecture_')));
  assert.ok(atomic.some(item => item.domain.startsWith('interior_')));
  for (const item of atomic) {
    assert.equal(item.implementationStatus, item.status, item.id);
    assert.ok(item.sourceManualIds.length > 0, item.id);
    assert.ok(item.sourceManualIds.every(id => manualIds.has(id)), item.id);
    assert.notEqual(item.verificationKind, undefined, item.id);
    if (item.status === 'implemented_verified') assert.notEqual(item.verificationKind, 'not_run', item.id);
  }
});

test('manual trace validator accepts the checked-in contract', () => {
  const result = spawnSync(process.execPath, ['scripts/reference/validate-manual-trace.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trace valid: 20 manuals, \d+ baseline requirements/);
});

test('architecture/interior atomic scenarios remain lineage- and evidence-gated', () => {
  const contract = requirements.architectureInteriorScenarioRequirementContract;
  assert.equal(contract.schemaVersion, 1);
  const rows = contract.requirements;
  assert.ok(rows.length >= 6);
  assert.deepEqual(new Set(rows.map(item => item.stableId)).size, rows.length);
  assert.deepEqual(new Set(rows.map(item => item.goldenScenario)), new Set(['architecture-office', 'interior-apartment', 'interior-cafe']));
  for (const row of rows) {
    assert.equal(row.atomic, true, row.id);
    assert.equal(row.implementationStatus, row.status, row.id);
    assert.equal(row.lineage.bindingStatus, 'HOLD', row.id);
    assert.equal(row.scoreEligible, false, row.id);
    assert.equal(row.license.status, 'HOLD', row.id);
    assert.equal(row.provenance.status, 'HOLD', row.id);
    assert.equal(row.reviewerEligibility.status, 'HOLD', row.id);
    assert.equal(row.sourceManualIds.length, Object.keys(row.sourceHashes).length, row.id);
    for (const manualId of row.sourceManualIds) assert.equal(row.sourceHashes[manualId], manuals.documents.find(item => item.documentId === manualId)?.sha256, row.id);
  }
});
