#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS,
  CURRENT_REFERENCE_UTILIZATION_MANIFEST_PATH,
  CURRENT_ARCHITECTURE_INTERIOR_EVIDENCE_ROOT,
  defaultInputs,
  validateArchitectureInteriorGoldenLineageReceipt,
} from './qualify-architecture-interior-golden-lineage.mjs';

export const OPERATIONS_REPORT_SCHEMA = 'nexyfab.architecture-interior.lineage-operations-report.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const SCENARIOS = ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS;
const ROLES = new Set(['reference', 'regression', 'holdout']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const portable = value => String(value).replaceAll('\\', '/');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function containedFile(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return { ok: false, reason: 'path_invalid' };
  const normalized = relative.replaceAll('\\', '/');
  if (normalized.split('/').includes('..')) return { ok: false, reason: 'path_traversal' };
  try {
    const rootReal = fs.realpathSync(root);
    const targetReal = fs.realpathSync(path.resolve(rootReal, ...normalized.split('/')));
    const rel = path.relative(rootReal, targetReal);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return { ok: false, reason: 'realpath_escape' };
    if (!fs.statSync(targetReal).isFile() || fs.lstatSync(targetReal).isSymbolicLink()) return { ok: false, reason: 'not_regular_file' };
    const bytes = fs.readFileSync(targetReal);
    return { ok: true, rootReal, targetReal, bytes: bytes.byteLength, sha256: sha256(bytes), relativePath: portable(path.relative(rootReal, targetReal)) };
  } catch { return { ok: false, reason: 'source_file_missing' }; }
}

function rootStatus(configuredPath) {
  try {
    const configured = path.resolve(configuredPath);
    const realPath = fs.realpathSync(configured);
    return { configuredPath: portable(configured), realPath: portable(realPath), exists: true };
  } catch { return { configuredPath: portable(path.resolve(configuredPath)), realPath: null, exists: false }; }
}

function fileBinding(file, cwd) {
  try {
    const bytes = fs.readFileSync(file);
    return { path: portable(path.relative(cwd, path.resolve(file))), sha256: sha256(bytes), exists: true };
  } catch { return { path: portable(path.relative(cwd, path.resolve(file))), sha256: null, exists: false }; }
}

function readAttestation(attestationRoot, relativePath, expectedSchema, sourceSha256, scenarioId = null) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return { status: 'HOLD', reviewerId: null, reason: 'attestation_missing' };
  const resolved = containedFile(attestationRoot, relativePath);
  if (!resolved.ok) return { status: 'HOLD', reviewerId: null, reason: `attestation_${resolved.reason}` };
  try {
    const value = readJson(resolved.targetReal);
    const valid = value?.schema === expectedSchema
      && value?.decision === 'approved'
      && value?.sourceSha256 === sourceSha256
      && typeof value?.reviewerId === 'string'
      && value.reviewerId.trim().length > 0
      && Number.isFinite(Date.parse(value.reviewedAt))
      && (scenarioId === null || value.scenarioId === scenarioId)
      && (expectedSchema.endsWith('license-attestation.v1') ? value.allowedUses?.includes('commercial-golden-evaluation') : true);
    return { status: valid ? 'approved' : 'HOLD', reviewerId: valid ? value.reviewerId : null, reason: valid ? null : 'attestation_not_approved_for_source', sha256: resolved.sha256 };
  } catch { return { status: 'HOLD', reviewerId: null, reason: 'attestation_json_invalid' }; }
}

