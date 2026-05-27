// Standard rate-limit wrapper for API routes. Single import + decorator
// keeps key naming, IP extraction, and 429 response format consistent
// across the codebase. Reaches for the user id when available, falls back
// to trusted client IP so anonymous abuse still gets caught.

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from './rate-limit';
import { getTrustedClientIp } from './client-ip';
import { getAuthUser } from './auth-middleware';

export interface RateLimitConfig {
  /** Unique prefix for this endpoint, e.g. 'ai-chat'. */
  key: string;
  /** Max requests per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Custom 429 message. */
  message?: string;
  /** Bucket by user id if logged in, otherwise by IP. Default true. */
  perUser?: boolean;
}

/**
 * Wrap an API handler with rate limiting. Returns 429 with Retry-After when
 * the bucket is exhausted; otherwise calls through. Use at the very top of
 * the handler so we don't waste DB/LLM cost on rejected requests.
 *
 * Usage:
 *   export const POST = withRateLimit(
 *     { key: 'ai-chat', max: 30, windowMs: 60_000 },
 *     async (req) => { ... your handler ... },
 *   );
 */
export function withRateLimit<R extends NextResponse | Response>(
  config: RateLimitConfig,
  handler: (req: NextRequest) => Promise<R>,
): (req: NextRequest) => Promise<R | NextResponse> {
  return async (req: NextRequest) => {
    const ip = getTrustedClientIp(req.headers);
    let bucketId = ip;
    if (config.perUser !== false) {
      // Best-effort user lookup — failure (anonymous user) falls back to IP.
      try {
        const u = await getAuthUser(req);
        if (u?.userId) bucketId = u.userId;
      } catch { /* ignore */ }
    }
    const bucket = `${config.key}:${bucketId}`;
    const result = rateLimit(bucket, config.max, config.windowMs);
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: config.message ?? 'Too many requests. Slow down.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(config.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
          },
        },
      );
    }
    const res = await handler(req);
    // Decorate successful responses with rate-limit headers so clients can
    // back off proactively. Tolerate readonly Headers (e.g. error responses).
    try {
      res.headers.set('X-RateLimit-Limit', String(config.max));
      res.headers.set('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
      res.headers.set('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
    } catch { /* immutable headers — skip */ }
    return res;
  };
}

/**
 * Conventional limits for common API categories. Use as a starting point;
 * tune individual endpoints via the explicit config form when needed.
 */
export const RATE_LIMITS = {
  ai_inference:   { max: 30,  windowMs: 60_000 },     // LLM / scad-agent — 30/min
  ai_render:      { max: 10,  windowMs: 60_000 },     // openscad-render / image gen — 10/min
  billing_action: { max: 20,  windowMs: 60_000 },     // checkout, plan change — 20/min
  billing_query:  { max: 60,  windowMs: 60_000 },     // GET subscription / invoices
  auth_action:    { max: 10,  windowMs: 5 * 60_000 }, // login / signup / pw reset
  public_api:     { max: 100, windowMs: 60_000 },     // /api/public/v1/*
  cron:           { max: 6,   windowMs: 60_000 },     // cron triggers — internal
} as const;
