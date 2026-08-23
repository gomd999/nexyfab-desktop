import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const DESIGN_CASE_ARTIFACTS = Object.freeze([
  'requirements', 'nfab', 'step', 'drawing', 'bom', 'manifest', 'intentEvaluation', 'verificationReceipt',
]);
const DESIGN_CASE_EXTENSIONS = Object.freeze({
  requirements: ['.json', '.md', '.txt'],
  nfab: ['.nfab', '.json'],
  step: ['.step', '.stp'],
  drawing: ['.pdf', '.dxf'],
  bom: ['.csv', '.json', '.xlsx'],
  manifest: ['.json'],
  intentEvaluation: ['.json'],
  verificationReceipt: ['.json'],
});
const DESIGN_FAMILY_COUNTS = Object.freeze({
  machined: 12,
  sheet_metal: 8,
  rotational_sweep_loft: 5,
  pattern_multibody_boolean: 5,
});
const REQUIRED_INTENT_CATEGORIES = Object.freeze([
  'ko_practical', 'en_practical', 'mixed_units', 'missing_required', 'contradictory_or_unmanufacturable',
]);
const REQUIRED_CASE_CHECKS = Object.freeze([
  'kernelValid', 'nonEmpty', 'stableFeatureIds', 'lockedDimensionsPreserved',
  'nfabThreeCycles', 'stepThreeCycles', 'drawingReleased', 'bomReconciled', 'revisionBound',
]);
const VERIFICATION_ROLES = Object.freeze(['step', 'drawing', 'bom']);
const VERIFIER_ROLE_BY_ARTIFACT = Object.freeze({
  step: 'mechanical-step-verifier',
  drawing: 'mechanical-drawing-verifier',
  bom: 'mechanical-bom-verifier',
});
const VERIFICATION_CLAIM_BOUNDARY = Object.freeze({
  actualManufacturingEvidence: 'NOT_RUN',
  actualInspectionEvidence: 'NOT_RUN',
  releaseEligible: false,
});

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function parseTrustedMechanicalDesignVerifiers(raw = process.env.NEXYFAB_MECHANICAL_DESIGN_VERIFIER_KEYS) {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mechanicalDesignVerificationPayload(receipt, artifactRole) {
  const verification = receipt?.artifacts?.[artifactRole] ?? {};
  return canonical({
    schema: 'nexyfab.mechanical-design-case-verification-signature.v1',
    caseId: receipt?.caseId,
    designRevisionSha256: receipt?.designRevisionSha256,
    requirementsSha256: receipt?.requirementsSha256,
    artifactRole,
    artifactSha256: verification.sha256,
    evidenceSha256: verification.evidenceSha256,
    status: verification.status,
    verifierId: verification.verifierId,
    verifierVersion: verification.verifierVersion,
    verifiedAt: verification.verifiedAt,
    claimBoundary: receipt?.claimBoundary,
  });
}

export function validateMechanicalDesignVerificationReceipt(receipt, item, trustedVerifiers = {}, now = Date.now()) {
  if (receipt?.schema !== 'nexyfab.mechanical-design-case-verification.v1'
    || receipt?.caseId !== item?.caseId
    || receipt?.designRevisionSha256 !== item?.designRevisionSha256
    || receipt?.requirementsSha256 !== item?.requirementsSha256
    || receipt?.status !== 'PASS'
    || receipt?.claimBoundary?.actualManufacturingEvidence !== VERIFICATION_CLAIM_BOUNDARY.actualManufacturingEvidence
    || receipt?.claimBoundary?.actualInspectionEvidence !== VERIFICATION_CLAIM_BOUNDARY.actualInspectionEvidence
    || receipt?.claimBoundary?.releaseEligible !== false) return false;

  const verifierIds = new Set();
  for (const role of VERIFICATION_ROLES) {
    const verification = receipt?.artifacts?.[role];
    const trusted = trustedVerifiers?.[verification?.verifierId];
    const verifiedAt = Date.parse(verification?.verifiedAt);
    if (verification?.status !== 'PASS'
      || verification?.sha256 !== item?.artifacts?.[role]?.sha256
      || !SHA256.test(String(verification?.evidenceSha256 ?? ''))
      || typeof verification?.verifierId !== 'string'
      || !verification.verifierId.trim()
      || verifierIds.has(verification.verifierId)
      || typeof verification?.verifierVersion !== 'string'
      || !verification.verifierVersion.trim()
      || !Number.isFinite(verifiedAt)
      || verifiedAt > now
      || typeof verification?.signature !== 'string'
      || !verification.signature.trim()
      || typeof trusted?.publicKey !== 'string'
      || !Array.isArray(trusted?.roles)
      || !trusted.roles.includes(VERIFIER_ROLE_BY_ARTIFACT[role])) return false;
    try {
      if (!crypto.verify(
        null,
        Buffer.from(mechanicalDesignVerificationPayload(receipt, role)),
        trusted.publicKey,
        Buffer.from(verification.signature, 'base64'),
      )) return false;
    } catch {
      return false;
    }
    verifierIds.add(verification.verifierId);
  }
  return Object.keys(receipt?.artifacts ?? {}).length === VERIFICATION_ROLES.length;
}

function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

function realEvidenceRoot(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const absolute = path.resolve(value);
  return fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? fs.realpathSync(absolute) : null;
}

function readBinding(realRoot, binding, extensions, usedPaths) {
  if (!realRoot || typeof binding?.path !== 'string' || !SHA256.test(String(binding?.sha256 ?? ''))) return null;
  const normalized = binding.path.replaceAll('\\', '/');
  if (usedPaths.has(normalized) || !extensions.includes(path.extname(normalized).toLowerCase())) return null;
  const absolute = resolveInside(realRoot, normalized);
  if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return null;
  const real = fs.realpathSync(absolute);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return null;
  const bytes = fs.readFileSync(real);
  if (sha256(bytes) !== binding.sha256) return null;
  usedPaths.add(normalized);
  return { bytes, normalized };
}

function validIntentEvaluation(value, item) {
  if (value?.schema !== 'nexyfab.mechanical-intent-case-evaluation.v1'
    || value?.caseId !== item.caseId
    || value?.designRevisionSha256 !== item.designRevisionSha256
    || !Array.isArray(value?.entries)) return { valid: false, intents: 0 };
  const categories = new Set(value.entries.map(entry => entry?.category));
  const entryValid = entry => {
    const stages = entry?.stages ?? {};
    const statuses = ['pass', 'not_run', 'rejected'];
    if (!REQUIRED_INTENT_CATEGORIES.includes(entry?.category)
      || !['executed', 'clarified', 'rejected'].includes(entry?.outcome)
      || entry?.falseVerified !== false
      || typeof entry?.verified !== 'boolean'
      || !['parse', 'requirements', 'plan', 'geometry', 'verification'].every(stage => statuses.includes(stages[stage]))) return false;
    if (entry.outcome === 'executed') return entry.verified === true
      && ['parse', 'requirements', 'plan', 'geometry', 'verification'].every(stage => stages[stage] === 'pass');
    return entry.verified === false && stages.verification !== 'pass';
  };
  return {
    valid: REQUIRED_INTENT_CATEGORIES.every(category => categories.has(category)) && value.entries.every(entryValid),
    intents: value.entries.length,
  };
}

function validDesignCase(realRoot, item, usedPaths, trustedVerifiers, now) {
  if (item?.status !== 'pass'
    || !SHA256.test(String(item?.designRevisionSha256 ?? ''))
    || !SHA256.test(String(item?.requirementsSha256 ?? ''))
    || !Object.hasOwn(DESIGN_FAMILY_COUNTS, item?.family)
    || typeof item?.primaryFeature !== 'string'
    || !item.primaryFeature.trim()
    || REQUIRED_CASE_CHECKS.some(check => item?.checks?.[check] !== true)
    || item?.cycles?.nfab !== 3
    || item?.cycles?.step !== 3) return { valid: false, intents: 0 };

  const loaded = {};
  for (const role of DESIGN_CASE_ARTIFACTS) {
    const artifact = readBinding(realRoot, item?.artifacts?.[role], DESIGN_CASE_EXTENSIONS[role], usedPaths);
    if (!artifact) return { valid: false, intents: 0 };
    loaded[role] = artifact;
  }
  let manifest;
  let intentEvaluation;
  let verificationReceipt;
  try {
    manifest = JSON.parse(loaded.manifest.bytes.toString('utf8'));
    intentEvaluation = JSON.parse(loaded.intentEvaluation.bytes.toString('utf8'));
    verificationReceipt = JSON.parse(loaded.verificationReceipt.bytes.toString('utf8'));
  } catch {
    return { valid: false, intents: 0 };
  }
  const manifestValid = manifest?.schema === 'nexyfab.mechanical-design-case-manifest.v1'
    && manifest?.caseId === item.caseId
    && manifest?.designRevisionSha256 === item.designRevisionSha256
    && manifest?.requirementsSha256 === item.requirementsSha256
    && DESIGN_CASE_ARTIFACTS.filter(role => role !== 'manifest')
      .every(role => manifest?.artifacts?.[role] === item.artifacts[role].sha256);
  const intent = validIntentEvaluation(intentEvaluation, item);
  const verificationReceiptValid = validateMechanicalDesignVerificationReceipt(
    verificationReceipt,
    item,
    trustedVerifiers,
    now,
  );
  return { valid: manifestValid && intent.valid && verificationReceiptValid, intents: intent.intents };
}

export function assessMechanicalDesignCampaign(receipt, {
  evidenceRoot = process.env.NEXYFAB_MECHANICAL_DESIGN_EVIDENCE_ROOT,
  trustedDesignVerifiers = parseTrustedMechanicalDesignVerifiers(),
  now = Date.now(),
} = {}) {
  const cases = Array.isArray(receipt?.cases) ? receipt.cases : [];
  const caseIds = new Set(cases.map(item => item?.caseId).filter(Boolean));
  const primaryFeatures = new Set(cases.map(item => item?.primaryFeature).filter(Boolean));
  const familyCounts = Object.fromEntries(Object.keys(DESIGN_FAMILY_COUNTS).map(family => [family, cases.filter(item => item?.family === family).length]));
  const structural = receipt?.schema === 'nexyfab.mechanical-direct-design-campaign.v1'
    && receipt?.releaseChannel === 'mechanical-core'
    && SHA256.test(String(receipt?.evidenceRootId ?? ''))
    && Number.isFinite(Date.parse(receipt?.generatedAt))
    && Date.parse(receipt.generatedAt) <= now
    && cases.length === 30
    && caseIds.size === 30
    && primaryFeatures.size === 30
    && Object.entries(DESIGN_FAMILY_COUNTS).every(([family, count]) => familyCounts[family] === count)
    && cases.every(item => ['pending', 'pass', 'fail'].includes(item?.status));
  const realRoot = realEvidenceRoot(evidenceRoot);
  const usedPaths = new Set();
  let passedCases = 0;
  let intents = 0;
  if (structural && realRoot) {
    for (const item of cases) {
      if (item.status !== 'pass') continue;
      const result = validDesignCase(realRoot, item, usedPaths, trustedDesignVerifiers, now);
      if (result.valid) {
        passedCases += 1;
        intents += result.intents;
      }
    }
  }
  const summary = receipt?.summary ?? {};
  const claimedPassed = cases.filter(item => item?.status === 'pass').length;
  const summaryValid = summary.cases === 30
    && summary.passed === claimedPassed
    && summary.pending === cases.filter(item => item?.status === 'pending').length
    && summary.failed === cases.filter(item => item?.status === 'fail').length
    && summary.falseVerified === 0
    && summary.intents === intents;
  const candidateVerified = structural && summaryValid && passedCases >= 10 && intents >= passedCases * 5;
  const completeVerified = candidateVerified
    && receipt?.ok === true
    && passedCases === 30
    && intents >= 150
    && summary.passed === 30
    && summary.pending === 0
    && summary.failed === 0;
  return {
    structural,
    summaryValid,
    passedCases,
    intents,
    candidateVerified,
    completeVerified,
    standardStepConformanceVerified: completeVerified,
  };
}

export function blindChallengeTargetHash(receipt, item) {
  const caseTarget = structuredClone(item);
  delete caseTarget.reviews;
  delete caseTarget.targetHash;
  return sha256(Buffer.from(canonical({
    schema: 'nexyfab.mechanical-blind-challenge-target.v1',
    releaseChannel: receipt.releaseChannel,
    evidenceRootId: receipt.evidenceRootId,
    case: caseTarget,
  })));
}

export function blindChallengeReviewPayload(receipt, item, review) {
  return canonical({
    schema: 'nexyfab.mechanical-blind-challenge-review-signoff.v1',
    releaseChannel: receipt.releaseChannel,
    challengeId: item.challengeId,
    targetHash: review.targetHash,
    reviewerId: review.reviewerId,
    decision: review.decision,
    reviewedAt: review.reviewedAt,
  });
}

export function parseTrustedBlindReviewers(raw = process.env.NEXYFAB_BLIND_REVIEWER_KEYS) {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function validateMechanicalBlindChallenge(receipt, {
  evidenceRoot = process.env.NEXYFAB_MECHANICAL_BLIND_EVIDENCE_ROOT,
  trustedReviewers = parseTrustedBlindReviewers(),
  now = Date.now(),
} = {}) {
  const cases = Array.isArray(receipt?.cases) ? receipt.cases : [];
  const ids = new Set(cases.map(item => item?.challengeId).filter(Boolean));
  const revisions = new Set(cases.map(item => item?.designRevisionSha256).filter(Boolean));
  const realRoot = realEvidenceRoot(evidenceRoot);
  const usedPaths = new Set();
  const validCase = item => {
    const requirements = readBinding(realRoot, item?.artifacts?.requirements, ['.json', '.md', '.txt'], usedPaths);
    const releasePackage = readBinding(realRoot, item?.artifacts?.releasePackage, ['.zip', '.json'], usedPaths);
    if (!requirements || !releasePackage || !SHA256.test(String(item?.designRevisionSha256 ?? ''))) return false;
    const lockedAt = Date.parse(item?.requirementsLockedAt);
    const startedAt = Date.parse(item?.startedAt);
    const completedAt = Date.parse(item?.completedAt);
    const targetHash = blindChallengeTargetHash(receipt, item);
    const reviews = Array.isArray(item?.reviews) ? item.reviews : [];
    const validReviewerIds = new Set();
    for (const review of reviews) {
      const registration = trustedReviewers[review?.reviewerId];
      const reviewedAt = Date.parse(review?.reviewedAt);
      let signatureValid = false;
      try {
        signatureValid = registration?.roles?.includes('mechanical-blind-reviewer') === true
          && crypto.verify(
            null,
            Buffer.from(blindChallengeReviewPayload(receipt, item, review)),
            registration.publicKey,
            Buffer.from(review.signature, 'base64'),
          );
      } catch {
        signatureValid = false;
      }
      if (review?.decision === 'approved'
        && review?.independentFromBuild === true
        && review?.reviewerId !== item?.builderId
        && review?.targetHash === targetHash
        && Number.isFinite(reviewedAt)
        && reviewedAt >= completedAt
        && reviewedAt <= now
        && signatureValid) validReviewerIds.add(review.reviewerId);
    }
    const requiredReviewers = item?.risk === 'high' ? 2 : 1;
    return item?.status === 'pass'
      && ['standard', 'high'].includes(item?.risk)
      && item?.internalRoleSeparated === true
      && typeof item?.builderId === 'string'
      && item.builderId.length > 0
      && Number.isFinite(lockedAt)
      && Number.isFinite(startedAt)
      && Number.isFinite(completedAt)
      && lockedAt <= startedAt
      && startedAt <= completedAt
      && completedAt <= now
      && item?.targetHash === targetHash
      && validReviewerIds.size >= requiredReviewers;
  };
  const structurallyValid = receipt?.schema === 'nexyfab.mechanical-blind-product-challenge.v1'
    && receipt?.releaseChannel === 'mechanical-core'
    && receipt?.ok === true
    && SHA256.test(String(receipt?.evidenceRootId ?? ''))
    && Number.isFinite(Date.parse(receipt?.generatedAt))
    && Date.parse(receipt.generatedAt) <= now
    && cases.length === 20
    && ids.size === 20
    && revisions.size === 20
    && cases.filter(item => item?.risk === 'high').length >= 5;
  const valid = structurallyValid && realRoot && cases.every(validCase);
  const summary = receipt?.summary ?? {};
  return Boolean(valid
    && summary.cases === 20
    && summary.passed === 20
    && summary.pending === 0
    && summary.failed === 0
    && summary.highRisk >= 5
    && summary.falseVerified === 0);
}
