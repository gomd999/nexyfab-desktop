#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX_64 = /^[a-f0-9]{64}$/i;
const HEX_40 = /^[a-f0-9]{40}$/i;
const SUBMISSION_SCHEMA = 'nexyfab.holdout-acquisition-submission.v2';
const REVIEW_SCHEMA = 'nexyfab.holdout-review-attestation.v1';
const FREEZE_SCHEMA = 'nexyfab.model-freeze-receipt.v1';
const ISOLATION_SCHEMA = 'nexyfab.holdout-isolation-receipt.v1';
const NATIVE_SCHEMA = 'nexyfab.native-structure-receipt.v1';
const ARCHIVE_SCHEMA = 'nexyfab.holdout-archive-manifest.v1';
const MAX_ARCHIVE_ENTRIES = 100_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_EXPANSION_RATIO = 100;
const DANGEROUS_ARCHIVE_EXTENSIONS = new Set([
  'bat', 'cmd', 'com', 'dll', 'exe', 'hta', 'jar', 'js', 'jse', 'lnk', 'msi',
  'ps1', 'scr', 'vbe', 'vbs', 'wsf',
]);

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

function canonicalRelative(value) {
  if (!text(value) || path.isAbsolute(value) || /^[a-z]:/i.test(value)) throw new Error('relative_path_required');
  const slash = value.replaceAll('\\', '/');
  const normalized = path.posix.normalize(slash);
  if (slash !== normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error('relative_path_noncanonical');
  }
  return normalized;
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeFile(root, relativePath) {
  const normalized = canonicalRelative(relativePath);
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, ...normalized.split('/'));
  if (!inside(absoluteRoot, absolute) || absolute === absoluteRoot) throw new Error('source_path_outside_corpus_root');

  // Reject symlinks/junctions anywhere in the path. Lexical containment alone
  // does not stop `root/link -> outside` from escaping the controlled corpus.
  let cursor = absoluteRoot;
  for (const segment of normalized.split('/')) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('source_path_symlink_forbidden');
  }
  if (fs.existsSync(absolute)) {
    const realRoot = fs.realpathSync.native(absoluteRoot);
    const realFile = fs.realpathSync.native(absolute);
    if (!inside(realRoot, realFile) || realRoot === realFile) throw new Error('source_path_outside_corpus_root');
  }
  return { absolute, normalized };
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

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizedHttps(value) {
  if (!validHttps(value)) return '';
  const url = new URL(value);
  url.hash = '';
  return url.href.toLowerCase();
}

function queueSlots(queue) {
  if (queue?.schema !== 'nexyfab.holdout-shortfall-acquisition-queue.v1' || !Array.isArray(queue.slots)) {
    throw new Error('invalid_acquisition_queue');
  }
  for (const flag of ['placeholdersAreNotCases', 'crossFamilyReuseForbidden', 'snapshotArchiveAndMembersShareLineage']) {
    if (queue?.policy?.[flag] !== true) throw new Error(`invalid_acquisition_queue_policy:${flag}`);
  }
  if (queue?.policy?.grantsApproval !== false || queue?.policy?.scoreEligible !== false) {
    throw new Error('invalid_acquisition_queue_promotion_policy');
  }
  const slots = new Map();
  for (const slot of queue.slots) {
    if (!text(slot?.slotId) || slots.has(slot.slotId) || !text(slot?.family)) throw new Error('invalid_or_duplicate_queue_slot');
    if (slot.status !== 'missing' || slot.scoreEligible !== false) throw new Error(`invalid_queue_slot_state:${slot.slotId}`);
    for (const flag of [
      'independentProductLineage', 'sourceSha256Required', 'commercialProvenanceReviewRequired',
      'holdoutIsolationRequired', 'nativeDefinitionOccurrenceReviewRequired',
    ]) {
      if (slot?.requirements?.[flag] !== true) throw new Error(`invalid_queue_slot_requirement:${slot.slotId}:${flag}`);
    }
    if (!Array.isArray(slot?.requirements?.preferredExactFormats) || slot.requirements.preferredExactFormats.length === 0) {
      throw new Error(`invalid_queue_slot_formats:${slot.slotId}`);
    }
    slots.set(slot.slotId, slot);
  }
  if (queue?.summary?.required !== slots.size || queue?.summary?.remaining !== slots.size || queue?.summary?.acquired !== 0) {
    throw new Error('invalid_acquisition_queue_summary');
  }
  return slots;
}

