import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { buildHoldoutAcquisitionDraft } from './scaffold-holdout-acquisition.mjs';
import { validateHoldoutAcquisitions } from './validate-holdout-acquisitions.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resolveWorkspace = relative => path.resolve(workspace, relative);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('scaffolds every official shortfall slot without fabricating evidence or approval', () => {
  const queueFile = resolveWorkspace('docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json');
  const casesFile = resolveWorkspace('docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const existingCases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const draft = buildHoldoutAcquisitionDraft({
    queue,
    queueSha256: digest(queueFile),
    existingCases,
    existingCasesSha256: digest(casesFile),
  });

  assert.equal(draft.schema, 'nexyfab.holdout-acquisition-submission.v2');
  assert.equal(draft.records.length, 32);
  assert.equal(new Set(draft.records.map(record => record.slotId)).size, 32);
  assert.deepEqual(
    Object.fromEntries(['robot', 'gearbox', 'pressure_vessel', 'turbomachinery'].map(family => [
      family,
      draft.records.filter(record => record.family === family).length,
    ])),
    { robot: 11, gearbox: 3, pressure_vessel: 9, turbomachinery: 9 },
  );
  assert.equal(draft.queueBinding.slotCount, 32);
  assert.equal(draft.existingCorpusBinding.caseCount, existingCases.length);

  for (const record of draft.records) {
    assert.equal(record.sourceHash, '');
    assert.equal(record.bytes, 0);
    assert.equal(record.provenance.commercialUseStatus, 'pending');
    assert.equal(record.provenance.review.decision, 'pending');
    assert.equal(record.holdoutIsolation.excludedFromTraining, false);
    assert.equal(record.holdoutIsolation.review.decision, 'pending');
    assert.equal(record.nativeStructure.review.decision, 'pending');
    assert.equal(record.conditionalFormatReview.decision, 'pending');
  }

  const controlledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-holdout-draft-'));
  try {
    const receipt = validateHoldoutAcquisitions({
      queue,
      queueSha256: digest(queueFile),
      existingCases,
      existingCasesSha256: digest(casesFile),
      submission: draft,
      corpusRoot: controlledRoot,
    });
    assert.equal(receipt.readyForCuration, false);
    assert.equal(receipt.summary.submitted, 32);
    assert.equal(receipt.summary.valid, 0);
    assert.equal(receipt.scoreEligible, false);
    assert.equal(receipt.grantsGroundTruthApproval, false);
  } finally {
    fs.rmSync(controlledRoot, { recursive: true, force: true });
  }
});

test('scaffolds the machine/skid and welded/enclosure extension as 40 pending-only slots', () => {
  const queueFile = resolveWorkspace('docs/evidence/complex-holdout-lineage-v3-extension-260812/shortfall-acquisition-queue.json');
  const casesFile = resolveWorkspace('docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  const existingCases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  const draft = buildHoldoutAcquisitionDraft({ queue, queueSha256: digest(queueFile), existingCases, existingCasesSha256: digest(casesFile) });
  assert.equal(draft.records.length, 40);
  assert.equal(draft.records.filter(record => record.family === 'machine_skid').length, 20);
  assert.equal(draft.records.filter(record => record.family === 'welded_enclosure').length, 20);
  assert.equal(draft.records.every(record => record.sourceHash === '' && record.provenance.review.decision === 'pending' && record.holdoutIsolation.excludedFromTraining === false), true);
});

test('receipt worksheets remain visibly pending and contain no plausible evidence hashes', () => {
  const templateRoot = resolveWorkspace('docs/process/templates/holdout-acquisition');
  const files = fs.readdirSync(templateRoot).filter(file => file.endsWith('.json')).sort();
  assert.equal(files.length, 5);
  for (const file of files) {
    const value = JSON.parse(fs.readFileSync(path.join(templateRoot, file), 'utf8'));
    const serialized = JSON.stringify(value);
    assert.equal(serialized.includes('"approved"'), false, `${file} contains an approval`);
    assert.equal(serialized.includes('"verified"'), false, `${file} contains a verification`);
    assert.equal(/[a-f0-9]{64}/i.test(serialized), false, `${file} contains a plausible SHA-256`);
  }
});
