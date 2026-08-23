import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'config/platform/slice-deployment.v1.json');
const RECEIPT = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-readiness.json');
const STAGING_EVIDENCE = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-staging.json');
const LOCAL_RUNTIME_EVIDENCE = path.join(ROOT, 'docs/evidence/platform-runtime/slice-local-runtime.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }
function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function isPathInside(root, parent, child) {
  const relative = path.relative(path.resolve(root, parent), path.resolve(root, child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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
    if (slice.build?.contextRoot === '.') localIssues.push('repository_root_build_context_forbidden');
    if (slice.build?.mode !== 'isolated-candidate') localIssues.push('isolated_build_mode_required');
    if (slice.build?.contextRoot && slice.build?.dockerfile && !isPathInside(root, slice.build.contextRoot, slice.build.dockerfile)) {
      localIssues.push('dockerfile_must_be_inside_build_context');
    }
    const descriptorPath = path.join(root, slice.build?.contextRoot ?? '', 'service.json');
    if (!fs.existsSync(descriptorPath)) {
      localIssues.push('service_descriptor_missing');
    } else {
      const descriptor = readJson(descriptorPath);
      if (descriptor.id !== slice.deployUnit) localIssues.push('service_descriptor_id_mismatch');
      if (descriptor.scope !== slice.scope) localIssues.push('service_descriptor_scope_mismatch');
      if (descriptor.build?.context !== slice.build.contextRoot || descriptor.build?.dockerfile !== 'Dockerfile') {
        localIssues.push('service_descriptor_build_mismatch');
      }
      if (descriptor.deployEnabled !== false) localIssues.push('candidate_deploy_must_remain_disabled');
    }
    const packagePath = path.join(root, slice.build?.contextRoot ?? '', 'package.json');
    if (!fs.existsSync(packagePath)) localIssues.push('slice_package_missing');
    if (slice.build?.dockerfile && fs.existsSync(path.join(root, slice.build.dockerfile))) {
      const dockerfile = fs.readFileSync(path.join(root, slice.build.dockerfile), 'utf8');
      if (!/\bHEALTHCHECK\b/.test(dockerfile)) localIssues.push('docker_healthcheck_missing');
      if (/^\s*(?:COPY|ADD)\s+[^\n]*\.\.[\\/]/im.test(dockerfile)) localIssues.push('docker_context_parent_escape_forbidden');
    }
    if (!slice.health?.mode) localIssues.push('health_mode_missing');
    for (const phase of ['live', 'ready', 'release']) if (!slice.health?.[phase]) localIssues.push(`health_${phase}_missing`);
    if (!slice.rollback?.owner || slice.rollback.requiredBuildBinding !== true) localIssues.push('rollback_binding_incomplete');
    return { id: slice.id, scope: slice.scope, deployUnit: slice.deployUnit, status: localIssues.length ? 'FAIL' : 'ISOLATED_CONTEXT_READY', issues: localIssues };
  });
  return { ok: issues.length === 0 && results.every(result => result.status !== 'FAIL'), issues, slices: results };
}

export function evaluateLocalRuntimeEvidence(evidence, manifest) {
  const issues = [];
  if (evidence?.schema !== 'nexyfab.slice-local-runtime-evidence.v1') issues.push('local_runtime_evidence_schema_invalid');
  if (evidence?.environment?.provider !== 'Docker Desktop') issues.push('local_runtime_provider_invalid');
  if (!/^\d+\.\d+\.\d+$/.test(evidence?.environment?.engineVersion ?? '')) issues.push('docker_engine_version_invalid');
  if (!/^[a-f0-9]{40}$/.test(evidence?.integrationHeadAtVerification ?? '')) issues.push('local_runtime_integration_head_invalid');
  const expected = new Map((manifest?.slices ?? []).map(slice => [slice.scope, slice]));
  const slices = Array.isArray(evidence?.slices) ? evidence.slices : [];
  if (slices.length !== expected.size) issues.push('local_runtime_scope_count_invalid');
  for (const result of slices) {
    const slice = expected.get(result.scope);
    if (!slice) {
      issues.push(`local_runtime_scope_unknown:${result.scope ?? 'missing'}`);
      continue;
    }
    if (result.unit !== slice.deployUnit) issues.push(`local_runtime_unit_mismatch:${result.scope}`);
    if (!/^[a-f0-9]{40}$/.test(result.sourceCommit ?? '')) issues.push(`local_runtime_source_commit_invalid:${result.scope}`);
    if (result.build?.context !== slice.build.contextRoot || result.build?.dockerfile !== slice.build.dockerfile) {
      issues.push(`local_runtime_build_path_mismatch:${result.scope}`);
    }
    if (!result.sourceCommit?.startsWith(result.build?.buildId ?? 'invalid')) issues.push(`local_runtime_build_id_mismatch:${result.scope}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(result.build?.imageId ?? '')) issues.push(`local_runtime_image_id_invalid:${result.scope}`);
    if (result.build?.state !== 'PASS') issues.push(`local_runtime_build_not_passed:${result.scope}`);
    if (result.health?.dockerStatus !== 'healthy') issues.push(`local_runtime_docker_health_not_passed:${result.scope}`);
    if (result.health?.live?.statusCode !== 200 || result.health?.ready?.statusCode !== 200) {
      issues.push(`local_runtime_health_not_ready:${result.scope}`);
    }
    if (result.health?.release?.statusCode !== 503 || result.health?.release?.state !== 'HOLD') {
      issues.push(`local_runtime_release_must_hold:${result.scope}`);
    }
    if (result.tests?.state !== 'PASS') issues.push(`local_runtime_tests_not_passed:${result.scope}`);
  }
  for (const scope of expected.keys()) if (!slices.some(result => result.scope === scope)) issues.push(`local_runtime_scope_missing:${scope}`);
  if (evidence?.cleanup?.temporaryContainersRemaining !== 0) issues.push('local_runtime_temporary_containers_remain');
  return {
    ok: issues.length === 0,
    state: issues.length ? 'FAIL' : 'PASS_WITH_RELEASE_HOLDS',
    issues,
    slices: slices.map(result => ({ scope: result.scope, unit: result.unit, imageId: result.build?.imageId, state: result.status })),
  };
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
  const localRuntimeEvidence = exists(path.relative(ROOT, LOCAL_RUNTIME_EVIDENCE)) ? readJson(LOCAL_RUNTIME_EVIDENCE) : null;
  const localRuntime = localRuntimeEvidence
    ? { ...evaluateLocalRuntimeEvidence(localRuntimeEvidence, manifest), evidenceFile: path.relative(ROOT, LOCAL_RUNTIME_EVIDENCE).replaceAll('\\', '/') }
    : { ok: false, state: 'NOT_RUN', reason: 'isolated local runtime evidence is not available in this workspace' };
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
    localRuntime,
    staging,
    rollback,
    status: evaluation.ok && localRuntime.ok && staging.ok && rollback.state === 'PASS' && staging.holds.length === 0
      ? 'PASS'
      : evaluation.ok && localRuntime.ok
        ? 'HOLD'
        : 'BLOCKED',
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
