#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIndependentDomainReviewKit } from './validate-independent-domain-review-kit.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const found = args.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function promoteMechanicalIndependentReviewKit({
  baseCorpus,
  kit,
  kitPath,
  kitBytes,
  trustedReviewers,
  generatedAt = new Date().toISOString(),
}) {
  if (baseCorpus?.schema !== 'nexyfab.commercial-validation-corpus.v1'
    && baseCorpus?.schema !== 'nexyfab.commercial-validation-corpus.v2') {
    throw new Error('MECHANICAL_PROMOTION_BASE_CORPUS_INVALID');
  }
  const validation = validateIndependentDomainReviewKit(kit, { trustedReviewers });
  if (kit?.schema !== 'nexyfab.independent-domain-review-kit.v3'
    || kit?.releaseChannel !== 'mechanical-core'
    || validation.releaseEligible !== true) {
    throw new Error(`MECHANICAL_PROMOTION_REVIEW_KIT_NOT_ELIGIBLE:${validation.issues.join(',') || 'pending_cases'}`);
  }
  const reviewers = new Set(kit.cases.flatMap(item => [
    item.reviews.domainReviewer.reviewerId,
    item.reviews.independentReviewer.reviewerId,
  ]));
  const kitSha256 = sha256(kitBytes);
  if (!SHA256.test(kitSha256)) throw new Error('MECHANICAL_PROMOTION_KIT_HASH_INVALID');

  const promoted = structuredClone(baseCorpus);
  promoted.schema = 'nexyfab.commercial-validation-corpus.v2';
  promoted.generatedAt = generatedAt;
  promoted.releaseChannel = 'mechanical-core';
  promoted.requiredDomains = ['mechanical'];
  promoted.lanes.independentHoldout.domains.mechanical = {
    requiredCases: 20,
    approvedCases: 20,
    requiredIndependentReviewers: 2,
    independentReviewers: reviewers.size,
    releaseEligible: true,
    blockers: [],
    sourceReviewKit: { path: kitPath.replaceAll('\\', '/'), sha256: kitSha256 },
  };
  promoted.decision = 'mechanical_core_independent_holdout_ready';
  promoted.promotion = {
    sourceReviewKit: { path: kitPath.replaceAll('\\', '/'), sha256: kitSha256 },
    sourceCases: 20,
    sourceSignedReviews: 40,
    sourceReleaseEligible: true,
    sourceMutated: false,
  };
  return promoted;
}

export function main(args = process.argv.slice(2)) {
  const kitArg = option(args, 'review-kit', 'docs/evidence/release/mechanical-core-independent-domain-review-kit.json');
  const baseArg = option(args, 'base', 'docs/evidence/release/commercial-validation-corpus-260810.json');
  const outputArg = option(args, 'out');
  if (!outputArg) throw new Error('MECHANICAL_PROMOTION_OUTPUT_REQUIRED');
  const kitPath = path.resolve(kitArg);
  const basePath = path.resolve(baseArg);
  const outputPath = path.resolve(outputArg);
  if (fs.existsSync(outputPath)) throw new Error('MECHANICAL_PROMOTION_OUTPUT_ALREADY_EXISTS');
  const kitBytes = fs.readFileSync(kitPath);
  const kit = JSON.parse(kitBytes.toString('utf8'));
  const baseCorpus = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const promoted = promoteMechanicalIndependentReviewKit({
    baseCorpus,
    kit,
    kitPath: path.relative(process.cwd(), kitPath),
    kitBytes,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(promoted, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, reviewKitSha256: promoted.promotion.sourceReviewKit.sha256 })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-promotion] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
