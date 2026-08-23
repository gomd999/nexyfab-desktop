import { NextRequest, NextResponse } from 'next/server';
import IORedis, { type Redis } from 'ioredis';
import { getAuthUser } from './auth-middleware';

const CAD_PREFIX = '/api/cad/v1';
const PUBLIC_CAPABILITY_PATH = '/api/cad/v1/capabilities';
const CAD_WRITE_SCOPE_PATHS = new Set([
  '/api/cad/v1/feature-tree-mesh',
  '/api/cad/v1/part-step',
  '/api/cad/v1/ifc/recover-geometry',
  '/api/cad/v1/assembly/animation/command',
  '/api/cad/v1/brep/push-pull',
  '/api/cad/v1/architecture/daylight/package',
  '/api/cad/v1/architecture/daylight/status',
  '/api/cad/v1/architecture/interior/edit',
  '/api/cad/v1/architecture/service-openings/sync',
  '/api/cad/v1/generation/refine',
  '/api/cad/v1/generation/state',
  '/api/cad/v1/generation/advance',
  '/api/cad/v1/generation/finalize',
  '/api/cad/v1/generation/commercial-receipts/requests',
  '/api/cad/v1/interior/layout/edit',
  '/api/cad/v1/robot/integration/apply',
  '/api/cad/v1/robot/generate',
  '/api/cad/v1/robot/release/work-packet',
  '/api/cad/v1/spatial/command',
]);
const quotaMemory = new Map<string, { count: number; resetAt: number }>();
const MAX_MEMORY_KEYS = 20_000;

type CadQuotaResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  backend: 'redis' | 'upstash-rest' | 'memory';
  unavailable?: boolean;
};

let redisClient: Redis | null = null;
let redisConnectPromise: Promise<void> | null = null;

export type CadApiKeyScope = 'read:projects' | 'write:projects';

/**
 * This boundary is pathname-scoped (not method-scoped), so the daylight
 * readiness path remains write-scoped even for GET: its status probe can
 * spawn local Radiance executables and is not a safe read-only operation.
 * Stateless verification/proposal routes are readable compute. Routes that
 * create export bytes, apply geometry, persist commercial generation state,
 * or advance durable generation state require an explicit write-capable API
 * key. Cookie/JWT sessions continue to be governed by their account and
 * downstream project/role checks.
 */
export function requiredCadApiKeyScope(pathname: string): CadApiKeyScope {
  const canonicalPathname = pathname.replace(/\/+$/, '') || '/';
  return CAD_WRITE_SCOPE_PATHS.has(canonicalPathname) ? 'write:projects' : 'read:projects';
}

function directRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (redisClient) return redisClient;
  redisClient = new IORedis(url, {
    connectTimeout: 2_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redisClient.on('error', error => {
    console.error('[cad-api-boundary] Redis connection error:', error.message);
  });
  return redisClient;
}

async function connectedDirectRedis(): Promise<Redis | null> {
  const client = directRedis();
  if (!client) return null;
  if (client.status === 'ready') return client;
  if (!redisConnectPromise) {
    redisConnectPromise = client.connect().finally(() => {
      redisConnectPromise = null;
    });
  }
  await redisConnectPromise;
  return client;
}

function memoryQuota(key: string, maximum: number, windowMs: number): CadQuotaResult {
  const now = Date.now();
  const current = quotaMemory.get(key);
  if (!current || now >= current.resetAt) {
    if (!current && quotaMemory.size >= MAX_MEMORY_KEYS) {
      const oldest = [...quotaMemory.entries()]
        .sort((left, right) => left[1].resetAt - right[1].resetAt)
        .slice(0, Math.ceil(MAX_MEMORY_KEYS * 0.1));
      for (const [entryKey] of oldest) quotaMemory.delete(entryKey);
    }
    quotaMemory.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maximum - 1, resetAt: now + windowMs, backend: 'memory' };
  }
  if (current.count >= maximum) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt, backend: 'memory' };
  }
  current.count += 1;
  return { allowed: true, remaining: maximum - current.count, resetAt: current.resetAt, backend: 'memory' };
}

