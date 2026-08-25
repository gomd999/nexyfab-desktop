#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessMechanicalDesignCampaign,
  validateMechanicalBlindChallenge,
} from './mechanical-commercial-evidence-v3.mjs';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
} from './canonical-text-binding.mjs';
import { EVIDENCE_BINDING_ROOTS } from './run-mechanical-core-internal-verification.mjs';

export const MECHANICAL_SCOPE_PATHS = Object.freeze({
  internalVerification: 'docs/evidence/cad-independent/mechanical-core-internal-verification.json',
  featureClosedLoopAssessment: 'docs/evidence/cad-independent/mechanical-core-feature-closed-loop-assessment.json',
  directDesignCampaign: 'docs/evidence/release/mechanical-direct-design-campaign-receipt.json',
  blindProductChallenge: 'docs/evidence/release/mechanical-blind-product-challenge-receipt.json',
  manufacturingValidation: 'docs/evidence/release/mechanical-manufacturing-validation-receipt.json',
  output: 'docs/evidence/cad-independent/mechanical-product-scope-assessment.json',
});

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const render = value => `${JSON.stringify(value, null, 2)}\n`;
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

export const REQUIRED_MECHANICAL_PILOT_PROCESSES = Object.freeze([
  'cnc_machining',
  'sheet_metal',
  'additive_manufacturing',
]);
const REQUIRED_PILOT_ARTIFACTS = Object.freeze([
  'nfab', 'step', 'drawing', 'bom', 'manufacturingReceipt', 'inspectionReport', 'photoEvidence',
]);
const PILOT_ARTIFACT_EXTENSIONS = Object.freeze({
  nfab: ['.nfab', '.json'],
  step: ['.step', '.stp'],
  drawing: ['.pdf', '.dxf'],
  bom: ['.csv', '.json', '.xlsx'],
  manufacturingReceipt: ['.pdf', '.json'],
  inspectionReport: ['.pdf', '.json', '.csv'],
  photoEvidence: ['.jpg', '.jpeg', '.png', '.pdf'],
});

export function parseTrustedManufacturingInspectors(raw = process.env.NEXYFAB_MANUFACTURING_REVIEWER_KEYS) {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mechanicalManufacturingCaseTargetHash(receipt, item) {
  const caseTarget = { ...item };
  delete caseTarget.inspector;
  return sha256(Buffer.from(canonical({
    schema: 'nexyfab.mechanical-manufacturing-pilot-target.v1',
    releaseChannel: receipt.releaseChannel,
    evidenceRootId: receipt.evidenceRootId,
    case: caseTarget,
  })));
}

export function mechanicalManufacturingInspectorPayload(receipt, item, inspector) {
  return canonical({
    schema: 'nexyfab.mechanical-manufacturing-inspection-signoff.v1',
    releaseChannel: receipt.releaseChannel,
    caseId: item.caseId,
    reviewerId: inspector.reviewerId,
    inspectedAt: inspector.inspectedAt,
    targetHash: inspector.targetHash,
  });
}

function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const prefix = `${resolvedRoot}${path.sep}`;
  return resolved === resolvedRoot || resolved.startsWith(prefix) ? resolved : null;
}

function readOptionalEvidence(root, relative) {
  const absolute = resolveInside(root, relative);
  const safe = safeFileInsideRoot(root, absolute);
  if (!safe) return null;
  const bytes = fs.readFileSync(safe);
  return { path: relative, ...canonicalTextBinding(bytes), value: JSON.parse(bytes.toString('utf8')) };
}

/**
 * Evidence paths are repository-relative claims. A lexical path check alone
 * still permits a symlinked directory to point outside the evidence root, so
 * resolve and constrain the real path before hashing or parsing it.
 */
function safeFileInsideRoot(root, absolute) {
  if (!absolute) return null;
  try {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return null;
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(absolute);
    return real === realRoot || real.startsWith(`${realRoot}${path.sep}`) ? real : null;
  } catch {
    return null;
  }
}

