import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as deepRoundtrip } from './deep-roundtrip/route';
import { POST as domainIr } from './domain-ir/route';
import { POST as recoverGeometry } from './recover-geometry/route';
import { POST as recoveryPlan } from './recovery-plan/route';
import { POST as semanticRoundtrip } from './semantic-roundtrip/route';
import { POST as spatialIr } from './spatial-ir/route';
import { MAX_INLINE_IFC_BYTES, MAX_PAIR_IFC_JSON_BYTES, MAX_SINGLE_IFC_JSON_BYTES } from './bodyLimits';

type Handler = (request: NextRequest) => Promise<Response>;
const cases: Array<{ name: string; path: string; maximumBytes: number; handler: Handler }> = [
  { name: 'deep-roundtrip', path: 'deep-roundtrip', maximumBytes: MAX_PAIR_IFC_JSON_BYTES, handler: deepRoundtrip },
  { name: 'domain-ir', path: 'domain-ir', maximumBytes: MAX_SINGLE_IFC_JSON_BYTES, handler: domainIr },
  { name: 'recover-geometry', path: 'recover-geometry', maximumBytes: MAX_SINGLE_IFC_JSON_BYTES, handler: recoverGeometry },
  { name: 'recovery-plan', path: 'recovery-plan', maximumBytes: MAX_SINGLE_IFC_JSON_BYTES, handler: recoveryPlan },
  { name: 'semantic-roundtrip', path: 'semantic-roundtrip', maximumBytes: MAX_PAIR_IFC_JSON_BYTES, handler: semanticRoundtrip },
  { name: 'spatial-ir', path: 'spatial-ir', maximumBytes: MAX_SINGLE_IFC_JSON_BYTES, handler: spatialIr },
];

let ipSuffix = 10;
function request(path: string, body: BodyInit, headers: Record<string, string> = {}): NextRequest {
  ipSuffix += 1;
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${ipSuffix}`, ...headers },
    body,
    duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
  return new NextRequest(`http://localhost/api/cad/v1/ifc/${path}`, init);
}

describe('CAD v1 inline IFC streaming body boundaries', () => {
  it('reserves finite envelope room for JSON-escaped full-size UTF-8 IFC payloads', () => {
    expect(MAX_SINGLE_IFC_JSON_BYTES).toBeGreaterThan(MAX_INLINE_IFC_BYTES * 3);
    expect(MAX_PAIR_IFC_JSON_BYTES).toBeGreaterThan(MAX_INLINE_IFC_BYTES * 6);
  });

  for (const entry of cases) {
    it(`${entry.name} measures a falsely small Content-Length and cancels an oversized stream`, async () => {
      const chunk = new Uint8Array(1024 * 1024);
      let emitted = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted <= entry.maximumBytes) {
            controller.enqueue(chunk);
            emitted += chunk.byteLength;
          } else controller.close();
        },
        cancel() { cancelled = true; },
      });
      const response = await entry.handler(request(entry.path, stream, { 'content-length': '1' }));
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
      expect(cancelled).toBe(true);
    });

    it(`${entry.name} rejects malformed JSON and invalid UTF-8`, async () => {
      const malformed = await entry.handler(request(entry.path, '{'));
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });

      const invalidUtf8 = await entry.handler(request(entry.path, new Uint8Array([0xff])));
      expect(invalidUtf8.status).toBe(400);
      await expect(invalidUtf8.json()).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    });
  }
});
