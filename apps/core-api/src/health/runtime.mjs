const BUILD_ID_PATTERN = /^(?!unknown$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function resolveRuntimeBuildId(env = process.env) {
  return env.NEXYFAB_BUILD_ID
    || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12)
    || env.NEXYFAB_BUILD_TAG
    || 'unknown';
}

export function evaluateCoreApiReadiness(env = process.env) {
  const build = resolveRuntimeBuildId(env);
  const blockers = [];
  if (!BUILD_ID_PATTERN.test(build)) blockers.push('build_id_missing_or_invalid');
  if (!isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? '')) blockers.push('legacy_next_origin_missing_or_invalid');
  return {
    ready: blockers.length === 0,
    blockers,
    bindings: {
      buildId: BUILD_ID_PATTERN.test(build),
      legacyNextOrigin: isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? ''),
    },
  };
}

export function buildCoreApiHealth(phase, env = process.env, now = new Date()) {
  const readiness = evaluateCoreApiReadiness(env);
  const releaseBlockers = [
    'deploy_disabled',
    'legacy_route_compatibility_not_promoted',
    ...readiness.blockers,
  ];
  const isLive = phase === 'live';
  const isReady = phase === 'ready' && readiness.ready;
  return {
    schema: 'nexyfab.slice-health.v1',
    scope: 'platform',
    unit: 'core-api',
    phase,
    status: isLive || isReady ? 'ok' : 'hold',
    timestamp: now.toISOString(),
    build: resolveRuntimeBuildId(env),
    implementationState: 'COMPATIBILITY_BOUNDARY',
    deployEnabled: false,
    releaseEligible: false,
    bindings: readiness.bindings,
    blockers: phase === 'live' ? [] : phase === 'ready' ? readiness.blockers : releaseBlockers,
  };
}
