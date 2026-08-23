#!/usr/bin/env node
import { createHash, createHmac } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { qualifyCommercialCatalog } from './commercial-catalog.mjs';
import {
  EXPANDED_I18N_COMMAND,
  OFFICIAL_I18N_COMMAND,
  verifyI18nVitestEvidence,
} from './collect-i18n-vitest-evidence.mjs';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const FULL_PRODUCT_REVIEW_SCHEMA = 'nexyfab.commercial-i18n-full-product-artifact-review.v1';
const FULL_PRODUCT_LOCALES = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
const FULL_PRODUCT_ARTIFACTS = ['visual', 'rtl', 'email', 'pdf', 'export'];
const FULL_PRODUCT_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function withoutSignature(value) {
  const payload = { ...(value ?? {}) };
  delete payload.receiptSha256;
  delete payload.receiptHmacSha256;
  delete payload.signature;
  return payload;
}

export function signFullProductArtifactReviewReceipt(receipt, secret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '', { now = Date.now() } = {}) {
  const generatedAt = Date.parse(receipt?.generatedAt);
  const expiresAt = Date.parse(receipt?.expiresAt);
  const artifactSignable = artifact => artifact && typeof artifact === 'object'
    && artifact.status === 'PASS' && artifact.reviewStatus === 'APPROVED' && artifact.synthetic === false
    && artifact.buildId === receipt?.buildId && artifact.head === receipt?.head
    && JSON.stringify(artifact.locales) === JSON.stringify(FULL_PRODUCT_LOCALES)
    && Number.isSafeInteger(artifact.artifactBytes) && artifact.artifactBytes > 0
    && Number.isSafeInteger(artifact.evidenceBytes) && artifact.evidenceBytes > 0
    && validSha(artifact.artifactSha256) && validSha(artifact.evidenceSha256)
    && typeof artifact.artifactPath === 'string' && artifact.artifactPath.length > 0 && !path.isAbsolute(artifact.artifactPath) && !artifact.artifactPath.replaceAll('\\', '/').split('/').includes('..')
    && typeof artifact.evidencePath === 'string' && artifact.evidencePath.length > 0 && !path.isAbsolute(artifact.evidencePath) && !artifact.evidencePath.replaceAll('\\', '/').split('/').includes('..');
  const signable = secret.length >= 32
    && receipt?.schema === FULL_PRODUCT_REVIEW_SCHEMA
    && typeof receipt?.reviewerId === 'string' && receipt.reviewerId.trim().length > 0
    && typeof receipt?.buildId === 'string' && receipt.buildId.length > 0
    && typeof receipt?.head === 'string' && receipt.head.length > 0
    && JSON.stringify(receipt?.locales) === JSON.stringify(FULL_PRODUCT_LOCALES)
    && Number.isFinite(generatedAt) && generatedAt <= now + 5 * 60 * 1000 && now - generatedAt <= FULL_PRODUCT_REVIEW_MAX_AGE_MS
    && Number.isFinite(expiresAt) && expiresAt > now && expiresAt > generatedAt && expiresAt - generatedAt <= FULL_PRODUCT_REVIEW_MAX_AGE_MS
    && receipt?.artifacts && FULL_PRODUCT_ARTIFACTS.every(kind => artifactSignable(receipt.artifacts[kind]));
  if (!signable) throw new Error('full_product_review_not_signable');
  const payload = {
    ...withoutSignature(receipt),
    packetType: 'signed_review_receipt',
    status: 'PASS',
    releaseEligible: true,
    signatureStatus: 'SIGNED',
  };
  const receiptSha256 = digest(payload);
  const receiptHmacSha256 = createHmac('sha256', secret).update(canonical({ ...payload, receiptSha256 })).digest('hex');
  return { ...payload, receiptSha256, receiptHmacSha256 };
}

function validSha(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? ''));
}

function verifiedEvidenceFile(root, relative, expectedBytes, expectedSha256) {
  if (typeof root !== 'string' || !root.trim() || typeof relative !== 'string' || !relative.trim()
    || path.isAbsolute(relative) || relative.replaceAll('\\', '/').split('/').includes('..')) return false;
  try {
    const resolvedRoot = realpathSync(path.resolve(root));
    const absolute = path.resolve(resolvedRoot, ...relative.replaceAll('\\', '/').split('/'));
    if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) return false;
    const real = realpathSync(absolute);
    if (real !== resolvedRoot && !real.startsWith(`${resolvedRoot}${path.sep}`)) return false;
    const bytes = readFileSync(real);
    return bytes.byteLength === expectedBytes && createHash('sha256').update(bytes).digest('hex') === expectedSha256;
  } catch {
    return false;
  }
}

