#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX_64 = /^[a-f0-9]{64}$/i;
const HEX_40 = /^[a-f0-9]{40}$/i;

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function iso(value) {
  return text(value) && Number.isFinite(Date.parse(value));
}

function safeFile(root, relativePath) {
  if (!text(relativePath) || path.isAbsolute(relativePath)) throw new Error('relative_path_required');
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('source_path_outside_corpus_root');
  return absolute;
}

function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkDecision(value, label, issues) {
  if (!value || value.decision !== 'approved') issues.push(`${label}:decision_not_approved`);
  if (!text(value?.reviewerId)) issues.push(`${label}:reviewer_missing`);
  if (!iso(value?.reviewedAt)) issues.push(`${label}:reviewed_at_invalid`);
  if (!HEX_64.test(value?.signedArtifactHash ?? '')) issues.push(`${label}:signed_artifact_hash_invalid`);
}

function validHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function queueSlots(queue) {
  if (queue?.schema !== 'nexyfab.holdout-shortfall-acquisition-queue.v1' || !Array.isArray(queue.slots)) {
    throw new Error('invalid_acquisition_queue');
  }
  const slots = new Map();
  for (const slot of queue.slots) {
    if (!text(slot.slotId) || slots.has(slot.slotId)) throw new Error('invalid_or_duplicate_queue_slot');
    slots.set(slot.slotId, slot);
  }
  return slots;
}