function checkTime(value, label, issues, { notBefore, notAfter } = {}) {
  if (!iso(value)) {
    issues.push(`${label}_invalid`);
    return;
  }
  const instant = Date.parse(value);
  if (iso(notBefore) && instant < Date.parse(notBefore)) issues.push(`${label}_before_required_boundary`);
  if (Number.isFinite(notAfter) && instant > notAfter) issues.push(`${label}_in_future`);
}

function latestIso(...values) {
  const valid = values.filter(iso);
  if (valid.length === 0) return undefined;
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function readJsonArtifact(bytes, label, issues) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    issues.push(`${label}:json_invalid`);
    return null;
  }
}

function verifyArtifact(root, reference, label, issues, registry, { unique = true, json = false } = {}) {
  if (!reference || typeof reference !== 'object') {
    issues.push(`${label}:reference_missing`);
    return null;
  }
  if (!HEX_64.test(reference.sha256 ?? '')) issues.push(`${label}:sha256_invalid`);
  if (!Number.isInteger(reference.bytes) || reference.bytes < 1) issues.push(`${label}:bytes_invalid`);
  let resolved;
  try {
    resolved = safeFile(root, reference.relativePath);
  } catch (error) {
    issues.push(`${label}:${error instanceof Error ? error.message : 'path_invalid'}`);
    return null;
  }
  const pathKey = resolved.normalized.toLowerCase();
  const hashKey = String(reference.sha256 ?? '').toLowerCase();
  registry.controlPaths.add(pathKey);
  if (unique) {
    if (registry.paths.has(pathKey)) issues.push(`${label}:artifact_path_reused`);
    else registry.paths.add(pathKey);
    if (HEX_64.test(hashKey)) {
      if (registry.hashes.has(hashKey)) issues.push(`${label}:artifact_hash_reused`);
      else registry.hashes.add(hashKey);
    }
  }
  if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isFile()) {
    issues.push(`${label}:file_missing`);
    return null;
  }
  let jsonBytes = null;
  let actualBytes;
  let actualHash;
  if (json) {
    // Parse the exact byte buffer that is hashed. Reading once prevents a
    // receipt from being swapped between integrity verification and parsing.
    jsonBytes = fs.readFileSync(resolved.absolute);
    actualBytes = jsonBytes.length;
    actualHash = createHash('sha256').update(jsonBytes).digest('hex');
  } else {
    actualBytes = fs.statSync(resolved.absolute).size;
    actualHash = digest(resolved.absolute);
  }
  if (reference.bytes !== actualBytes) issues.push(`${label}:size_mismatch`);
  if (HEX_64.test(reference.sha256 ?? '') && actualHash !== hashKey) issues.push(`${label}:hash_mismatch`);
  return {
    ...resolved,
    sha256: hashKey,
    value: json ? readJsonArtifact(jsonBytes, label, issues) : null,
  };
}

function checkReview(value, label, issues, context) {
  if (!value || value.decision !== 'approved') issues.push(`${label}:decision_not_approved`);
  if (!text(value?.reviewerId)) issues.push(`${label}:reviewer_missing`);
  checkTime(value?.reviewedAt, `${label}:reviewed_at`, issues, {
    notBefore: context.notBefore,
    notAfter: context.now,
  });
  if (!HEX_64.test(value?.subjectHash ?? '') || value?.subjectHash?.toLowerCase() !== context.subjectHash?.toLowerCase()) {
    issues.push(`${label}:subject_hash_mismatch`);
  }
  const artifact = verifyArtifact(context.root, value?.signedArtifact, `${label}:signed_artifact`, issues, context.registry, { json: true });
  const attestation = artifact?.value;
  if (!attestation) return;
  const expected = {
    schema: REVIEW_SCHEMA,
    kind: context.kind,
    slotId: context.slotId,
    family: context.family,
    sourceHash: context.sourceHash,
    subjectHash: context.subjectHash,
    decision: 'approved',
    reviewerId: value?.reviewerId,
    reviewedAt: value?.reviewedAt,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actual = typeof attestation?.[field] === 'string' ? attestation[field].toLowerCase() : attestation?.[field];
    const wanted = typeof expectedValue === 'string' ? expectedValue.toLowerCase() : expectedValue;
    if (actual !== wanted) issues.push(`${label}:attestation_${field}_mismatch`);
  }
  const verification = attestation?.signatureVerification;
  if (verification?.status !== 'verified') issues.push(`${label}:signature_not_verified`);
  if (!text(verification?.algorithm)) issues.push(`${label}:signature_algorithm_missing`);
  if (!text(verification?.keyId)) issues.push(`${label}:signature_key_id_missing`);
  checkTime(verification?.verifiedAt, `${label}:signature_verified_at`, issues, {
    notBefore: value?.reviewedAt,
    notAfter: context.now,
  });
  if (!HEX_64.test(verification?.receiptHash ?? '')) issues.push(`${label}:signature_receipt_hash_invalid`);
}