function internalReceiptValid(root, receipt) {
  if (receipt?.schema !== 'nexyfab.mechanical-core-internal-verification.v1' || receipt?.ok !== true) return false;
  if (receipt?.bindingPolicy?.text !== TEXT_BINDING_CANONICALIZATION
    || receipt?.bindingPolicy?.binary !== 'raw'
    || JSON.stringify(receipt?.bindingPolicy?.evidenceRoots) !== JSON.stringify(EVIDENCE_BINDING_ROOTS)) return false;
  const checks = receipt.checks ?? {};
  if (checks.losslessDesignGraph !== true
    || checks.coreThirtyImplementationCoverage !== true
    || checks.threeCycleNfab !== true
    || checks.threeCycleStep !== true
    || checks.mechanicalAccuracy !== true
    || checks.intentIntakeQualification !== true
    || checks.intentExactRuntimeRepresentative !== true
    || checks.assemblyDrawingHandoffLocalReadiness !== true
    || checks.typecheck !== true) return false;
  if (!Array.isArray(receipt.commands) || receipt.commands.length < 6
    || receipt.commands.some(command => command?.exitCode !== 0)) return false;
  const commands = Object.fromEntries(receipt.commands.map(command => [command?.name, command]));
  if (commands['direct-cad']?.environment?.RUN_OCCT_FEASIBILITY !== '1'
    || !commands['mechanical-accuracy']
    || !commands['intent-qualification']
    || !commands['intent-runtime']
    || !commands['assembly-handoff-readiness']
    || !commands.typecheck) return false;
  if (!Array.isArray(receipt.sourceBindings) || receipt.sourceBindings.length === 0) return false;
  if (!EVIDENCE_BINDING_ROOTS.every(evidenceRoot => receipt.sourceBindings.some(binding =>
    typeof binding?.path === 'string' && binding.path.startsWith(`${evidenceRoot}/`)))) return false;

  return receipt.sourceBindings.every(binding => {
    if (!SHA256.test(String(binding?.sha256 ?? ''))) return false;
    const absolute = resolveInside(root, binding?.path);
    const safe = safeFileInsideRoot(root, absolute);
    if (safe === null) return false;
    const bytes = fs.readFileSync(safe);
    const actual = binding?.canonicalization === TEXT_BINDING_CANONICALIZATION
      ? canonicalTextBinding(bytes)
      : binding?.canonicalization === 'raw'
        ? { sha256: sha256(bytes), bytes: bytes.byteLength }
        : null;
    return actual !== null && actual.sha256 === binding.sha256 && actual.bytes === binding.bytes;
  });
}

function sourceBindingValid(root, binding) {
  if (typeof binding?.path !== 'string' || !SHA256.test(String(binding?.sha256 ?? ''))) return false;
  const absolute = resolveInside(root, binding.path);
  const safe = safeFileInsideRoot(root, absolute);
  if (safe === null) return false;
  const bytes = fs.readFileSync(safe);
  if (binding?.canonicalization === TEXT_BINDING_CANONICALIZATION) {
    const actual = canonicalTextBinding(bytes);
    return actual.sha256 === binding.sha256 && (binding.bytes === undefined || actual.bytes === binding.bytes);
  }
  return binding?.canonicalization === 'raw'
    && sha256(bytes) === binding.sha256
    && (binding.bytes === undefined || bytes.byteLength === binding.bytes);
}

function featureClosedLoopAssessmentValid(root, assessment) {
  return assessment?.schema === 'nexyfab.mechanical-core-feature-contract.v1'
    && assessment?.eligible === true
    && assessment?.required === 30
    && assessment?.passed === 30
    && Array.isArray(assessment?.blockers)
    && assessment.blockers.length === 0
    && sourceBindingValid(root, assessment?.sourceReceipt);
}

export function validateMechanicalDualExpertReview(receipt, expectedHoldoutSha256 = null) {
  const reviewers = Array.isArray(receipt?.reviewers) ? receipt.reviewers : [];
  const reviewerIds = new Set(reviewers.map(item => item?.reviewerId).filter(Boolean));
  const summary = receipt?.summary ?? {};
  return receipt?.schema === 'nexyfab.mechanical-dual-expert-review.v2'
    && receipt?.releaseChannel === 'mechanical-core'
    && receipt?.ok === true
    && receipt?.reviewKitSchema === 'nexyfab.independent-domain-review-kit.v3'
    && reviewers.length >= 2
    && reviewerIds.size === reviewers.length
    && reviewers.every(item => item?.independentFromBuild === true
      && typeof item?.signedAt === 'string'
      && typeof item?.signatureRef === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(item.signatureRef))
    && Number.isInteger(summary.cases)
    && summary.cases >= 20
    && summary.dualApproved === summary.cases
    && summary.pending === 0
    && summary.rejected === 0
    && summary.changesRequested === 0
    && SHA256.test(String(receipt?.holdoutCorpusSha256 ?? ''))
    && (expectedHoldoutSha256 === null || receipt.holdoutCorpusSha256 === expectedHoldoutSha256);
}

