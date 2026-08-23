#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const ROLES = new Set(['reference', 'regression', 'holdout']);
const SCENARIOS = Object.freeze({
  office: Object.freeze({ tokens: ['office', 'workplace', 'desk'], formats: ['.ifc', '.dwg', '.rvt', '.skp', '.3dm', '.sat', '.step', '.stp', '.igs', '.iges'] }),
  apartment: Object.freeze({ tokens: ['apartment', 'residential', '2bhk'], formats: ['.ifc', '.dwg', '.rvt', '.skp', '.3dm', '.sat'] }),
  cafe: Object.freeze({ tokens: ['cafe', 'café', 'coffee', 'cafeteria'], formats: ['.ifc', '.dwg', '.rvt', '.skp', '.3dm', '.sat'] }),
  mep_companion: Object.freeze({ tokens: ['sprinkler-design', 'revit-mep', 'sprinkler', 'service-opening'], formats: ['.rvt', '.dwg', '.ifc'] }),
  comprehensive_residential: Object.freeze({ tokens: ['las-vegas-dream-home', 'dream-home', 'residential'], formats: ['.rvt', '.dwg', '.ifc', '.pdf'] }),
  ifc_regression: Object.freeze({ tokens: ['ifc4.3', 'ifc4x3', 'ifc 4_3', 'georeference'], formats: ['.ifc'] }),
});

export const ARCHITECTURE_INTERIOR_LINEAGE_SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));
export const CURRENT_REFERENCE_UTILIZATION_MANIFEST_PATH = 'docs/evidence/cad-independent/reference-utilization-manifest-260823.json';
export const CURRENT_ARCHITECTURE_INTERIOR_EVIDENCE_ROOT = 'docs/evidence/architecture-interior-golden-lineage-260823';

