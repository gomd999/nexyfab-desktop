import { describe, expect, it, vi } from 'vitest';
import { handleEdgeGatewayRequest, resolveGatewayRoute, type EdgeGatewayEnv } from './index';

const env: EdgeGatewayEnv = {
  CORE_API_ORIGIN: 'https://core.internal.example/base',
  STUDIO_ORIGIN: 'https://studio.internal.example',
  EDGE_HANDLER_ORIGIN: 'https://edge-handlers.internal.example',
  GATEWAY_SHARED_SECRET: 'server-secret',
  ALLOWED_HOSTS: 'nexyfab.com,www.nexyfab.com',
  ENVIRONMENT: 'test',
  BUILD_ID: 'build-test',
};

describe('Cloudflare edge gateway', () => {
  it('routes pages, core APIs and edge-owned API groups to explicit origins', () => {
    expect(resolveGatewayRoute('/kr/studio', env)).toEqual({ ok: true, owner: 'studio-web', origin: env.STUDIO_ORIGIN });
    expect(resolveGatewayRoute('/api/nexyfab/projects', env)).toEqual({ ok: true, owner: 'core-api', origin: env.CORE_API_ORIGIN });
    expect(resolveGatewayRoute('/api/webhooks/stripe', env)).toEqual({ ok: true, owner: 'edge-handler', origin: env.EDGE_HANDLER_ORIGIN });
  });

  it('fails closed when an owned route has no configured origin', () => {
    expect(resolveGatewayRoute('/api/docs/openapi', { ...env, EDGE_HANDLER_ORIGIN: undefined })).toEqual({ ok: false, code: 'ORIGIN_NOT_CONFIGURED' });
  });

  it('replaces spoofable forwarding headers and never leaks the gateway secret', async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://core.internal.example/base/api/nexyfab/projects?limit=10');
      expect(request.headers.get('x-forwarded-for')).toBeNull();
      expect(request.headers.get('x-forwarded-host')).toBe('nexyfab.com');
      expect(request.headers.get('x-forwarded-proto')).toBe('https');
      expect(request.headers.get('x-nexyfab-route-owner')).toBe('core-api');
      expect(request.headers.get('x-nexyfab-gateway-secret')).toBe('server-secret');
      return new Response('ok', { status: 201, headers: { 'x-nexyfab-gateway-secret': 'must-not-leak' } });
    });
    const response = await handleEdgeGatewayRequest(new Request('https://nexyfab.com/api/nexyfab/projects?limit=10', {
      headers: {
        'cf-ray': 'ray-id-ICN',
        'x-forwarded-for': '203.0.113.99',
        'x-nexyfab-gateway-secret': 'attacker-value',
      },
    }), env, fetcher);
    expect(response.status).toBe(201);
    expect(response.headers.get('x-nexyfab-gateway-secret')).toBeNull();
    expect(response.headers.get('x-nexyfab-request-id')).toBe('ray');
    expect(response.headers.get('x-nexyfab-gateway-build')).toBe('build-test');
  });

  it('rejects unapproved hosts and recursive origins before any fetch', async () => {
    const fetcher = vi.fn();
    expect((await handleEdgeGatewayRequest(new Request('https://attacker.example/kr'), env, fetcher)).status).toBe(421);
    expect((await handleEdgeGatewayRequest(
      new Request('https://nexyfab.com/kr'),
      { ...env, STUDIO_ORIGIN: 'https://nexyfab.com' },
      fetcher,
    )).status).toBe(508);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports its own deployment identity without touching an origin', async () => {
    const fetcher = vi.fn();
    const response = await handleEdgeGatewayRequest(
      new Request('https://nexyfab.com/.well-known/nexyfab-gateway-health', { headers: { 'cf-ray': 'health-ray-ICN' } }),
      env,
      fetcher,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ service: 'edge-gateway', buildId: 'build-test', deploymentState: 'RUNNING' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