export function validateMechanicalManufacturingReceipt(receipt, {
  evidenceRoot = process.env.NEXYFAB_MECHANICAL_PILOT_ROOT,
  trustedInspectors = parseTrustedManufacturingInspectors(),
  now = Date.now(),
} = {}) {
  const cases = Array.isArray(receipt?.cases) ? receipt.cases : [];
  const caseIds = new Set(cases.map(item => item?.caseId).filter(Boolean));
  const processes = new Set(cases.map(item => item?.process).filter(Boolean));
  const revisions = new Set(cases.map(item => item?.designRevision).filter(Boolean));
  const facilities = new Set(cases.map(item => item?.manufacturer?.facilityId).filter(Boolean));
  const inspectors = new Set(cases.map(item => item?.inspector?.reviewerId).filter(Boolean));
  const artifactPaths = new Set();
  const summary = receipt?.summary ?? {};
  const absoluteRoot = typeof evidenceRoot === 'string' && evidenceRoot.trim() ? path.resolve(evidenceRoot) : null;
  const realRoot = absoluteRoot && fs.existsSync(absoluteRoot) && fs.statSync(absoluteRoot).isDirectory()
    ? fs.realpathSync(absoluteRoot)
    : null;
  const artifactValid = (role, binding) => {
    if (!realRoot || typeof binding?.path !== 'string' || !SHA256.test(String(binding?.sha256 ?? ''))) return false;
    const absolute = resolveInside(realRoot, binding.path);
    if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return false;
    const real = fs.realpathSync(absolute);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return false;
    const normalized = binding.path.replaceAll('\\', '/');
    if (artifactPaths.has(normalized)) return false;
    artifactPaths.add(normalized);
    const extension = path.extname(normalized).toLowerCase();
    return PILOT_ARTIFACT_EXTENSIONS[role].includes(extension)
      && sha256(fs.readFileSync(real)) === binding.sha256;
  };
  const caseValid = item => {
    const measurements = Array.isArray(item?.measurements) ? item.measurements : [];
    const measurementValid = measurement => Number.isFinite(measurement?.nominal)
      && Number.isFinite(measurement?.actual)
      && Number.isFinite(measurement?.minusTolerance)
      && measurement.minusTolerance >= 0
      && Number.isFinite(measurement?.plusTolerance)
      && measurement.plusTolerance >= 0
      && typeof measurement?.characteristic === 'string'
      && measurement.characteristic.trim().length > 0
      && typeof measurement?.unit === 'string'
      && measurement.unit.trim().length > 0
      && measurement.result === 'pass'
      && measurement.actual >= measurement.nominal - measurement.minusTolerance
      && measurement.actual <= measurement.nominal + measurement.plusTolerance;
    const artifacts = item?.artifacts ?? {};
    const bindingsValid = REQUIRED_PILOT_ARTIFACTS.every(role => artifactValid(role, artifacts[role]));
    const inspector = item?.inspector ?? {};
    const registration = trustedInspectors[inspector.reviewerId];
    const expectedTarget = mechanicalManufacturingCaseTargetHash(receipt, item);
    let signatureValid = false;
    try {
      signatureValid = registration?.roles?.includes('manufacturing-inspector') === true
        && crypto.verify(
          null,
          Buffer.from(mechanicalManufacturingInspectorPayload(receipt, item, inspector)),
          registration.publicKey,
          Buffer.from(inspector.signature, 'base64'),
        );
    } catch {
      signatureValid = false;
    }
    const completedAt = Date.parse(item?.manufacturer?.completedAt);
    const inspectedAt = Date.parse(inspector?.inspectedAt);
    return item?.result === 'pass'
      && REQUIRED_MECHANICAL_PILOT_PROCESSES.includes(item?.process)
      && SHA256.test(String(item?.designRevision ?? ''))
      && item?.noUnapprovedCadChanges === true
      && item?.stepRoundtripVerified === true
      && item?.drawingReleased === true
      && item?.bomReconciled === true
      && item?.inspectionDisposition === 'accepted'
      && typeof item?.manufacturer?.facilityId === 'string'
      && item.manufacturer.facilityId.trim().length > 0
      && item?.manufacturer?.independentFromNexyfab === true
      && Number.isFinite(completedAt)
      && Number.isFinite(inspectedAt)
      && inspectedAt >= completedAt
      && inspectedAt <= now
      && inspector?.independentFromBuild === true
      && inspector?.targetHash === expectedTarget
      && signatureValid
      && measurements.length >= 3
      && new Set(measurements.map(measurement => measurement?.characteristic)).size === measurements.length
      && measurements.every(measurementValid)
      && bindingsValid;
  };

  return receipt?.schema === 'nexyfab.mechanical-manufacturing-validation.v3'
    && receipt?.releaseChannel === 'mechanical-core'
    && receipt?.ok === true
    && SHA256.test(String(receipt?.evidenceRootId ?? ''))
    && Number.isFinite(Date.parse(receipt?.generatedAt))
    && Date.parse(receipt.generatedAt) <= now
    && cases.length === 3
    && caseIds.size === cases.length
    && revisions.size === cases.length
    && processes.size === REQUIRED_MECHANICAL_PILOT_PROCESSES.length
    && REQUIRED_MECHANICAL_PILOT_PROCESSES.every(process => processes.has(process))
    && facilities.size >= 2
    && inspectors.size >= 2
    && cases.every(caseValid)
    && summary.cases === cases.length
    && summary.passed === cases.length
    && summary.failed === 0
    && summary.pending === 0
    && summary.measurements === cases.reduce((count, item) => count + item.measurements.length, 0);
}

