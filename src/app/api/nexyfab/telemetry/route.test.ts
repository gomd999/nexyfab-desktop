import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  cadAudit: vi.fn(),
  dedupe: vi.fn(),
  sentry: vi.fn(),
  rate: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.auth }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }));
vi.mock('@/lib/enterprise-cad-audit', () => ({
  CadAuditAction: {
    DRAWING_EXPORT: 'cad.drawing_export',
    MESH_EXPORT: 'cad.mesh_export',
    CAM_TOOLPATH_REQUEST: 'cad.cam_toolpath_request',
  },
  logCadPipelineAudit: mocks.cadAudit,
}));
vi.mock('@/lib/telemetryCadDedupe', () => ({
  shouldSkipTelemetryDuplicateForCadAudit: mocks.dedupe,
}));
vi.mock('@/lib/sentry-forward', () => ({ forwardToSentry: mocks.sentry }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }));

import { POST } from './route';
import { MAX_CONTEXT_BYTES, boundTelemetryContext } from './telemetry-bounds';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.dedupe.mockReturnValue(false);
  mocks.rate.mockReturnValue({ allowed: true, remaining: 29, resetAt: Date.now() + 60_000 });
});

describe('public telemetry bounds', () => {
  it('bounds nested context before audit and Sentry fan-out', async () => {
    const deeplyNested = { a: { b: { c: { d: { e: 'secret-at-depth' } } } } };
    const oversized = { ...deeplyNested, payload: 'x'.repeat(20_000) };
    const bounded = boundTelemetryContext(oversized);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    expect((bounded?.a as Record<string, unknown>).b).toEqual({ c: { d: '[truncated-depth]' } });
    expect(bounded?.payload).toHaveLength(512);

    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/telemetry', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify({ events: [{ level: 'error', source: 'shape-generator', context: oversized }] }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain('x'.repeat(1_000));
    expect(mocks.sentry).toHaveBeenCalledWith(expect.objectContaining({
      extra: expect.objectContaining({ payload: 'x'.repeat(512) }),
    }));
  });

  it('rejects a request when the telemetry-specific limiter is exhausted', async () => {
    mocks.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 10_000 });

    const response = await POST(new NextRequest('https://nexyfab.com/api/nexyfab/telemetry', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    }));

    expect(response.status).toBe(429);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
