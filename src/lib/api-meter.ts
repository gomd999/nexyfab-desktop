/**
 * meterApiCall — wrap any external API call so cost / latency / errors
 * land in nf_api_usage for the admin observability dashboard.
 *
 * Why: aiMeter only covers chat completions; Toss / Resend / R2 calls
 * have been invisible. Rolling everything through one wrapper means a
 * single query (`SELECT provider, COUNT(*), SUM(cost_usd) FROM
 * nf_api_usage WHERE called_at > now() - interval '24h' GROUP BY 1`)
 * answers "what did we spend on what?".
 *
 * Usage:
 *   const result = await meterApiCall(
 *     { provider: 'toss', endpoint: 'payments/confirm', userId },
 *     async () => tossClient.confirmPayment(...),
 *   );
 *
 * For AI calls with token + cost info, pass them in via the post-call
 * shape so the wrapper can record them:
 *   meterApiCall({ provider: 'anthropic', ... }, async () => {
 *     const r = await anthropic.messages.create(...);
 *     return { value: r, tokensIn: r.usage.input_tokens, tokensOut: r.usage.output_tokens, costUsd: ... };
 *   });
 *
 * Failures: write is fire-and-forget — a logging issue must never break
 * the actual API call path.
 */

import { randomUUID } from 'crypto';
import { getDbAdapter } from './db-adapter';

export interface MeterContext {
  provider: string;          // 'deepseek' | 'anthropic' | 'openai' | 'gemini' | 'toss' | 'resend' | 'r2' | …
  endpoint?: string;         // 'chat.completions', 'payments/confirm', 'mail.send', 'putObject', …
  feature?: string;          // 'shape-chat' | 'scad-agent' | 'rfq-writer' | 'order-payment' | …
  userId?: string;           // nf_users.id; omit if no user context
}

export interface MeterResultEnvelope<T> {
  value: T;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  statusCode?: number;       // override default 200/0
  cachedPromptTokens?: number;
  cacheWriteTokens?: number;
  cacheMissTokens?: number;
  cacheProfile?: string;
}

let usageTableEnsured = false;
async function ensureUsageTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (usageTableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_api_usage (
      id            TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      endpoint      TEXT,
      feature       TEXT,
      status_code   INTEGER,
      latency_ms    INTEGER NOT NULL,
      tokens_in     INTEGER,
      tokens_out    INTEGER,
      cached_tokens INTEGER,
      cache_write_tokens INTEGER,
      cache_miss_tokens INTEGER,
      cache_profile TEXT,
      cost_usd      REAL,
      user_id       TEXT,
      error_message TEXT,
      called_at     BIGINT NOT NULL
    )
  `).catch(() => {});
  // Existing installations predate cache accounting. Keep migrations
  // idempotent across SQLite and Postgres; duplicate-column errors are safe.
  await db.execute('ALTER TABLE nf_api_usage ADD COLUMN cached_tokens INTEGER').catch(() => {});
  await db.execute('ALTER TABLE nf_api_usage ADD COLUMN cache_write_tokens INTEGER').catch(() => {});
  await db.execute('ALTER TABLE nf_api_usage ADD COLUMN cache_miss_tokens INTEGER').catch(() => {});
  await db.execute('ALTER TABLE nf_api_usage ADD COLUMN cache_profile TEXT').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_api_usage_provider_time ON nf_api_usage(provider, called_at DESC)').catch(() => {});
  usageTableEnsured = true;
}

async function recordUsage(row: {
  provider: string; endpoint?: string; feature?: string;
  statusCode: number; latencyMs: number;
  tokensIn?: number; tokensOut?: number; costUsd?: number;
  cachedPromptTokens?: number; cacheWriteTokens?: number; cacheMissTokens?: number; cacheProfile?: string;
  userId?: string; errorMessage?: string;
}): Promise<void> {
  const db = getDbAdapter();
  await ensureUsageTable(db);
  await db.execute(
    `INSERT INTO nf_api_usage
      (id, provider, endpoint, feature, status_code, latency_ms,
       tokens_in, tokens_out, cached_tokens, cache_write_tokens,
       cache_miss_tokens, cache_profile, cost_usd, user_id, error_message, called_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `apu_${randomUUID()}`, row.provider,
    row.endpoint ?? null, row.feature ?? null,
    row.statusCode, row.latencyMs,
    row.tokensIn ?? null, row.tokensOut ?? null,
    row.cachedPromptTokens ?? null, row.cacheWriteTokens ?? null,
    row.cacheMissTokens ?? null, row.cacheProfile ?? null, row.costUsd ?? null,
    row.userId ?? null,
    row.errorMessage ? row.errorMessage.slice(0, 500) : null,
    Date.now(),
  ).catch(err => console.warn('[api-meter] write failed:', err));
}

/**
 * Wrap a plain async call (no token/cost reporting). The wrapper records
 * latency + status_code (200 on success, 0 on throw). Best for non-AI
 * APIs like Toss / Resend / R2.
 */
export async function meterApiCall<T>(
  ctx: MeterContext,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const value = await fn();
    void recordUsage({
      provider: ctx.provider,
      endpoint: ctx.endpoint,
      feature: ctx.feature,
      statusCode: 200,
      latencyMs: Date.now() - t0,
      userId: ctx.userId,
    });
    return value;
  } catch (err) {
    void recordUsage({
      provider: ctx.provider,
      endpoint: ctx.endpoint,
      feature: ctx.feature,
      statusCode: 0,
      latencyMs: Date.now() - t0,
      userId: ctx.userId,
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Like meterApiCall but for AI calls where the response carries token /
 * cost info. The inner fn must return a `MeterResultEnvelope<T>` so the
 * wrapper can extract those fields. The unwrapped value is returned to
 * the caller.
 */
export async function meterAiCall<T>(
  ctx: MeterContext,
  fn: () => Promise<MeterResultEnvelope<T>>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const env = await fn();
    void recordUsage({
      provider: ctx.provider,
      endpoint: ctx.endpoint,
      feature: ctx.feature,
      statusCode: env.statusCode ?? 200,
      latencyMs: Date.now() - t0,
      tokensIn: env.tokensIn,
      tokensOut: env.tokensOut,
      costUsd: env.costUsd,
      cachedPromptTokens: env.cachedPromptTokens,
      cacheWriteTokens: env.cacheWriteTokens,
      cacheMissTokens: env.cacheMissTokens,
      cacheProfile: env.cacheProfile,
      userId: ctx.userId,
    });
    return env.value;
  } catch (err) {
    void recordUsage({
      provider: ctx.provider,
      endpoint: ctx.endpoint,
      feature: ctx.feature,
      statusCode: 0,
      latencyMs: Date.now() - t0,
      userId: ctx.userId,
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Direct-write path for callers that already have token/cost data and
 * just want to log it (e.g. existing aiMeter usage that we don't want
 * to refactor). Always returns immediately — write is fire-and-forget.
 */
export function recordApiUsage(args: {
  provider: string; endpoint?: string; feature?: string;
  statusCode: number; latencyMs: number;
  tokensIn?: number; tokensOut?: number; costUsd?: number;
  cachedPromptTokens?: number; cacheWriteTokens?: number; cacheMissTokens?: number; cacheProfile?: string;
  userId?: string; errorMessage?: string;
}): void {
  void recordUsage(args);
}
