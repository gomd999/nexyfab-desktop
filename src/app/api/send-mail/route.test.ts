import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const mocks = vi.hoisted(() => ({ getDbAdapter: vi.fn(), sendMail: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 })),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mocks.sendMail }) } }));

import { POST } from './route';
import {
  cleanupPrivateSpoolDirectory,
  createPrivateSpoolDirectory,
  SEND_MAIL_MAX_MULTIPART_BODY_BYTES,
  spoolAttachmentFile,
} from '@/lib/send-mail-private-spool';

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/send-mail', {
    method: 'POST', body, headers: { 'content-type': 'multipart/form-data; boundary=test', ...headers }, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
}

describe('send-mail multipart ingress boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels declared and measured oversized multipart bodies before DB, disk, CAPTCHA or SMTP work', async () => {
    let declaredCancelled = false;
    const declared = new ReadableStream<Uint8Array>({ cancel() { declaredCancelled = true; } });
    const declaredResponse = await POST(streamedRequest(declared, { 'content-length': String(SEND_MAIL_MAX_MULTIPART_BODY_BYTES + 1) }));
    expect(declaredResponse.status).toBe(413);
    expect(declaredCancelled).toBe(true);

    let measuredCancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const measured = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 21; i += 1) controller.enqueue(chunk);
      },
      cancel() { measuredCancelled = true; },
    });
    const measuredResponse = await POST(streamedRequest(measured, { 'content-length': '1' }));
    expect(measuredResponse.status).toBe(413);
    expect(measuredCancelled).toBe(true);
    expect(mocks.getDbAdapter).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('spools exact File stream bytes under UUID-only private paths without arrayBuffer copies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexyfab-send-mail-spool-'));
    try {
      const requestDir = createPrivateSpoolDirectory(root);
      const file = new File([new TextEncoder().encode('exact-attachment')], '../../display-name.step');
      const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
      const spooled = await spoolAttachmentFile(file, requestDir, root);

      expect(spooled.bytes).toBe(file.size);
      expect(basename(spooled.path)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(await readFile(spooled.path, 'utf8')).toBe('exact-attachment');
      expect(arrayBuffer).not.toHaveBeenCalled();
      if (process.platform !== 'win32') {
        expect((await stat(spooled.path)).mode & 0o777).toBe(0o600);
        expect((await stat(requestDir)).mode & 0o777).toBe(0o700);
      }

      await cleanupPrivateSpoolDirectory(requestDir, root);
      await expect(access(requestDir)).rejects.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a File stream whose measured bytes exceed its declared size and removes the partial file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexyfab-send-mail-spool-'));
    try {
      const requestDir = createPrivateSpoolDirectory(root);
      const file = new File([new Uint8Array([1])], 'display.step');
      const oversized = new Uint8Array(new ArrayBuffer(2));
      oversized.set([1, 2]);
      vi.spyOn(file, 'stream').mockReturnValue(new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) { controller.enqueue(oversized); controller.close(); },
      }));
      await expect(spoolAttachmentFile(file, requestDir, root)).rejects.toThrow('attachment byte count exceeded');
      await expect(readdir(requestDir)).resolves.toEqual([]);
      await cleanupPrivateSpoolDirectory(requestDir, root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
