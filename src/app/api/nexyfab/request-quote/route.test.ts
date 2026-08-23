import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ consumeSlot: vi.fn(), getProvider: vi.fn(), getDefaultProvider: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/plan-guard', () => ({
  checkPlan: async () => ({ ok: true, userId: 'u1', plan: 'free', orgId: null }),
  consumeMonthlyMetricSlot: mocks.consumeSlot,
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/quoting/registry', () => ({ getProvider: mocks.getProvider, getDefaultProvider: mocks.getDefaultProvider }));
vi.mock('@/lib/enterprise-cad-audit', () => ({ CadAuditAction: { QUOTE_REQUESTED: 'quote_requested' }, logCadPipelineAudit: mocks.audit }));

import { POST } from './route';

function request(body: BodyInit) {
  return new NextRequest('http://localhost/api/nexyfab/request-quote', {
    method: 'POST', body, headers: { 'content-type': 'application/json' },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>) {
  return new NextRequest('http://localhost/api/nexyfab/request-quote', {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': '1' }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

function expectNoProviderSideEffects() {
  expect(mocks.getProvider).not.toHaveBeenCalled();
  expect(mocks.getDefaultProvider).not.toHaveBeenCalled();
  expect(mocks.consumeSlot).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
}

describe('quote request bounded ingress', () => {
  it('rejects invalid UTF-8 before quota, provider and audit side effects', async () => {
    const response = await POST(request(new Uint8Array([0xff])));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: 'BAD_PROCESS' });
    expectNoProviderSideEffects();
  });

  it('cancels measured overflow before quota, provider and audit side effects', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream));
    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
    expectNoProviderSideEffects();
  });
});
