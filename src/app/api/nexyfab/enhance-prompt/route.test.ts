import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/cost-breaker', () => ({ getActiveBreaker: async () => null }));

function request(body: BodyInit, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/nexyfab/enhance-prompt', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, ip: string, headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/nexyfab/enhance-prompt', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

async function expectExistingBadBodyContract(response: Response) {
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'PROMPT_REQUIRED' });
}

describe('NexyFab prompt enhancement bounded ingress', () => {
  it('preserves the malformed and invalid UTF-8 response contract', async () => {
    await expectExistingBadBodyContract(await POST(request('{', 'enhance-bounded-malformed')));
    await expectExistingBadBodyContract(await POST(request(new Uint8Array([0xff]), 'enhance-bounded-utf8')));
  });

  it('rejects a declared oversized body before parsing', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    await expectExistingBadBodyContract(await POST(streamedRequest(stream, 'enhance-bounded-declared', { 'content-length': '65537' })));
    expect(cancelled).toBe(true);
  });

  it('does not trust Content-Length and cancels a measured oversized stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { cancelled = true; },
    });
    await expectExistingBadBodyContract(await POST(streamedRequest(stream, 'enhance-bounded-measured', { 'content-length': '1' })));
    expect(cancelled).toBe(true);
  });
});