function inspectSelection(item, scenarioId, receipt, roots, attestationRoot) {
  const root = roots[item?.sourceRoot];
  const source = root?.realPath ? containedFile(root.realPath, item?.relativePath) : { ok: false, reason: 'source_root_missing' };
  const pathHash = {
    status: source.ok && source.bytes === item.bytes && source.sha256 === item.sha256 && item.sourceExists === true && item.containmentVerified === true && item.inventoryMatch === true ? 'PASS' : 'HOLD',
    expectedSha256: item?.sha256 ?? null,
    actualSha256: source.ok ? source.sha256 : null,
    expectedBytes: item?.bytes ?? null,
    actualBytes: source.ok ? source.bytes : null,
    sourcePath: item?.relativePath ?? null,
    sourceRoot: item?.sourceRoot ?? null,
    reason: source.ok ? (source.bytes === item.bytes && source.sha256 === item.sha256 ? null : 'source_path_or_hash_mismatch') : source.reason,
  };
  const license = readAttestation(attestationRoot, item?.licenseEvidencePath, 'nexyfab.architecture-interior.license-attestation.v1', item?.sha256 ?? null);
  const scenarioFit = readAttestation(attestationRoot, item?.scenarioEvidencePath, 'nexyfab.architecture-interior.scenario-fit-attestation.v1', item?.sha256 ?? null, scenarioId);
  const reviewerIds = [...new Set([license.reviewerId, scenarioFit.reviewerId].filter(Boolean))];
  const independentReviewerStatus = reviewerIds.length >= 2 ? 'approved' : 'HOLD';
  const rejectionReasons = [...(item?.rejectionReasons ?? [])];
  if (pathHash.status !== 'PASS') rejectionReasons.push('source_path_hash_inconsistent');
  if (license.status !== 'approved') rejectionReasons.push(license.reason ?? 'license_decision_hold');
  if (scenarioFit.status !== 'approved') rejectionReasons.push(scenarioFit.reason ?? 'scenario_fit_decision_hold');
  if (independentReviewerStatus !== 'approved') rejectionReasons.push('independent_reviewer_status_hold');
  if (!ROLES.has(item?.role)) rejectionReasons.push('assignment_role_invalid');
  return {
    sourceRoot: item?.sourceRoot ?? null,
    relativePath: item?.relativePath ?? null,
    sha256: item?.sha256 ?? null,
    role: item?.role ?? null,
    assignmentStatus: item?.role && ROLES.has(item.role) ? 'assigned' : 'HOLD',
    pathHash,
    license: { decision: license.status, reviewerId: license.reviewerId, evidenceSha256: license.sha256 ?? null },
    scenarioFit: { decision: scenarioFit.status, reviewerId: scenarioFit.reviewerId, evidenceSha256: scenarioFit.sha256 ?? null },
    independentReviewer: { status: independentReviewerStatus, reviewerIds },
    qualificationStatus: rejectionReasons.length ? 'HOLD' : 'QUALIFIED',
    rejectionReasons: [...new Set(rejectionReasons)],
  };
}

/**
 * @param {{ inventoryPath?: string, goldenManifestPath?: string, validationPath?: string | null, roots?: Record<string, string>, cwd?: string, now?: number, generatedAt?: string, expectedReferenceManifestPath?: string | null }} [options]
 */
