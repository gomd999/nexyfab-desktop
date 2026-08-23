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
  requireKey('GENERATION_EVIDENCE_SIGNING_SECRET', 'cad_release.evidence_signing_secret_required', 'commercial generation measurements must be server-signed');
  if (has(env, 'GENERATION_EVIDENCE_SIGNING_SECRET') && env.GENERATION_EVIDENCE_SIGNING_SECRET!.length < 32) {
    issues.push({ code: 'cad_release.evidence_signing_secret_weak', message: 'GENERATION_EVIDENCE_SIGNING_SECRET must contain at least 32 characters' });
  }
  requireKey('SMTP_HOST', 'notifications.smtp_required', 'transactional email must be deliverable');
  if (env.NEXYFAB_COMMERCIAL_MODE === '1') requireKey('ADMIN_BOOTSTRAP_EMAILS', 'admin.bootstrap_email_required', 'at least one passwordless administrator must be recoverable');
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

  if (env.NEXYFAB_COMMERCIAL_MODE === '1') {
    requireKey('NEXYFAB_BUILD_ID', 'deployment.build_id_required', 'commercial releases must bind readiness to an immutable build');
    if (!['enforce', 'strict'].includes(env.SECURITY_GATE_MODE?.trim().toLowerCase() ?? '')) issues.push({ code: 'security.mode_not_allowed', message: 'SECURITY_GATE_MODE must be enforce or strict in commercial mode' });
    requireKey('NEXYFAB_AGENT_APPROVAL_SECRET', 'approval.secret_required', 'server approvals must use a private secret');
    if (has(env, 'NEXYFAB_AGENT_APPROVAL_SECRET') && env.NEXYFAB_AGENT_APPROVAL_SECRET!.length < 32) issues.push({ code: 'approval.secret_weak', message: 'NEXYFAB_AGENT_APPROVAL_SECRET must contain at least 32 characters' });
    if (has(env, 'CRON_SECRET') && env.CRON_SECRET!.length < 32) issues.push({ code: 'operations.cron_secret_weak', message: 'CRON_SECRET must contain at least 32 characters' });
    requireKey('NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON', 'agentic.registry_required', 'exact three-role Ed25519 registry is required');
    if (env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE !== '1') issues.push({ code: 'agentic.execution_boundary_required', message: 'NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE must be 1' });
    requireKey('EXTERNAL_WORKER_ORCHESTRATOR_URL', 'worker.orchestrator_required', 'external native worker/orchestrator is required');
    requireKey('EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL', 'worker.health_required', 'readiness must probe the external worker independently');
    if (env.POSTGRES_MIGRATION_VERSION !== '2026082208') issues.push({ code: 'database.migration_version_required', message: 'Postgres migrations through 2026082208 must be applied' });
    for (const version of ['2026082202', '2026082203', '2026082204', '2026082205', '2026082206', '2026082207', '2026082208']) requireKey(`POSTGRES_MIGRATION_CHECKSUM_${version}`, `database.migration_${version}_checksum_required`, `migration ${version} checksum must be verified before GA`);
    requireKey('NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', 'worker.ed25519_registry_required', 'commercial worker Ed25519 public-key registry is required');
    requireKey('NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 'worker.claim_secret_required', 'commercial worker claim transport must be isolated from other internal APIs');
    requireKey('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 'worker.transport_secret_required', 'commercial job transport integrity is required');
    requireKey('NEXYFAB_COMMERCIAL_CALLBACK_SECRET', 'worker.callback_secret_required', 'commercial worker callback transport authentication is required');
    requireKey('NEXYFAB_COMMERCIAL_CALLBACK_URL', 'worker.callback_url_required', 'commercial worker callback target must be server-owned');
    requireKey('NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON', 'verifier.ed25519_registry_required', 'external verifier Ed25519 public-key registry is required');
    requireKey('NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET', 'verifier.transport_secret_required', 'external verifier transport authentication is required');
    requireKey('OBJECT_STORAGE_PRIVATE_BUCKET', 'storage.private_bucket_required', 'receipt bytes require private object storage');
  }

  return issues;
}