export function buildMechanicalProductScopeAssessment(root, paths = MECHANICAL_SCOPE_PATHS) {
  const internal = readOptionalEvidence(root, paths.internalVerification);
  const featureClosedLoop = readOptionalEvidence(root, paths.featureClosedLoopAssessment);
  const directDesignCampaign = readOptionalEvidence(root, paths.directDesignCampaign);
  const blindProductChallenge = readOptionalEvidence(root, paths.blindProductChallenge);
  const manufacturing = readOptionalEvidence(root, paths.manufacturingValidation);
  const internalVerified = internalReceiptValid(root, internal?.value);
  const coreThirtyFeatureClosedLoopVerified = featureClosedLoopAssessmentValid(root, featureClosedLoop?.value);
  const designCampaign = assessMechanicalDesignCampaign(directDesignCampaign?.value);
  const blindProductChallengeVerified = validateMechanicalBlindChallenge(blindProductChallenge?.value);
  const manufacturingReceiptVerified = validateMechanicalManufacturingReceipt(manufacturing?.value);

  const evidence = {
    internalRegressionVerified: internalVerified,
    intentQualification150Verified: internalVerified && internal.value.checks.intentIntakeQualification === true,
    intentRuntimeRepresentativeVerified: internalVerified && internal.value.checks.intentExactRuntimeRepresentative === true,
    assemblyDrawingHandoffLocalVerified: internalVerified && internal.value.checks.assemblyDrawingHandoffLocalReadiness === true,
    coreThirtyFeatureClosedLoopVerified,
    directDesignCandidateVerified: designCampaign.candidateVerified,
    directDesignThirtyVerified: designCampaign.completeVerified,
    intentCampaign150Verified: designCampaign.completeVerified && designCampaign.intents >= 150,
    standardStepConformanceVerified: designCampaign.standardStepConformanceVerified,
    artifactRevisionConsistencyVerified: internalVerified
      && internal.value.checks.losslessDesignGraph === true
      && internal.value.checks.threeCycleNfab === true,
    blindProductChallengeVerified,
    manufacturingReceiptVerified,
  };
  const privateBetaEligible = evidence.internalRegressionVerified
    && evidence.coreThirtyFeatureClosedLoopVerified
    && evidence.directDesignCandidateVerified
    && evidence.artifactRevisionConsistencyVerified;
  const selfServiceEligible = privateBetaEligible
    && evidence.directDesignThirtyVerified
    && evidence.intentCampaign150Verified
    && evidence.standardStepConformanceVerified
    && evidence.artifactRevisionConsistencyVerified
    && evidence.blindProductChallengeVerified;
  const manufacturingReleaseVerified = selfServiceEligible && evidence.manufacturingReceiptVerified;
  const blockers = [
    ...(!evidence.internalRegressionVerified ? ['mechanical_internal_regression_required'] : []),
    ...(!evidence.coreThirtyFeatureClosedLoopVerified ? ['mechanical_core_30_feature_closed_loop_required'] : []),
    ...(!evidence.directDesignCandidateVerified ? ['ten_direct_design_packages_required_for_private_beta'] : []),
    ...(!evidence.directDesignThirtyVerified ? ['thirty_direct_design_packages_required'] : []),
    ...(!evidence.intentCampaign150Verified ? ['mechanical_intent_campaign_150_required'] : []),
    ...(!evidence.standardStepConformanceVerified ? ['standard_step_conformance_required'] : []),
    ...(!evidence.artifactRevisionConsistencyVerified ? ['artifact_revision_consistency_verification_required'] : []),
    ...(!evidence.blindProductChallengeVerified ? ['twenty_blind_product_challenges_required'] : []),
    ...(!evidence.manufacturingReceiptVerified ? ['three_manufactured_pilot_receipts_required'] : []),
  ];

  const sources = [internal, featureClosedLoop, directDesignCampaign, blindProductChallenge, manufacturing]
    .filter(Boolean)
    .map(item => ({ path: item.path, sha256: item.sha256, bytes: item.bytes, canonicalization: item.canonicalization }));
  const assessedAt = [internal, featureClosedLoop, directDesignCampaign, blindProductChallenge, manufacturing]
    .map(item => item?.value?.generatedAt ?? item?.value?.assessedAt)
    .filter(value => typeof value === 'string')
    .sort()
    .at(-1) ?? null;
  return {
    schema: 'nexyfab.mechanical-product-scope-assessment.v4',
    releaseChannel: 'mechanical-core',
    assessedAt,
    sources,
    evidence,
    decision: {
      privateBetaEligible,
      selfServiceEligible,
      manufacturingReleaseVerified,
      failClosed: true,
      status: manufacturingReleaseVerified
        ? 'manufacturing_release_verified'
        : selfServiceEligible
          ? 'self_service_verified'
          : privateBetaEligible
            ? 'ga_evidence_pending'
            : 'private_beta_evidence_pending',
    },
    blockers,
    claimBoundary: {
      internalRegressionCertifiesCommercialAccuracy: false,
      syntheticEvidenceCertifiesCommercialAccuracy: false,
      stepExportAloneCertifiesManufacturability: false,
      kernelSelfRoundtripCertifiesCommercialCadCompatibility: false,
      featureRegistrationAloneCertifiesClosedLoop: false,
      spatialLabsEvidenceMaySatisfyMechanicalCore: false,
      vendorSpecificCadValidationRequiredForBaseRelease: false,
      internalRoleSeparatedReviewMayBeMarketedAsExternal: false,
    },
  };
}

