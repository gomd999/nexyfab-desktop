import { NextRequest, NextResponse } from 'next/server';
import IORedis, { type Redis } from 'ioredis';
import { verifyJWT } from './jwt';

const CAD_PREFIX = '/api/cad/v1';
const PUBLIC_CAPABILITY_PATH = '/api/cad/v1/capabilities';
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

  const cookieToken = request.cookies.get('nf_access_token')?.value;
  const authorization = request.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const user = await verifyJWT(token);
  if (!user?.sub) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } },
    );
  }

  // Existing unverified Closed Beta accounts remain valid here. Email
  // verification is enforced only by actions whose business contract needs it.
  const normalizedPlan = (user.plan || 'free').trim().toLowerCase();
  const limit = normalizedPlan === 'free' ? 10 : 60;
  const quota = await cadAccountQuota(`nexyfab:cad:v1:user:${user.sub}`, limit, 60_000);
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
  requestHeaders.set('x-user-id', user.sub);
  requestHeaders.set('x-user-email', user.email);
  requestHeaders.set('x-user-plan', user.plan);
  requestHeaders.set('x-cad-request-id', requestId);
  if (user.service) requestHeaders.set('x-user-service', user.service);

  if (process.env.NODE_ENV === 'production') {
    console.info('[CAD_API_ACCESS]', JSON.stringify({
      requestId,
      userId: user.sub,
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