export function validateHoldoutAcquisitions({ queue, existingCases, submission, corpusRoot }) {
  const slots = queueSlots(queue);
  const records = Array.isArray(submission?.records) ? submission.records : [];
  const globalIssues = [];
  if (submission?.schema !== 'nexyfab.holdout-acquisition-submission.v1') globalIssues.push('submission_schema_invalid');
  if (!HEX_40.test(submission?.modelFreeze?.releaseHead ?? '')) globalIssues.push('model_freeze_release_head_invalid');
  if (!iso(submission?.modelFreeze?.frozenAt)) globalIssues.push('model_freeze_timestamp_invalid');
  if (!HEX_64.test(submission?.modelFreeze?.receiptHash ?? '')) globalIssues.push('model_freeze_receipt_hash_invalid');
  if (!text(corpusRoot)) globalIssues.push('corpus_root_missing');

  const existing = Array.isArray(existingCases) ? existingCases : [];
  const existingHashes = new Set(existing.map(item => item.sourceHash).filter(text).map(value => value.toLowerCase()));
  const existingLineages = new Set(existing.map(item => item.holdoutGroup).filter(text).map(value => value.trim().toLowerCase()));
  const seenSlots = new Set();
  const seenHashes = new Set();
  const seenLineages = new Set();
  const seenPaths = new Set();
  const results = [];

  for (const record of records) {
    const slotId = text(record?.slotId) ? record.slotId : '(missing-slot)';
    const issues = [];
    const slot = slots.get(record?.slotId);
    if (!slot) issues.push('slot_unknown');
    if (seenSlots.has(record?.slotId)) issues.push('slot_duplicate');
    else if (text(record?.slotId)) seenSlots.add(record.slotId);
    if (slot && record.family !== slot.family) issues.push('family_mismatch');
    const normalizedLineage = text(record?.lineageGroup) ? record.lineageGroup.trim().toLowerCase() : '';
    const normalizedHash = text(record?.sourceHash) ? record.sourceHash.toLowerCase() : '';
    const normalizedPath = text(record?.relativePath) ? record.relativePath.replaceAll('\\', '/').toLowerCase() : '';
    if (!normalizedLineage || !normalizedLineage.startsWith(`${record.family}:`)) issues.push('lineage_group_invalid');
    if (existingLineages.has(normalizedLineage)) issues.push('lineage_overlaps_existing_holdout');
    if (seenLineages.has(normalizedLineage)) issues.push('lineage_duplicate_in_submission');
    else if (normalizedLineage) seenLineages.add(normalizedLineage);
    if (!HEX_64.test(record?.sourceHash ?? '')) issues.push('source_hash_invalid');
    if (existingHashes.has(normalizedHash)) issues.push('source_hash_overlaps_existing_holdout');
    if (seenHashes.has(normalizedHash)) issues.push('source_hash_duplicate_in_submission');
    else if (HEX_64.test(normalizedHash)) seenHashes.add(normalizedHash);
    if (seenPaths.has(normalizedPath)) issues.push('source_path_duplicate_in_submission');
    else if (normalizedPath) seenPaths.add(normalizedPath);

    const extension = String(record?.extension ?? '').toLowerCase().replace(/^\./, '');
    const acceptedFormats = new Set([...(slot?.requirements?.preferredExactFormats ?? []), ...(slot?.requirements?.conditionalFormats ?? [])]);
    if (!acceptedFormats.has(extension)) issues.push('source_format_not_accepted');
    const conditional = new Set(slot?.requirements?.conditionalFormats ?? []).has(extension);
    if (conditional) checkDecision(record?.conditionalFormatReview, 'conditional_format_review', issues);

    try {
      const file = safeFile(path.resolve(corpusRoot), record?.relativePath);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) issues.push('source_file_missing');
      else {
        const stat = fs.statSync(file);
        if (!Number.isInteger(record?.bytes) || record.bytes !== stat.size) issues.push('source_size_mismatch');
        if (path.extname(file).toLowerCase().replace(/^\./, '') !== extension) issues.push('source_extension_mismatch');
        if (HEX_64.test(record?.sourceHash ?? '') && digest(file) !== record.sourceHash.toLowerCase()) issues.push('source_hash_mismatch');
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'source_file_check_failed');
    }

    const provenance = record?.provenance;
    if (!validHttps(provenance?.sourceUrl)) issues.push('provenance_source_url_invalid');
    if (!text(provenance?.provider)) issues.push('provenance_provider_missing');
    if (!text(provenance?.licenseId)) issues.push('provenance_license_id_missing');
    if (!validHttps(provenance?.licenseUrl)) issues.push('provenance_license_url_invalid');
    if (provenance?.commercialUseStatus !== 'approved') issues.push('provenance_commercial_use_not_approved');
    checkDecision(provenance?.review, 'provenance_review', issues);

    const isolation = record?.holdoutIsolation;
    for (const flag of ['excludedFromTraining', 'excludedFromFineTuning', 'excludedFromPromptDevelopment', 'evaluationAccessRestricted']) {
      if (isolation?.[flag] !== true) issues.push(`holdout_isolation:${flag}_required`);
    }
    if (!iso(record?.sourceAcquiredAt)) issues.push('source_acquired_at_invalid');
    if (iso(record?.sourceAcquiredAt) && iso(submission?.modelFreeze?.frozenAt)
      && Date.parse(record.sourceAcquiredAt) < Date.parse(submission.modelFreeze.frozenAt)) {
      issues.push('source_acquired_before_model_freeze');
    }
    if (!HEX_64.test(isolation?.accessControlReceiptHash ?? '')) issues.push('holdout_isolation:access_control_receipt_hash_invalid');
    checkDecision(isolation?.review, 'holdout_isolation_review', issues);
    if (text(provenance?.review?.reviewerId) && provenance.review.reviewerId === isolation?.review?.reviewerId) {
      issues.push('provenance_and_isolation_reviewers_must_differ');
    }

    const structure = record?.nativeStructure;
    if (!Number.isInteger(structure?.definitions) || structure.definitions < 1) issues.push('native_structure:definitions_invalid');
    if (!Number.isInteger(structure?.occurrences) || structure.occurrences < 1) issues.push('native_structure:occurrences_invalid');
    if (!Number.isInteger(structure?.transforms) || structure.transforms < 1) issues.push('native_structure:transforms_invalid');
    if (!Number.isInteger(structure?.joints) || structure.joints < 0) issues.push('native_structure:joints_invalid');
    if (!text(structure?.extractor) || structure.extractor === 'aabb-approximation') issues.push('native_structure:extractor_invalid');
    if (!HEX_64.test(structure?.receiptHash ?? '')) issues.push('native_structure:receipt_hash_invalid');
    checkDecision(structure?.review, 'native_structure_review', issues);

    results.push({ slotId, family: record?.family ?? null, pass: issues.length === 0, issues });
  }

  const missingSlots = [...slots.keys()].filter(slotId => !seenSlots.has(slotId));
  const invalidRecords = results.filter(result => !result.pass);
  const readyForCuration = globalIssues.length === 0
    && missingSlots.length === 0
    && records.length === slots.size
    && invalidRecords.length === 0;
  return {
    schema: 'nexyfab.holdout-acquisition-validation.v1',
    generatedAt: new Date().toISOString(),
    readyForCuration,
    grantsGroundTruthApproval: false,
    scoreEligible: false,
    summary: {
      required: slots.size,
      submitted: records.length,
      valid: results.length - invalidRecords.length,
      invalid: invalidRecords.length,
      missing: missingSlots.length,
    },
    byFamily: Object.fromEntries([...new Set([...slots.values()].map(slot => slot.family))].sort().map(family => {
      const required = [...slots.values()].filter(slot => slot.family === family).length;
      const familyResults = results.filter(result => result.family === family);
      return [family, { required, submitted: familyResults.length, valid: familyResults.filter(result => result.pass).length }];
    })),
    globalIssues,
    missingSlots,
    results,
    redaction: 'Source bytes, credentials, reviewer names, signatures, and local absolute paths are not included.',
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function main() {
  const queuePath = arg('queue', 'docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json');
  const casesPath = arg('cases', 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const submissionPath = arg('submission');
  const corpusRoot = arg('root') || process.env.NEXYFAB_HOLDOUT_ACQUISITION_ROOT;
  const outputPath = arg('out');
  if (!submissionPath) throw new Error('submission_path_required');
  if (!corpusRoot) throw new Error('holdout_acquisition_root_required');
  const receipt = validateHoldoutAcquisitions({
    queue: readJson(queuePath),
    existingCases: readJson(casesPath),
    submission: readJson(submissionPath),
    corpusRoot,
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (outputPath) {
    const absolute = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (!receipt.readyForCuration) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main().catch(error => {
  console.error(`[holdout-acquisition] ${error instanceof Error ? error.message : 'validation failed'}`);
  process.exitCode = 1;
});
