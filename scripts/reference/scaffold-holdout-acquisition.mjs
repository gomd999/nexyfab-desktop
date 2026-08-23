#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function digest(file) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function artifact() {
  return { relativePath: '', bytes: 0, sha256: '' };
}

function review() {
  return {
    decision: 'pending',
    reviewerId: '',
    reviewedAt: '',
    subjectHash: '',
    signedArtifact: artifact(),
  };
}

function assertQueue(queue) {
  if (queue?.schema !== 'nexyfab.holdout-shortfall-acquisition-queue.v1' || !Array.isArray(queue.slots)) {
    throw new Error('invalid_acquisition_queue');
  }
  if (queue?.policy?.placeholdersAreNotCases !== true
    || queue?.policy?.grantsApproval !== false
    || queue?.policy?.scoreEligible !== false) {
    throw new Error('unsafe_acquisition_queue_policy');
  }
  const seen = new Set();
  for (const slot of queue.slots) {
    if (typeof slot?.slotId !== 'string' || !slot.slotId || seen.has(slot.slotId)
      || typeof slot?.family !== 'string' || !slot.family
      || slot.status !== 'missing' || slot.scoreEligible !== false) {
      throw new Error('invalid_or_duplicate_queue_slot');
    }
    seen.add(slot.slotId);
  }
  if (queue?.summary?.required !== seen.size
    || queue?.summary?.remaining !== seen.size
    || queue?.summary?.acquired !== 0) {
    throw new Error('invalid_acquisition_queue_summary');
  }
}

export function buildHoldoutAcquisitionDraft({
  queue,
  queueSha256,
  existingCases,
  existingCasesSha256,
}) {
  assertQueue(queue);
  if (!Array.isArray(existingCases)) throw new Error('invalid_existing_cases');
  if (!/^[a-f0-9]{64}$/i.test(queueSha256 ?? '')
    || !/^[a-f0-9]{64}$/i.test(existingCasesSha256 ?? '')) {
    throw new Error('input_digest_required');
  }

  return {
    schema: 'nexyfab.holdout-acquisition-submission.v2',
    queueBinding: { sha256: queueSha256.toLowerCase(), slotCount: queue.slots.length },
    existingCorpusBinding: { sha256: existingCasesSha256.toLowerCase(), caseCount: existingCases.length },
    modelFreeze: { releaseHead: '', frozenAt: '', receipt: artifact() },
    records: queue.slots.map(slot => ({
      slotId: slot.slotId,
      family: slot.family,
      lineageGroup: '',
      relativePath: '',
      extension: '',
      sourceHash: '',
      bytes: 0,
      sourceAcquiredAt: '',
      provenance: {
        sourceUrl: '',
        provider: '',
        productId: '',
        licenseId: '',
        licenseUrl: '',
        commercialUseStatus: 'pending',
        licenseEvidence: artifact(),
        review: review(),
      },
      holdoutIsolation: {
        excludedFromTraining: false,
        excludedFromFineTuning: false,
        excludedFromPromptDevelopment: false,
        evaluationAccessRestricted: false,
        accessControlReceipt: artifact(),
        review: review(),
      },
      nativeStructure: {
        definitions: 0,
        occurrences: 0,
        transforms: 0,
        joints: 0,
        extractor: '',
        extractorVersion: '',
        extractorArtifactHash: '',
        receipt: artifact(),
        review: review(),
      },
      archiveManifest: artifact(),
      conditionalFormatReview: review(),
    })),
  };
}

function readJsonWithHash(file) {
  const absolute = path.resolve(file);
  return { value: JSON.parse(fs.readFileSync(absolute, 'utf8')), sha256: digest(absolute) };
}

function main() {
  const queuePath = arg('queue', 'docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json');
  const casesPath = arg('cases', 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const outputPath = arg('out');
  if (!outputPath) throw new Error('output_path_required');
  const absoluteOutput = path.resolve(outputPath);
  if (fs.existsSync(absoluteOutput)) throw new Error('refusing_to_overwrite_existing_draft');

  const queueFile = readJsonWithHash(queuePath);
  const casesFile = readJsonWithHash(casesPath);
  const draft = buildHoldoutAcquisitionDraft({
    queue: queueFile.value,
    queueSha256: queueFile.sha256,
    existingCases: casesFile.value,
    existingCasesSha256: casesFile.sha256,
  });
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(draft, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({
    schema: draft.schema,
    output: absoluteOutput,
    slots: draft.records.length,
    status: 'draft-only-pending-evidence-and-review',
  }, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[holdout-acquisition-scaffold] ${error instanceof Error ? error.message : 'failed'}`);
    process.exitCode = 1;
  }
}
