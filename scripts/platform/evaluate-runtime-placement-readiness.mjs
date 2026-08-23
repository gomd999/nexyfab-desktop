import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function elapsedDays(from, through) {
  const start = Date.parse(from);
  const end = Date.parse(through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 86_400_000;
}

function sameMembers(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function passCheck(check) {
  return check?.status === 'PASS' && /^sha256:[0-9a-f]{64}$/i.test(check.receipt ?? '');
}

export function evaluateRuntimePlacementReadiness({ root = DEFAULT_ROOT, evidence, readLiveEvidence = true, now = new Date() } = {}) {
  const policy = readJson(path.join(root, 'config/platform/runtime-placement.v1.json'));
  const evidencePath = path.join(root, policy.liveEvidencePath);
  const observed = evidence ?? (readLiveEvidence && fs.existsSync(evidencePath) ? readJson(evidencePath) : null);
  const claims = [];

  if (!observed) {
    return {
      schema: 'nexyfab.runtime-placement-readiness.v1',
      status: 'HOLD',
      evidenceState: 'NOT_RUN',
      claims: policy.requiredLiveChecks.map((id) => ({ id, state: 'NOT_RUN', reason: 'live evidence file is absent' })),
      targetDeployments: policy.targetDeployments,
      evidencePath: policy.liveEvidencePath,
    };
  }

  if (observed.schema !== 'nexyfab.runtime-placement-evidence.v1') {
    claims.push({ id: 'evidence-schema', state: 'FAIL', reason: 'runtime evidence schema mismatch' });
  }

  const checks = new Map((observed.checks ?? []).map((check) => [check.id, check]));
  const duplicateChecks = (observed.checks ?? [])
    .map((check) => check.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  claims.push({
    id: 'unique-live-check-receipts',
    state: duplicateChecks.length === 0 ? 'PASS' : 'FAIL',
    reason: duplicateChecks.length === 0 ? 'live check ids are unique' : `duplicate live checks: ${[...new Set(duplicateChecks)].join(', ')}`,
  });
  for (const id of policy.requiredLiveChecks) {
    const check = checks.get(id);
    const valid = passCheck(check);
    claims.push({
      id,
      state: valid ? 'PASS' : check?.status === 'PASS' ? 'FAIL' : check?.status ?? 'NOT_RUN',
      reason: valid
        ? 'hash-addressed receipt recorded'
        : check?.status === 'PASS'
          ? 'PASS was claimed without a valid sha256 receipt'
          : check?.reason ?? 'required live check is missing',
    });
  }

  const days = elapsedDays(observed.observedFrom, observed.observedThrough);
  claims.push({
    id: 'observation-window',
    state: days !== null && days >= policy.observationPolicy.minimumConsecutiveDays && observed.unexplainedGaps === 0 ? 'PASS' : 'FAIL',
    reason: days === null
      ? 'invalid observation timestamps'
      : `${days.toFixed(2)} observed days; unexplained gaps=${observed.unexplainedGaps ?? 'missing'}`,
  });

  const latest = Date.parse(observed.lastSampleAt);
  const ageHours = (now.getTime() - latest) / 3_600_000;
  const freshnessPass = Number.isFinite(latest) && ageHours >= 0 && ageHours <= policy.observationPolicy.maximumEvidenceAgeHours;
  claims.push({
    id: 'latest-sample-freshness',
    state: freshnessPass ? 'PASS' : 'FAIL',
    reason: Number.isFinite(ageHours) ? `${ageHours.toFixed(2)} hours old` : 'lastSampleAt is missing or invalid',
  });

  claims.push({
    id: 'railway-service-allowlist',
    state: sameMembers(observed.activeRailwayServices ?? [], policy.targetDeployments.railway) ? 'PASS' : 'FAIL',
    reason: `active Railway services=${JSON.stringify(observed.activeRailwayServices ?? [])}`,
  });

  const before = observed.cost?.railwayMonthlyUsdBefore;
  const after = observed.cost?.railwayMonthlyUsdAfter;
  const totalAfter = observed.cost?.totalMonthlyUsdAfter;
  const costPass = Number.isFinite(before) && Number.isFinite(after) && Number.isFinite(totalAfter) && after < before;
  claims.push({
    id: 'measured-cost-reduction',
    state: costPass ? 'PASS' : 'FAIL',
    reason: costPass ? `Railway monthly USD ${before} -> ${after}; total=${totalAfter}` : 'measured before/after cost is missing or Railway cost did not decrease',
  });

  const forbidden = new Set(policy.forbiddenRailwayTargetsAfterCutover);
  const forbiddenActive = (observed.activeRailwayServices ?? []).filter((id) => forbidden.has(id));
  claims.push({
    id: 'forbidden-railway-targets-retired',
    state: forbiddenActive.length === 0 ? 'PASS' : 'FAIL',
    reason: forbiddenActive.length === 0 ? 'no forbidden target is active on Railway' : `still active: ${forbiddenActive.join(', ')}`,
  });

  const pass = claims.length > 0 && claims.every((claim) => claim.state === 'PASS');
  return {
    schema: 'nexyfab.runtime-placement-readiness.v1',
    status: pass ? 'PASS' : 'HOLD',
    evidenceState: pass ? 'PASS' : 'INCOMPLETE',
    claims,
    targetDeployments: policy.targetDeployments,
    evidencePath: policy.liveEvidencePath,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateRuntimePlacementReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS' && !process.argv.includes('--allow-hold')) process.exitCode = 1;
}
