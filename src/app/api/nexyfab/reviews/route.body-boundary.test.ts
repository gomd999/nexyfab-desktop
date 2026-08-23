import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ saveReview: vi.fn() }));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({
    userId: 'review-boundary-user', orgIds: [], activeOrgId: null, orgContextStatus: 'personal',
  })),
}));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/design-reviews', () => ({
  deleteReview: vi.fn(),
  listReviews: vi.fn(async () => []),
  saveReview: mocks.saveReview,
}));

import { POST } from './route';

const REVIEW_JSON_BYTES = 1024 * 1024;

const URL = 'https://nexyfab.test/api/nexyfab/reviews';

function streamedRequest(body: ReadableStream<Uint8Array>, contentLength: string) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': contentLength },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  return new NextRequest(URL, init as never);
}

describe('review bounded JSON ingress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects and cancels an oversized declared Content-Length before saving', async () => {
    let cancelled = false;
    const request = streamedRequest(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
      cancel() { cancelled = true; },
    }), String(REVIEW_JSON_BYTES + 1));

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });

  it('measures and cancels an actual chunked overflow with a false Content-Length', async () => {
    let cancelled = false;
    const request = streamedRequest(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(REVIEW_JSON_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    }), '1');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{' as BodyInit],
    ['invalid UTF-8', new Uint8Array([0xff]) as BodyInit],
  ])('preserves validation failure and performs no save for %s', async (_name, body) => {
    const response = await POST(new NextRequest(URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'report required' });
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });
});
