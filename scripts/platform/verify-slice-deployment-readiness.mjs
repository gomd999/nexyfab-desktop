import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'config/platform/slice-deployment.v1.json');
const RECEIPT = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-readiness.json');
const STAGING_EVIDENCE = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-staging.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }
function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

export function evaluateSliceDeploymentReadiness(manifest, root = ROOT) {
  const issues = [];
  if (manifest.schema !== 'nexyfab.slice-deployment.v1') issues.push('manifest_schema_invalid');
  if (manifest.policy?.default !== 'NO_DEPLOY') issues.push('default_deploy_policy_must_be_NO_DEPLOY');
  if (manifest.policy?.automaticPromotion !== false) issues.push('automatic_promotion_must_remain_disabled');
  const slices = Array.isArray(manifest.slices) ? manifest.slices : [];
  if (slices.length !== 3) issues.push('expected_three_scope_slices');
  const ids = new Set();
  const results = slices.map((slice) => {
    const localIssues = [];
    if (!slice.id || ids.has(slice.id)) localIssues.push('slice_id_missing_or_duplicate');
    ids.add(slice.id);
    for (const source of slice.sourceRoots ?? []) if (!fs.existsSync(path.join(root, source))) localIssues.push(`source_missing:${source}`);
    if (!slice.build?.contextRoot || !fs.existsSync(path.join(root, slice.build.contextRoot))) localIssues.push('build_context_missing');
    if (!slice.build?.dockerfile || !fs.existsSync(path.join(root, slice.build.dockerfile))) localIssues.push('dockerfile_missing');
    if (!slice.health?.mode) localIssues.push('health_mode_missing');
    if (!slice.rollback?.owner || slice.rollback.requiredBuildBinding !== true) localIssues.push('rollback_binding_incomplete');
    return { id: slice.id, scope: slice.scope, deployUnit: slice.deployUnit, status: localIssues.length ? 'FAIL' : 'READY_FOR_STAGING', issues: localIssues };
  });
  return { ok: issues.length === 0 && results.every(result => result.status !== 'FAIL'), issues, slices: results };
}

export function evaluateStagingEvidence(evidence, manifest) {
  const issues = [];
  if (evidence?.schema !== 'nexyfab.slice-deployment-staging-evidence.v1') issues.push('staging_evidence_schema_invalid');
  if (evidence?.environment?.provider !== 'Railway' || evidence?.environment?.name !== 'staging') issues.push('staging_environment_invalid');
  if (!/^[a-f0-9]{40}$/.test(evidence?.sourceBindings?.nexyfabCommit ?? '')) issues.push('nexyfab_commit_binding_invalid');
  if (!/^[a-f0-9]{40}$/.test(evidence?.sourceBindings?.runtimeCommit ?? '')) issues.push('runtime_commit_binding_invalid');
  const expectedScopes = new Set((manifest?.slices ?? []).map(slice => slice.scope));
  const scopes = Array.isArray(evidence?.scopes) ? evidence.scopes : [];
  const observedScopes = new Set(scopes.map(scope => scope.scope));
  for (const scope of expectedScopes) if (!observedScopes.has(scope)) issues.push(`staging_scope_missing:${scope}`);
  const services = scopes.flatMap(scope => Array.isArray(scope.services) ? scope.services : []);
  if (services.length !== 7) issues.push('expected_seven_runtime_services');
  for (const service of services) {
    if (!service?.name) issues.push('staging_service_name_missing');
    if (!/^[a-f0-9-]{36}$/.test(service?.deploymentId ?? '')) issues.push(`deployment_id_invalid:${service?.name ?? 'unknown'}`);
    if (service?.status !== 'SUCCESS') issues.push(`deployment_not_successful:${service?.name ?? 'unknown'}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(service?.imageDigest ?? '')) issues.push(`deployment_digest_invalid:${service?.name ?? 'unknown'}`);
    if (service?.health !== 'PASS') issues.push(`deployment_health_not_passed:${service?.name ?? 'unknown'}`);
  }
  if (evidence?.smoke?.state !== 'PASS') issues.push('staging_smoke_not_passed');
  if (!/^[a-f0-9]{64}$/.test(evidence?.smoke?.contentSha256 ?? '')) issues.push('staging_smoke_artifact_digest_invalid');
  const rollbackTargets = Array.isArray(evidence?.rollback?.targets) ? evidence.rollback.targets : [];
  if (rollbackTargets.length !== 7) issues.push('rollback_targets_incomplete');
  for (const target of rollbackTargets) {
    if (!target?.service || !/^[a-f0-9-]{36}$/.test(target?.deploymentId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(target?.imageDigest ?? '')) {
      issues.push(`rollback_target_invalid:${target?.service ?? 'unknown'}`);
    }
  }
  const holds = Array.isArray(evidence?.holds) ? evidence.holds : [];
  return {
    ok: issues.length === 0,
    state: issues.length ? 'FAIL' : holds.length ? 'PASS_WITH_HOLDS' : 'PASS',
    issues,
    holds,
    scopes: scopes.map(scope => ({ scope: scope.scope, state: scope.state, services: (scope.services ?? []).map(service => service.name) })),
  };
}

export function buildSliceDeploymentReceipt(manifest, root = ROOT) {
  const evaluation = evaluateSliceDeploymentReadiness(manifest, root);
  const stagingEvidence = exists(path.relative(ROOT, STAGING_EVIDENCE)) ? readJson(STAGING_EVIDENCE) : null;
  const staging = stagingEvidence
    ? { ...evaluateStagingEvidence(stagingEvidence, manifest), evidenceFile: path.relative(ROOT, STAGING_EVIDENCE).replaceAll('\\', '/') }
    : { ok: false, state: 'NOT_RUN', reason: 'live Cloudflare/Railway staging evidence is not available in this workspace' };
  const rollback = stagingEvidence
    ? {
        state: stagingEvidence.rollback.execution === 'PASS' ? 'PASS' : 'READY_DASHBOARD_ONLY',
        execution: stagingEvidence.rollback.execution,
        mechanism: stagingEvidence.rollback.mechanism,
        targetCount: stagingEvidence.rollback.targets?.length ?? 0,
        reason: stagingEvidence.rollback.reason,
      }
    : { state: 'NOT_RUN', reason: 'rollback target requires a live staging deployment' };
  return {
    schema: 'nexyfab.slice-deployment-readiness-receipt.v1',
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    local: evaluation,
    staging,
    rollback,
    status: evaluation.ok && staging.ok && rollback.state === 'PASS' && staging.holds.length === 0 ? 'PASS' : evaluation.ok ? 'HOLD' : 'BLOCKED',
  };
}

function main() {
  const manifest = readJson(MANIFEST);
  const receipt = buildSliceDeploymentReceipt(manifest);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
    fs.writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--check') && receipt.status !== 'HOLD') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