function verifyFreezeReceipt(modelFreeze, root, issues, registry, binding, now) {
  if (!HEX_40.test(modelFreeze?.releaseHead ?? '')) issues.push('model_freeze_release_head_invalid');
  checkTime(modelFreeze?.frozenAt, 'model_freeze_timestamp', issues, { notAfter: now });
  const receipt = verifyArtifact(root, modelFreeze?.receipt, 'model_freeze_receipt', issues, registry, { json: true });
  const value = receipt?.value;
  if (!value) return;
  const expected = {
    schema: FREEZE_SCHEMA,
    releaseHead: modelFreeze?.releaseHead,
    frozenAt: modelFreeze?.frozenAt,
    queueSha256: binding.queueSha256,
    existingCasesSha256: binding.existingCasesSha256,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actual = typeof value?.[field] === 'string' ? value[field].toLowerCase() : value?.[field];
    const wanted = typeof expectedValue === 'string' ? expectedValue.toLowerCase() : expectedValue;
    if (actual !== wanted) issues.push(`model_freeze_receipt:${field}_mismatch`);
  }
  const verification = value?.signatureVerification;
  if (verification?.status !== 'verified') issues.push('model_freeze_receipt:signature_not_verified');
  if (!text(verification?.algorithm)) issues.push('model_freeze_receipt:signature_algorithm_missing');
  if (!text(verification?.keyId)) issues.push('model_freeze_receipt:signature_key_id_missing');
  checkTime(verification?.verifiedAt, 'model_freeze_receipt:signature_verified_at', issues, {
    notBefore: modelFreeze?.frozenAt,
    notAfter: now,
  });
  if (!HEX_64.test(verification?.receiptHash ?? '')) issues.push('model_freeze_receipt:signature_receipt_hash_invalid');
}

