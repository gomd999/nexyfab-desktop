import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildLedger } from './audit-manual-ledger-v2.mjs';

const root = process.cwd();
const ledger = JSON.parse(readFileSync(path.join(root, 'docs/cad-program/requirements/manual-ledger-v2.json'), 'utf8'));
const manuals = JSON.parse(readFileSync(path.join(root, 'docs/cad-program/requirements/manual-index.json'), 'utf8'));
const requirements = JSON.parse(readFileSync(path.join(root, 'docs/cad-program/requirements/manual-requirements.json'), 'utf8'));

test('manual ledger v2 reports all 20 manuals deterministically', () => {
  assert.equal(ledger.schema, 'nexyfab.manual-ledger.v2');
  assert.equal(ledger.summary.manualCount, 20);
  assert.equal(ledger.sourceRequirements.requirementCount, 46);
  assert.equal(ledger.sourceRequirements.atomicRequirementCount, 30);
  assert.equal(ledger.sourceRequirements.unmappedRequirementIds.length, 13);
  assert.equal(ledger.summary.mappedManualCount, 20);
  assert.equal(ledger.summary.unmappedManualCount, 0);
  assert.deepEqual(ledger.summary.unmappedManualIds, []);
  assert.deepEqual(ledger.summary.verifiedManualIds, ['MANUAL-04', 'MANUAL-07', 'MANUAL-11', 'MANUAL-19', 'MANUAL-20']);
  assert.equal(ledger.summary.allManualsScoreEligible, false);
  assert.equal(ledger.manuals.length, 20);
});

test('page/section anchors are bound without promoting missing reviewer evidence', () => {
  const indexById = new Map(manuals.documents.map(item => [item.documentId, item]));
  const boundManualIds = new Set(['MANUAL-04', 'MANUAL-07', 'MANUAL-11', 'MANUAL-19', 'MANUAL-20']);
  for (const row of ledger.manuals) {
    assert.equal(row.sha256, indexById.get(row.manualId)?.sha256, row.manualId);
    assert.equal(row.sourceAnchors.status, boundManualIds.has(row.manualId) ? 'BOUND' : 'HOLD', row.manualId);
    assert.equal(row.review.status, 'HOLD', row.manualId);
    assert.equal(row.review.scoreEligible, false, row.manualId);
    for (const locator of row.sourceAnchors.locators) {
      if (boundManualIds.has(row.manualId)) {
        assert.equal(Number.isInteger(locator.page) && locator.page > 0, true, `${row.manualId}:${locator.requirementId}`);
        assert.equal(typeof locator.section === 'string' && locator.section.length > 0, true, `${row.manualId}:${locator.requirementId}`);
        assert.equal(locator.status, 'BOUND', `${row.manualId}:${locator.requirementId}`);
      } else {
        assert.equal(locator.page, null, `${row.manualId}:${locator.requirementId}`);
        assert.equal(locator.section, null, `${row.manualId}:${locator.requirementId}`);
        assert.equal(locator.status, 'HOLD', `${row.manualId}:${locator.requirementId}`);
      }
    }
  }
});

test('reviewed generic filenames retain hash-bound domain classifications', () => {
  const byId = new Map(manuals.documents.map(item => [item.documentId, item]));
  assert.deepEqual(
    Object.fromEntries(['MANUAL-04', 'MANUAL-07', 'MANUAL-11', 'MANUAL-19', 'MANUAL-20'].map(id => [id, {
      family: byId.get(id)?.family,
      domains: byId.get(id)?.domains,
    }])),
    {
      'MANUAL-04': { family: 'civil3d', domains: ['civil', 'alignment', 'survey'] },
      'MANUAL-07': { family: 'midas-civil', domains: ['civil', 'bridge', 'structural_analysis', 'fea'] },
      'MANUAL-11': { family: 'visualization', domains: ['architecture', 'interior', 'visualization'] },
      'MANUAL-19': { family: 'solidworks', domains: ['part', 'assembly', 'drawing', 'manufacturing', 'pdm'] },
      'MANUAL-20': { family: 'grasshopper', domains: ['parametric_graph', 'surface', 'brep'] },
    },
  );
});

test('checked-in ledger is deterministic and validator rejects stale output', () => {
  const rebuilt = buildLedger(manuals, requirements);
  assert.equal(JSON.stringify(rebuilt, null, 2), readFileSync(path.join(root, 'docs/cad-program/requirements/manual-ledger-v2.json'), 'utf8').trimEnd());
});