export function buildArchitectureInteriorLineageOperationsReport({
  inventoryPath,
  goldenManifestPath,
  validationPath = null,
  roots,
  cwd = process.cwd(),
  now = Date.now(),
  generatedAt = new Date(now).toISOString(),
  expectedReferenceManifestPath = null,
} = {}) {
  if (!inventoryPath || !goldenManifestPath || !roots) throw new Error('ARCHITECTURE_INTERIOR_OPERATIONS_INPUTS_REQUIRED');
  const inventoryBytes = fs.readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  const manifestBytes = fs.readFileSync(goldenManifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const validation = validationPath && fs.existsSync(validationPath) ? readJson(validationPath) : null;
  const sourceRoots = Object.fromEntries(Object.entries(roots).map(([alias, configured]) => [alias, rootStatus(configured)]));
  const receiptValidation = validateArchitectureInteriorGoldenLineageReceipt(manifest, {
    now, cwd, verifyBindings: false, expectedReferenceManifestPath,
  });
  const attestationRootRelative = manifest?.policy?.attestationRoot;
  const attestationRoot = typeof attestationRootRelative === 'string' ? path.resolve(cwd, attestationRootRelative) : null;
  const scenarios = {};
  const blockers = [];
  if (manifest?.schema !== 'nexyfab.architecture-interior.golden-lineage-qualification.v1') blockers.push('golden_manifest_schema_invalid');
  if (!receiptValidation.valid) blockers.push('golden_manifest_validation_failed');
  if (!attestationRoot || !fs.existsSync(attestationRoot)) blockers.push('attestation_root_missing');
  for (const scenarioId of SCENARIOS) {
    const source = manifest?.scenarios?.[scenarioId];
    const selected = Array.isArray(source?.selected) ? source.selected : [];
    const selections = selected.map(item => inspectSelection(item, scenarioId, manifest, sourceRoots, attestationRoot ?? cwd));
    const pathHashMatches = selections.filter(item => item.pathHash.status === 'PASS').length;
    const licenseApproved = selections.filter(item => item.license.decision === 'approved').length;
    const independentApproved = selections.filter(item => item.independentReviewer.status === 'approved').length;
    const assignmentStatus = selected.length ? (selections.every(item => item.assignmentStatus === 'assigned') ? 'assigned' : 'HOLD') : 'unassigned';
    const scenarioStatus = selected.length > 0
      && assignmentStatus === 'assigned'
      && pathHashMatches === selections.length
      && licenseApproved === selections.length
      && independentApproved === selections.length
      && source?.status === 'QUALIFIED'
      ? 'QUALIFIED' : 'HOLD';
    const scenarioBlockers = [...new Set([
      ...(source?.rejectionReasons ?? []),
      ...(selected.length ? selections.flatMap(item => item.rejectionReasons) : ['assignment_missing']),
    ])];
    if (scenarioStatus !== 'QUALIFIED') blockers.push(`scenario_hold:${scenarioId}`);
    scenarios[scenarioId] = {
      status: scenarioStatus,
      assignment: { status: assignmentStatus, selectedCount: selected.length, roles: selections.map(item => item.role) },
      sourceRoot: { status: sourceRoots && selections.every(item => sourceRoots[item.sourceRoot]?.exists === true) ? 'PASS' : 'HOLD', roots: [...new Set(selections.map(item => item.sourceRoot).filter(Boolean))] },
      pathHash: { status: pathHashMatches === selections.length && selections.length > 0 ? 'PASS' : 'HOLD', checked: selections.length, matched: pathHashMatches },
      license: { decision: licenseApproved === selections.length && selections.length > 0 ? 'approved' : 'HOLD', checked: selections.length, approved: licenseApproved },
      independentReviewer: { status: independentApproved === selections.length && selections.length > 0 ? 'approved' : 'HOLD', checked: selections.length, approved: independentApproved, reviewerIds: [...new Set(selections.flatMap(item => item.independentReviewer.reviewerIds))] },
      selections,
      candidateCount: Array.isArray(source?.candidates) ? source.candidates.length : 0,
      blockers: scenarioBlockers,
    };
  }
  const reportStatus = blockers.length === 0 ? 'QUALIFIED' : 'HOLD';
  return {
    schema: OPERATIONS_REPORT_SCHEMA,
    generatedAt,
    status: reportStatus,
    scoreEligible: reportStatus === 'QUALIFIED',
    policy: {
      sourceReadOnly: true,
      licenseDecisionNeverInferred: true,
      assignmentNeverInferred: true,
      independentReviewerRequired: true,
      holdoutTuningExcluded: true,
    },
    inventory: {
      binding: fileBinding(inventoryPath, cwd),
      declaredRootSha256: inventory?.rootSha256 ?? null,
      files: Array.isArray(inventory?.files) ? inventory.files.length : 0,
      schema: inventory?.schema ?? null,
    },
    goldenManifest: {
      binding: fileBinding(goldenManifestPath, cwd),
      schema: manifest?.schema ?? null,
      status: manifest?.status ?? 'HOLD',
      validation: { status: receiptValidation.valid ? 'PASS' : 'HOLD', issues: receiptValidation.issues ?? [] },
      externalValidation: validation ? { status: validation.valid === true ? 'PASS' : 'HOLD', issues: validation.issues ?? [] } : { status: 'NOT_RUN', issues: ['validation_receipt_missing'] },
    },
    sourceRoots,
    scenarios,
    blockers: [...new Set(blockers)],
  };
}

export function defaultOperationsReportInputs(cwd = process.cwd()) {
  const defaults = defaultInputs(cwd);
  const goldenManifestPath = path.resolve(cwd, `${CURRENT_ARCHITECTURE_INTERIOR_EVIDENCE_ROOT}/qualification-receipt.json`);
  return {
    ...defaults,
    goldenManifestPath,
    validationPath: path.resolve(cwd, `${CURRENT_ARCHITECTURE_INTERIOR_EVIDENCE_ROOT}/qualification-validation.json`),
    expectedReferenceManifestPath: path.resolve(cwd, CURRENT_REFERENCE_UTILIZATION_MANIFEST_PATH),
  };
}

function option(args, name, fallback) {
  const found = args.find(value => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

export function main(args = process.argv.slice(2)) {
  const defaults = defaultOperationsReportInputs();
  const output = path.resolve(option(args, 'out', path.join(defaults.goldenManifestPath, '..', 'lineage-operations-report.json')));
  const report = buildArchitectureInteriorLineageOperationsReport({
    ...defaults,
    goldenManifestPath: path.resolve(option(args, 'golden-manifest', defaults.goldenManifestPath)),
    validationPath: path.resolve(option(args, 'validation', defaults.validationPath)),
    expectedReferenceManifestPath: defaults.expectedReferenceManifestPath,
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, status: report.status, scenarios: Object.fromEntries(Object.entries(report.scenarios).map(([id, item]) => [id, item.status])) })}\n`);
  return report.status === 'QUALIFIED' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
