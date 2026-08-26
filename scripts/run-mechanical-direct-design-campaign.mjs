#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  assessMechanicalDesignCampaign,
  parseTrustedMechanicalDesignVerifiers,
  validateMechanicalDesignVerificationReceipt,
} from './mechanical-commercial-evidence-v3.mjs';

const ARTIFACT_ROLES = Object.freeze(['requirements', 'nfab', 'step', 'drawing', 'bom', 'manifest', 'intentEvaluation', 'verificationReceipt']);
const REQUIRED_CHECKS = Object.freeze([
  'kernelValid', 'nonEmpty', 'stableFeatureIds', 'lockedDimensionsPreserved',
  'nfabThreeCycles', 'stepThreeCycles', 'drawingReleased', 'bomReconciled', 'revisionBound',
]);
const REQUIRED_VERIFIER_ROLES = Object.freeze([
  'mechanical-step-verifier', 'mechanical-drawing-verifier', 'mechanical-bom-verifier',
]);
const ADAPTER_APPROVER_ROLE = 'mechanical-adapter-release-approver';
const MAX_ADAPTER_APPROVAL_MS = 30 * 24 * 60 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/;

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stateHash = state => hash(Buffer.from(canonical({ ...state, stateSha256: undefined })));
const hasExactKeys = (value, keys) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','));

function resolveInside(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return null;
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.includes('..')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...parts);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

function assertWorkbook(workbook) {
  const cases = workbook?.cases;
  if (workbook?.schema !== 'nexyfab.mechanical-direct-design-workbook.v1'
    || workbook?.releaseChannel !== 'mechanical-core'
    || !SHA256.test(String(workbook?.evidenceRootId ?? ''))
    || !Array.isArray(cases)
    || cases.length !== 30) throw new Error('DIRECT_DESIGN_WORKBOOK_INVALID');
  if (new Set(cases.map(item => item?.caseId)).size !== 30
    || new Set(cases.map(item => item?.primaryFeature)).size !== 30) throw new Error('DIRECT_DESIGN_WORKBOOK_CASES_INVALID');
  for (const item of cases) {
    if (!item?.caseId || !item?.family || !item?.primaryFeature || item?.status !== 'evidence_required'
      || item?.releaseEligible !== false
      || ARTIFACT_ROLES.some(role => !resolveInside('', item?.artifactPaths?.[role]))) {
      throw new Error(`DIRECT_DESIGN_WORKBOOK_CASE_INVALID:${item?.caseId ?? 'unknown'}`);
    }
  }
}

