export interface LiveHealthPayload {
  status: 'ok';
  timestamp: string;
  build: string;
}

export function resolveBuildTag(env: NodeJS.ProcessEnv): string {
  return env.NEXYFAB_BUILD_ID
    || env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12)
    || env.NEXYFAB_BUILD_TAG
    || env.NEXT_PUBLIC_RELEASE
    || 'unknown';
}

export function buildLiveHealthPayload(
  env: NodeJS.ProcessEnv,
  now: Date = new Date(),
): LiveHealthPayload {
  return { status: 'ok', timestamp: now.toISOString(), build: resolveBuildTag(env) };
}