const portable = value => value.replaceAll('\\', '/');
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const sha256File = file => sha256(fs.readFileSync(file));

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const found = args.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value.trim());
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return null;
  return normalized;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveContainedFile(root, relativePath) {
  const safe = safeRelative(relativePath);
  if (!safe) return { ok: false, reason: 'path_traversal_or_absolute_path' };
  try {
    const rootReal = fs.realpathSync(root);
    const candidate = path.resolve(rootReal, safe);
    const targetReal = fs.realpathSync(candidate);
    if (!contained(rootReal, targetReal)) return { ok: false, reason: 'realpath_escape' };
    const stat = fs.statSync(targetReal);
    if (!stat.isFile()) return { ok: false, reason: 'not_a_regular_file' };
    return { ok: true, rootReal, targetReal, bytes: stat.size, relativePath: portable(path.relative(rootReal, targetReal)) };
  } catch (error) {
    return { ok: false, reason: error?.code === 'ENOENT' ? 'source_file_missing' : 'source_file_unreadable' };
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function evidenceBinding(file, cwd) {
  const absolute = path.resolve(file);
  return { path: portable(path.relative(cwd, absolute)), sha256: sha256File(absolute) };
}

function loadSupportingIndexes({ operatorManifestPath, manualIndexPath }) {
  const operatorManifest = fs.existsSync(operatorManifestPath) ? readJson(operatorManifestPath) : null;
  const manualIndex = fs.existsSync(manualIndexPath) ? readJson(manualIndexPath) : null;
  return {
    operatorManifest,
    operatorByHash: new Map((operatorManifest?.artifacts ?? []).map(item => [item.sha256, item])),
    manualIndex,
    manualByHash: new Map((manualIndex?.documents ?? []).map(item => [item.sha256, item])),
  };
}

function provenanceFor(entry, indexes, bindings) {
  if (entry.alias === 'operator_refs') {
    const item = indexes.operatorByHash.get(entry.sha256);
    return item ? {
      status: item.licenseReviewRequired === true ? 'manifest_bound_license_review_required' : 'manifest_bound',
      evidencePath: bindings.operatorManifest.path,
      evidenceSha256: bindings.operatorManifest.sha256,
      lineageId: item.lineageId ?? null,
      trainingEligible: item.trainingEligible === true,
      commercialScoreEligible: item.commercialScoreEligible === true,
      licenseReviewRequired: item.licenseReviewRequired !== false,
    } : { status: 'operator_manifest_entry_missing', evidencePath: null, evidenceSha256: null, lineageId: null, trainingEligible: false, commercialScoreEligible: false, licenseReviewRequired: true };
  }
  if (entry.alias === 'manuals') {
    const item = indexes.manualByHash.get(entry.sha256);
    return item ? {
      status: 'manual_index_bound_read_only', evidencePath: bindings.manualIndex.path, evidenceSha256: bindings.manualIndex.sha256,
      lineageId: item.documentId ?? null, trainingEligible: false, commercialScoreEligible: false, licenseReviewRequired: true,
    } : { status: 'manual_index_entry_missing', evidencePath: null, evidenceSha256: null, lineageId: null, trainingEligible: false, commercialScoreEligible: false, licenseReviewRequired: true };
  }
  return { status: 'inventory_only', evidencePath: bindings.inventory.path, evidenceSha256: bindings.inventory.sha256, lineageId: null, trainingEligible: false, commercialScoreEligible: false, licenseReviewRequired: true };
}

function rank(entry, scenario) {
  const lower = entry.path.toLocaleLowerCase('en-US');
  const tokenHits = scenario.tokens.filter(token => lower.includes(token));
  if (!tokenHits.length) return null;
  const extension = String(entry.extension ?? path.extname(entry.path)).toLowerCase();
  const formatRank = scenario.formats.indexOf(extension);
  if (formatRank < 0) return null;
  const basename = path.basename(lower);
  const exactNameBonus = tokenHits.some(token => basename.includes(token)) ? 40 : 0;
  const openFormatBonus = 30 - formatRank;
  const derivedPenalty = lower.startsWith('result/') ? 40 : 0;
  const archivePenalty = extension === '.zip' ? 20 : 0;
  return { score: tokenHits.length * 100 + exactNameBonus + openFormatBonus - derivedPenalty - archivePenalty, tokenHits, extension };
}

function inspectEntry(entry, root, provenance, duplicatePaths = []) {
  const rejectionReasons = [];
  const resolved = resolveContainedFile(root, entry.path);
  if (!resolved.ok) rejectionReasons.push(resolved.reason);
  let actualSha256 = null;
  if (resolved.ok) {
    if (resolved.relativePath !== portable(path.normalize(entry.path))) rejectionReasons.push('realpath_relative_path_mismatch');
    if (resolved.bytes !== entry.bytes) rejectionReasons.push('inventory_bytes_mismatch');
    actualSha256 = sha256File(resolved.targetReal);
    if (actualSha256 !== entry.sha256) rejectionReasons.push('inventory_sha256_mismatch');
  }
  if (!SHA256.test(String(entry.sha256 ?? ''))) rejectionReasons.push('inventory_sha256_invalid');
  if (duplicatePaths.length > 1) rejectionReasons.push('inventory_duplicate_hash');
  if (provenance.status.endsWith('_missing')) rejectionReasons.push('provenance_entry_missing');
  return {
    sourceExists: resolved.ok,
    containmentVerified: resolved.ok,
    inventoryMatch: resolved.ok && rejectionReasons.every(reason => !reason.startsWith('inventory_') && reason !== 'realpath_relative_path_mismatch'),
    actualBytes: resolved.ok ? resolved.bytes : null,
    actualSha256,
    inventoryDuplicatePaths: duplicatePaths,
    rejectionReasons,
  };
}

function loadAttestation(binding, evidenceRoot, expected) {
  if (!binding || typeof binding.path !== 'string' || !SHA256.test(String(binding.sha256 ?? ''))) return { ok: false, reason: `${expected.kind}_attestation_missing` };
  const resolved = resolveContainedFile(evidenceRoot, binding.path);
  if (!resolved.ok) return { ok: false, reason: `${expected.kind}_attestation_${resolved.reason}` };
  const actualHash = sha256File(resolved.targetReal);
  if (actualHash !== binding.sha256) return { ok: false, reason: `${expected.kind}_attestation_hash_mismatch` };
  try {
    const value = readJson(resolved.targetReal);
    const schema = expected.kind === 'license'
      ? 'nexyfab.architecture-interior.license-attestation.v1'
      : 'nexyfab.architecture-interior.scenario-fit-attestation.v1';
    const reviewedAt = Date.parse(value?.reviewedAt);
    const common = value?.schema === schema && value?.decision === 'approved'
      && value?.sourceSha256 === expected.sourceSha256
      && typeof value?.reviewerId === 'string' && value.reviewerId.trim().length > 0
      && Number.isFinite(reviewedAt)
      && reviewedAt <= expected.now + 5 * 60_000;
    const specific = expected.kind === 'license'
      ? Array.isArray(value?.allowedUses) && value.allowedUses.includes('commercial-golden-evaluation')
      : value?.scenarioId === expected.scenarioId;
    if (!common || !specific) return { ok: false, reason: `${expected.kind}_attestation_not_approved_for_source` };
    return { ok: true, path: binding.path, sha256: actualHash, reviewedAt: value.reviewedAt, reviewerId: value.reviewerId };
  } catch {
    return { ok: false, reason: `${expected.kind}_attestation_json_invalid` };
  }
}

function assignmentMap(assignments) {
  const source = assignments?.scenarios ?? {};
  return new Map(Object.keys(SCENARIOS).map(id => [id, Array.isArray(source[id]) ? source[id] : []]));
}

export function qualifyArchitectureInteriorGoldenLineage({
  inventoryPath,
  roots,
  operatorManifestPath,
  manualIndexPath,
  assignments = null,
  evidenceRoot,
  cwd = process.cwd(),
  generatedAt = new Date().toISOString(),
  candidateLimit = 8,
} = {}) {
  const inventoryBytes = fs.readFileSync(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  if (inventory?.schema !== 'nexyfab.architecture-interior.reference-inventory.v1' || !Array.isArray(inventory?.files)) {
    throw new Error('ARCHITECTURE_INTERIOR_INVENTORY_INVALID');
  }
  const aliases = Object.keys(roots ?? {});
  const unknownAliases = [...new Set(inventory.files.map(item => item?.alias).filter(alias => !aliases.includes(alias)))];
  if (unknownAliases.length) throw new Error(`ARCHITECTURE_INTERIOR_ROOT_ALIAS_MISSING:${unknownAliases.join(',')}`);
  const bindings = {
    inventory: { path: portable(path.relative(cwd, inventoryPath)), sha256: sha256(inventoryBytes) },
    operatorManifest: evidenceBinding(operatorManifestPath, cwd),
    manualIndex: evidenceBinding(manualIndexPath, cwd),
  };
  const indexes = loadSupportingIndexes({ operatorManifestPath, manualIndexPath });
  const entries = new Map(inventory.files.map(item => [`${item.alias}\0${portable(item.path)}`, item]));
  const pathsByHash = new Map();
  for (const item of inventory.files) {
    const paths = pathsByHash.get(item.sha256) ?? [];
    paths.push(`${item.alias}:${portable(item.path)}`);
    pathsByHash.set(item.sha256, paths);
  }
  const assigned = assignmentMap(assignments);
  const rootsReceipt = Object.fromEntries(aliases.map(alias => {
    try { return [alias, { configuredPath: path.resolve(roots[alias]), realPath: fs.realpathSync(roots[alias]), exists: true }]; }
    catch { return [alias, { configuredPath: path.resolve(roots[alias]), realPath: null, exists: false }]; }
  }));
  const scenarios = {};
  const selectedHashes = new Map();
  const globalBlockers = [];

  for (const [scenarioId, scenario] of Object.entries(SCENARIOS)) {
    const ranked = inventory.files.map(entry => ({ entry, ranking: rank(entry, scenario) })).filter(item => item.ranking)
      .sort((left, right) => right.ranking.score - left.ranking.score || left.entry.path.localeCompare(right.entry.path));
    const seenHashes = new Set();
    const candidates = [];
    for (const { entry, ranking } of ranked) {
      if (seenHashes.has(entry.sha256)) continue;
      seenHashes.add(entry.sha256);
      const provenance = provenanceFor(entry, indexes, bindings);
      const inspection = inspectEntry(entry, roots[entry.alias], provenance, pathsByHash.get(entry.sha256) ?? []);
      candidates.push({
        sourceRoot: entry.alias, relativePath: portable(entry.path), bytes: entry.bytes, sha256: entry.sha256,
        role: 'holdout', tuningExclusion: true, rank: candidates.length + 1, ranking,
        licenseStatus: 'approval_attestation_missing', licenseEvidencePath: null, licenseEvidenceSha256: null,
        scenarioFitStatus: 'approval_attestation_missing', scenarioEvidencePath: null, scenarioEvidenceSha256: null,
        provenance, ...inspection,
        rejectionReasons: [...inspection.rejectionReasons, 'license_attestation_missing', 'scenario_fit_attestation_missing'],
      });
      if (candidates.length >= candidateLimit) break;
    }

    const selections = [];
    for (const request of assigned.get(scenarioId)) {
      const key = `${request?.alias}\0${portable(String(request?.path ?? ''))}`;
      const entry = entries.get(key);
      if (!entry) {
        selections.push({ sourceRoot: request?.alias ?? null, relativePath: request?.path ?? null, role: request?.role ?? null, tuningExclusion: true, qualificationStatus: 'HOLD', rejectionReasons: ['assignment_not_in_inventory'] });
        continue;
      }
      const provenance = provenanceFor(entry, indexes, bindings);
      const inspection = inspectEntry(entry, roots[entry.alias], provenance, pathsByHash.get(entry.sha256) ?? []);
      const role = ROLES.has(request?.role) ? request.role : null;
      const qualificationTime = Date.parse(generatedAt);
      const license = loadAttestation(request?.licenseEvidence, evidenceRoot, { kind: 'license', sourceSha256: entry.sha256, now: qualificationTime });
      const scenarioEvidence = loadAttestation(request?.scenarioEvidence, evidenceRoot, { kind: 'scenario', sourceSha256: entry.sha256, scenarioId, now: qualificationTime });
      const rejectionReasons = [...inspection.rejectionReasons];
      if (!role) rejectionReasons.push('role_invalid');
      if (!license.ok) rejectionReasons.push(license.reason);
      if (!scenarioEvidence.ok) rejectionReasons.push(scenarioEvidence.reason);
      if (license.ok && scenarioEvidence.ok && license.reviewerId === scenarioEvidence.reviewerId) rejectionReasons.push('independent_reviewer_required');
      const previous = selectedHashes.get(entry.sha256);
      if (previous) {
        rejectionReasons.push('duplicate_selected_hash');
        globalBlockers.push(`duplicate_selected_hash:${entry.sha256}`);
        if (previous.role !== role) globalBlockers.push(`same_hash_role_reuse:${entry.sha256}:${previous.role}:${role}`);
      } else selectedHashes.set(entry.sha256, { scenarioId, role });
      selections.push({
        sourceRoot: entry.alias, relativePath: portable(entry.path), bytes: entry.bytes, sha256: entry.sha256,
        role, tuningExclusion: true,
        licenseStatus: license.ok ? 'approved' : 'HOLD', licenseEvidencePath: license.path ?? request?.licenseEvidence?.path ?? null, licenseEvidenceSha256: license.sha256 ?? request?.licenseEvidence?.sha256 ?? null,
        scenarioFitStatus: scenarioEvidence.ok ? 'approved' : 'HOLD', scenarioEvidencePath: scenarioEvidence.path ?? request?.scenarioEvidence?.path ?? null, scenarioEvidenceSha256: scenarioEvidence.sha256 ?? request?.scenarioEvidence?.sha256 ?? null,
        licenseReviewerId: license.reviewerId ?? null, scenarioReviewerId: scenarioEvidence.reviewerId ?? null,
        provenance, ...inspection, rejectionReasons,
        qualificationStatus: rejectionReasons.length ? 'HOLD' : 'QUALIFIED',
      });
    }
    scenarios[scenarioId] = {
      status: selections.length > 0 && selections.every(item => item.qualificationStatus === 'QUALIFIED') ? 'QUALIFIED' : 'HOLD',
      selected: selections,
      candidates,
      sourceRootAssessments: Object.fromEntries(aliases.map(alias => {
        const matches = ranked.filter(item => item.entry.alias === alias);
        return [alias, {
          inventoryFiles: inventory.files.filter(item => item.alias === alias).length,
          filenameKeywordMatches: matches.length,
          status: matches.length ? 'CANDIDATE_REVIEW_REQUIRED' : 'HOLD',
          reason: matches.length ? 'filename_match_is_not_scenario_or_license_approval' : 'no_filename_evidence_for_scenario',
        }];
      })),
      rejectionReasons: selections.length ? [...new Set(selections.flatMap(item => item.rejectionReasons))] : ['no_approved_assignment'],
    };
  }
  if (Object.values(rootsReceipt).some(item => !item.exists)) globalBlockers.push('source_root_missing');
  const status = !globalBlockers.length && Object.values(scenarios).every(item => item.status === 'QUALIFIED') ? 'QUALIFIED' : 'HOLD';
  return {
    schema: 'nexyfab.architecture-interior.golden-lineage-qualification.v1', generatedAt, status,
    policy: {
      sourceReadOnly: true,
      tuningExcludedByDefault: true,
      licenseAndScenarioFitNeverInferred: true,
      roleHashIsolationRequired: true,
      authoritativeReferenceManifestRequired: true,
      authoritativeReferenceManifestPath: bindings.operatorManifest.path,
      attestationRoot: portable(path.relative(cwd, fs.realpathSync(evidenceRoot))),
    },
    inventory: {
      ...bindings.inventory, declaredRootSha256: inventory.rootSha256 ?? null, files: inventory.files.length,
      duplicateHashGroups: [...pathsByHash.values()].filter(paths => paths.length > 1).length,
    },
    supportingEvidence: {
      operatorManifest: bindings.operatorManifest,
      authoritativeReferenceManifest: bindings.operatorManifest,
      manualIndex: bindings.manualIndex,
    },
    sourceRoots: rootsReceipt, scenarios, blockers: [...new Set(globalBlockers)],
  };
}

export function validateArchitectureInteriorGoldenLineageReceipt(receipt, {
  now = Date.now(), maxAgeDays = 30, cwd = process.cwd(), verifyBindings = true, expectedReferenceManifestPath = null,
} = {}) {
  const issues = [];
  const generatedAt = Date.parse(receipt?.generatedAt);
  if (receipt?.schema !== 'nexyfab.architecture-interior.golden-lineage-qualification.v1') issues.push('receipt_schema_invalid');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || now - generatedAt > maxAgeDays * 86_400_000) issues.push('receipt_stale_or_future');
  if (!SHA256.test(String(receipt?.inventory?.sha256 ?? ''))) issues.push('inventory_binding_invalid');
  const authoritativeReferenceManifest = receipt?.supportingEvidence?.authoritativeReferenceManifest;
  if (receipt?.policy?.authoritativeReferenceManifestRequired !== true) issues.push('authoritative_reference_manifest_requirement_missing');
  if (!authoritativeReferenceManifest || authoritativeReferenceManifest.path !== receipt?.policy?.authoritativeReferenceManifestPath) {
    issues.push('authoritative_reference_manifest_binding_missing');
  }
  if (expectedReferenceManifestPath !== null) {
    const expected = portable(path.relative(cwd, path.resolve(cwd, expectedReferenceManifestPath)));
    if (authoritativeReferenceManifest?.path !== expected) issues.push('authoritative_reference_manifest_not_current');
  }
  if (verifyBindings) {
    for (const [label, binding] of Object.entries({ inventory: receipt?.inventory, ...(receipt?.supportingEvidence ?? {}) })) {
      const resolved = resolveContainedFile(cwd, binding?.path);
      if (!resolved.ok || !SHA256.test(String(binding?.sha256 ?? '')) || sha256File(resolved.targetReal) !== binding.sha256) {
        issues.push(`evidence_binding_stale_or_invalid:${label}`);
      }
    }
  }
  const selected = [];
  const attestationRootRelative = safeRelative(receipt?.policy?.attestationRoot);
  const attestationRoot = attestationRootRelative ? path.resolve(cwd, attestationRootRelative) : null;
  for (const scenarioId of Object.keys(SCENARIOS)) {
    const scenario = receipt?.scenarios?.[scenarioId];
    if (!scenario || !['QUALIFIED', 'HOLD'].includes(scenario.status)) { issues.push(`scenario_invalid:${scenarioId}`); continue; }
    for (const item of scenario.selected ?? []) {
      selected.push({ ...item, scenarioId });
      if (!SHA256.test(String(item?.sha256 ?? '')) || !ROLES.has(item?.role)) issues.push(`selected_identity_invalid:${scenarioId}`);
      if (item?.tuningExclusion !== true) issues.push(`tuning_exclusion_missing:${scenarioId}:${item?.sha256 ?? 'unknown'}`);
      if (item?.qualificationStatus === 'QUALIFIED' && (item?.sourceExists !== true || item?.containmentVerified !== true || item?.inventoryMatch !== true
        || item?.licenseStatus !== 'approved' || item?.scenarioFitStatus !== 'approved'
        || typeof item?.licenseReviewerId !== 'string' || typeof item?.scenarioReviewerId !== 'string' || item.licenseReviewerId === item.scenarioReviewerId
        || !SHA256.test(String(item?.licenseEvidenceSha256 ?? '')) || !SHA256.test(String(item?.scenarioEvidenceSha256 ?? '')))) {
        issues.push(`false_qualified_selection:${scenarioId}:${item?.sha256 ?? 'unknown'}`);
      }
      if (item?.qualificationStatus === 'QUALIFIED' && verifyBindings) {
        const sourceRoot = receipt?.sourceRoots?.[item?.sourceRoot]?.realPath;
        const source = typeof sourceRoot === 'string' ? resolveContainedFile(sourceRoot, item?.relativePath) : { ok: false };
        if (!source.ok || source.bytes !== item.bytes || sha256File(source.targetReal) !== item.sha256) {
          issues.push(`qualified_source_stale_or_invalid:${scenarioId}:${item?.sha256 ?? 'unknown'}`);
        }
        if (!attestationRoot) {
          issues.push(`attestation_root_invalid:${scenarioId}`);
        } else {
          const license = loadAttestation(
            { path: item?.licenseEvidencePath, sha256: item?.licenseEvidenceSha256 },
            attestationRoot,
            { kind: 'license', sourceSha256: item?.sha256, now: generatedAt },
          );
          const scenarioEvidence = loadAttestation(
            { path: item?.scenarioEvidencePath, sha256: item?.scenarioEvidenceSha256 },
            attestationRoot,
            { kind: 'scenario', sourceSha256: item?.sha256, scenarioId, now: generatedAt },
          );
          if (!license.ok) issues.push(`qualified_license_stale_or_invalid:${scenarioId}:${license.reason}`);
          if (!scenarioEvidence.ok) issues.push(`qualified_scenario_attestation_stale_or_invalid:${scenarioId}:${scenarioEvidence.reason}`);
        }
      }
    }
    const derived = (scenario.selected?.length ?? 0) > 0 && scenario.selected.every(item => item.qualificationStatus === 'QUALIFIED') ? 'QUALIFIED' : 'HOLD';
    if (scenario.status !== derived) issues.push(`scenario_status_mismatch:${scenarioId}`);
  }
  const byHash = new Map();
  for (const item of selected) {
    const previous = byHash.get(item.sha256);
    if (previous) {
      issues.push(`duplicate_selected_hash:${item.sha256}`);
      if (previous.role !== item.role) issues.push(`same_hash_role_reuse:${item.sha256}`);
    } else byHash.set(item.sha256, item);
  }
  const derivedStatus = Object.keys(SCENARIOS).every(id => receipt?.scenarios?.[id]?.status === 'QUALIFIED') && !(receipt?.blockers?.length) ? 'QUALIFIED' : 'HOLD';
  if (receipt?.status !== derivedStatus) issues.push('receipt_status_mismatch');
  return { schema: 'nexyfab.architecture-interior.golden-lineage-validation.v1', valid: issues.length === 0, qualificationStatus: derivedStatus, issues: [...new Set(issues)] };
}

export function defaultInputs(cwd = process.cwd()) {
  return {
    inventoryPath: path.resolve(cwd, 'docs/evidence/architecture-interior-reference-inventory-260821/reference-inventory.json'),
    roots: { example73: path.resolve(cwd, '../7.3 example'), manuals: path.resolve(cwd, '../document(manuals)'), operator_refs: path.resolve(cwd, '../../../참고파일들') },
    operatorManifestPath: path.resolve(cwd, CURRENT_REFERENCE_UTILIZATION_MANIFEST_PATH),
    manualIndexPath: path.resolve(cwd, 'docs/cad-program/requirements/manual-index.json'),
    evidenceRoot: path.resolve(cwd, CURRENT_ARCHITECTURE_INTERIOR_EVIDENCE_ROOT),
  };
}

export function main(args = process.argv.slice(2)) {
  const defaults = defaultInputs();
  const assignmentPath = option(args, 'assignments', path.join(defaults.evidenceRoot, 'assignments.json'));
  const output = path.resolve(option(args, 'out', path.join(defaults.evidenceRoot, 'qualification-receipt.json')));
  const validationOutput = path.resolve(option(args, 'validation-out', path.join(defaults.evidenceRoot, 'qualification-validation.json')));
  const assignments = fs.existsSync(assignmentPath) ? readJson(assignmentPath) : null;
  fs.mkdirSync(defaults.evidenceRoot, { recursive: true });
  const receipt = qualifyArchitectureInteriorGoldenLineage({ ...defaults, assignments });
  const validation = validateArchitectureInteriorGoldenLineageReceipt(receipt, {
    expectedReferenceManifestPath: CURRENT_REFERENCE_UTILIZATION_MANIFEST_PATH,
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.mkdirSync(path.dirname(validationOutput), { recursive: true });
  fs.writeFileSync(validationOutput, `${JSON.stringify({ ...validation, receipt: evidenceBinding(output, process.cwd()) }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, validationOutput, status: receipt.status, valid: validation.valid, scenarios: Object.fromEntries(Object.entries(receipt.scenarios).map(([id, value]) => [id, value.status])) })}\n`);
  if (!validation.valid) return 2;
  return receipt.status === 'QUALIFIED' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
