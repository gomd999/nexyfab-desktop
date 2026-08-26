import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSliceRollbackEvidence, sha256File } from './verify-slice-rollback-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'config/platform/slice-deployment.v1.json');
const RECEIPT = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-readiness.json');

const REQUIRED_RUNTIME_BINDINGS = {
  platform: ['LEGACY_NEXT_ORIGIN', 'NEXYFAB_BUILD_ID'],
  'precision-cad': ['EXACT_KERNEL_URL', 'EXACT_KERNEL_AUTH_TOKEN', 'JOB_CONTROL_URL', 'JOB_CONTROL_AUTH_TOKEN', 'EXACT_KERNEL_IDENTITY', 'INTERNAL_AUTH_TOKEN', 'NEXYFAB_BUILD_ID'],
  'ai-design': ['ANALYSIS_URL', 'ANALYSIS_AUTH_TOKEN', 'AI_LIVE_ENABLED', 'INTERNAL_AUTH_TOKEN', 'NEXYFAB_BUILD_ID'],
};

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function gitHead(root = ROOT) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function isPathInside(root, parent, child) {
  const relative = path.relative(path.resolve(root, parent), path.resolve(root, child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function freshnessIssue(value, now, maximumAgeHours, prefix) {
  const timestamp = Date.parse(value ?? '');
  if (!Number.isFinite(timestamp)) return `${prefix}_timestamp_invalid`;
  const age = now.getTime() - timestamp;
  if (age < -5 * 60_000) return `${prefix}_timestamp_in_future`;
  if (age > maximumAgeHours * 60 * 60_000) return `${prefix}_stale`;
  return null;
}

export function fingerprintFiles(root, files, contextRoot) {
  const normalizedContext = contextRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const normalizedFiles = [...files].map(file => file.replaceAll('\\', '/')).sort();
  const hash = createHash('sha256');
  for (const file of normalizedFiles) {
    const relative = path.posix.relative(normalizedContext, file);
    if (!relative || relative.startsWith('../')) throw new Error(`slice_context_file_outside:${file}`);
    const absolute = path.join(root, ...file.split('/'));
    if (!fs.existsSync(absolute)) throw new Error(`slice_context_file_missing:${file}`);
    hash.update(relative);
    hash.update('\0');
    const content = fs.readFileSync(absolute);
    // Git checkouts use platform-specific working-tree line endings. Slice
    // identity binds logical source content so Windows-built evidence verifies
    // against the same committed files on Linux CI.
    hash.update(content.includes(0) ? content : Buffer.from(content.toString('utf8').replaceAll('\r\n', '\n')));
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), fileCount: normalizedFiles.length };
}

export function fingerprintSliceContext(root, contextRoot) {
  const output = execFileSync('git', ['ls-files', '-z', '--', contextRoot], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const files = output.split('\0').filter(Boolean);
  if (files.length === 0) throw new Error(`slice_context_has_no_tracked_files:${contextRoot}`);
  return fingerprintFiles(root, files, contextRoot);
}

function inspectLocalImages(evidence, root) {
  return Object.fromEntries((evidence?.slices ?? []).map(result => {
    const image = result.build?.image;
    if (!image) return ['', { error: 'image_name_missing' }];
    try {
      const id = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
      return [image, { id }];
    } catch (error) {
      return [image, { error: error instanceof Error ? error.message : String(error) }];
    }
  }));
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
    if (slice.build?.contextRoot && slice.build?.dockerfile && !isPathInside(root, slice.build.contextRoot, slice.build.dockerfile)) localIssues.push('dockerfile_must_be_inside_build_context');
    const descriptorPath = path.join(root, slice.build?.contextRoot ?? '', 'service.json');
    if (!fs.existsSync(descriptorPath)) {
      localIssues.push('service_descriptor_missing');
    } else {
      const descriptor = readJson(descriptorPath);
      if (descriptor.id !== slice.deployUnit) localIssues.push('service_descriptor_id_mismatch');
      if (descriptor.scope !== slice.scope) localIssues.push('service_descriptor_scope_mismatch');
      if (descriptor.build?.context !== slice.build.contextRoot || descriptor.build?.dockerfile !== 'Dockerfile') localIssues.push('service_descriptor_build_mismatch');
      if (descriptor.deployEnabled !== false) localIssues.push('candidate_deploy_must_remain_disabled');
      if (descriptor.dependencyProbe?.mode !== 'active-by-default' || !Array.isArray(descriptor.dependencyProbe?.targets)) localIssues.push('dependency_probe_declaration_missing');
      const runtimeBindings = new Set(descriptor.runtimeBindings ?? []);
      for (const binding of REQUIRED_RUNTIME_BINDINGS[slice.scope] ?? []) {
        if (!runtimeBindings.has(binding)) localIssues.push(`runtime_binding_missing:${binding}`);
      }
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

export function evaluateLocalRuntimeEvidence(evidence, manifest, options = {}) {
  const issues = [];
  const now = options.now ?? new Date();
  const maximumAgeHours = manifest.policy?.localEvidenceMaxAgeHours ?? 168;
  if (evidence?.schema !== 'nexyfab.slice-local-runtime-evidence.v1') issues.push('local_runtime_evidence_schema_invalid');
  const freshness = freshnessIssue(evidence?.generatedAt, now, maximumAgeHours, 'local_runtime_evidence');
  if (freshness) issues.push(freshness);
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
    if (!/^[a-f0-9]{64}$/.test(result.sourceTreeSha256 ?? '')) issues.push(`local_runtime_source_tree_invalid:${result.scope}`);
    if (!Number.isInteger(result.sourceFileCount) || result.sourceFileCount < 1) issues.push(`local_runtime_source_file_count_invalid:${result.scope}`);
    const actualFingerprint = options.contextFingerprints?.[result.scope];
    if (options.requireCurrentSource !== false) {
      if (!actualFingerprint) issues.push(`local_runtime_current_source_unavailable:${result.scope}`);
      else if (actualFingerprint.sha256 !== result.sourceTreeSha256 || actualFingerprint.fileCount !== result.sourceFileCount) issues.push(`local_runtime_source_tree_mismatch:${result.scope}`);
    }
    if (result.build?.context !== slice.build.contextRoot || result.build?.dockerfile !== slice.build.dockerfile) issues.push(`local_runtime_build_path_mismatch:${result.scope}`);
    if (result.build?.buildId !== result.sourceTreeSha256?.slice(0, 12)) issues.push(`local_runtime_build_id_mismatch:${result.scope}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(result.build?.imageId ?? '')) issues.push(`local_runtime_image_id_invalid:${result.scope}`);
    if (result.build?.state !== 'PASS') issues.push(`local_runtime_build_not_passed:${result.scope}`);
    if (options.requireLocalImages) {
      const inspected = options.localImages?.[result.build?.image];
      if (!inspected || inspected.error) issues.push(`local_runtime_image_unavailable:${result.scope}`);
      else if (inspected.id !== result.build.imageId) issues.push(`local_runtime_image_id_mismatch:${result.scope}`);
    }
    if (result.health?.dockerStatus !== 'healthy') issues.push(`local_runtime_docker_health_not_passed:${result.scope}`);
    if (result.health?.live?.path !== slice.health.live || result.health?.live?.statusCode !== 200 || result.health?.live?.state !== 'ok' || result.health?.live?.build !== result.build?.buildId) issues.push(`local_runtime_live_health_invalid:${result.scope}`);
    const assurance = result.health?.readinessAssurance;
    const activeReady = assurance === 'ACTIVE_PROBED' && result.health?.ready?.statusCode === 200 && result.health?.ready?.state === 'ok';
    const isolatedHold = assurance === 'ISOLATED_BINDING_ONLY' && result.health?.ready?.statusCode === 503 && result.health?.ready?.state === 'HOLD';
    if (result.health?.ready?.path !== slice.health.ready || (!activeReady && !isolatedHold)) issues.push(`local_runtime_ready_health_invalid:${result.scope}`);
    if (result.health?.release?.path !== slice.health.release || result.health?.release?.statusCode !== 503 || result.health?.release?.state !== 'HOLD') issues.push(`local_runtime_release_must_hold:${result.scope}`);
    if (result.tests?.state !== 'PASS') issues.push(`local_runtime_tests_not_passed:${result.scope}`);
  }
  for (const scope of expected.keys()) if (!slices.some(result => result.scope === scope)) issues.push(`local_runtime_scope_missing:${scope}`);
  if (evidence?.cleanup?.temporaryContainersRemaining !== 0) issues.push('local_runtime_temporary_containers_remain');
  return {
    ok: issues.length === 0,
    state: issues.length ? 'FAIL' : 'PASS_WITH_RELEASE_HOLDS',
    issues,
    slices: slices.map(result => ({ scope: result.scope, unit: result.unit, imageId: result.build?.imageId, sourceTreeSha256: result.sourceTreeSha256, state: result.status })),
  };
}

export function evaluateStagingEvidence(evidence, manifest, options = {}) {
  const issues = [];
  const now = options.now ?? new Date();
  const maximumAgeHours = manifest.policy?.stagingEvidenceMaxAgeHours ?? 168;
  if (evidence?.schema !== 'nexyfab.slice-deployment-staging-evidence.v1') issues.push('staging_evidence_schema_invalid');
  const freshness = freshnessIssue(evidence?.recordedAt, now, maximumAgeHours, 'staging_evidence');
  if (freshness) issues.push(freshness);
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
    if (!target?.service || !/^[a-f0-9-]{36}$/.test(target?.deploymentId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(target?.imageDigest ?? '')) issues.push(`rollback_target_invalid:${target?.service ?? 'unknown'}`);
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

export function buildSliceDeploymentReceipt(manifest, root = ROOT, options = {}) {
  const now = options.now ?? new Date();
  const evaluation = evaluateSliceDeploymentReadiness(manifest, root);
  const verificationIssues = [];
  let head = null;
  try { head = gitHead(root); } catch { verificationIssues.push('git_head_unavailable'); }
  const contextFingerprints = {};
  for (const slice of manifest.slices ?? []) {
    try { contextFingerprints[slice.scope] = fingerprintSliceContext(root, slice.build.contextRoot); }
    catch { verificationIssues.push(`source_fingerprint_unavailable:${slice.scope}`); }
  }
  const localRuntimeEvidencePath = path.join(root, 'docs/evidence/platform-runtime/slice-local-runtime.json');
  const localRuntimeEvidence = fs.existsSync(localRuntimeEvidencePath) ? readJson(localRuntimeEvidencePath) : null;
  const localImages = options.verifyImages && localRuntimeEvidence ? inspectLocalImages(localRuntimeEvidence, root) : undefined;
  const localRuntime = localRuntimeEvidence
    ? {
        ...evaluateLocalRuntimeEvidence(localRuntimeEvidence, manifest, {
          now,
          contextFingerprints,
          requireCurrentSource: true,
          requireLocalImages: options.verifyImages === true,
          localImages,
        }),
        evidenceFile: path.relative(root, localRuntimeEvidencePath).replaceAll('\\', '/'),
      }
    : { ok: false, state: 'NOT_RUN', reason: 'isolated local runtime evidence is not available in this workspace' };
  const stagingEvidencePath = path.join(root, 'docs/evidence/platform-runtime/slice-deployment-staging.json');
  const stagingEvidence = fs.existsSync(stagingEvidencePath) ? readJson(stagingEvidencePath) : null;
  const staging = stagingEvidence
    ? { ...evaluateStagingEvidence(stagingEvidence, manifest, { now }), evidenceFile: path.relative(root, stagingEvidencePath).replaceAll('\\', '/') }
    : { ok: false, state: 'NOT_RUN', reason: 'live Cloudflare/Railway staging evidence is not available in this workspace' };
  const rollbackEvidencePath = path.join(root, 'docs/evidence/platform-runtime/slice-rollback-execution.json');
  const rollbackEvidence = fs.existsSync(rollbackEvidencePath) ? readJson(rollbackEvidencePath) : null;
  const rollback = stagingEvidence && rollbackEvidence
    ? {
        ...evaluateSliceRollbackEvidence(rollbackEvidence, stagingEvidence, {
          now,
          stagingSha256: sha256File(stagingEvidencePath),
          maximumAgeHours: manifest.policy?.rollbackEvidenceMaxAgeHours ?? 168,
        }),
        evidenceFile: path.relative(root, rollbackEvidencePath).replaceAll('\\', '/'),
        mechanism: rollbackEvidence.mechanism,
      }
    : { ok: false, state: 'NOT_RUN', reason: 'rollback execution evidence or live staging evidence is not available' };
  const blocked = verificationIssues.length > 0 || !evaluation.ok || !localRuntime.ok || !staging.ok || !rollback.ok;
  return {
    schema: 'nexyfab.slice-deployment-readiness-receipt.v2',
    generatedAt: now.toISOString(),
    gitHead: head,
    verification: {
      sourceBinding: verificationIssues.some(issue => issue.startsWith('source_fingerprint')) ? 'FAIL' : 'PASS',
      imageBinding: options.verifyImages ? (localRuntime.ok ? 'PASS' : 'FAIL') : 'NOT_REQUESTED',
      contexts: contextFingerprints,
      issues: verificationIssues,
    },
    local: evaluation,
    localRuntime,
    staging,
    rollback,
    status: blocked ? 'BLOCKED' : rollback.state === 'PASS' && staging.holds.length === 0 ? 'PASS' : 'HOLD',
  };
}

function main() {
  const allowed = new Set(['--write', '--check', '--require-pass', '--require-hold', '--verify-images']);
  const unknown = process.argv.slice(2).filter(argument => !allowed.has(argument));
  if (unknown.length) throw new Error(`slice_readiness_argument_unknown:${unknown.join(',')}`);
  const manifest = readJson(MANIFEST);
  const receipt = buildSliceDeploymentReceipt(manifest, ROOT, { verifyImages: process.argv.includes('--verify-images') });
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
    fs.writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes('--check') && receipt.status === 'BLOCKED') process.exitCode = 1;
  if (process.argv.includes('--require-pass') && receipt.status !== 'PASS') process.exitCode = 1;
  if (process.argv.includes('--require-hold') && receipt.status !== 'HOLD') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