export function checkOrWriteMechanicalProductScopeAssessment({ root, write, paths = MECHANICAL_SCOPE_PATHS }) {
  const output = resolveInside(root, paths.output);
  if (!output) throw new Error('MECHANICAL_SCOPE_OUTPUT_PATH_INVALID');
  const expectedValue = buildMechanicalProductScopeAssessment(root, paths);
  const expected = render(expectedValue);
  if (write) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, expected);
    return { ok: true, output: paths.output, status: expectedValue.decision.status, blockers: expectedValue.blockers };
  }
  const actual = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  return {
    ok: actual === expected,
    output: paths.output,
    status: expectedValue.decision.status,
    blockers: expectedValue.blockers,
    error: actual === expected ? null : 'MECHANICAL_PRODUCT_SCOPE_ASSESSMENT_STALE',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtimePaths = {
      internalVerification: process.env.MECHANICAL_INTERNAL_VERIFICATION ?? MECHANICAL_SCOPE_PATHS.internalVerification,
      featureClosedLoopAssessment: process.env.MECHANICAL_FEATURE_CLOSED_LOOP_ASSESSMENT ?? MECHANICAL_SCOPE_PATHS.featureClosedLoopAssessment,
      directDesignCampaign: process.env.MECHANICAL_DIRECT_DESIGN_CAMPAIGN ?? MECHANICAL_SCOPE_PATHS.directDesignCampaign,
      blindProductChallenge: process.env.MECHANICAL_BLIND_PRODUCT_CHALLENGE ?? MECHANICAL_SCOPE_PATHS.blindProductChallenge,
      manufacturingValidation: process.env.MECHANICAL_MANUFACTURING_VALIDATION_RECEIPT ?? MECHANICAL_SCOPE_PATHS.manufacturingValidation,
      output: process.env.MECHANICAL_PRODUCT_SCOPE_ASSESSMENT ?? MECHANICAL_SCOPE_PATHS.output,
    };
    const result = checkOrWriteMechanicalProductScopeAssessment({
      root: process.cwd(),
      write: process.argv.includes('--write'),
      paths: runtimePaths,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[mechanical-scope] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
