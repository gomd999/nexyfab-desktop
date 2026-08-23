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

async function probeAnalysis(env, fetcher) {
  if (!isHttpUrl(env.ANALYSIS_URL ?? '')) return { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (probeMode(env) !== 'active') return { state: 'HOLD', reason: 'active_probe_required' };
  try {
    const response = await fetcher(new URL('/healthz', env.ANALYSIS_URL), {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(probeTimeout(env)),
    });
    const payload = await response.json();
    if (payload?.service !== 'analysis-worker') {
      return { state: 'FAIL', reason: 'service_identity_mismatch', httpStatus: response.status };
    }
    if (!response.ok || payload?.state !== 'ok' || payload?.aiQualification !== 'MODEL_NOT_RUN') {
      return { state: 'FAIL', reason: 'analysis_safe_state_invalid', httpStatus: response.status };
    }
    return { state: 'PASS', httpStatus: response.status, qualification: payload.aiQualification };
  } catch {
    return { state: 'FAIL', reason: 'analysis_unreachable' };
  }
}

function resolveBuildId(env) {
  return env.NEXYFAB_BUILD_ID || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || 'unknown';
}

export async function evaluateAiReadiness(env = process.env, fetcher = globalThis.fetch) {
  const liveModelDisabled = env.AI_LIVE_ENABLED?.trim().toLowerCase() === 'false';
  const bindings = {
    buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
    analysis: isHttpUrl(env.ANALYSIS_URL ?? ''),
    analysisAuthToken: secretBound(env.ANALYSIS_AUTH_TOKEN),
    liveModelDisabled,
  };
  const blockers = Object.entries(bindings)
    .filter(([, bound]) => !bound)
    .map(([binding]) => binding === 'liveModelDisabled'
      ? 'live_model_must_remain_disabled'
      : `runtime_binding_missing_or_invalid:${binding}`);
  if (!['active', 'binding-only'].includes(probeMode(env))) blockers.push('dependency_probe_mode_invalid');
  const bindingReady = blockers.length === 0;
  const analysis = bindingReady
    ? await probeAnalysis(env, fetcher)
    : { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (analysis.state !== 'PASS' && bindingReady) {
    blockers.push(`dependency_probe_failed:analysis:${analysis.reason}`);
  }
  return { ready: blockers.length === 0, blockers, bindings, dependencies: { analysis } };
}

export async function buildAiHealth(phase, env = process.env, now = new Date(), fetcher = globalThis.fetch) {
  const readiness = phase === 'live'
    ? {
        ready: false,
        blockers: [],
        bindings: {
          buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
          analysis: isHttpUrl(env.ANALYSIS_URL ?? ''),
          analysisAuthToken: secretBound(env.ANALYSIS_AUTH_TOKEN),
          liveModelDisabled: env.AI_LIVE_ENABLED?.trim().toLowerCase() === 'false',
        },
        dependencies: { analysis: { state: 'NOT_RUN', reason: 'live_probe_skipped' } },
      }
    : await evaluateAiReadiness(env, fetcher);
  const status = phase === 'live' || (phase === 'ready' && readiness.ready) ? 'ok' : 'hold';
  return {
    schema: 'nexyfab.slice-health.v1',
    scope: 'ai-design',
    unit: 'ai-domain-accuracy',
    phase,
    status,
    timestamp: now.toISOString(),
    build: resolveBuildId(env),
    contract: 'nexyfab.domain-accuracy-assessment.v1',
    implementationState: 'PARTIAL',
    deployEnabled: false,
    releaseEligible: false,
    bindings: readiness.bindings,
    dependencies: readiness.dependencies,
    blockers: phase === 'live'
      ? []
      : phase === 'ready'
        ? readiness.blockers
        : ['deploy_disabled', 'external_accuracy_evidence_incomplete', 'live_model_not_authorized', ...readiness.blockers],
  };
}