function verifyIsolationReceipt(record, root, issues, registry, now, freezeAt) {
  const isolation = record?.holdoutIsolation;
  const flags = ['excludedFromTraining', 'excludedFromFineTuning', 'excludedFromPromptDevelopment', 'evaluationAccessRestricted'];
  for (const flag of flags) if (isolation?.[flag] !== true) issues.push(`holdout_isolation:${flag}_required`);
  const receipt = verifyArtifact(root, isolation?.accessControlReceipt, 'holdout_isolation:access_control_receipt', issues, registry, { json: true });
  const value = receipt?.value;
  if (value) {
    if (value.schema !== ISOLATION_SCHEMA) issues.push('holdout_isolation:receipt_schema_invalid');
    for (const [field, expected] of Object.entries({ slotId: record.slotId, family: record.family, sourceHash: record.sourceHash })) {
      if (String(value?.[field] ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) issues.push(`holdout_isolation:receipt_${field}_mismatch`);
    }
    if (!text(value?.accessPolicyId)) issues.push('holdout_isolation:access_policy_id_missing');
    checkTime(value?.effectiveAt, 'holdout_isolation:effective_at', issues, { notBefore: freezeAt, notAfter: now });
    if (iso(value?.effectiveAt) && iso(record?.sourceAcquiredAt)
      && Date.parse(value.effectiveAt) > Date.parse(record.sourceAcquiredAt)) {
      issues.push('holdout_isolation:effective_after_source_acquisition');
    }
    for (const flag of flags) if (value?.controls?.[flag] !== true) issues.push(`holdout_isolation:receipt_${flag}_required`);
  }
  return receipt;
}

function verifyNativeReceipt(record, root, issues, registry, now) {
  const structure = record?.nativeStructure;
  for (const [field, minimum] of [['definitions', 1], ['occurrences', 1], ['transforms', 1], ['joints', 0]]) {
    if (!Number.isInteger(structure?.[field]) || structure[field] < minimum) issues.push(`native_structure:${field}_invalid`);
  }
  if (!text(structure?.extractor) || /aabb|approximation/i.test(structure.extractor)) issues.push('native_structure:extractor_invalid');
  if (!text(structure?.extractorVersion)) issues.push('native_structure:extractor_version_missing');
  if (!HEX_64.test(structure?.extractorArtifactHash ?? '')) issues.push('native_structure:extractor_artifact_hash_invalid');
  const receipt = verifyArtifact(root, structure?.receipt, 'native_structure:receipt', issues, registry, { json: true });
  const value = receipt?.value;
  if (value) {
    if (value.schema !== NATIVE_SCHEMA) issues.push('native_structure:receipt_schema_invalid');
    for (const [field, expected] of Object.entries({ slotId: record.slotId, family: record.family, sourceHash: record.sourceHash })) {
      if (String(value?.[field] ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) issues.push(`native_structure:receipt_${field}_mismatch`);
    }
    for (const field of ['definitions', 'occurrences', 'transforms', 'joints']) {
      if (value?.counts?.[field] !== structure?.[field]) issues.push(`native_structure:receipt_${field}_mismatch`);
    }
    for (const [field, expected] of Object.entries({
      name: structure?.extractor,
      version: structure?.extractorVersion,
      artifactHash: structure?.extractorArtifactHash,
    })) {
      if (String(value?.extractor?.[field] ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) {
        issues.push(`native_structure:receipt_extractor_${field}_mismatch`);
      }
    }
    checkTime(value?.generatedAt, 'native_structure:generated_at', issues, { notBefore: record?.sourceAcquiredAt, notAfter: now });
  }
  return receipt;
}

function verifyArchiveManifest(record, root, issues, registry, now) {
  const artifact = verifyArtifact(root, record?.archiveManifest, 'archive_manifest', issues, registry, { json: true });
  const manifest = artifact?.value;
  if (!manifest) return artifact;
  if (manifest.schema !== ARCHIVE_SCHEMA) issues.push('archive_manifest:schema_invalid');
  for (const [field, expected] of Object.entries({ slotId: record.slotId, family: record.family, sourceHash: record.sourceHash })) {
    if (String(manifest?.[field] ?? '').toLowerCase() !== String(expected ?? '').toLowerCase()) issues.push(`archive_manifest:${field}_mismatch`);
  }
  checkTime(manifest?.generatedAt, 'archive_manifest:generated_at', issues, { notBefore: record?.sourceAcquiredAt, notAfter: now });
  if (!text(manifest?.scanner?.name) || !text(manifest?.scanner?.version)
    || !HEX_64.test(manifest?.scanner?.artifactHash ?? '')) issues.push('archive_manifest:scanner_identity_invalid');
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (entries.length < 1 || entries.length > MAX_ARCHIVE_ENTRIES) issues.push('archive_manifest:entry_count_invalid');
  const seen = new Set();
  let expandedBytes = 0;
  for (const entry of entries) {
    let memberPath = '';
    try {
      memberPath = canonicalRelative(entry?.relativePath);
    } catch {
      issues.push('archive_manifest:member_path_unsafe');
    }
    const key = memberPath.toLowerCase();
    if (key && seen.has(key)) issues.push('archive_manifest:member_path_duplicate');
    else if (key) seen.add(key);
    if (entry?.kind !== 'file') issues.push('archive_manifest:member_kind_not_file');
    if (entry?.encrypted !== false) issues.push('archive_manifest:encrypted_member_forbidden');
    if (!Number.isInteger(entry?.bytes) || entry.bytes < 0) issues.push('archive_manifest:member_bytes_invalid');
    else expandedBytes += entry.bytes;
    if (!HEX_64.test(entry?.sha256 ?? '')) issues.push('archive_manifest:member_hash_invalid');
    const extension = path.posix.extname(memberPath).toLowerCase().replace(/^\./, '');
    if (DANGEROUS_ARCHIVE_EXTENSIONS.has(extension)) issues.push('archive_manifest:dangerous_member_extension');
  }
  if (!Number.isInteger(manifest?.expandedBytes) || manifest.expandedBytes !== expandedBytes) issues.push('archive_manifest:expanded_bytes_mismatch');
  if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) issues.push('archive_manifest:expanded_bytes_limit_exceeded');
  if (Number.isInteger(record?.bytes) && record.bytes > 0 && expandedBytes / record.bytes > MAX_ARCHIVE_EXPANSION_RATIO) {
    issues.push('archive_manifest:expansion_ratio_exceeded');
  }
  return artifact;
}

export function validateHoldoutAcquisitions({
  queue,
  queueSha256,
  existingCases,
  existingCasesSha256,
  submission,
  corpusRoot,
  workspaceRoot = process.cwd(),
  now = Date.now(),
}) {
  const slots = queueSlots(queue);
  const records = Array.isArray(submission?.records) ? submission.records : [];
  const globalIssues = [];
  if (submission?.schema !== SUBMISSION_SCHEMA) globalIssues.push('submission_schema_invalid');
  if (!HEX_64.test(queueSha256 ?? '')) globalIssues.push('validator_queue_sha256_missing');
  if (!HEX_64.test(existingCasesSha256 ?? '')) globalIssues.push('validator_existing_cases_sha256_missing');
  if (submission?.queueBinding?.sha256?.toLowerCase() !== String(queueSha256 ?? '').toLowerCase()
    || submission?.queueBinding?.slotCount !== slots.size) globalIssues.push('queue_binding_mismatch');

  const existing = Array.isArray(existingCases) ? existingCases : [];
  if (submission?.existingCorpusBinding?.sha256?.toLowerCase() !== String(existingCasesSha256 ?? '').toLowerCase()
    || submission?.existingCorpusBinding?.caseCount !== existing.length) globalIssues.push('existing_corpus_binding_mismatch');
  if (!text(corpusRoot)) globalIssues.push('corpus_root_missing');
  const absoluteRoot = text(corpusRoot) ? path.resolve(corpusRoot) : '';
  if (absoluteRoot) {
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
      globalIssues.push('corpus_root_invalid');
    } else {
      if (fs.lstatSync(absoluteRoot).isSymbolicLink()) globalIssues.push('corpus_root_symlink_forbidden');
      const realRoot = fs.realpathSync.native(absoluteRoot);
      const realWorkspace = fs.existsSync(workspaceRoot) ? fs.realpathSync.native(workspaceRoot) : path.resolve(workspaceRoot);
      if (inside(realWorkspace, realRoot) || inside(realRoot, realWorkspace)) {
        globalIssues.push('corpus_root_not_isolated_from_workspace');
      }
    }
  }

  const registry = { paths: new Set(), hashes: new Set(), controlPaths: new Set() };
  verifyFreezeReceipt(submission?.modelFreeze, absoluteRoot || '.', globalIssues, registry, {
    queueSha256,
    existingCasesSha256,
  }, now);

  const existingHashes = new Set(existing.map(item => item.sourceHash).filter(text).map(value => value.toLowerCase()));
  const existingLineages = new Set(existing.map(item => item.holdoutGroup).filter(text).map(value => value.trim().toLowerCase()));
  const seenSlots = new Set();
  const seenHashes = new Set();
  const seenLineages = new Set();
  const seenPaths = new Set();
  const seenProductIds = new Set();
  const seenSourceUrls = new Set();
  const sourcePaths = new Set();
  const results = [];

  for (const record of records) {
    const slotId = text(record?.slotId) ? record.slotId : '(missing-slot)';
    const issues = [];
    const slot = slots.get(record?.slotId);
    if (!slot) issues.push('slot_unknown');
    if (seenSlots.has(record?.slotId)) issues.push('slot_duplicate');
    else if (text(record?.slotId)) seenSlots.add(record.slotId);
    if (slot && record.family !== slot.family) issues.push('family_mismatch');

    const family = slot?.family ?? record?.family;
    const normalizedLineage = text(record?.lineageGroup) ? record.lineageGroup.trim().toLowerCase() : '';
    const lineageSuffix = normalizedLineage.startsWith(`${family}:`) ? normalizedLineage.slice(String(family).length + 1) : '';
    const normalizedHash = text(record?.sourceHash) ? record.sourceHash.toLowerCase() : '';
    if (!normalizedLineage || !/^[a-z0-9][a-z0-9._-]{2,}$/.test(lineageSuffix)) issues.push('lineage_group_invalid');
    if (existingLineages.has(normalizedLineage)) issues.push('lineage_overlaps_existing_holdout');
    if (seenLineages.has(normalizedLineage)) issues.push('lineage_duplicate_in_submission');
    else if (normalizedLineage) seenLineages.add(normalizedLineage);
    if (!HEX_64.test(record?.sourceHash ?? '')) issues.push('source_hash_invalid');
    if (existingHashes.has(normalizedHash)) issues.push('source_hash_overlaps_existing_holdout');
    if (seenHashes.has(normalizedHash)) issues.push('source_hash_duplicate_in_submission');
    else if (HEX_64.test(normalizedHash)) seenHashes.add(normalizedHash);

    let normalizedPath = '';
    try {
      normalizedPath = canonicalRelative(record?.relativePath);
      const key = normalizedPath.toLowerCase();
      if (seenPaths.has(key)) issues.push('source_path_duplicate_in_submission');
      else seenPaths.add(key);
      sourcePaths.add(key);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'source_path_invalid');
    }

    const extension = String(record?.extension ?? '').toLowerCase().replace(/^\./, '');
    const acceptedFormats = new Set([...(slot?.requirements?.preferredExactFormats ?? []), ...(slot?.requirements?.conditionalFormats ?? [])]);
    if (!acceptedFormats.has(extension)) issues.push('source_format_not_accepted');
    const conditional = new Set(slot?.requirements?.conditionalFormats ?? []).has(extension);

    try {
      const file = safeFile(absoluteRoot, record?.relativePath);
      if (!fs.existsSync(file.absolute) || !fs.statSync(file.absolute).isFile()) issues.push('source_file_missing');
      else {
        const stat = fs.statSync(file.absolute);
        if (!Number.isInteger(record?.bytes) || record.bytes < 1 || record.bytes !== stat.size) issues.push('source_size_mismatch');
        if (path.extname(file.absolute).toLowerCase().replace(/^\./, '') !== extension) issues.push('source_extension_mismatch');
        if (HEX_64.test(record?.sourceHash ?? '') && digest(file.absolute) !== normalizedHash) issues.push('source_hash_mismatch');
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'source_file_check_failed');
    }

    checkTime(record?.sourceAcquiredAt, 'source_acquired_at', issues, {
      notBefore: submission?.modelFreeze?.frozenAt,
      notAfter: now,
    });

    const provenance = record?.provenance;
    if (!validHttps(provenance?.sourceUrl)) issues.push('provenance_source_url_invalid');
    const sourceUrl = normalizedHttps(provenance?.sourceUrl);
    if (sourceUrl && seenSourceUrls.has(sourceUrl)) issues.push('provenance_source_url_duplicate_in_submission');
    else if (sourceUrl) seenSourceUrls.add(sourceUrl);
    if (!text(provenance?.provider)) issues.push('provenance_provider_missing');
    if (!text(provenance?.productId)) issues.push('provenance_product_id_missing');
    const productKey = text(provenance?.provider) && text(provenance?.productId)
      ? `${provenance.provider.trim().toLowerCase()}:${provenance.productId.trim().toLowerCase()}` : '';
    if (productKey && seenProductIds.has(productKey)) issues.push('provenance_product_identity_duplicate_in_submission');
    else if (productKey) seenProductIds.add(productKey);
    if (!text(provenance?.licenseId)) issues.push('provenance_license_id_missing');
    if (!validHttps(provenance?.licenseUrl)) issues.push('provenance_license_url_invalid');
    if (provenance?.commercialUseStatus !== 'approved') issues.push('provenance_commercial_use_not_approved');
    const licenseEvidence = verifyArtifact(absoluteRoot, provenance?.licenseEvidence, 'provenance_license_evidence', issues, registry, { unique: false });
    checkReview(provenance?.review, 'provenance_review', issues, {
      root: absoluteRoot, registry, now, notBefore: record?.sourceAcquiredAt,
      kind: 'provenance', slotId, family, sourceHash: normalizedHash, subjectHash: licenseEvidence?.sha256,
    });

    const isolationReceipt = verifyIsolationReceipt(record, absoluteRoot, issues, registry, now, submission?.modelFreeze?.frozenAt);
    checkReview(record?.holdoutIsolation?.review, 'holdout_isolation_review', issues, {
      root: absoluteRoot, registry, now,
      notBefore: latestIso(record?.sourceAcquiredAt, isolationReceipt?.value?.effectiveAt),
      kind: 'holdout_isolation', slotId, family, sourceHash: normalizedHash, subjectHash: isolationReceipt?.sha256,
    });

    const nativeReceipt = verifyNativeReceipt(record, absoluteRoot, issues, registry, now);
    checkReview(record?.nativeStructure?.review, 'native_structure_review', issues, {
      root: absoluteRoot, registry, now,
      notBefore: latestIso(record?.sourceAcquiredAt, nativeReceipt?.value?.generatedAt),
      kind: 'native_structure', slotId, family, sourceHash: normalizedHash, subjectHash: nativeReceipt?.sha256,
    });

    let conditionalSubjectHash = normalizedHash;
    let archiveManifest;
    if (extension === 'zip') {
      archiveManifest = verifyArchiveManifest(record, absoluteRoot, issues, registry, now);
      conditionalSubjectHash = archiveManifest?.sha256;
    }
    if (conditional) {
      checkReview(record?.conditionalFormatReview, 'conditional_format_review', issues, {
        root: absoluteRoot, registry, now,
        notBefore: latestIso(record?.sourceAcquiredAt, archiveManifest?.value?.generatedAt),
        kind: 'conditional_format', slotId, family, sourceHash: normalizedHash, subjectHash: conditionalSubjectHash,
      });
    }

    const reviewers = [
      provenance?.review?.reviewerId,
      record?.holdoutIsolation?.review?.reviewerId,
      record?.nativeStructure?.review?.reviewerId,
      conditional ? record?.conditionalFormatReview?.reviewerId : null,
    ].filter(text).map(value => value.trim().toLowerCase());
    if (new Set(reviewers).size !== reviewers.length) issues.push('reviewer_roles_must_differ');
    for (const artifactPath of registry.controlPaths) {
      if (sourcePaths.has(artifactPath)) issues.push('source_path_reused_as_control_artifact');
    }

    results.push({ slotId, family: record?.family ?? null, pass: issues.length === 0, issues: [...new Set(issues)] });
  }

  const missingSlots = [...slots.keys()].filter(slotId => !seenSlots.has(slotId));
  const invalidRecords = results.filter(result => !result.pass);
  const readyForCuration = globalIssues.length === 0
    && missingSlots.length === 0
    && records.length === slots.size
    && invalidRecords.length === 0;
  return {
    schema: 'nexyfab.holdout-acquisition-validation.v2',
    generatedAt: new Date(now).toISOString(),
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
    byFamily: Object.fromEntries([...new Set([...slots.values()].map(slot => slot.family))].sort().map(familyName => {
      const required = [...slots.values()].filter(slot => slot.family === familyName).length;
      const familyResults = results.filter(result => result.family === familyName);
      return [familyName, { required, submitted: familyResults.length, valid: familyResults.filter(result => result.pass).length }];
    })),
    globalIssues: [...new Set(globalIssues)],
    missingSlots,
    results,
    redaction: 'Source bytes, URLs, product identifiers, artifact paths, credentials, reviewer identities, signatures, and local absolute paths are not included.',
  };
}

function readJsonWithHash(file) {
  const absolute = path.resolve(file);
  return { value: JSON.parse(fs.readFileSync(absolute, 'utf8')), sha256: digest(absolute) };
}

async function main() {
  const queuePath = arg('queue', 'docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json');
  const casesPath = arg('cases', 'docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json');
  const submissionPath = arg('submission');
  const corpusRoot = arg('root') || process.env.NEXYFAB_HOLDOUT_ACQUISITION_ROOT;
  const outputPath = arg('out');
  if (!submissionPath) throw new Error('submission_path_required');
  if (!corpusRoot) throw new Error('holdout_acquisition_root_required');
  const queueFile = readJsonWithHash(queuePath);
  const casesFile = readJsonWithHash(casesPath);
  const receipt = validateHoldoutAcquisitions({
    queue: queueFile.value,
    queueSha256: queueFile.sha256,
    existingCases: casesFile.value,
    existingCasesSha256: casesFile.sha256,
    submission: JSON.parse(fs.readFileSync(path.resolve(submissionPath), 'utf8')),
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
