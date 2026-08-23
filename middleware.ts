import { NextRequest, NextResponse } from 'next/server';
import { getTrustedClientIp } from '@/lib/client-ip';
import { canonicalizeLocalePath } from '@/lib/i18n/normalize';

// ─── JWT verification (inlined for edge runtime compatibility) ─────────────────
// Cannot import from src/lib/jwt.ts in edge middleware — no Node.js crypto.
// Uses Web Crypto API (crypto.subtle) which is available on all edge runtimes.

const DEV_JWT_FALLBACKS = [
  'nexyfab-dev-secret-change-in-production',
  'nexyfab-dev-secret-change-in-production-32ch',
];
const JWT_SECRET_RAW = process.env.JWT_SECRET ?? DEV_JWT_FALLBACKS[0];
const JWT_SECRET_IS_INSECURE =
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_SECRET || DEV_JWT_FALLBACKS.includes(JWT_SECRET_RAW));
const JWT_SECRET = JWT_SECRET_RAW;

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(pad);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

interface JWTUser {
  userId: string;
  email: string;
  plan: string;
  emailVerified: boolean;
  service?: string;
}

async function verifyJWT(token: string): Promise<JWTUser | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64urlDecode(sigB64);
    // Ensure a plain ArrayBuffer (not SharedArrayBuffer) for crypto.subtle.verify
    const sigBuffer =
      sigBytes.buffer instanceof ArrayBuffer
        ? sigBytes.buffer
        : new Uint8Array(sigBytes).buffer;

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      new TextEncoder().encode(signingInput)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as {
      sub?: string;
      userId?: string;
      email?: string;
      plan?: string;
      emailVerified?: boolean;
      service?: string;
      exp?: number;
    };

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return {
      userId: payload.sub ?? payload.userId ?? '',
      email: payload.email ?? '',
      plan: payload.plan ?? 'free',
      emailVerified: payload.emailVerified === true,
      service: payload.service,
    };
  } catch {
    return null;
  }
}

// ─── Edge-compatible Rate Limiter ──────────────────────────────────────────────
// In-memory sliding window. Works per-instance (not cross-instance).
// For cross-instance protection, the per-route rateLimit() in Node.js runtime
// syncs with Redis. This middleware layer provides first-line defense.

const rlStore = new Map<string, { count: number; resetAt: number }>();
const RL_MAX_KEYS = 20_000;

// Cleanup every 3 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rlStore) {
      if (now > v.resetAt) rlStore.delete(k);
    }
  }, 180_000);
}

function edgeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rlStore.get(key);

  if (!entry || now > entry.resetAt) {
    if (!entry && rlStore.size >= RL_MAX_KEYS) {
      // Evict oldest 10%
      const sorted = [...rlStore.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (let i = 0; i < 2000; i++) rlStore.delete(sorted[i][0]);
    }
    rlStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

type CadQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  backend: 'upstash-rest' | 'memory';
  unavailable?: boolean;
};

async function cadAccountRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<CadQuotaResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const strict = process.env.NEXYFAB_CAD_INDEPENDENT_MODE === '1';
  if (!url || !token) {
    if (strict) {
      return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, backend: 'memory', unavailable: true };
    }
    return { ...edgeRateLimit(key, max, windowMs), backend: 'memory' };
  }

  const script = [
    "local current = redis.call('INCR', KEYS[1])",
    "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
    "local ttl = redis.call('PTTL', KEYS[1])",
    'return {current, ttl}',
  ].join('\n');
  try {
    const response = await fetch(`${url}/eval`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify([script, '1', key, String(windowMs)]),
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) throw new Error(`UPSTASH_${response.status}`);
    const value = await response.json() as { result?: [number | string, number | string] };
    const count = Number(value.result?.[0]);
    const ttl = Number(value.result?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('UPSTASH_INVALID_RESULT');
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: Date.now() + Math.max(0, ttl),
      backend: 'upstash-rest',
    };
  } catch (cause) {
    console.error('[middleware] distributed CAD quota unavailable:', cause);
    if (strict) {
      return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, backend: 'upstash-rest', unavailable: true };
    }
    return { ...edgeRateLimit(key, max, windowMs), backend: 'memory' };
  }
}

function getClientIp(req: NextRequest): string {
  return getTrustedClientIp(req.headers);
}

// Rate limit tiers: [maxRequests, windowMs]
type RLTier = [number, number];