function isEd25519PublicKey(publicKey) {
  try {
    return crypto.createPublicKey(publicKey).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

function hasDistinctVerifierAssignment(roleCoverage, roleIndex = 0, used = new Set()) {
  if (roleIndex === REQUIRED_VERIFIER_ROLES.length) return true;
  const role = REQUIRED_VERIFIER_ROLES[roleIndex];
  return roleCoverage[role].some(verifierId => {
    if (used.has(verifierId)) return false;
    const next = new Set(used); next.add(verifierId);
    return hasDistinctVerifierAssignment(roleCoverage, roleIndex + 1, next);
  });
}

function inspectTrustedVerifiers(trustedDesignVerifiers) {
  const configured = trustedDesignVerifiers && typeof trustedDesignVerifiers === 'object'
    ? Object.entries(trustedDesignVerifiers)
    : [];
  const valid = configured.filter(([, value]) => isEd25519PublicKey(value?.publicKey));
  const roleCoverage = Object.fromEntries(REQUIRED_VERIFIER_ROLES.map(role => [
    role,
    valid.filter(([, value]) => Array.isArray(value?.roles) && value.roles.includes(role)).map(([verifierId]) => verifierId),
  ]));
  return {
    configuredKeys: configured.length,
    validEd25519Keys: valid.length,
    requiredRoles: REQUIRED_VERIFIER_ROLES,
    roleCoverage: Object.fromEntries(Object.entries(roleCoverage).map(([role, ids]) => [role, ids.length])),
    roleSeparated: hasDistinctVerifierAssignment(roleCoverage),
  };
}

export function parseTrustedMechanicalAdapterApprovers(raw = process.env.NEXYFAB_MECHANICAL_ADAPTER_APPROVER_KEYS) {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mechanicalDesignAdapterApprovalPayload(receipt) {
  return canonical({
    schema: 'nexyfab.mechanical-design-adapter-approval-signature.v1',
    releaseChannel: receipt?.releaseChannel,
    evidenceRootId: receipt?.evidenceRootId,
    adapter: receipt?.adapter,
    approval: {
      approverId: receipt?.approval?.approverId,
      role: receipt?.approval?.role,
      algorithm: receipt?.approval?.algorithm,
      approvedAt: receipt?.approval?.approvedAt,
      expiresAt: receipt?.approval?.expiresAt,
    },
    claimBoundary: receipt?.claimBoundary,
  });
}

export function validateMechanicalDesignAdapterApproval(receipt, {
  adapterSha256,
  evidenceRootId,
  trustedAdapterApprovers = parseTrustedMechanicalAdapterApprovers(),
  now = Date.now(),
}) {
  if (!hasExactKeys(receipt, ['schema', 'releaseChannel', 'evidenceRootId', 'adapter', 'approval', 'claimBoundary'])
    || !hasExactKeys(receipt?.adapter, ['sha256', 'version'])
    || !hasExactKeys(receipt?.approval, ['approverId', 'role', 'algorithm', 'approvedAt', 'expiresAt', 'signature'])
    || !hasExactKeys(receipt?.claimBoundary, ['importsOnlyApprovedBytes', 'grantsCommercialRelease'])
    || receipt.schema !== 'nexyfab.mechanical-design-adapter-approval.v1'
    || receipt.releaseChannel !== 'mechanical-core'
    || !SHA256.test(String(receipt.evidenceRootId ?? ''))
    || receipt.evidenceRootId !== evidenceRootId
    || !SHA256.test(String(receipt.adapter.sha256 ?? ''))
    || receipt.adapter.sha256 !== adapterSha256
    || typeof receipt.adapter.version !== 'string'
    || !receipt.adapter.version.trim()
    || receipt.adapter.version.length > 128
    || typeof receipt.approval.approverId !== 'string'
    || !receipt.approval.approverId.trim()
    || receipt.approval.role !== ADAPTER_APPROVER_ROLE
    || receipt.approval.algorithm !== 'Ed25519'
    || typeof receipt.approval.signature !== 'string'
    || receipt.claimBoundary.importsOnlyApprovedBytes !== true
    || receipt.claimBoundary.grantsCommercialRelease !== false) return false;
  const approvedAt = Date.parse(receipt.approval.approvedAt);
  const expiresAt = Date.parse(receipt.approval.expiresAt);
  if (!Number.isFinite(approvedAt)
    || !Number.isFinite(expiresAt)
    || approvedAt > now
    || expiresAt <= now
    || expiresAt <= approvedAt
    || expiresAt - approvedAt > MAX_ADAPTER_APPROVAL_MS) return false;
  const trusted = trustedAdapterApprovers?.[receipt.approval.approverId];
  if (!isEd25519PublicKey(trusted?.publicKey)
    || !Array.isArray(trusted?.roles)
    || !trusted.roles.includes(ADAPTER_APPROVER_ROLE)) return false;
  try {
    const signature = Buffer.from(receipt.approval.signature, 'base64');
    return signature.length === 64 && crypto.verify(
      null,
      Buffer.from(mechanicalDesignAdapterApprovalPayload(receipt)),
      trusted.publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

function inspectTrustedAdapterApprovers(trustedAdapterApprovers) {
  const configured = trustedAdapterApprovers && typeof trustedAdapterApprovers === 'object'
    ? Object.entries(trustedAdapterApprovers)
    : [];
  const valid = configured.filter(([, value]) => isEd25519PublicKey(value?.publicKey)
    && Array.isArray(value?.roles)
    && value.roles.includes(ADAPTER_APPROVER_ROLE));
  return { configuredKeys: configured.length, validReleaseApprovers: valid.length };
}

function inspectTrustedAdapter({
  adapterPath,
  trustedAdapterSha256,
  adapterApprovalPath,
  evidenceRootId,
  trustedAdapterApprovers,
  now,
}) {
  const resolvedPath = adapterPath ? path.resolve(adapterPath) : null;
  const regularFile = Boolean(resolvedPath
    && fs.existsSync(resolvedPath)
    && fs.statSync(resolvedPath).isFile()
    && !fs.lstatSync(resolvedPath).isSymbolicLink());
  const sha256 = regularFile ? hash(fs.readFileSync(resolvedPath)) : null;
  const trustedSha256Configured = SHA256.test(String(trustedAdapterSha256 ?? ''));
  const resolvedApprovalPath = adapterApprovalPath ? path.resolve(adapterApprovalPath) : null;
  const approvalRegularFile = Boolean(resolvedApprovalPath
    && fs.existsSync(resolvedApprovalPath)
    && fs.statSync(resolvedApprovalPath).isFile()
    && !fs.lstatSync(resolvedApprovalPath).isSymbolicLink());
  let approvalReceipt = null;
  if (approvalRegularFile) {
    try {
      approvalReceipt = JSON.parse(fs.readFileSync(resolvedApprovalPath, 'utf8'));
    } catch {
      approvalReceipt = null;
    }
  }
  const approvalValid = Boolean(approvalReceipt && validateMechanicalDesignAdapterApproval(approvalReceipt, {
    adapterSha256: sha256,
    evidenceRootId,
    trustedAdapterApprovers,
    now,
  }));
  return {
    configured: Boolean(adapterPath),
    regularFile,
    sha256,
    trustedSha256Configured,
    digestMatches: Boolean(regularFile && trustedSha256Configured && sha256 === trustedAdapterSha256),
    approval: {
      configured: Boolean(adapterApprovalPath),
      regularFile: approvalRegularFile,
      sha256: approvalRegularFile ? hash(fs.readFileSync(resolvedApprovalPath)) : null,
      valid: approvalValid,
    },
    approvers: inspectTrustedAdapterApprovers(trustedAdapterApprovers),
    loadedOrExecuted: false,
  };
}

export function inspectMechanicalDirectDesignCampaignPrerequisites({
  workbook,
  evidenceRoot,
  adapterPath,
  trustedAdapterSha256 = process.env.NEXYFAB_MECHANICAL_DESIGN_ADAPTER_SHA256,
  adapterApprovalPath,
  trustedAdapterApprovers = parseTrustedMechanicalAdapterApprovers(),
  trustedDesignVerifiers = parseTrustedMechanicalDesignVerifiers(),
  now = Date.now(),
}) {
  let workbookError = null;
  try {
    assertWorkbook(workbook);
  } catch (error) {
    workbookError = error instanceof Error ? error.message : String(error);
  }

  const resolvedRoot = path.resolve(evidenceRoot);
  const rootExists = fs.existsSync(resolvedRoot)
    && fs.statSync(resolvedRoot).isDirectory()
    && !fs.lstatSync(resolvedRoot).isSymbolicLink();
  const byRole = Object.fromEntries(ARTIFACT_ROLES.map(role => [
    role,
    { expected: workbookError ? 0 : 30, present: 0, missing: 0, invalid: 0 },
  ]));
  if (!workbookError) {
    const realRoot = rootExists ? fs.realpathSync(resolvedRoot) : null;
    for (const item of workbook.cases) {
      for (const role of ARTIFACT_ROLES) {
        const absolute = resolveInside(resolvedRoot, item.artifactPaths[role]);
        if (!rootExists || !absolute || !fs.existsSync(absolute)) {
          byRole[role].missing += 1;
          continue;
        }
        if (!fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
          byRole[role].invalid += 1;
          continue;
        }
        const real = fs.realpathSync(absolute);
        if (!real.startsWith(`${realRoot}${path.sep}`)) {
          byRole[role].invalid += 1;
          continue;
        }
        byRole[role].present += 1;
      }
    }
  }
  const artifacts = {
    expected: workbookError ? 0 : workbook.cases.length * ARTIFACT_ROLES.length,
    present: Object.values(byRole).reduce((count, item) => count + item.present, 0),
    missing: Object.values(byRole).reduce((count, item) => count + item.missing, 0),
    invalid: Object.values(byRole).reduce((count, item) => count + item.invalid, 0),
    byRole,
  };
  const adapter = inspectTrustedAdapter({
    adapterPath,
    trustedAdapterSha256,
    adapterApprovalPath,
    evidenceRootId: workbook?.evidenceRootId,
    trustedAdapterApprovers,
    now,
  });
  const verifiers = inspectTrustedVerifiers(trustedDesignVerifiers);
  const executionBlockers = [];
  const evidenceBlockers = [];
  if (workbookError) executionBlockers.push('direct_design_workbook_invalid');
  if (!rootExists) executionBlockers.push('evidence_root_missing_or_unsafe');
  if (!workbookError && artifacts.missing > 0) evidenceBlockers.push('required_artifacts_missing');
  if (!workbookError && artifacts.invalid > 0) executionBlockers.push('required_artifacts_invalid');
  if (!verifiers.roleSeparated) executionBlockers.push('role_separated_trusted_verifiers_missing');
  if (!adapterPath) executionBlockers.push('trusted_runtime_adapter_not_supplied');
  else if (!adapter.regularFile) executionBlockers.push('trusted_runtime_adapter_not_regular_file');
  if (!adapter.trustedSha256Configured) executionBlockers.push('trusted_runtime_adapter_sha256_not_supplied_or_invalid');
  else if (adapter.regularFile && !adapter.digestMatches) executionBlockers.push('trusted_runtime_adapter_sha256_mismatch');
  if (adapter.approvers.validReleaseApprovers === 0) executionBlockers.push('trusted_runtime_adapter_release_approver_missing');
  if (!adapterApprovalPath) executionBlockers.push('trusted_runtime_adapter_approval_not_supplied');
  else if (!adapter.approval.regularFile) executionBlockers.push('trusted_runtime_adapter_approval_not_regular_file');
  else if (!adapter.approval.valid) executionBlockers.push('trusted_runtime_adapter_approval_invalid');
  const blockers = [...executionBlockers, ...evidenceBlockers];
  return {
    schema: 'nexyfab.mechanical-direct-design-campaign-preflight.v2',
    releaseChannel: 'mechanical-core',
    readyToExecute: executionBlockers.length === 0,
    readyForFinalVerification: blockers.length === 0,
    workbook: { valid: !workbookError, error: workbookError, cases: workbookError ? 0 : workbook.cases.length },
    evidenceRoot: { path: resolvedRoot, exists: rootExists },
    adapter,
    verifiers,
    artifacts,
    blockers,
    executionBlockers,
    evidenceBlockers,
    claimBoundary: {
      createsCampaignState: false,
      createsEvidence: false,
      executesAdapter: false,
      grantsCommercialRelease: false,
    },
  };
}

export function createMechanicalDirectDesignState(workbook, generatedAt = new Date().toISOString()) {
  assertWorkbook(workbook);
  const state = {
    schema: 'nexyfab.mechanical-direct-design-campaign-state.v1',
    releaseChannel: 'mechanical-core',
    evidenceRootId: workbook.evidenceRootId,
    workbookSha256: hash(Buffer.from(canonical(workbook))),
    generatedAt,
    updatedAt: generatedAt,
    slots: workbook.cases.map(item => ({ caseId: item.caseId, status: 'pending', attempts: 0, error: null, result: null })),
  };
  return { ...state, stateSha256: stateHash(state) };
}

export function resumeMechanicalDirectDesignState(workbook, state) {
  assertWorkbook(workbook);
  if (state?.schema !== 'nexyfab.mechanical-direct-design-campaign-state.v1'
    || state?.releaseChannel !== 'mechanical-core'
    || state?.evidenceRootId !== workbook.evidenceRootId
    || state?.workbookSha256 !== hash(Buffer.from(canonical(workbook)))
    || state?.stateSha256 !== stateHash(state)
    || !Array.isArray(state?.slots)
    || state.slots.length !== 30
    || state.slots.some((slot, index) => slot?.caseId !== workbook.cases[index]?.caseId)) {
    throw new Error('DIRECT_DESIGN_CAMPAIGN_RESUME_MISMATCH');
  }
  return structuredClone(state);
}

function collectArtifacts(evidenceRoot, caseValue) {
  const artifacts = {};
  const normalizedPaths = new Set();
  for (const role of ARTIFACT_ROLES) {
    const relative = caseValue.artifactPaths[role];
    const normalized = relative.replaceAll('\\', '/');
    if (normalizedPaths.has(normalized)) throw new Error(`DIRECT_DESIGN_ARTIFACT_ROLE_COLLISION:${caseValue.caseId}:${role}`);
    const absolute = resolveInside(evidenceRoot, relative);
    if (!absolute || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error(`DIRECT_DESIGN_ARTIFACT_MISSING:${caseValue.caseId}:${role}`);
    }
    const realRoot = fs.realpathSync(evidenceRoot);
    const real = fs.realpathSync(absolute);
    if (!real.startsWith(`${realRoot}${path.sep}`)) throw new Error(`DIRECT_DESIGN_ARTIFACT_OUTSIDE_ROOT:${caseValue.caseId}:${role}`);
    artifacts[role] = { path: normalized, sha256: hash(fs.readFileSync(real)) };
    normalizedPaths.add(normalized);
  }
  return artifacts;
}

function finalizeCase(evidenceRoot, caseValue, execution, trustedDesignVerifiers, now) {
  if (!execution || execution.cycles?.nfab !== 3 || execution.cycles?.step !== 3
    || REQUIRED_CHECKS.some(check => execution.checks?.[check] !== true)) {
    throw new Error(`DIRECT_DESIGN_RUNTIME_CHECKS_INCOMPLETE:${caseValue.caseId}`);
  }
  const artifacts = collectArtifacts(evidenceRoot, caseValue);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolveInside(evidenceRoot, caseValue.artifactPaths.manifest), 'utf8'));
  } catch {
    throw new Error(`DIRECT_DESIGN_MANIFEST_INVALID:${caseValue.caseId}`);
  }
  const requirementsSha256 = artifacts.requirements.sha256;
  if (manifest?.schema !== 'nexyfab.mechanical-design-case-manifest.v1'
    || manifest?.caseId !== caseValue.caseId
    || !SHA256.test(String(manifest?.designRevisionSha256 ?? ''))
    || manifest?.requirementsSha256 !== requirementsSha256
    || ARTIFACT_ROLES.filter(role => role !== 'manifest').some(role => manifest?.artifacts?.[role] !== artifacts[role].sha256)) {
    throw new Error(`DIRECT_DESIGN_MANIFEST_BINDING_INVALID:${caseValue.caseId}`);
  }
  let verificationReceipt;
  try {
    verificationReceipt = JSON.parse(fs.readFileSync(resolveInside(evidenceRoot, caseValue.artifactPaths.verificationReceipt), 'utf8'));
  } catch {
    throw new Error(`DIRECT_DESIGN_VERIFICATION_RECEIPT_INVALID:${caseValue.caseId}`);
  }
  const verificationItem = {
    caseId: caseValue.caseId,
    designRevisionSha256: manifest.designRevisionSha256,
    requirementsSha256,
    artifacts,
  };
  if (!validateMechanicalDesignVerificationReceipt(
    verificationReceipt,
    verificationItem,
    trustedDesignVerifiers,
    now,
  )) {
    throw new Error(`DIRECT_DESIGN_VERIFICATION_RECEIPT_INVALID:${caseValue.caseId}`);
  }
  return {
    caseId: caseValue.caseId,
    family: caseValue.family,
    primaryFeature: caseValue.primaryFeature,
    status: 'pass',
    designRevisionSha256: manifest.designRevisionSha256,
    requirementsSha256,
    cycles: { nfab: 3, step: 3 },
    checks: Object.fromEntries(REQUIRED_CHECKS.map(check => [check, true])),
    artifacts,
  };
}

function verifyCompletedArtifacts(evidenceRoot, workbook, state) {
  for (const slot of state.slots.filter(item => item.status === 'completed')) {
    const caseValue = workbook.cases.find(item => item.caseId === slot.caseId);
    const current = collectArtifacts(evidenceRoot, caseValue);
    if (ARTIFACT_ROLES.some(role => current[role].sha256 !== slot.result?.artifacts?.[role]?.sha256)) {
      throw new Error(`DIRECT_DESIGN_CAMPAIGN_ARTIFACT_TAMPERED:${slot.caseId}`);
    }
  }
}

export function buildMechanicalDirectDesignReceipt(workbook, state, evidenceRoot, generatedAt = new Date().toISOString()) {
  const byId = new Map(state.slots.map(slot => [slot.caseId, slot]));
  const cases = workbook.cases.map(item => {
    const slot = byId.get(item.caseId);
    if (slot?.status === 'completed') return slot.result;
    return { caseId: item.caseId, family: item.family, primaryFeature: item.primaryFeature, status: slot?.status === 'failed' ? 'fail' : 'pending' };
  });
  const intents = cases.filter(item => item.status === 'pass').reduce((count, item) => {
    try {
      const evaluation = JSON.parse(fs.readFileSync(resolveInside(evidenceRoot, item.artifacts.intentEvaluation.path), 'utf8'));
      return count + (Array.isArray(evaluation?.entries) ? evaluation.entries.length : 0);
    } catch { return count; }
  }, 0);
  const passed = cases.filter(item => item.status === 'pass').length;
  const failed = cases.filter(item => item.status === 'fail').length;
  return {
    schema: 'nexyfab.mechanical-direct-design-campaign.v1', releaseChannel: 'mechanical-core',
    evidenceRootId: workbook.evidenceRootId, generatedAt, ok: passed === 30 && failed === 0,
    cases, summary: { cases: 30, passed, pending: 30 - passed - failed, failed, intents, falseVerified: 0 },
  };
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, file);
}

export async function runMechanicalDirectDesignCampaign({ workbook, evidenceRoot, state, executeCase, caseIds, maximumAttempts = 3, onCheckpoint, trustedDesignVerifiers = parseTrustedMechanicalDesignVerifiers(), now = Date.now() }) {
  const next = resumeMechanicalDirectDesignState(workbook, state);
  verifyCompletedArtifacts(evidenceRoot, workbook, next);
  const selected = caseIds ? new Set(caseIds) : null;
  for (const slot of next.slots) {
    if (slot.status === 'completed' || (selected && !selected.has(slot.caseId)) || slot.attempts >= maximumAttempts) continue;
    const caseValue = workbook.cases.find(item => item.caseId === slot.caseId);
    slot.status = 'running'; slot.attempts += 1; slot.error = null; next.updatedAt = new Date().toISOString();
    next.stateSha256 = stateHash(next); await onCheckpoint?.(structuredClone(next));
    try {
      const execution = await executeCase({ caseValue: structuredClone(caseValue), evidenceRoot, attempt: slot.attempts });
      slot.result = finalizeCase(evidenceRoot, caseValue, execution, trustedDesignVerifiers, now);
      slot.status = 'completed';
      const receipt = buildMechanicalDirectDesignReceipt(workbook, next, evidenceRoot, new Date(now).toISOString());
      const assessment = assessMechanicalDesignCampaign(receipt, { evidenceRoot, trustedDesignVerifiers, now });
      const completed = next.slots.filter(item => item.status === 'completed').length;
      if (!assessment.summaryValid || assessment.passedCases !== completed || assessment.intents < completed * 5) {
        throw new Error(`DIRECT_DESIGN_CASE_EVIDENCE_INVALID:${caseValue.caseId}`);
      }
    } catch (error) {
      slot.status = 'failed'; slot.result = null; slot.error = error instanceof Error ? error.message : String(error);
    }
    next.updatedAt = new Date().toISOString(); next.stateSha256 = stateHash(next); await onCheckpoint?.(structuredClone(next));
  }
  return next;
}

const option = (args, name) => args.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main(args = process.argv.slice(2)) {
  const workbookPath = option(args, 'workbook');
  const statePath = option(args, 'state');
  const adapterPath = option(args, 'adapter');
  const adapterApprovalPath = option(args, 'adapter-approval');
  const trustedAdapterSha256 = option(args, 'adapter-sha256') ?? process.env.NEXYFAB_MECHANICAL_DESIGN_ADAPTER_SHA256;
  if (args.includes('--preflight')) {
    if (!workbookPath) throw new Error('Usage: --preflight --workbook=<workbook.json> [--adapter=<adapter.mjs>] [--adapter-sha256=<approved-sha256>] [--adapter-approval=<signed-approval.json>]');
    const resolvedWorkbook = path.resolve(workbookPath);
    const workbook = JSON.parse(fs.readFileSync(resolvedWorkbook, 'utf8'));
    const result = inspectMechanicalDirectDesignCampaignPrerequisites({
      workbook,
      evidenceRoot: path.dirname(resolvedWorkbook),
      adapterPath,
      trustedAdapterSha256,
      adapterApprovalPath,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.readyToExecute) process.exitCode = 4;
    return;
  }
  if (!workbookPath || !statePath || !adapterPath) throw new Error('Usage: --workbook=<workbook.json> --state=<state.json> --adapter=<adapter.mjs> --adapter-sha256=<approved-sha256> --adapter-approval=<signed-approval.json> [--receipt=<receipt.json>] [--cases=id,id] [--resume]');
  const resolvedWorkbook = path.resolve(workbookPath);
  const workbook = JSON.parse(fs.readFileSync(resolvedWorkbook, 'utf8'));
  const evidenceRoot = path.dirname(resolvedWorkbook);
  const resolvedState = path.resolve(statePath);
  if (!args.includes('--resume') && fs.existsSync(resolvedState)) throw new Error('DIRECT_DESIGN_CAMPAIGN_STATE_ALREADY_EXISTS');
  const adapterTrust = inspectTrustedAdapter({
    adapterPath,
    trustedAdapterSha256,
    adapterApprovalPath,
    evidenceRootId: workbook.evidenceRootId,
    trustedAdapterApprovers: parseTrustedMechanicalAdapterApprovers(),
    now: Date.now(),
  });
  if (!adapterTrust.regularFile) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_NOT_REGULAR_FILE');
  if (!adapterTrust.trustedSha256Configured) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_SHA256_REQUIRED');
  if (!adapterTrust.digestMatches) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_SHA256_MISMATCH');
  if (adapterTrust.approvers.validReleaseApprovers === 0) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_RELEASE_APPROVER_REQUIRED');
  if (!adapterTrust.approval.regularFile) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_APPROVAL_REQUIRED');
  if (!adapterTrust.approval.valid) throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_APPROVAL_INVALID');
  const state = args.includes('--resume')
    ? JSON.parse(fs.readFileSync(resolvedState, 'utf8'))
    : createMechanicalDirectDesignState(workbook);
  const adapter = await import(pathToFileURL(path.resolve(adapterPath)).href);
  if (typeof adapter.executeMechanicalDesignCase !== 'function') throw new Error('DIRECT_DESIGN_CAMPAIGN_ADAPTER_EXPORT_MISSING');
  const next = await runMechanicalDirectDesignCampaign({
    workbook, evidenceRoot, state, executeCase: adapter.executeMechanicalDesignCase,
    caseIds: option(args, 'cases')?.split(',').map(item => item.trim()).filter(Boolean),
    onCheckpoint: checkpoint => atomicJson(resolvedState, checkpoint),
  });
  atomicJson(resolvedState, next);
  const receiptPath = path.resolve(option(args, 'receipt') ?? `${resolvedState}.receipt.json`);
  atomicJson(receiptPath, buildMechanicalDirectDesignReceipt(workbook, next, evidenceRoot));
  const counts = Object.fromEntries(['pending', 'running', 'completed', 'failed'].map(status => [status, next.slots.filter(slot => slot.status === status).length]));
  process.stdout.write(`${JSON.stringify({ state: resolvedState, receipt: receiptPath, counts })}\n`);
  if (counts.failed > 0 || counts.completed < 30) process.exitCode = 4;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`[mechanical-direct-design] ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
}
