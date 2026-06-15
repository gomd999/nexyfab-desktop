/**
 * POST /api/nexyfab/sketch-from-image — route gating + result mapping.
 * Guards and the core service are mocked so no auth/vision round-trip happens.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const planCheck = vi.fn();
const rateLimit = vi.fn();
const checkUserBudget = vi.fn();
const runSketchFromImage = vi.fn();

vi.mock('@/lib/plan-guard', () => ({ checkPlan: (...a: unknown[]) => planCheck(...a) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '1.2.3.4' }));
vi.mock('@/lib/ai/userBudget', () => ({ checkUserBudget: (...a: unknown[]) => checkUserBudget(...a) }));
vi.mock('@/lib/ai/telemetry', () => ({ recordPromptCall: vi.fn(), classifyAiError: () => 'unknown' }));
vi.mock('@/lib/error-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/ai/sketchFromImageService', () => ({ runSketchFromImage: (...a: unknown[]) => runSketchFromImage(...a) }));

import { POST } from '../route';

function reqOf(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

const okEntities = { points: [], lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 10, y2: 0 }], circles: [], arcs: [] };

describe('POST /api/nexyfab/sketch-from-image', () => {
  beforeEach(() => {
    planCheck.mockReset();
    rateLimit.mockReset();
    checkUserBudget.mockReset();
    runSketchFromImage.mockReset();
    planCheck.mockResolvedValue({ ok: true, userId: 'u1', plan: 'pro' });
    rateLimit.mockReturnValue({ allowed: true });
    checkUserBudget.mockResolvedValue({ ok: true, limitUsd: 5, usedCents: 0, approaching: false, fraction: 0 });
    runSketchFromImage.mockResolvedValue({ ok: true, entities: okEntities, warnings: [], imageBytes: 100 });
  });

  it('returns 200 + entities on success', async () => {
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.entities.lines).toHaveLength(1);
    expect(runSketchFromImage).toHaveBeenCalledWith({ imageBase64: 'abc' });
  });

  it('403 when the plan gate fails', async () => {
    planCheck.mockResolvedValue({ ok: false });
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PLAN_LOCKED');
    expect(runSketchFromImage).not.toHaveBeenCalled();
  });

  it('429 when rate-limited', async () => {
    rateLimit.mockReturnValue({ allowed: false });
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(429);
    expect(runSketchFromImage).not.toHaveBeenCalled();
  });

  it('402 when over daily budget (before the paid vision call)', async () => {
    checkUserBudget.mockResolvedValue({ ok: false, limitUsd: 5, usedCents: 600, resetAtMs: 0 });
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('COST_BUDGET');
    expect(runSketchFromImage).not.toHaveBeenCalled();
  });

  it('maps IMAGE_TOO_LARGE to 413', async () => {
    runSketchFromImage.mockResolvedValue({ ok: false, code: 'IMAGE_TOO_LARGE', error: 'too big', warnings: [] });
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('IMAGE_TOO_LARGE');
  });

  it('maps INFER_FAILED to 502', async () => {
    runSketchFromImage.mockResolvedValue({ ok: false, code: 'INFER_FAILED', error: 'vision down', warnings: [] });
    const res = await POST(reqOf({ imageBase64: 'abc' }));
    expect(res.status).toBe(502);
  });
});
