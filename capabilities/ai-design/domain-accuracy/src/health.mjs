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

export function evaluateAiReadiness(env = process.env) {
  const liveModelDisabled = !['1', 'true', 'yes', 'on'].includes((env.AI_LIVE_MODEL_ENABLED ?? 'false').toLowerCase());
  const bindings = {
    buildId: BUILD_ID_PATTERN.test(resolveBuildId(env)),
    analysis: isHttpUrl(env.ANALYSIS_URL ?? ''),
    analysisRevision: Boolean(env.ANALYSIS_API_REVISION?.trim()),
    liveModelDisabled,
  };
  const blockers = Object.entries(bindings)
    .filter(([, bound]) => !bound)
    .map(([binding]) => binding === 'liveModelDisabled'
      ? 'live_model_must_remain_disabled'
      : `runtime_binding_missing_or_invalid:${binding}`);
  return { ready: blockers.length === 0, blockers, bindings };
}

export function buildAiHealth(phase, env = process.env, now = new Date()) {
  const readiness = evaluateAiReadiness(env);
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
    blockers: phase === 'live'
      ? []
      : phase === 'ready'
        ? readiness.blockers
        : ['deploy_disabled', 'external_accuracy_evidence_incomplete', 'live_model_not_authorized', ...readiness.blockers],
  };
}
