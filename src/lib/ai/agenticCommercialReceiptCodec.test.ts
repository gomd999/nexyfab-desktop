import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeAgenticCommercialReceiptEnvelope, encodeAgenticCommercialReceiptEnvelope } from './agenticCommercialReceiptCodec';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
describe('agentic commercial receipt binary codec', () => {
  it('round-trips candidate/final exact canonical envelopes with embedded bytes', () => {
    const payload = { schema: 'candidate', nested: { bytes: new Uint8Array([0, 1, 255]), sha: hash(new Uint8Array([2])) }, list: [1, 'x'] };
    for (const kind of ['candidate', 'final'] as const) {
      const encoded = encodeAgenticCommercialReceiptEnvelope(kind, payload);
      const decoded = decodeAgenticCommercialReceiptEnvelope(encoded);
      expect(decoded.kind).toBe(kind);
      expect(decoded.payload.nested).toMatchObject({ bytes: new Uint8Array([0, 1, 255]) });
      expect(encodeAgenticCommercialReceiptEnvelope(kind, decoded.payload)).toEqual(encoded);
    }
  });

  it('rejects malformed UTF8, duplicate/prototype keys, unknown envelope keys, and noncanonical base64', () => {
    const valid = encodeAgenticCommercialReceiptEnvelope('candidate', { bytes: new Uint8Array([1]) });
    const text = new TextDecoder().decode(valid);
    expect(() => decodeAgenticCommercialReceiptEnvelope(new Uint8Array([0xc3, 0x28]))).toThrow('UTF8_INVALID');
    expect(() => decodeAgenticCommercialReceiptEnvelope(new TextEncoder().encode(text.replace('"kind":"candidate"', '"kind":"candidate","kind":"candidate"')))).toThrow('DUPLICATE_OR_FORBIDDEN_KEY');
    expect(() => decodeAgenticCommercialReceiptEnvelope(new TextEncoder().encode(text.replace('"schema":', '"unknown":1,"schema":')))).toThrow('ENVELOPE_SHAPE_INVALID');
    const binary = text.replace('AQ', 'AQ==');
    expect(() => decodeAgenticCommercialReceiptEnvelope(new TextEncoder().encode(binary))).toThrow('PAYLOAD_HASH_INVALID');
  });

  it('rejects forged size/hash, depth, arrays and total byte caps before materialization', () => {
    const valid = new TextDecoder().decode(encodeAgenticCommercialReceiptEnvelope('candidate', { bytes: new Uint8Array([1, 2]) }));
    expect(() => decodeAgenticCommercialReceiptEnvelope(new TextEncoder().encode(valid.replace('"size":2', '"size":3')))).toThrow('PAYLOAD_HASH_INVALID');
    const deep: Record<string, unknown> = {}; let current = deep; for (let i = 0; i < 34; i++) { current.next = {}; current = current.next as Record<string, unknown>; }
    expect(() => encodeAgenticCommercialReceiptEnvelope('candidate', deep)).toThrow('DEPTH_LIMIT');
    expect(() => encodeAgenticCommercialReceiptEnvelope('candidate', { values: Array.from({ length: 4097 }, () => 1) })).toThrow('ARRAY_LIMIT');
    expect(() => encodeAgenticCommercialReceiptEnvelope('candidate', { ...Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [`k${index}`, index])) })).toThrow('OBJECT_KEY_LIMIT');
    expect(() => encodeAgenticCommercialReceiptEnvelope('candidate', { text: 'x'.repeat(16 * 1024 * 1024 + 1) })).toThrow('TEXT_LIMIT');
  });
});
