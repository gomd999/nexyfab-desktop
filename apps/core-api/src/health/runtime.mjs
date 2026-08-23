const BUILD_ID_PATTERN = /^(?!unknown$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function probeTimeout(env) {
  const value = Number.parseInt(env.NEXYFAB_DEPENDENCY_PROBE_TIMEOUT_MS ?? '2000', 10);
  return Number.isInteger(value) && value >= 100 && value <= 10000 ? value : 2000;
}

function probeMode(env) {
  return env.NEXYFAB_DEPENDENCY_PROBE_MODE?.trim().toLowerCase() || 'active';
}

async function probeLegacyNext(env, fetcher) {
  if (!isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? '')) return { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (probeMode(env) !== 'active') return { state: 'HOLD', reason: 'active_probe_required' };
  try {
    const endpoint = new URL('/api/health/ready', env.LEGACY_NEXT_ORIGIN);
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(probeTimeout(env)),
    });
    const payload = await response.json();
    if (!response.ok || payload?.status !== 'ok') {
      return { state: 'FAIL', reason: 'legacy_ready_response_invalid', httpStatus: response.status };
    }
    return { state: 'PASS', httpStatus: response.status };
  } catch {
    return { state: 'FAIL', reason: 'legacy_ready_unreachable' };
  }
}

export function resolveRuntimeBuildId(env = process.env) {
  return env.NEXYFAB_BUILD_ID
    || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12)
    || env.NEXYFAB_BUILD_TAG
    || 'unknown';
}

export async function evaluateCoreApiReadiness(env = process.env, fetcher = globalThis.fetch) {
  const build = resolveRuntimeBuildId(env);
  const blockers = [];
  if (!BUILD_ID_PATTERN.test(build)) blockers.push('build_id_missing_or_invalid');
  if (!isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? '')) blockers.push('legacy_next_origin_missing_or_invalid');
  if (!['active', 'binding-only'].includes(probeMode(env))) blockers.push('dependency_probe_mode_invalid');
  const legacyNext = blockers.length === 0
    ? await probeLegacyNext(env, fetcher)
    : { state: 'NOT_RUN', reason: 'binding_invalid' };
  if (legacyNext.state !== 'PASS' && isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? '')) {
    blockers.push(`dependency_probe_failed:legacyNext:${legacyNext.reason}`);
  }
  return {
    ready: blockers.length === 0,
    blockers,
    bindings: {
      buildId: BUILD_ID_PATTERN.test(build),
      legacyNextOrigin: isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? ''),
    },
    dependencies: { legacyNext },
  };
}

export async function buildCoreApiHealth(phase, env = process.env, now = new Date(), fetcher = globalThis.fetch) {
  const readiness = phase === 'live'
    ? {
        ready: false,
        blockers: [],
        bindings: {
          buildId: BUILD_ID_PATTERN.test(resolveRuntimeBuildId(env)),
          legacyNextOrigin: isHttpUrl(env.LEGACY_NEXT_ORIGIN ?? ''),
        },
        dependencies: { legacyNext: { state: 'NOT_RUN', reason: 'live_probe_skipped' } },
      }
    : await evaluateCoreApiReadiness(env, fetcher);
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
    dependencies: readiness.dependencies,
    blockers: phase === 'live' ? [] : phase === 'ready' ? readiness.blockers : releaseBlockers,
  };
}
