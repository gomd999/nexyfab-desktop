export interface CommercialReadinessIssue {
  code: string;
  message: string;
}

type Env = Record<string, string | undefined>;

function has(env: Env, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function completeProvider(env: Env, keys: string[]): boolean {
  return keys.every((key) => has(env, key));
}

/**
 * Fail-closed configuration checks used when NEXYFAB_COMMERCIAL_MODE=1.
 * This intentionally checks capabilities rather than requiring every payment
 * provider: one complete provider is enough to sell, while half-configured
 * providers never count as ready.
 */
export function commercialReadinessIssues(env: Env): CommercialReadinessIssue[] {
  const issues: CommercialReadinessIssue[] = [];
  const requireKey = (key: string, code: string, reason: string): void => {
    if (!has(env, key)) issues.push({ code, message: `${key} is required: ${reason}` });
  };

  requireKey('DATABASE_URL', 'database.postgres_required', 'commercial traffic requires PostgreSQL');
  requireKey('REDIS_URL', 'rate_limit.redis_required', 'distributed rate limits and job state must be shared');
  if (env.OPENSCAD_EXTERNAL_WORKER !== '1') {
    issues.push({ code: 'cad_runtime.openscad_isolation_required', message: 'OPENSCAD_EXTERNAL_WORKER must be 1 so the web service never executes OpenSCAD directly' });
  }
  if (env.CAD_RUNTIME_EXTERNAL_WORKER !== '1') {
    issues.push({ code: 'cad_runtime.native_isolation_required', message: 'CAD_RUNTIME_EXTERNAL_WORKER must be 1 so Gmsh and Radiance execute only in the isolated worker' });
  }
  const hasUpstashUrl = has(env, 'UPSTASH_REDIS_REST_URL');
  const hasUpstashToken = has(env, 'UPSTASH_REDIS_REST_TOKEN');
  if (hasUpstashUrl !== hasUpstashToken) {
    issues.push({
      code: 'cad_rate_limit.redis_rest_pair_incomplete',
      message: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together when the optional REST fallback is used',
    });
  }
  if (env.NEXYFAB_CAD_INDEPENDENT_MODE !== '1') {
    issues.push({ code: 'cad_mode.independent_required', message: 'NEXYFAB_CAD_INDEPENDENT_MODE must be 1 so CAD quota failures are fail-closed' });
  }
  requireKey('S3_BUCKET', 'storage.bucket_required', 'customer CAD files must use durable object storage');
  requireKey('S3_ACCESS_KEY_ID', 'storage.access_key_required', 'object storage credentials are incomplete');
  requireKey('S3_SECRET_ACCESS_KEY', 'storage.secret_key_required', 'object storage credentials are incomplete');
  requireKey('CRON_SECRET', 'operations.cron_secret_required', 'recovery and backup jobs must be authenticated');
  requireKey('SMTP_HOST', 'notifications.smtp_required', 'transactional email must be deliverable');
  requireKey('SENTRY_DSN', 'observability.sentry_required', 'production exceptions must be captured');
  requireKey(
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    'deployment.server_actions_key_required',
    'rolling deployments need stable Server Action identifiers',
  );

  const paymentReady =
    completeProvider(env, ['TOSS_SECRET_KEY', 'TOSS_WEBHOOK_SECRET']) ||
    completeProvider(env, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) ||
    completeProvider(env, ['AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY', 'AIRWALLEX_WEBHOOK_SECRET']) ||
    completeProvider(env, ['DODO_API_KEY', 'DODO_WEBHOOK_SECRET']);
  if (!paymentReady) {
    issues.push({
      code: 'payments.provider_incomplete',
      message: 'At least one payment provider must have both API credentials and webhook verification configured',
    });
  }

  return issues;
}
