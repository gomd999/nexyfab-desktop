import { MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA } from './contract.mjs';

const IMMUTABLE_BUILD_ID_PATTERN = /^(?:[a-f0-9]{7,64}|sha256:[a-f0-9]{64})$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const INVALID_JOB_CANARY = Object.freeze({
  contractVersion: 'readiness-canary.invalid',
  jobId: '',
  tenantId: '',
  projectId: '',
  kind: 'READINESS_CANARY',
  inputArtifacts: [],
  requestedAt: '',
  requestedBy: '',
});
const INVALID_COMPUTE_CANARY = Object.freeze({
  contractVersion: 'readiness-canary.invalid',
  message: INVALID_JOB_CANARY,
  authorizationToken: '',
  artifactGatewayUrl: 'invalid:',
  inputArtifacts: [],
});

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

async function requestJson(baseUrl, pathname, env, fetcher, init = {}) {
  try {
    const response = await fetcher(new URL(pathname, baseUrl), {
      ...init,
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        ...init.headers,
      },
      signal: AbortSignal.timeout(probeTimeout(env)),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: 'response_invalid_json', httpStatus: response.status };
    }
    return { ok: response.ok, response, payload, httpStatus: response.status };
  } catch {
    return { ok: false, reason: 'dependency_unreachable' };
  }
}

async function probeDependency(baseUrl, authToken, env, fetcher, validateHealth, canaryCode, canaryBody) {
  if (!isHttpUrl(baseUrl ?? '')) return { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (probeMode(env) !== 'active') return { state: 'HOLD', reason: 'active_probe_required' };
  const health = await requestJson(baseUrl, '/healthz', env, fetcher, { method: 'GET' });
  if (!health.ok) {
    return { state: 'FAIL', reason: health.reason || 'health_response_invalid', httpStatus: health.httpStatus };
  }
  const healthReason = validateHealth(health.payload);
  if (healthReason) return { state: 'FAIL', reason: healthReason, httpStatus: health.httpStatus };

  // A deliberately invalid job is a side-effect-free authenticated canary:
  // 403 means the token was rejected, while the contract-level 422 proves the
  // request passed authentication without enqueueing or executing any work.
  const canary = await requestJson(baseUrl, '/v1/jobs', env, fetcher, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(canaryBody),
  });
  if (canary.httpStatus !== 422 || canary.payload?.code !== canaryCode) {
    return {
      state: 'FAIL',
      reason: 'dependency_authentication_not_verified',
      httpStatus: canary.httpStatus,
    };
  }
  return { state: 'PASS', httpStatus: health.httpStatus, authentication: 'VERIFIED' };
}

function resolveBuildId(env) {
  return env.NEXYFAB_BUILD_ID || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || 'unknown';
}

function immutableBuildBound(env) {
  return IMMUTABLE_BUILD_ID_PATTERN.test(resolveBuildId(env));
}

function exactKernelIdentityBound(env) {
  return SHA256_PATTERN.test(env.EXACT_KERNEL_IDENTITY?.trim() ?? '');
}

export async function evaluatePrecisionReadiness(env = process.env, fetcher = globalThis.fetch) {
  const bindings = {
    buildId: immutableBuildBound(env),
    exactKernel: isHttpUrl(env.EXACT_KERNEL_URL ?? ''),
    exactKernelAuthToken: secretBound(env.EXACT_KERNEL_AUTH_TOKEN),
    jobControl: isHttpUrl(env.JOB_CONTROL_URL ?? ''),
    jobControlAuthToken: secretBound(env.JOB_CONTROL_AUTH_TOKEN),
    kernelIdentity: exactKernelIdentityBound(env),
    internalAuthToken: secretBound(env.INTERNAL_AUTH_TOKEN),
  };
  const blockers = Object.entries(bindings)
    .filter(([, bound]) => !bound)
    .map(([binding]) => `runtime_binding_missing_or_invalid:${binding}`);
  if (!['active', 'binding-only'].includes(probeMode(env))) blockers.push('dependency_probe_mode_invalid');
  const bindingReady = blockers.length === 0;
  const [exactKernel, jobControl] = bindingReady
    ? await Promise.all([
        probeDependency(env.EXACT_KERNEL_URL, env.EXACT_KERNEL_AUTH_TOKEN, env, fetcher, payload => {
          if (payload?.ok !== true || payload?.service !== 'occt-exact') return 'service_identity_mismatch';
          if (payload?.execution !== 'NOT_RUN') return 'exact_health_contract_invalid';
          if (payload?.kernelIdentitySha256 !== env.EXACT_KERNEL_IDENTITY) return 'kernel_identity_mismatch';
          if (!SHA256_PATTERN.test(payload?.workerIdentitySha256 ?? '')) return 'worker_identity_invalid';
          return null;
        }, 'COMPUTE_REQUEST_REJECTED', INVALID_COMPUTE_CANARY),
        probeDependency(env.JOB_CONTROL_URL, env.JOB_CONTROL_AUTH_TOKEN, env, fetcher, payload => (
          payload?.ok === true && payload?.service === 'job-orchestrator' && payload?.deploymentState === 'RUNNING'
            ? null
            : 'job_control_not_ready'
        ), 'JOB_CONTRACT_REJECTED', INVALID_JOB_CANARY),
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
          buildId: immutableBuildBound(env),
          exactKernel: isHttpUrl(env.EXACT_KERNEL_URL ?? ''),
          exactKernelAuthToken: secretBound(env.EXACT_KERNEL_AUTH_TOKEN),
          jobControl: isHttpUrl(env.JOB_CONTROL_URL ?? ''),
          jobControlAuthToken: secretBound(env.JOB_CONTROL_AUTH_TOKEN),
          kernelIdentity: exactKernelIdentityBound(env),
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
