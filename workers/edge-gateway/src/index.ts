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
const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUILD_ID_PLACEHOLDERS = new Set(['not_configured', 'not_deployed', 'unknown', 'dev', 'local', 'latest']);
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
  if (!configured?.trim()) return false;
  const allowed = new Set(configured.split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  return allowed.has(requestHost.toLowerCase());
}

function validOrigin(value: string | undefined, environment: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    const allowHttp = ['development', 'test', 'local'].includes(environment?.toLowerCase() ?? '');
    return (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validBuildId(value: string | undefined): boolean {
  return BUILD_ID_PATTERN.test(value ?? '') && !BUILD_ID_PLACEHOLDERS.has(value!.toLowerCase());
}

export function gatewayConfigurationIssues(env: EdgeGatewayEnv): string[] {
  const issues: string[] = [];
  if (!validOrigin(env.CORE_API_ORIGIN, env.ENVIRONMENT)) issues.push('core_api_origin_missing_or_invalid');
  if (!validOrigin(env.STUDIO_ORIGIN, env.ENVIRONMENT)) issues.push('studio_origin_missing_or_invalid');
  if (!validOrigin(env.EDGE_HANDLER_ORIGIN, env.ENVIRONMENT)) issues.push('edge_handler_origin_missing_or_invalid');
  if (!env.ALLOWED_HOSTS?.split(',').some(value => value.trim())) issues.push('allowed_hosts_missing');
  if (!env.GATEWAY_SHARED_SECRET || env.GATEWAY_SHARED_SECRET.length < 32) issues.push('gateway_shared_secret_missing_or_short');
  if (!validBuildId(env.BUILD_ID)) issues.push('build_id_missing_or_invalid');
  return issues;
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
  const configurationIssues = gatewayConfigurationIssues(env);
  if (BLOCKED_METHODS.has(request.method.toUpperCase())) {
    return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, requestId);
  }
  if (incoming.pathname === '/.well-known/nexyfab-gateway-health' || incoming.pathname === '/healthz/gateway') {
    const hostAllowed = allowedHost(incoming.hostname, env.ALLOWED_HOSTS);
    const healthIssues = [...configurationIssues, ...(hostAllowed ? [] : ['request_host_not_allowed'])];
    const configured = healthIssues.length === 0;
    return json(configured ? 200 : 503, {
      ok: configured,
      service: 'edge-gateway',
      environment: env.ENVIRONMENT ?? 'unknown',
      buildId: env.BUILD_ID ?? 'NOT_CONFIGURED',
      deploymentState: env.BUILD_ID === 'NOT_DEPLOYED'
        ? 'NOT_DEPLOYED'
        : configured ? 'RUNNING' : 'NOT_CONFIGURED',
      issues: healthIssues,
    }, requestId);
  }
  if (configurationIssues.length) {
    return json(503, { ok: false, code: 'GATEWAY_NOT_CONFIGURED', issues: configurationIssues }, requestId);
  }
  if (!allowedHost(incoming.hostname, env.ALLOWED_HOSTS)) {
    return json(421, { ok: false, code: 'HOST_NOT_ALLOWED' }, requestId);
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
  upstreamRequest.headers.set('x-nexyfab-gateway-secret', env.GATEWAY_SHARED_SECRET!);

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
