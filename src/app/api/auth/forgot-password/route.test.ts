import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  rate: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: mocks.rate }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({ queryOne: mocks.queryOne, execute: mocks.execute }),
}));
vi.mock('@/lib/nexyfab-email', () => ({ sendEmail: mocks.sendEmail }));

import { POST } from './route';

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('https://nexyfab.com/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockResolvedValue({ allowed: true });
});

describe('forgot-password bounded public ingress', () => {
  it('cancels a declared oversized body without revealing account state or side effects', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const response = await POST(streamedRequest(stream, { 'content-length': String(16 * 1024 + 1) }));
    expect(response.status).toBe(200);
    expect(cancelled).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('does not trust false-small Content-Length and cancels measured overflow', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, { 'content-length': '1' }));
    expect(response.status).toBe(200);
    expect(cancelled).toBe(true);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 before database or email mutation without enumeration', async () => {
    const response = await POST(new NextRequest('https://nexyfab.com/api/auth/forgot-password', {
      method: 'POST',
      body: new Uint8Array([0xff]),
    }));
    expect(response.status).toBe(200);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
