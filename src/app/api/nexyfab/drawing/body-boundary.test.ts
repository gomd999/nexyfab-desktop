import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.8') }));
vi.mock('@/lib/studio-ai-guard', () => ({ guardStudioAi: vi.fn(async () => null) }));

import { POST as editPart } from './edit-part/route';
import { POST as editAssembly } from './edit-assembly/route';
import { POST as faceDrag } from './face-drag/route';
import { POST as partOp } from './part-op/route';

type Handler = (request: NextRequest) => Promise<Response>;

const routes: Array<{ name: string; handler: Handler; limit: number; tooLarge: string; malformed: string }> = [
  { name: 'edit-part', handler: editPart, limit: 800_000, tooLarge: 'assembly 가 너무 큽니다(≤800KB)', malformed: 'invalid json' },
  { name: 'edit-assembly', handler: editAssembly, limit: 1_200_000, tooLarge: '조립체 데이터가 너무 큽니다(최대 1.2MB).', malformed: '잘못된 요청 형식입니다.' },
  { name: 'face-drag', handler: faceDrag, limit: 800_000, tooLarge: 'assembly 가 너무 큽니다(≤800KB)', malformed: 'invalid json' },
  { name: 'part-op', handler: partOp, limit: 800_000, tooLarge: 'assembly 가 너무 큽니다(≤800KB)', malformed: 'invalid json' },
];

function streamRequest(name: string, body: ReadableStream<Uint8Array>): NextRequest {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new NextRequest(`https://nexyfab.test/api/nexyfab/drawing/${name}`, init as never);
}

describe.each(routes)('$name streaming JSON body boundary', ({ name, handler, limit, tooLarge, malformed }) => {
  it('measures and cancels an oversized chunked body despite a falsely small Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(limit));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    const response = await handler(streamRequest(name, body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: tooLarge });
    expect(cancelled).toBe(true);
  });

  it('preserves the malformed-JSON response contract', async () => {
    const response = await handler(new NextRequest(`https://nexyfab.test/api/nexyfab/drawing/${name}`, {
      method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: malformed });
  });

  it('rejects invalid UTF-8 through the same sanitized response contract', async () => {
    const response = await handler(new NextRequest(`https://nexyfab.test/api/nexyfab/drawing/${name}`, {
      method: 'POST', body: new Uint8Array([0xff]), headers: { 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: malformed });
  });
});
