import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGING = path.join(ROOT, 'docs/evidence/platform-runtime/slice-deployment-staging.json');
const EVIDENCE = path.join(ROOT, 'docs/evidence/platform-runtime/slice-rollback-execution.json');
export const SLICE_ROLLBACK_SCHEMA = 'nexyfab.slice-rollback-execution.v2';
export const STAGING_EVIDENCE_CANONICALIZATION = 'utf8-crlf-to-lf';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function sha256File(file) {
  const bytes = fs.readFileSync(file);
  const canonical = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
  return createHash('sha256').update(canonical).digest('hex');
}

function validObservation(observation, expected, prefix, issues) {
  if (observation?.deploymentId !== expected.deploymentId) issues.push(`${prefix}_deployment_mismatch`);
  if (observation?.imageDigest !== expected.imageDigest) issues.push(`${prefix}_digest_mismatch`);
  if (observation?.health !== 'PASS') issues.push(`${prefix}_health_not_passed`);
  if (!Number.isFinite(Date.parse(observation?.observedAt ?? ''))) issues.push(`${prefix}_timestamp_invalid`);
}

export function buildRollbackTemplate(staging, stagingSha256, now = new Date()) {
  const current = new Map((staging.scopes ?? []).flatMap(scope => scope.services ?? []).map(service => [service.name, service]));
  return {
    schema: SLICE_ROLLBACK_SCHEMA,
    recordedAt: now.toISOString(),
    environment: { provider: staging.environment?.provider, name: staging.environment?.name },
    mechanism: staging.rollback?.mechanism,
    stagingEvidenceSha256: stagingSha256,
    stagingEvidenceCanonicalization: STAGING_EVIDENCE_CANONICALIZATION,
    execution: 'NOT_RUN',
    reason: 'Native staging rollback drill has not been executed. Use the captured immutable targets, verify rollback health, then restore and verify the current deployment.',
    targets: (staging.rollback?.targets ?? []).map(target => {
      const deployed = current.get(target.service);
      return {
        service: target.service,
        execution: 'NOT_RUN',
        currentDeployment: { deploymentId: deployed?.deploymentId, imageDigest: deployed?.imageDigest },
        rollbackTarget: { deploymentId: target.deploymentId, imageDigest: target.imageDigest },
        rollbackObservation: null,
        restoreObservation: null,
      };
    }),
  };
}

export function evaluateSliceRollbackEvidence(evidence, staging, options = {}) {
  const issues = [];
  if (evidence?.schema !== SLICE_ROLLBACK_SCHEMA) issues.push('rollback_evidence_schema_invalid');
  if (evidence?.environment?.provider !== staging?.environment?.provider || evidence?.environment?.name !== staging?.environment?.name) issues.push('rollback_environment_mismatch');
  if (evidence?.mechanism !== staging?.rollback?.mechanism) issues.push('rollback_mechanism_mismatch');
  if (!/^[a-f0-9]{64}$/.test(evidence?.stagingEvidenceSha256 ?? '')) issues.push('rollback_staging_digest_invalid');
  if (evidence?.stagingEvidenceCanonicalization !== STAGING_EVIDENCE_CANONICALIZATION) issues.push('rollback_staging_canonicalization_invalid');
  if (options.stagingSha256 && evidence?.stagingEvidenceSha256 !== options.stagingSha256) issues.push('rollback_staging_digest_mismatch');
  if (!['NOT_RUN', 'PASS'].includes(evidence?.execution)) issues.push('rollback_execution_state_invalid');
  const current = new Map((staging?.scopes ?? []).flatMap(scope => scope.services ?? []).map(service => [service.name, service]));
  const previous = new Map((staging?.rollback?.targets ?? []).map(target => [target.service, target]));
  const targets = Array.isArray(evidence?.targets) ? evidence.targets : [];
  if (targets.length !== previous.size || previous.size !== 7) issues.push('rollback_execution_targets_incomplete');
  const observed = new Set();
  for (const target of targets) {
    if (!target?.service || observed.has(target.service)) {
      issues.push(`rollback_execution_service_missing_or_duplicate:${target?.service ?? 'missing'}`);
      continue;
    }
    observed.add(target.service);
    const deployed = current.get(target.service);
    const rollback = previous.get(target.service);
    if (!deployed || !rollback) {
      issues.push(`rollback_execution_service_unknown:${target.service}`);
      continue;
    }
    if (target.currentDeployment?.deploymentId !== deployed.deploymentId || target.currentDeployment?.imageDigest !== deployed.imageDigest) issues.push(`rollback_current_binding_mismatch:${target.service}`);
    if (target.rollbackTarget?.deploymentId !== rollback.deploymentId || target.rollbackTarget?.imageDigest !== rollback.imageDigest) issues.push(`rollback_target_binding_mismatch:${target.service}`);
    if (evidence.execution === 'NOT_RUN') {
      if (target.execution !== 'NOT_RUN' || target.rollbackObservation !== null || target.restoreObservation !== null) issues.push(`rollback_not_run_state_invalid:${target.service}`);
    } else {
      if (target.execution !== 'PASS') issues.push(`rollback_target_not_passed:${target.service}`);
      validObservation(target.rollbackObservation, rollback, `rollback_observation:${target.service}`, issues);
      validObservation(target.restoreObservation, deployed, `restore_observation:${target.service}`, issues);
    }
  }
  for (const service of previous.keys()) if (!observed.has(service)) issues.push(`rollback_execution_service_missing:${service}`);
  if (evidence?.execution === 'NOT_RUN' && !evidence?.reason?.trim()) issues.push('rollback_not_run_reason_missing');
  if (evidence?.execution === 'PASS') {
    const timestamp = Date.parse(evidence.recordedAt ?? '');
    const now = (options.now ?? new Date()).getTime();
    const maximumAgeHours = options.maximumAgeHours ?? 168;
    if (!Number.isFinite(timestamp)) issues.push('rollback_recorded_at_invalid');
    else if (now - timestamp > maximumAgeHours * 60 * 60_000) issues.push('rollback_evidence_stale');
    else if (timestamp - now > 5 * 60_000) issues.push('rollback_recorded_at_in_future');
  }
  return {
    ok: issues.length === 0,
    state: issues.length ? 'INVALID' : evidence?.execution === 'PASS' ? 'PASS' : 'READY_NOT_EXECUTED',
    issues,
    holds: evidence?.execution === 'PASS' ? [] : ['native_staging_rollback_not_executed'],
    targetCount: targets.length,
  };
}

function main() {
  const allowed = new Set(['--check', '--require-pass', '--print-template']);
  const unknown = process.argv.slice(2).filter(argument => !allowed.has(argument));
  if (unknown.length) throw new Error(`slice_rollback_argument_unknown:${unknown.join(',')}`);
  const staging = readJson(STAGING);
  const stagingSha256 = sha256File(STAGING);
  if (process.argv.includes('--print-template')) {
    process.stdout.write(`${JSON.stringify(buildRollbackTemplate(staging, stagingSha256), null, 2)}\n`);
    return;
  }
  if (!fs.existsSync(EVIDENCE)) throw new Error('slice_rollback_evidence_missing');
  const result = evaluateSliceRollbackEvidence(readJson(EVIDENCE), staging, { stagingSha256 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.argv.includes('--check') && !result.ok) process.exitCode = 1;
  if (process.argv.includes('--require-pass') && result.state !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
