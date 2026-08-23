export interface EdgeGatewayEnv {
  CORE_API_ORIGIN?: string;
  STUDIO_ORIGIN?: string;
  EDGE_HANDLER_ORIGIN?: string;
  GATEWAY_SHARED_SECRET?: string;
  ALLOWED_HOSTS?: string;
  ENVIRONMENT?: string;
  BUILD_ID?: string;
}

type UpstreamFetch = (request: Request) => Promise<Response>;
type RouteOwner = 'core-api' | 'studio-web' | 'edge-handler';

const BLOCKED_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);
const EDGE_HANDLER_API_GROUPS = new Set(['docs', 'og', 'webhooks']);
const STRIPPED_REQUEST_HEADERS = [
  'connection',
  'forwarded',
  'proxy-authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-nexyfab-gateway-secret',
  'x-nexyfab-route-owner',
  'x-nexyfab-request-id',
];

function json(status: number, body: Record<string, unknown>, requestId?: string): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (requestId) headers.set('x-nexyfab-request-id', requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedHost(requestHost: string, configured: string | undefined): boolean {
  if (!configured?.trim()) return true;
  const allowed = new Set(configured.split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  return allowed.has(requestHost.toLowerCase());
}

function apiGroup(pathname: string): string | null {
  const match = /^\/api\/([^/]+)(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}

export function resolveGatewayRoute(pathname: string, env: EdgeGatewayEnv):
  | { ok: true; owner: RouteOwner; origin: string }
  | { ok: false; code: 'ORIGIN_NOT_CONFIGURED' } {
  const group = apiGroup(pathname);
  const owner: RouteOwner = group === null
    ? 'studio-web'
    : EDGE_HANDLER_API_GROUPS.has(group)
      ? 'edge-handler'
      : 'core-api';
  const origin = owner === 'studio-web'
    ? env.STUDIO_ORIGIN
    : owner === 'edge-handler'
      ? env.EDGE_HANDLER_ORIGIN
      : env.CORE_API_ORIGIN;
  return origin?.trim() ? { ok: true, owner, origin } : { ok: false, code: 'ORIGIN_NOT_CONFIGURED' };
}

function targetUrl(origin: string, incoming: URL): URL | null {
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
    const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}${incoming.pathname}`;
    base.search = incoming.search;
    base.hash = '';
    return base;
  } catch {
    return null;
  }
}

function requestIdFor(request: Request): string {
  const ray = request.headers.get('cf-ray')?.split('-')[0]?.trim();
  return ray || crypto.randomUUID();
}

export async function handleEdgeGatewayRequest(
  request: Request,
  env: EdgeGatewayEnv,
  upstreamFetch: UpstreamFetch = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  const requestId = requestIdFor(request);
  if (BLOCKED_METHODS.has(request.method.toUpperCase())) {
    return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, requestId);
  }
  if (!allowedHost(incoming.hostname, env.ALLOWED_HOSTS)) {
    return json(421, { ok: false, code: 'HOST_NOT_ALLOWED' }, requestId);
  }
  if (incoming.pathname === '/.well-known/nexyfab-gateway-health' || incoming.pathname === '/healthz/gateway') {
    return json(200, {
      ok: true,
      service: 'edge-gateway',
      environment: env.ENVIRONMENT ?? 'unknown',
      buildId: env.BUILD_ID ?? 'NOT_CONFIGURED',
      deploymentState: env.BUILD_ID === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : 'RUNNING',
    }, requestId);
  }

  const route = resolveGatewayRoute(incoming.pathname, env);
  if (!route.ok) return json(503, { ok: false, code: route.code }, requestId);
  const target = targetUrl(route.origin, incoming);
  if (!target) return json(503, { ok: false, code: 'INVALID_ORIGIN' }, requestId);
  if (target.origin === incoming.origin) {
    return json(508, { ok: false, code: 'ORIGIN_RECURSION' }, requestId);
  }

  const upstreamRequest = new Request(target.toString(), request);
  for (const header of STRIPPED_REQUEST_HEADERS) upstreamRequest.headers.delete(header);
  upstreamRequest.headers.set('x-forwarded-host', incoming.host);
  upstreamRequest.headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1));
  upstreamRequest.headers.set('x-nexyfab-request-id', requestId);
  upstreamRequest.headers.set('x-nexyfab-route-owner', route.owner);
  if (env.GATEWAY_SHARED_SECRET) upstreamRequest.headers.set('x-nexyfab-gateway-secret', env.GATEWAY_SHARED_SECRET);

  try {
    const upstream = await upstreamFetch(upstreamRequest);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('x-nexyfab-gateway-secret');
    responseHeaders.set('x-nexyfab-request-id', requestId);
    responseHeaders.set('x-nexyfab-gateway-build', env.BUILD_ID ?? 'NOT_CONFIGURED');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return json(502, { ok: false, code: 'UPSTREAM_UNAVAILABLE' }, requestId);
  }
}

const edgeGatewayWorker = {
  fetch(request: Request, env: EdgeGatewayEnv): Promise<Response> {
    return handleEdgeGatewayRequest(request, env);
  },
};

export default edgeGatewayWorker;