export async function cadAccountQuota(key: string, maximum: number, windowMs: number): Promise<CadQuotaResult> {
  const script = [
    "local current = redis.call('INCR', KEYS[1])",
    "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
    "local ttl = redis.call('PTTL', KEYS[1])",
    'return {current, ttl}',
  ].join('\n');
  let direct: Redis | null = null;
  try {
    direct = await connectedDirectRedis();
  } catch (error) {
    console.error('[cad-api-boundary] direct Redis connection unavailable:', error);
    redisClient?.disconnect(false);
    redisClient = null;
  }
  if (direct) {
    try {
      const value = await direct.eval(script, 1, key, String(windowMs)) as [number | string, number | string];
      const count = Number(value?.[0]);
      const ttl = Number(value?.[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('REDIS_INVALID_RESULT');
      return {
        allowed: count <= maximum,
        remaining: Math.max(0, maximum - count),
        resetAt: Date.now() + Math.max(0, ttl),
        backend: 'redis',
      };
    } catch (error) {
      console.error('[cad-api-boundary] direct Redis quota unavailable:', error);
      direct.disconnect(false);
      if (redisClient === direct) redisClient = null;
      if (process.env.NEXYFAB_CAD_INDEPENDENT_MODE === '1') {
        return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, backend: 'redis', unavailable: true };
      }
    }
  }

  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const strict = process.env.NEXYFAB_CAD_INDEPENDENT_MODE === '1';
  if (!url || !token) {
    return strict
      ? { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, backend: 'memory', unavailable: true }
      : memoryQuota(key, maximum, windowMs);
  }

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
      allowed: count <= maximum,
      remaining: Math.max(0, maximum - count),
      resetAt: Date.now() + Math.max(0, ttl),
      backend: 'upstash-rest',
    };
  } catch (error) {
    console.error('[cad-api-boundary] distributed quota unavailable:', error);
    return strict
      ? { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, backend: 'upstash-rest', unavailable: true }
      : memoryQuota(key, maximum, windowMs);
  }
}

function quotaHeaders(limit: number, quota: CadQuotaResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(quota.remaining),
    'X-RateLimit-Reset': String(quota.resetAt),
    'X-RateLimit-Backend': quota.backend,
  };
}

/** Returns null for non-CAD paths; every CAD path returns an explicit proxy response. */
export async function enforceCadApiBoundary(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(CAD_PREFIX)) return null;
  const canonicalPathname = pathname.replace(/\/+$/, '') || '/';
  if (canonicalPathname === PUBLIC_CAPABILITY_PATH && request.method === 'GET') return NextResponse.next();

  const hasCredential = Boolean(
    request.cookies.get('nf_access_token')?.value
    || request.headers.get('authorization')?.startsWith('Bearer '),
  );
  if (!hasCredential) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  // Use the same account-backed verifier as the rest of the application.
  // Besides JWT/SSO sessions this validates issued nf_live_* API keys,
  // expiry, IP allowlists, account deletion/lock and current entitlements.
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
    );
  }

  const requiredScope = requiredCadApiKeyScope(canonicalPathname);
  if (user.apiKey && !user.apiKey.scopes.includes(requiredScope)) {
    return NextResponse.json(
      { error: 'Insufficient API key scope', code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope },
      { status: 403 },
    );
  }

  // Existing unverified Closed Beta accounts remain valid here. Email
  // verification is enforced only by actions whose business contract needs it.
  const normalizedPlan = (user.plan || 'free').trim().toLowerCase();
  const limit = normalizedPlan === 'free' ? 10 : 60;
  const quota = await cadAccountQuota(`nexyfab:cad:v1:user:${user.userId}`, limit, 60_000);
  const headers = quotaHeaders(limit, quota);
  if (quota.unavailable) {
    return NextResponse.json(
      { error: 'CAD quota service unavailable', code: 'CAD_QUOTA_UNAVAILABLE' },
      { status: 503, headers: { ...headers, 'Retry-After': '30' } },
    );
  }
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'CAD compute quota exceeded', code: 'CAD_QUOTA_EXCEEDED' },
      {
        status: 429,
        headers: { ...headers, 'Retry-After': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) },
      },
    );
  }

  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  // Downstream CAD handlers use the verified identity headers below; do not
  // propagate a raw JWT or nf_live_* API key beyond this authentication gate.
  requestHeaders.delete('authorization');
  requestHeaders.set('x-user-id', user.userId);
  requestHeaders.set('x-user-email', user.email);
  requestHeaders.set('x-user-plan', user.plan);
  requestHeaders.set('x-cad-request-id', requestId);
  if (user.apiKey) requestHeaders.set('x-api-key-id', user.apiKey.id);

  if (process.env.NODE_ENV === 'production') {
    console.info('[CAD_API_ACCESS]', JSON.stringify({
      requestId,
      userId: user.userId,
      plan: normalizedPlan,
      method: request.method,
      path: pathname,
      at: new Date().toISOString(),
    }));
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
