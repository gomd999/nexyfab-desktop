type BuildIdentityEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveBuildIdentity(env: BuildIdentityEnvironment, isDevelopment: boolean) {
  const explicitBuildId = env.NEXYFAB_BUILD_ID?.trim() ?? '';
  const gitCommit = env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? '';
  const deploymentId = env.RAILWAY_DEPLOYMENT_ID?.trim() ?? '';
  const configuredPublicRelease = env.NEXT_PUBLIC_RELEASE?.trim() ?? '';
  const fallback = isDevelopment ? 'dev' : 'unknown';

  return {
    buildId: explicitBuildId || gitCommit.slice(0, 12) || deploymentId || fallback,
    publicRelease: gitCommit.slice(0, 8) || explicitBuildId.slice(0, 8) || configuredPublicRelease || fallback,
  };
}
