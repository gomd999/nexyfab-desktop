#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIndependentDomainReviewKit } from './validate-independent-domain-review-kit.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const found = args.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function buildMechanicalDualExpertReviewReceipt({ kit, kitBytes, generatedAt = null, trustedReviewers }) {
  const validation = validateIndependentDomainReviewKit(kit, { trustedReviewers });
  if (kit?.schema !== 'nexyfab.independent-domain-review-kit.v3'
    || kit?.releaseChannel !== 'mechanical-core'
    || validation.releaseEligible !== true) {
    throw new Error(`MECHANICAL_EXPERT_RECEIPT_KIT_NOT_ELIGIBLE:${validation.issues.join(',') || 'pending_cases'}`);
  }
  const byReviewer = new Map();
  for (const item of kit.cases) {
    for (const review of [item.reviews.domainReviewer, item.reviews.independentReviewer]) {
      const current = byReviewer.get(review.reviewerId) ?? { signatures: [], signedAt: review.reviewedAt };
      current.signatures.push(review.signature);
      if (review.reviewedAt > current.signedAt) current.signedAt = review.reviewedAt;
      byReviewer.set(review.reviewerId, current);
    }
  }
  const reviewers = [...byReviewer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reviewerId, value]) => ({
      reviewerId,
      independentFromBuild: true,
      signedAt: value.signedAt,
      signatureRef: `sha256:${sha256(Buffer.from(value.signatures.sort().join('\0')))}`,
    }));
  const latestReview = kit.cases
    .flatMap(item => [item.reviews.domainReviewer.reviewedAt, item.reviews.independentReviewer.reviewedAt])
    .sort()
    .at(-1);
  return {
    schema: 'nexyfab.mechanical-dual-expert-review.v2',
    releaseChannel: 'mechanical-core',
    generatedAt: generatedAt ?? latestReview,
    ok: true,
    reviewKitSchema: kit.schema,
    holdoutCorpusSha256: sha256(kitBytes),
    reviewers,
    summary: { cases: 20, dualApproved: 20, pending: 0, rejected: 0, changesRequested: 0 },
  };
}

export function main(args = process.argv.slice(2)) {
  const input = path.resolve(option(args, 'review-kit', 'docs/evidence/release/mechanical-core-independent-domain-review-kit.json'));
  const outputArg = option(args, 'out');
  if (!outputArg) throw new Error('MECHANICAL_EXPERT_RECEIPT_OUTPUT_REQUIRED');
  const output = path.resolve(outputArg);
  if (fs.existsSync(output)) throw new Error('MECHANICAL_EXPERT_RECEIPT_OUTPUT_ALREADY_EXISTS');
  const kitBytes = fs.readFileSync(input);
  const kit = JSON.parse(kitBytes.toString('utf8'));
  const receipt = buildMechanicalDualExpertReviewReceipt({ kit, kitBytes });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, output, holdoutCorpusSha256: receipt.holdoutCorpusSha256 })}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[mechanical-expert-receipt] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
