#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachReceiptSha256, sha256, verifyReceiptSha256 } from './immutable-receipt-binding.mjs';

export const COMMERCIAL_SECURITY_RECEIPT_SCHEMA = 'nexyfab.commercial-security-evidence-receipt.v2';
export const COMMERCIAL_SECURITY_TARGET = 'production';
export const SECURITY_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export const SECURITY_SOURCE_SPECS = Object.freeze({
  routeSecurityMatrix: 'docs/evidence/security/route-security-matrix-260810.json',
  cadApiControls: 'docs/evidence/cad-independent/cad-api-control-evidence.json',
  secretScan: 'docs/evidence/security/secret-scan-260810.json',
  dependencyAudit: 'docs/evidence/security/dependency-audit-260810.json',
});
export const SECURITY_PACKAGE_LOCK_PATH = 'package-lock.json';

const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const ROUTE_CLASSES = new Set(['public', 'authenticated', 'admin', 'webhook', 'internal-worker', 'disabled']);
const DEPENDENCY_SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const CAD_CHECKS = [
  'allCadRoutesBehindActiveProxy', 'onlyCapabilityGetIsPublic', 'accountQuotaPresent',
  'distributedQuotaFailClosedInCommercial', 'productionAccessMeteringPresent',
  'openApiHasNoAnonymousCadOverride', 'everyDocumentedCadOperationUsesBearer',
  'allCadRequestBodiesUseBoundedReaders', 'allCadMutationRoutesDeclareBoundedIngress',
  'regressionTestsCoverBoundary',
];
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function validHash(value) { return SHA256.test(String(value ?? '')); }
function asNonNegativeInteger(value) { return Number.isInteger(value) && value >= 0; }
function sameJson(left, right) { return canonical(left) === canonical(right); }