function validArtifact(value, evidenceRoot) {
  const result = value?.status ?? value?.result;
  const binding = value?.binding ?? value;
  const artifactSha256 = value?.artifactSha256 ?? value?.artifact?.sha256;
  const evidenceSha256 = value?.evidenceSha256 ?? value?.evidence?.sha256;
  const artifactBytes = value?.artifactBytes ?? value?.artifact?.bytes;
  const evidenceBytes = value?.evidenceBytes ?? value?.evidence?.bytes;
  const artifactPath = value?.artifactPath ?? value?.artifact?.path;
  const evidencePath = value?.evidencePath ?? value?.evidence?.path;
  return value && typeof value === 'object' && result === 'PASS'
    && value.synthetic === false
    && value.reviewStatus === 'APPROVED'
    && Number.isSafeInteger(artifactBytes) && artifactBytes > 0
    && Number.isSafeInteger(evidenceBytes) && evidenceBytes > 0
    && validSha(artifactSha256) && validSha(evidenceSha256)
    && typeof binding.buildId === 'string' && typeof binding.head === 'string'
    && verifiedEvidenceFile(evidenceRoot, artifactPath, artifactBytes, artifactSha256)
    && verifiedEvidenceFile(evidenceRoot, evidencePath, evidenceBytes, evidenceSha256);
}

