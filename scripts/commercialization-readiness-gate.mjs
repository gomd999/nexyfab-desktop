#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'];

export function readGitIdentity(root = process.cwd()) {
  const dotGit = path.join(root, '.git');
  let gitDir = dotGit;
  if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
    const pointer = fs.readFileSync(dotGit, 'utf8').trim();
    if (!pointer.startsWith('gitdir:')) return { branch: null, head: null };
    gitDir = path.resolve(root, pointer.slice('gitdir:'.length).trim());
  }
  if (!fs.existsSync(gitDir)) return { branch: null, head: null };

  const headValue = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  if (!headValue.startsWith('ref:')) return { branch: null, head: headValue || null };
  const ref = headValue.slice('ref:'.length).trim();
  const looseRef = path.join(gitDir, ...ref.split('/'));
  let head = fs.existsSync(looseRef) ? fs.readFileSync(looseRef, 'utf8').trim() : '';
  if (!head) {
    const packedRefs = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedRefs)) {
      const row = fs.readFileSync(packedRefs, 'utf8')
        .split(/\r?\n/)
        .find(line => !line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${ref}`));
      head = row?.split(' ')[0] ?? '';
    }
  }
  return {
    branch: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref,
    head: head || null,
  };
}

export function evaluateCommercializationReadiness(input) {
  const privateBetaBlockers = [];
  const gaBlockers = [];
  const blockPrivate = value => privateBetaBlockers.push(value);
  const blockGa = value => gaBlockers.push(value);

  const release = input.releaseBaseline?.release ?? {};
  const currentRelease = input.currentRelease ?? {};
  if (!String(release.branch ?? '').startsWith('release/')) blockPrivate('release_branch_not_fixed');
  if (!currentRelease.branch || !currentRelease.head) blockPrivate('current_release_identity_unavailable');
  else {
    if (release.branch !== currentRelease.branch) blockPrivate('release_baseline_branch_mismatch');
    if (release.head !== currentRelease.head) blockPrivate('release_baseline_head_mismatch');
  }
  if (release.baselineStatus !== 'committed' || release.workingTreeChanges !== 0) blockPrivate('release_candidate_not_committed');
  for (const field of ['deploymentId', 'buildId', 'rollbackDeploymentId', 'dockerImageDigest']) {
    if (!release[field]) blockPrivate(`release_identity_missing:${field}`);
  }
  if (release.railwayIgnore?.missing?.length) blockPrivate('railway_deploy_exclusions_incomplete');

  if (input.closedBeta?.ok !== true || (input.closedBeta?.differences ?? []).length) blockPrivate('closed_beta_integrity_failed');
  if (input.productionProtectedState?.ok !== true) blockPrivate('production_protected_state_failed');
  if (input.liveSmoke?.status !== 'pass') blockPrivate('production_smoke_not_passed');
  if (input.openscadHttpSmoke?.ok !== true) blockPrivate('openscad_http_smoke_not_passed');
  if (input.authenticatedE2E?.ok !== true) blockPrivate('authenticated_user_e2e_not_passed');
  if (input.resourceBaseline?.assessment?.currentMaxWithinTarget !== true) blockPrivate('runtime_memory_target_failed');
  if (input.migrationReceipt?.ok !== true) blockPrivate('production_migration_receipt_missing');
  if (input.restoreReceipt?.ok !== true) blockPrivate('backup_restore_receipt_missing');

  const corpus = input.validationCorpus?.lanes;
  for (const domain of DOMAINS) {
    if ((corpus?.synthetic?.summary?.byDomain?.[domain] ?? 0) < 20) blockPrivate(`synthetic_cases_missing:${domain}`);
    const holdout = corpus?.independentHoldout?.domains?.[domain];
    if (holdout?.releaseEligible !== true) blockGa(`independent_holdout_not_eligible:${domain}`);
  }
  if (corpus?.reference?.sourceReadOnly !== true) blockPrivate('reference_corpus_not_read_only');
  if (input.syntheticCampaignReceipt?.ok !== true || input.syntheticCampaignReceipt?.totalGatePasses !== 1500) {
    blockPrivate('synthetic_domain_campaign_incomplete');
  }
  if (input.security?.routeMatrixOk !== true) blockPrivate('route_security_matrix_failed');
  if (input.security?.cadApiControlsOk !== true) blockPrivate('cad_api_controls_failed');
  if (input.security?.secretFindings !== 0) blockPrivate('secret_scan_failed');
  if (input.security?.dependencyVulnerabilities !== 0) blockPrivate('dependency_audit_failed');

  gaBlockers.unshift(...privateBetaBlockers);
  if (input.sevenDayOperationsReceipt?.ok !== true) blockGa('seven_day_operations_receipt_missing');
  if (input.expertReviewReceipt?.ok !== true) blockGa('expert_review_receipt_missing');

  return {
    schema: 'nexyfab.commercialization-readiness.v1',
    privateBeta: { eligible: privateBetaBlockers.length === 0, blockers: [...new Set(privateBetaBlockers)] },
    commercialGa: { eligible: gaBlockers.length === 0, blockers: [...new Set(gaBlockers)] },
  };
}

const readJson = value => JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
const optionalJson = value => value && fs.existsSync(path.resolve(value)) ? readJson(value) : null;

async function main() {
  const routeMatrix = readJson(process.env.ROUTE_SECURITY_MATRIX ?? 'docs/evidence/security/route-security-matrix-260810.json');
  const cadApiControls = readJson(process.env.CAD_API_CONTROL_EVIDENCE ?? 'docs/evidence/cad-independent/cad-api-control-evidence.json');
  const secretScan = readJson(process.env.SECRET_SCAN_EVIDENCE ?? 'docs/evidence/security/secret-scan-260810.json');
  const dependencyAudit = readJson(process.env.DEPENDENCY_AUDIT_EVIDENCE ?? 'docs/evidence/security/dependency-audit-260810.json');
  const result = evaluateCommercializationReadiness({
    currentRelease: readGitIdentity(),
    releaseBaseline: readJson(process.env.RELEASE_BASELINE ?? 'docs/evidence/release/commercial-release-baseline-current.json'),
    closedBeta: readJson(process.env.CLOSED_BETA_COMPARISON ?? 'docs/evidence/release/closed-beta-integrity-commercial-release-260810.json'),
    productionProtectedState: optionalJson(process.env.PRODUCTION_PROTECTED_STATE_RECEIPT ?? 'docs/evidence/release/production-protected-state-receipt.json'),
    validationCorpus: readJson(process.env.COMMERCIAL_VALIDATION_CORPUS ?? 'docs/evidence/release/commercial-validation-corpus-260810.json'),
    syntheticCampaignReceipt: readJson(process.env.SYNTHETIC_CAMPAIGN_RECEIPT ?? 'docs/evidence/release/commercial-synthetic-campaign-receipt-260810.json'),
    liveSmoke: readJson(process.env.COMMERCIAL_LIVE_SMOKE ?? 'docs/evidence/release/commercial-live-smoke-with-service-env-260810.json'),
    openscadHttpSmoke: optionalJson(process.env.OPENSCAD_HTTP_SMOKE ?? 'docs/evidence/release/openscad-http-smoke-260810.json'),
    authenticatedE2E: optionalJson(process.env.AUTHENTICATED_E2E_RECEIPT ?? 'docs/evidence/release/authenticated-commercial-e2e-260810.json'),
    resourceBaseline: readJson(process.env.RAILWAY_RESOURCE_BASELINE ?? 'docs/evidence/release/railway-resource-baseline-260810.json'),
    migrationReceipt: optionalJson(process.env.PRODUCTION_MIGRATION_RECEIPT ?? 'docs/evidence/release/production-migration-receipt.json'),
    restoreReceipt: optionalJson(process.env.BACKUP_RESTORE_RECEIPT ?? 'docs/evidence/release/backup-restore-receipt.json'),
    sevenDayOperationsReceipt: optionalJson(process.env.SEVEN_DAY_OPERATIONS_RECEIPT ?? 'docs/evidence/release/seven-day-operations-receipt.json'),
    expertReviewReceipt: optionalJson(process.env.EXPERT_REVIEW_RECEIPT ?? 'docs/evidence/release/expert-review-receipt.json'),
    security: {
      routeMatrixOk: routeMatrix.status === 'pass'
        && routeMatrix.summary?.unknownClassifications === 0
        && routeMatrix.summary?.routesWithGaps === 0,
      cadApiControlsOk: cadApiControls.status === 'pass'
        && cadApiControls.issues?.length === 0
        && cadApiControls.checks?.allCadRoutesBehindActiveProxy === true,
      secretFindings: secretScan.findingCount,
      dependencyVulnerabilities: dependencyAudit.vulnerabilities?.total,
    },
  });
  const report = {
    ...result,
    generatedAt: new Date().toISOString(),
    evidence: {
      routeSecurityMatrix: routeMatrix.status,
      cadApiControls: cadApiControls.status,
      secretFindings: secretScan.findingCount,
      dependencyVulnerabilities: dependencyAudit.vulnerabilities?.total,
    },
  };
  const outputPath = path.resolve(process.env.COMMERCIALIZATION_GATE_OUTPUT ?? 'docs/evidence/release/commercialization-readiness-current.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!result.privateBeta.eligible || !result.commercialGa.eligible) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`[commercialization-gate] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