function safeBinding(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const relative = relativePath.replaceAll('\\', '/');
  const absolute = path.resolve(resolvedRoot, relative);
  const actualRelative = path.relative(resolvedRoot, absolute).replaceAll('\\', '/');
  if (actualRelative !== relative || !relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`unsafe_security_source_path:${relativePath}`);
  }
  const linkStat = fs.lstatSync(absolute);
  if (linkStat.isSymbolicLink()) throw new Error(`security_source_not_regular_file:${relativePath}`);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realFile = fs.realpathSync.native(absolute);
  const realRelative = path.relative(realRoot, realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`security_source_outside_root:${relativePath}`);
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`security_source_not_regular_file:${relativePath}`);
  const bytes = fs.readFileSync(realFile);
  return { path: relative, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function loadDocuments(root) {
  return Object.fromEntries(Object.entries(SECURITY_SOURCE_SPECS).map(([id, relativePath]) => {
    try {
      const binding = safeBinding(root, relativePath);
      const document = JSON.parse(fs.readFileSync(path.resolve(root, relativePath), 'utf8'));
      return [id, { binding, document }];
    } catch (error) {
      return [id, { binding: (() => { try { return safeBinding(root, relativePath); } catch { return { path: relativePath, bytes: null, sha256: null }; } })(), document: null, error: error instanceof Error ? error.message : String(error) }];
    }
  }));
}

function sourceFresh(document, generatedAt) {
  const sourceTime = Date.parse(document?.generatedAt);
  const receiptTime = Date.parse(generatedAt);
  return Number.isFinite(sourceTime) && Number.isFinite(receiptTime)
    && sourceTime <= receiptTime + 5 * 60_000
    && sourceTime >= receiptTime - SECURITY_EVIDENCE_MAX_AGE_MS;
}

function verifyDeclaredSourceBindings(documents, root) {
  const declared = [
    ...(Array.isArray(documents?.routeSecurityMatrix?.routes)
      ? documents.routeSecurityMatrix.routes.flatMap(item => [
        { path: item?.file, sha256: item?.sourceSha256 },
        ...(Array.isArray(item?.securityDependencies)
          ? item.securityDependencies.map(dependency => ({ path: dependency?.file, sha256: dependency?.sha256 })) : []),
      ]) : []),
    ...(Array.isArray(documents?.cadApiControls?.sources)
      ? documents.cadApiControls.sources.map(item => ({ path: item?.file, sha256: item?.sha256 })) : []),
  ];
  if (declared.length === 0) return false;
  const seen = new Set();
  try {
    return declared.every(item => {
      if (typeof item.path !== 'string' || !item.path || !validHash(item.sha256)) return false;
      const binding = safeBinding(root, item.path);
      const key = `${binding.path}:${binding.sha256}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return binding.sha256 === item.sha256;
    });
  } catch {
    return false;
  }
}

function evaluateRouteSecurityMatrix(source) {
  const blockers = [];
  if (source?.schema !== 'nexyfab.route-security-matrix.v1') blockers.push('schema_invalid');
  if (source?.status !== 'pass') blockers.push('status_invalid');
  const routes = Array.isArray(source?.routes) ? source.routes : [];
  if (routes.length === 0) blockers.push('routes_missing');
  const malformed = routes.some(route => typeof route?.route !== 'string' || !route.route.startsWith('/api/')
    || !Array.isArray(route.methods) || route.methods.length === 0 || !ROUTE_CLASSES.has(route.classification)
    || !Array.isArray(route.gaps) || route.gaps.some(gap => typeof gap !== 'string' || !gap));
  if (malformed) blockers.push('route_shape_invalid');
  const gaps = routes.flatMap(route => Array.isArray(route?.gaps) ? route.gaps : []);
  const routesWithGaps = routes.filter(route => Array.isArray(route?.gaps) && route.gaps.length > 0).length;
  const gapCounts = {};
  for (const gap of gaps) gapCounts[gap] = (gapCounts[gap] ?? 0) + 1;
  if (gaps.length > 0) blockers.push('route_gaps_present');
  const byClassification = Object.fromEntries([...ROUTE_CLASSES].map(name => [name, routes.filter(route => route?.classification === name).length]));
  const unknownClassifications = routes.filter(route => !ROUTE_CLASSES.has(route?.classification)).length;
  const exportedHandlers = routes.reduce((sum, route) => sum + (Array.isArray(route?.methods) ? route.methods.length : 0), 0);
  const publicMutationPolicies = routes.filter(route => route?.classification === 'public' && route?.mutation === true && typeof route?.controls?.publicMutationPolicy === 'string').length;
  const summary = source?.summary;
  if (!summary || summary.routeFiles !== routes.length || summary.exportedHandlers !== exportedHandlers
    || summary.classifiedRoutes !== routes.length || summary.unknownClassifications !== unknownClassifications
    || summary.routesWithGaps !== routesWithGaps || !sameJson(summary.gapCounts, gapCounts)
    || !sameJson(summary.byClassification, byClassification) || summary.publicMutationPolicies !== publicMutationPolicies
    || !Array.isArray(summary.policyConfigIssues) || summary.policyConfigIssues.length !== 0) blockers.push('route_summary_inconsistent');
  return {
    ok: blockers.length === 0,
    schema: source?.schema ?? null,
    status: source?.status ?? null,
    derived: { routeFiles: routes.length, exportedHandlers, routesWithGaps, gapCounts, byClassification, unknownClassifications, publicMutationPolicies },
    blockers,
  };
}

function evaluateCadApiControls(source) {
  const blockers = [];
  if (source?.schema !== 'nexyfab.cad-api-control-evidence.v1') blockers.push('schema_invalid');
  if (source?.status !== 'pass') blockers.push('status_invalid');
  if (source?.externalCadRequired !== false) blockers.push('external_cad_requirement_invalid');
  if (!Array.isArray(source?.issues) || source.issues.length !== 0) blockers.push('issues_present');
  if (!Array.isArray(source?.publicExceptions) || source.publicExceptions.length !== 1
    || source.publicExceptions[0]?.method !== 'GET' || source.publicExceptions[0]?.path !== '/api/cad/v1/capabilities') blockers.push('public_exception_invalid');
  if (!source?.checks || CAD_CHECKS.some(key => source.checks[key] !== true)) blockers.push('cad_checks_incomplete');
  if (!asNonNegativeInteger(source?.routeFiles) || source.routeFiles === 0
    || !asNonNegativeInteger(source?.exportedHandlers) || source.exportedHandlers === 0
    || !asNonNegativeInteger(source?.documentedCadOperations) || source.documentedCadOperations === 0) blockers.push('cad_counts_invalid');
  if (!Array.isArray(source?.sources) || source.sources.length === 0
    || source.sources.some(item => typeof item?.file !== 'string' || !validHash(item?.sha256))) blockers.push('cad_source_provenance_invalid');
  return {
    ok: blockers.length === 0,
    schema: source?.schema ?? null,
    status: source?.status ?? null,
    derived: { checksPass: Boolean(source?.checks && CAD_CHECKS.every(key => source.checks[key] === true)), issues: Array.isArray(source?.issues) ? source.issues.length : null },
    blockers,
  };
}

function evaluateSecretScan(source) {
  const blockers = [];
  if (source?.schema !== 'nexyfab-secret-scan-v1') blockers.push('schema_invalid');
  if (source?.status !== 'pass') blockers.push('status_invalid');
  const findings = Array.isArray(source?.findings) ? source.findings : [];
  if (findings.length > 0) blockers.push('secret_findings_present');
  if (source?.findingCount !== findings.length) blockers.push('finding_count_inconsistent');
  if (!asNonNegativeInteger(source?.filesScanned) || source.filesScanned === 0 || !asNonNegativeInteger(source?.bytesScanned) || source.bytesScanned === 0) blockers.push('scan_coverage_invalid');
  return {
    ok: blockers.length === 0,
    schema: source?.schema ?? null,
    status: source?.status ?? null,
    derived: { findingCount: findings.length, filesScanned: source?.filesScanned ?? null, bytesScanned: source?.bytesScanned ?? null },
    blockers,
  };
}

function evaluateDependencyAudit(source) {
  const blockers = [];
  if (source?.schema !== 'nexyfab-dependency-audit-v1') blockers.push('schema_invalid');
  if (source?.status !== 'pass') blockers.push('status_invalid');
  if (source?.command !== 'npm audit --audit-level=low --json') blockers.push('audit_command_invalid');
  if (!validHash(source?.packageLockSha256)) blockers.push('lock_binding_invalid');
  const vulnerabilities = source?.vulnerabilities;
  if (!vulnerabilities || DEPENDENCY_SEVERITIES.some(key => !asNonNegativeInteger(vulnerabilities[key]))) blockers.push('vulnerability_counts_invalid');
  const total = DEPENDENCY_SEVERITIES.reduce((sum, key) => sum + (Number(vulnerabilities?.[key]) || 0), 0);
  if (vulnerabilities?.total !== total) blockers.push('vulnerability_total_inconsistent');
  if (total !== 0) blockers.push('vulnerabilities_present');
  const dependencies = source?.dependencies;
  if (!dependencies || ['prod', 'dev', 'optional', 'peer', 'peerOptional', 'total'].some(key => !asNonNegativeInteger(dependencies[key]))) blockers.push('dependency_counts_invalid');
  return {
    ok: blockers.length === 0,
    schema: source?.schema ?? null,
    status: source?.status ?? null,
    derived: { vulnerabilityTotal: total, dependencyTotal: dependencies?.total ?? null },
    blockers,
  };
}

const EVALUATORS = Object.freeze({ routeSecurityMatrix: evaluateRouteSecurityMatrix, cadApiControls: evaluateCadApiControls, secretScan: evaluateSecretScan, dependencyAudit: evaluateDependencyAudit });

export function evaluateCommercialSecuritySources(documents) {
  return Object.fromEntries(Object.keys(SECURITY_SOURCE_SPECS).map(id => [id, EVALUATORS[id](documents?.[id])]));
}

function releaseMetadata(release = {}, env = process.env) {
  return {
    buildId: release.buildId ?? env.RELEASE_BUILD_ID ?? env.NEXYFAB_BUILD_ID ?? null,
    deploymentId: release.deploymentId ?? env.RELEASE_DEPLOYMENT_ID ?? env.RAILWAY_DEPLOYMENT_ID ?? null,
    gitHead: release.gitHead ?? env.RELEASE_GIT_HEAD ?? env.RAILWAY_GIT_COMMIT_SHA ?? null,
  };
}

function releaseBlockers(release) {
  return [
    ...(typeof release?.buildId === 'string' && release.buildId.trim() ? [] : ['release_build_id_missing']),
    ...(typeof release?.deploymentId === 'string' && release.deploymentId.trim() ? [] : ['release_deployment_id_missing']),
    ...(GIT_SHA.test(String(release?.gitHead ?? '')) ? [] : ['release_git_head_invalid']),
  ];
}

export function buildCommercialSecurityEvidenceReceipt({
  root = process.cwd(), release = null, generatedAt = new Date().toISOString(),
} = {}) {
  const loaded = loadDocuments(root);
  const sourceDocuments = Object.fromEntries(Object.entries(loaded).map(([id, value]) => [id, value.document]));
  const evidence = evaluateCommercialSecuritySources(sourceDocuments);
  let packageLockBinding = { path: SECURITY_PACKAGE_LOCK_PATH, bytes: null, sha256: null };
  try { packageLockBinding = safeBinding(root, SECURITY_PACKAGE_LOCK_PATH); } catch { /* blocker below */ }
  const packageLockVerified = packageLockBinding.sha256 === sourceDocuments.dependencyAudit?.packageLockSha256;
  const declaredSourcesVerified = verifyDeclaredSourceBindings(sourceDocuments, root);
  const sourceFreshness = Object.fromEntries(Object.keys(SECURITY_SOURCE_SPECS)
    .map(id => [id, sourceFresh(sourceDocuments[id], generatedAt)]));
  const sourceBindings = [...Object.values(loaded).map(value => value.binding), packageLockBinding];
  const blockers = [
    ...Object.entries(loaded).flatMap(([id, value]) => value.error ? [`source_unavailable:${id}`] : []),
    ...Object.entries(evidence).flatMap(([id, value]) => value.blockers.map(blocker => `${id}:${blocker}`)),
    ...Object.entries(sourceFreshness).flatMap(([id, fresh]) => fresh ? [] : [`source_stale_or_unstamped:${id}`]),
    ...(packageLockVerified ? [] : ['dependencyAudit:package_lock_binding_mismatch']),
    ...(declaredSourcesVerified ? [] : ['declared_source_binding_mismatch']),
    ...releaseBlockers(releaseMetadata(release ?? {}, process.env)),
  ];
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) blockers.push('generated_at_invalid');
  const ok = blockers.length === 0;
  const resolvedRelease = releaseMetadata(release ?? {}, process.env);
  return attachReceiptSha256({
    schema: COMMERCIAL_SECURITY_RECEIPT_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'PASS' : 'HOLD',
    target: COMMERCIAL_SECURITY_TARGET,
    release: resolvedRelease,
    freshness: { generatedAt, maxAgeMs: SECURITY_EVIDENCE_MAX_AGE_MS, expiresAt: Number.isFinite(timestamp) ? new Date(timestamp + SECURITY_EVIDENCE_MAX_AGE_MS).toISOString() : null },
    sourceBindings,
    evidence,
    integrity: { packageLockVerified, declaredSourcesVerified, sourceFreshness },
    blockers: [...new Set(blockers)],
  });
}

export function verifyCommercialSecurityEvidenceReceipt(receipt, {
  root = process.cwd(), expectedRelease = null, expectedTarget = COMMERCIAL_SECURITY_TARGET,
  now = Date.now(), maxAgeMs = SECURITY_EVIDENCE_MAX_AGE_MS,
} = {}) {
  const blockers = [];
  const fail = code => blockers.push(code);
  const generatedAt = Date.parse(receipt?.generatedAt);
  if (receipt?.schema !== COMMERCIAL_SECURITY_RECEIPT_SCHEMA) fail('receipt_schema_invalid');
  if (receipt?.ok !== true || receipt?.status !== 'PASS') fail('receipt_not_pass');
  if (receipt?.target !== expectedTarget) fail('receipt_target_mismatch');
  if (!Number.isFinite(generatedAt) || generatedAt > now + 5 * 60_000 || generatedAt < now - maxAgeMs) fail('receipt_stale');
  if (receipt?.freshness?.generatedAt !== receipt?.generatedAt || receipt?.freshness?.maxAgeMs !== SECURITY_EVIDENCE_MAX_AGE_MS
    || receipt?.freshness?.expiresAt !== (Number.isFinite(generatedAt) ? new Date(generatedAt + SECURITY_EVIDENCE_MAX_AGE_MS).toISOString() : null)) fail('receipt_freshness_unbound');
  if (!verifyReceiptSha256(receipt)) fail('receipt_hash_mismatch');
  const release = receipt?.release;
  if (releaseBlockers(release).length) fail('release_metadata_invalid');
  const expectedGit = expectedRelease?.head ?? expectedRelease?.gitHead;
  if (expectedRelease && (release?.buildId !== expectedRelease.buildId || release?.deploymentId !== expectedRelease.deploymentId || release?.gitHead !== expectedGit)) fail('release_binding_mismatch');
  const loaded = loadDocuments(root);
  let packageLockBinding = { path: SECURITY_PACKAGE_LOCK_PATH, bytes: null, sha256: null };
  try { packageLockBinding = safeBinding(root, SECURITY_PACKAGE_LOCK_PATH); } catch { /* mismatch below */ }
  const expectedBindings = [...Object.values(loaded).map(value => value.binding), packageLockBinding];
  if (!sameJson(receipt?.sourceBindings, expectedBindings)) fail('source_bindings_mismatch');
  const documents = Object.fromEntries(Object.entries(loaded).map(([id, value]) => [id, value.document]));
  const expectedEvidence = evaluateCommercialSecuritySources(documents);
  if (!sameJson(receipt?.evidence, expectedEvidence)) fail('evidence_derivation_mismatch');
  const expectedIntegrity = {
    packageLockVerified: packageLockBinding.sha256 === documents.dependencyAudit?.packageLockSha256,
    declaredSourcesVerified: verifyDeclaredSourceBindings(documents, root),
    sourceFreshness: Object.fromEntries(Object.keys(SECURITY_SOURCE_SPECS)
      .map(id => [id, sourceFresh(documents[id], receipt.generatedAt)])),
  };
  if (!sameJson(receipt?.integrity, expectedIntegrity)
    || !expectedIntegrity.packageLockVerified || !expectedIntegrity.declaredSourcesVerified
    || Object.values(expectedIntegrity.sourceFreshness).some(value => value !== true)) fail('source_integrity_invalid');
  if (!Array.isArray(receipt?.blockers) || receipt.blockers.length !== 0) fail('receipt_blockers_present');
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export const buildSecurityEvidenceReceipt = buildCommercialSecurityEvidenceReceipt;
export const verifySecurityEvidenceReceipt = verifyCommercialSecurityEvidenceReceipt;

function main() {
  const output = path.resolve(process.env.COMMERCIAL_SECURITY_RECEIPT_OUTPUT
    ?? 'docs/evidence/release/commercial-security-evidence-receipt.json');
  const receipt = buildCommercialSecurityEvidenceReceipt({
    root: process.cwd(),
    release: {
      buildId: process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID,
      deploymentId: process.env.RELEASE_DEPLOYMENT_ID ?? process.env.RAILWAY_DEPLOYMENT_ID,
      gitHead: process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    },
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, status: receipt.status, output, blockers: receipt.blockers })}\n`);
  return receipt.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`[commercial-security-v2] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