export function verifyFullProductArtifactReviewReceipt(
  receipt,
  { buildId, head, now = Date.now(), secret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '', evidenceRoot = process.env.I18N_FULL_PRODUCT_EVIDENCE_ROOT ?? '', maxAgeMs = FULL_PRODUCT_REVIEW_MAX_AGE_MS } = {},
) {
  const issues = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { ok: false, issues: ['full_product_review_missing'] };
  if (receipt.schema !== FULL_PRODUCT_REVIEW_SCHEMA) issues.push('full_product_review_schema_invalid');
  if (receipt.packetType !== 'signed_review_receipt' || receipt.status !== 'PASS'
    || receipt.releaseEligible !== true || receipt.signatureStatus !== 'SIGNED'
    || typeof receipt.reviewerId !== 'string' || !receipt.reviewerId.trim()) issues.push('full_product_review_approval_invalid');
  if (typeof buildId !== 'string' || !buildId || receipt.buildId !== buildId) issues.push('full_product_review_build_mismatch');
  if (typeof head !== 'string' || !head || receipt.head !== head) issues.push('full_product_review_head_mismatch');
  if (JSON.stringify(receipt.locales ?? receipt.reviewedLocales) !== JSON.stringify(FULL_PRODUCT_LOCALES)) issues.push('full_product_review_locales_incomplete');

  const generatedAt = Date.parse(receipt.generatedAt ?? receipt.reviewedAt ?? receipt.issuedAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(generatedAt)) issues.push('full_product_review_timestamp_missing');
  else {
    if (generatedAt > now + 5 * 60 * 1000) issues.push('full_product_review_timestamp_in_future');
    if (now - generatedAt > maxAgeMs) issues.push('full_product_review_stale');
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now || !Number.isFinite(generatedAt)
    || expiresAt <= generatedAt || expiresAt - generatedAt > maxAgeMs) issues.push('full_product_review_expired');

  const artifacts = receipt.artifacts ?? receipt.evidence ?? receipt.review;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) issues.push('full_product_review_artifacts_missing');
  else for (const kind of FULL_PRODUCT_ARTIFACTS) {
    const artifact = artifacts[kind];
    if (!validArtifact(artifact, evidenceRoot)) issues.push(`full_product_review_artifact_invalid:${kind}`);
    const binding = artifact?.binding ?? artifact;
    if (artifact && (binding.buildId !== buildId || binding.head !== head)) issues.push(`full_product_review_artifact_binding_mismatch:${kind}`);
    if (artifact && (JSON.stringify(artifact.locales ?? binding.locales) !== JSON.stringify(FULL_PRODUCT_LOCALES))) issues.push(`full_product_review_artifact_locales_mismatch:${kind}`);
  }

  if (!validSha(receipt.receiptSha256) || receipt.receiptSha256 !== digest(withoutSignature(receipt))) issues.push('full_product_review_hash_invalid');
  const suppliedSignature = typeof receipt.receiptHmacSha256 === 'string'
    ? receipt.receiptHmacSha256
    : typeof receipt.signature === 'string' ? receipt.signature : receipt.signature?.value;
  if (secret.length < 32 || !validSha(suppliedSignature)) issues.push('full_product_review_signature_missing');
  else {
    const expected = createHmac('sha256', secret).update(canonical({ ...withoutSignature(receipt), receiptSha256: receipt.receiptSha256 })).digest('hex');
    if (suppliedSignature !== expected) issues.push('full_product_review_signature_invalid');
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function fullProductArtifactReviewEligible(receipt, options = {}) {
  return verifyFullProductArtifactReviewReceipt(receipt, options).ok;
}

function validMeasurement(value, suite, buildId, head) {
  const command = suite === 'official' ? OFFICIAL_I18N_COMMAND : EXPANDED_I18N_COMMAND;
  return verifyI18nVitestEvidence(value, {
    suite,
    command,
    root: process.env.I18N_AUTOMATED_EVIDENCE_ROOT ?? process.cwd(),
    buildId,
    gitHead: head,
  });
}

export function buildCommercialI18nReleaseReceipt(catalog, measurements = {}) {
  const result = qualifyCommercialCatalog(catalog);
  const locales = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
  const catalogLocales = ['ja', 'zh', 'es', 'ar'];
  const sourcePairs = result.pairs.length;
  const translatedPairs = result.pairs.filter(pair => pair.ko.trim() && pair.en.trim() && catalogLocales.every(locale => typeof catalog[pair.en]?.[locale] === 'string' && catalog[pair.en][locale].trim())).length;
  const buildId = process.env.NEXYFAB_BUILD_ID?.trim() || null;
  const head = process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null;
  const officialVerification = validMeasurement(measurements.official, 'official', buildId, head);
  const expandedVerification = validMeasurement(measurements.expanded, 'expanded', buildId, head);
  const officialValid = officialVerification.ok;
  const expandedValid = expandedVerification.ok;
  const catalogQualified = result.missing.length === 0 && result.invalid.length === 0 && result.legacyBilingualLiterals.length === 0 && sourcePairs > 0 && translatedPairs === sourcePairs;
  const automatedEvidenceValid = Boolean(catalogQualified && officialValid && expandedValid);
  const automatedQualified = Boolean(buildId && head && automatedEvidenceValid);
  const fullProductReview = measurements.fullProductReview
    ?? measurements.fullProductReviewReceipt
    ?? measurements.fullProductArtifactReview
    ?? measurements.externalFullProductReview
    ?? measurements.externalReviewReceipt
    ?? null;
  const fullProductReviewVerification = verifyFullProductArtifactReviewReceipt(fullProductReview, { buildId, head });
  const qualified = automatedQualified && fullProductReviewVerification.ok;
  const payload = {
    schema: 'nexyfab.commercial-i18n-release-receipt.v2', locales, catalogLocales,
    catalog: { sourcePairs, translatedPairs, missing: result.missing, invalid: result.invalid, legacyDebt: result.legacyBilingualLiterals.length, qualified: catalogQualified },
    regression: {
      official: measurements.official ?? null,
      expanded: measurements.expanded ?? null,
      evidenceSha256: digest(measurements),
      validation: { official: officialVerification, expanded: expandedVerification },
    },
    automatedStatus: automatedQualified ? 'PASS' : automatedEvidenceValid ? 'PASS_LOCAL' : 'HOLD',
    fullProductReview: fullProductReview ?? null,
    fullProductReviewStatus: fullProductReviewVerification.ok ? 'QUALIFIED' : 'HOLD',
    gaReady: qualified,
    blockers: [
      ...(!automatedEvidenceValid ? ['AUTOMATED_I18N_EVIDENCE_MISSING_OR_MISMATCHED'] : []),
      ...(!buildId || !head ? ['AUTOMATED_I18N_RELEASE_ID_MISSING'] : []),
      ...(fullProductReviewVerification.ok ? [] : fullProductReviewVerification.issues),
    ],
    measuredScope: 'generated commercial catalog, bound automated tests, and signed/hashed full-product visual/RTL/email/PDF/export artifact review',
    buildId, head,
  };
  const receiptSha256 = digest(payload);
  const secret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '';
  const receiptHmacSha256 = secret.length >= 32 ? createHmac('sha256', secret).update(canonical({ ...payload, receiptSha256 })).digest('hex') : null;
  return { ...payload, status: qualified ? 'QUALIFIED' : 'HOLD', receiptSha256, receiptHmacSha256 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const catalog = JSON.parse(readFileSync('src/lib/i18n/commercialTranslations.generated.json', 'utf8'));
  let measurements = {};
  const evidencePath = process.env.I18N_AUTOMATED_TEST_EVIDENCE;
  if (evidencePath) measurements = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const officialEvidencePath = process.env.I18N_OFFICIAL_TEST_EVIDENCE;
  if (officialEvidencePath) measurements.official = JSON.parse(readFileSync(officialEvidencePath, 'utf8'));
  const expandedEvidencePath = process.env.I18N_EXPANDED_TEST_EVIDENCE;
  if (expandedEvidencePath) measurements.expanded = JSON.parse(readFileSync(expandedEvidencePath, 'utf8'));
  const fullProductReviewPath = process.env.I18N_FULL_PRODUCT_REVIEW_RECEIPT;
  if (fullProductReviewPath) measurements.fullProductReview = JSON.parse(readFileSync(fullProductReviewPath, 'utf8'));
  const receipt = buildCommercialI18nReleaseReceipt(catalog, measurements);
  writeFileSync(process.env.I18N_RELEASE_RECEIPT_OUTPUT ?? 'docs/evidence/release/commercial-i18n-release-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, automatedStatus: receipt.automatedStatus, sourcePairs: receipt.catalog.sourcePairs, translatedPairs: receipt.catalog.translatedPairs, legacyDebt: receipt.catalog.legacyDebt }));
  if (receipt.status !== 'QUALIFIED') process.exitCode = 1;
}
