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

function secretBound(value) {
  return typeof value === 'string' && value.trim().length >= 32;
}

function probeTimeout(env) {
  const value = Number.parseInt(env.NEXYFAB_DEPENDENCY_PROBE_TIMEOUT_MS ?? '2000', 10);
  return Number.isInteger(value) && value >= 100 && value <= 10000 ? value : 2000;
}

function probeMode(env) {
  return env.NEXYFAB_DEPENDENCY_PROBE_MODE?.trim().toLowerCase() || 'active';
}

async function probeHealth(baseUrl, env, fetcher, validate) {
  if (!isHttpUrl(baseUrl ?? '')) return { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (probeMode(env) !== 'active') return { state: 'HOLD', reason: 'active_probe_required' };
  try {
    const response = await fetcher(new URL('/healthz', baseUrl), {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(probeTimeout(env)),
    });
    const payload = await response.json();
    const reason = validate(payload);
    if (!response.ok || reason) return { state: 'FAIL', reason: reason || 'health_response_invalid', httpStatus: response.status };
    return { state: 'PASS', httpStatus: response.status };
  } catch {
    return { state: 'FAIL', reason: 'health_unreachable' };
  }
}

function resolveBuildId(env) {
  return env.NEXYFAB_BUILD_ID || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || 'unknown';
}

export async function evaluatePrecisionReadiness(env = process.env, fetcher = globalThis.fetch) {
  const bindings = {
    buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
    exactKernel: isHttpUrl(env.EXACT_KERNEL_URL ?? ''),
    exactKernelAuthToken: secretBound(env.EXACT_KERNEL_AUTH_TOKEN),
    jobControl: isHttpUrl(env.JOB_CONTROL_URL ?? ''),
    jobControlAuthToken: secretBound(env.JOB_CONTROL_AUTH_TOKEN),
    kernelIdentity: Boolean(env.EXACT_KERNEL_IDENTITY?.trim()),
    internalAuthToken: secretBound(env.INTERNAL_AUTH_TOKEN),
  };
  const blockers = Object.entries(bindings)
    .filter(([, bound]) => !bound)
    .map(([binding]) => `runtime_binding_missing_or_invalid:${binding}`);
  if (!['active', 'binding-only'].includes(probeMode(env))) blockers.push('dependency_probe_mode_invalid');
  const bindingReady = blockers.length === 0;
  const [exactKernel, jobControl] = bindingReady
    ? await Promise.all([
        probeHealth(env.EXACT_KERNEL_URL, env, fetcher, payload => {
          if (payload?.service !== 'exact-cad-kernel') return 'service_identity_mismatch';
          if (payload?.state !== 'ok' || payload?.exactExecution !== 'PASS') return 'exact_execution_not_ready';
          if (payload?.kernelIdentity !== env.EXACT_KERNEL_IDENTITY) return 'kernel_identity_mismatch';
          return null;
        }),
        probeHealth(env.JOB_CONTROL_URL, env, fetcher, payload => (
          payload?.service === 'job-control' && payload?.state === 'ok'
            ? null
            : 'job_control_not_ready'
        )),
      ])
    : [
        { state: 'NOT_RUN', reason: 'binding_invalid' },
        { state: 'NOT_RUN', reason: 'binding_invalid' },
      ];
  const dependencies = { exactKernel, jobControl };
  for (const [dependency, result] of Object.entries(dependencies)) {
    if (result.state !== 'PASS' && bindingReady) {
      blockers.push(`dependency_probe_failed:${dependency}:${result.reason}`);
    }
  }
  return { ready: blockers.length === 0, blockers, bindings, dependencies };
}

export async function buildPrecisionHealth(phase, env = process.env, now = new Date(), fetcher = globalThis.fetch) {
  const readiness = phase === 'live'
    ? {
        ready: false,
        blockers: [],
        bindings: {
          buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
          exactKernel: isHttpUrl(env.EXACT_KERNEL_URL ?? ''),
          exactKernelAuthToken: secretBound(env.EXACT_KERNEL_AUTH_TOKEN),
          jobControl: isHttpUrl(env.JOB_CONTROL_URL ?? ''),
          jobControlAuthToken: secretBound(env.JOB_CONTROL_AUTH_TOKEN),
          kernelIdentity: Boolean(env.EXACT_KERNEL_IDENTITY?.trim()),
          internalAuthToken: secretBound(env.INTERNAL_AUTH_TOKEN),
        },
        dependencies: {
          exactKernel: { state: 'NOT_RUN', reason: 'live_probe_skipped' },
          jobControl: { state: 'NOT_RUN', reason: 'live_probe_skipped' },
        },
      }
    : await evaluatePrecisionReadiness(env, fetcher);
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
    dependencies: readiness.dependencies,
    blockers: phase === 'live'
      ? []
      : phase === 'ready'
        ? readiness.blockers
        : ['deploy_disabled', 'occt_executor_not_extracted', 'manufacturing_release_blocked', ...readiness.blockers],
  };
}
