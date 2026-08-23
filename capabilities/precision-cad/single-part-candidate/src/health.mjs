import { MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA } from './contract.mjs';

const BUILD_ID_PATTERN = /^(?!unknown$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveBuildId(env) {
  return env.NEXYFAB_BUILD_ID || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || 'unknown';
}

export function evaluatePrecisionReadiness(env = process.env) {
  const bindings = {
    buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
    exactCad: isHttpUrl(env.EXACT_CAD_URL ?? ''),
    jobControl: isHttpUrl(env.JOB_CONTROL_URL ?? ''),
    kernelIdentity: Boolean(env.EXACT_KERNEL_IDENTITY?.trim()),
  };
  const blockers = Object.entries(bindings)
    .filter(([, bound]) => !bound)
    .map(([binding]) => `runtime_binding_missing_or_invalid:${binding}`);
  return { ready: blockers.length === 0, blockers, bindings };
}

export function buildPrecisionHealth(phase, env = process.env, now = new Date()) {
  const readiness = evaluatePrecisionReadiness(env);
  const status = phase === 'live' || (phase === 'ready' && readiness.ready) ? 'ok' : 'hold';
  return {
    schema: 'nexyfab.slice-health.v1',
    scope: 'precision-cad',
    unit: 'precision-single-part-candidate',
    phase,
    status,
    timestamp: now.toISOString(),
    build: resolveBuildId(env),
    contract: MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
    implementationState: 'PARTIAL',
    deployEnabled: false,
    releaseEligible: false,
    bindings: readiness.bindings,
    blockers: phase === 'live'
      ? []
      : phase === 'ready'
        ? readiness.blockers
        : ['deploy_disabled', 'occt_executor_not_extracted', 'manufacturing_release_blocked', ...readiness.blockers],
  };
}