const RL_TIERS: { prefixes: string[]; tier: RLTier }[] = [
  // Auth — strict (brute force prevention)
  { prefixes: ['/api/auth/login', '/api/auth/signup', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/cross-login', '/api/auth/cross-signup'], tier: [10, 60_000] },
  // Cross-service token verification (higher limit, server-to-server)
  { prefixes: ['/api/auth/verify-token'], tier: [200, 60_000] },
  // OAuth callbacks
  { prefixes: ['/api/auth/oauth/'], tier: [15, 60_000] },
  // 2FA
  { prefixes: ['/api/auth/2fa/'], tier: [10, 60_000] },
  // Billing / payment — moderate
  { prefixes: ['/api/billing/checkout', '/api/billing/refund', '/api/billing/retry', '/api/billing/toss', '/api/stripe/create-checkout-session'], tier: [20, 60_000] },
  // File uploads — moderate
  { prefixes: ['/api/partner/upload', '/api/quick-quote/upload', '/api/nexyfab/files'], tier: [15, 60_000] },
  // CAD compute is authenticated below; keep an edge-level abuse ceiling too.
  { prefixes: ['/api/cad/v1'], tier: [120, 60_000] },
  // Admin — relaxed (already auth-gated)
  { prefixes: ['/api/admin'], tier: [60, 60_000] },
  // Email / notifications
  { prefixes: ['/api/send-mail', '/api/auth/send-verification'], tier: [5, 60_000] },
  // Account deletion
  { prefixes: ['/api/auth/delete-account'], tier: [3, 60_000] },
];

const RL_DEFAULT: RLTier = [100, 60_000]; // general API: 100 req/min

function getRateLimitTier(pathname: string): RLTier {
  for (const { prefixes, tier } of RL_TIERS) {
    if (prefixes.some(p => pathname.startsWith(p))) return tier;
  }
  return RL_DEFAULT;
}

// ─── CORS allowed origins (parsed at startup) ────────────────────────────────
const CORS_ORIGINS_RAW = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',').map(o => o.trim()).filter(Boolean);

// Default-deny is already enforced (no CORS headers when list is empty),
// but warn loudly in production so missing env doesn't silently break the SPA.
if (process.env.NODE_ENV === 'production' && CORS_ORIGINS_RAW.length === 0) {
  console.warn(
    '[middleware] CORS_ALLOWED_ORIGINS is empty in production — all cross-origin requests will be blocked.',
  );
}

// ─── Route classification ──────────────────────────────────────────────────────

/**
 * API prefixes that require a valid JWT.
 * Order does not matter — all are checked with startsWith().
 */
const PROTECTED_PREFIXES = [
  // CAD compute and release evidence. Read-only capability discovery is
  // explicitly exempted below.
  '/api/cad/v1',
  // NexyFab core features
  '/api/nexyfab/projects',
  '/api/nexyfab/rfq',
  '/api/nexyfab/collab',
  '/api/nexyfab/audit',
  '/api/nexyfab/comments',
  '/api/nexyfab/orders',
  '/api/nexyfab/manufacturers',
  // Stripe — only the session creation endpoint; webhook is excluded (no Bearer token)
  '/api/stripe/create-checkout-session',
  // Auth management (not login/signup/refresh)
  '/api/auth/account',
  '/api/auth/logout',
  // Admin / financial
  '/api/admin',
  '/api/contracts',
  '/api/settlements',
  // Partner portal (except /api/partner/auth — see PARTNER_AUTH_EXEMPT below)
  '/api/partner',
];

/**
 * Routes that require the user's email to be verified.
 * These are sensitive actions (payments, ordering, RFQ submission).
 */
const EMAIL_VERIFIED_REQUIRED = [
  '/api/nexyfab/rfq',
  '/api/stripe/create-checkout-session',
  '/api/nexyfab/orders',
];

/**
 * Among the protected prefixes above, these additionally require the
 * x-admin-secret header to match ADMIN_SECRET (user plan alone is not enough).
 * Partner routes (/api/partner/**) are intentionally excluded — they only need a valid JWT.
 */
const ADMIN_ONLY_PREFIXES = [
  '/api/admin',
  '/api/contracts',
  '/api/settlements',
];

/**
 * Sub-paths that are public even though their parent is protected.
 */
const PARTNER_AUTH_EXEMPT = '/api/partner/auth';

// ─── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const canonicalPath = canonicalizeLocalePath(pathname);
  if (canonicalPath !== pathname) {
    const destination = req.nextUrl.clone();
    destination.pathname = canonicalPath;
    return NextResponse.redirect(destination, 308);
  }

  // Only handle API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ── CORS: dynamic origin matching for multi-product ────────────────────────
  const origin = req.headers.get('origin');
  let corsHeaders: Record<string, string> = {};
  if (origin && CORS_ORIGINS_RAW.length > 0 && CORS_ORIGINS_RAW.includes(origin)) {
    corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token, x-admin-secret',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    };
  }

  // Handle preflight
  if (req.method === 'OPTIONS' && Object.keys(corsHeaders).length > 0) {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  // ── Webhook bypass — webhooks use signature verification, not rate limiting ──
  if (
    pathname === '/api/billing/webhook' ||
    pathname === '/api/stripe/webhook' ||
    pathname === '/api/webhooks/dodo'
  ) {
    return NextResponse.next();
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const clientIp = getClientIp(req);
  const [rlMax, rlWindow] = getRateLimitTier(pathname);
  const rlKey = `${clientIp}:${pathname.split('/').slice(0, 4).join('/')}`;
  const rl = edgeRateLimit(rlKey, rlMax, rlWindow);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(rlMax),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rl.resetAt),
        },
      },
    );
  }

  // ── Public exceptions inside otherwise-protected prefixes ──────────────────

  // /api/nexyfab/share  →  GET is public, all other methods require auth
  if (pathname.startsWith('/api/nexyfab/share') && req.method === 'GET') {
    return NextResponse.next();
  }

  // /api/partner/auth  →  fully public (login endpoint for partners)
  if (pathname.startsWith(PARTNER_AUTH_EXEMPT)) {
    return NextResponse.next();
  }

  // Capability discovery is public and read-only. Alternate methods on this
  // path and every other CAD v1 endpoint remain authenticated.
  if (pathname === '/api/cad/v1/capabilities' && req.method === 'GET') {
    return NextResponse.next();
  }

  // ── Determine whether this route needs protection ──────────────────────────

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  // ── Block insecure JWT secret in production ────────────────────────────────
  if (JWT_SECRET_IS_INSECURE) {
    console.error('[middleware] FATAL: JWT_SECRET is unset or uses dev default in production.');
    return NextResponse.json(
      { error: 'Server misconfiguration. Contact administrator.' },
      { status: 500 },
    );
  }

  // ── Extract and verify JWT (cookie first, then Authorization header) ────────

  const cookieToken = req.cookies.get('nf_access_token')?.value;
  const authHeader = req.headers.get('authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers: { ...corsHeaders, 'WWW-Authenticate': 'Bearer' } }
    );
  }

  const user = await verifyJWT(token);

  if (!user) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      {
        status: 401,
        headers: { ...corsHeaders, 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      }
    );
  }

  // Per-account CAD compute quota. This is intentionally independent of the
  // IP ceiling above so shared networks do not merge customer entitlements.
  // Existing Closed Beta accounts keep access; plan only changes the quota.
  const isCadRequest = pathname.startsWith('/api/cad/v1');
  const cadRequestId = isCadRequest ? crypto.randomUUID() : null;
  let cadQuotaHeaders: Record<string, string> = {};
  if (isCadRequest) {
    const normalizedPlan = user.plan.trim().toLowerCase();
    const cadLimit = normalizedPlan === 'free' ? 10 : 60;
    const cadQuota = await cadAccountRateLimit(`nexyfab:cad:v1:user:${user.userId}`, cadLimit, 60_000);
    cadQuotaHeaders = {
      'X-RateLimit-Limit': String(cadLimit),
      'X-RateLimit-Remaining': String(cadQuota.remaining),
      'X-RateLimit-Reset': String(cadQuota.resetAt),
      'X-RateLimit-Backend': cadQuota.backend,
    };
    if (cadQuota.unavailable) {
      return NextResponse.json(
        { error: 'CAD quota service unavailable', code: 'CAD_QUOTA_UNAVAILABLE' },
        { status: 503, headers: { ...corsHeaders, ...cadQuotaHeaders, 'Retry-After': '30' } },
      );
    }
    if (!cadQuota.allowed) {
      return NextResponse.json(
        { error: 'CAD compute quota exceeded', code: 'CAD_QUOTA_EXCEEDED' },
        {
          status: 429,
          headers: {
            ...corsHeaders,
            ...cadQuotaHeaders,
            'Retry-After': String(Math.max(0, Math.ceil((cadQuota.resetAt - Date.now()) / 1000))),
          },
        },
      );
    }
    if (process.env.NODE_ENV === 'production') {
      console.info('[CAD_API_ACCESS]', JSON.stringify({
        requestId: cadRequestId,
        userId: user.userId,
        plan: normalizedPlan,
        method: req.method,
        path: pathname,
        at: new Date().toISOString(),
      }));
    }
  }

  // ── Admin-only route check ─────────────────────────────────────────────────

  const isAdminRoute = ADMIN_ONLY_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isAdminRoute) {
    const adminSecret = req.headers.get('x-admin-secret');
    const expectedSecret = process.env.ADMIN_SECRET;

    const hasAdminSecret =
      expectedSecret != null && adminSecret === expectedSecret;

    if (!hasAdminSecret) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }
  }

  // ── Email verification check for sensitive routes ──────────────────────────

  const requiresVerification = EMAIL_VERIFIED_REQUIRED.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (requiresVerification && !user.emailVerified) {
    return NextResponse.json(
      {
        error: 'Email verification required. Please verify your email to use this feature.',
        code: 'EMAIL_NOT_VERIFIED',
      },
      { status: 403 }
    );
  }

  // ── Forward verified user identity to route handlers via headers ───────────

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', user.userId);
  requestHeaders.set('x-user-email', user.email);
  requestHeaders.set('x-user-plan', user.plan);
  if (user.service) requestHeaders.set('x-user-service', user.service);
  if (cadRequestId) requestHeaders.set('x-cad-request-id', cadRequestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Attach CORS headers to successful responses
  for (const [k, v] of Object.entries(corsHeaders)) {
    response.headers.set(k, v);
  }
  for (const [k, v] of Object.entries(cadQuotaHeaders)) {
    response.headers.set(k, v);
  }

  return response;
}

// ─── Matcher ──────────────────────────────────────────────────────────────────

export const config = {
  // API protection plus canonical redirects for legacy ISO locale segments.
  matcher: ['/api/:path*', '/ko/:path*', '/zh/:path*', '/jp/:path*'],
};
