import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_ARRAY = 4096;
const MAX_OBJECT_KEYS = 4096;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 100_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
export type AgenticReceiptEnvelopeKind = 'candidate' | 'final';
export interface AgenticCommercialReceiptEnvelope { schema: 'nexyfab.agentic-commercial-receipt-envelope.v1'; kind: AgenticReceiptEnvelopeKind; payload: Record<string, unknown>; payloadSize: number; payloadSha256: string; }
export interface DecodedAgenticCommercialReceiptEnvelope { kind: AgenticReceiptEnvelopeKind; payload: Record<string, unknown>; envelope: AgenticCommercialReceiptEnvelope; bytes: Uint8Array; }
export class AgenticCommercialReceiptCodecError extends Error { constructor(public readonly code: string) { super(code); } }

function digest(bytes: Uint8Array): string { return createHash('sha256').update(Buffer.from(bytes)).digest('hex'); }
function canonical(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new AgenticCommercialReceiptCodecError('DEPTH_LIMIT');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new AgenticCommercialReceiptCodecError('NONFINITE_NUMBER'); return JSON.stringify(value); }
  if (Array.isArray(value)) { if (value.length > MAX_ARRAY) throw new AgenticCommercialReceiptCodecError('ARRAY_LIMIT'); return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`; }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>; const keys = Object.keys(object);
    if (keys.length > MAX_OBJECT_KEYS) throw new AgenticCommercialReceiptCodecError('OBJECT_KEY_LIMIT');
    if (keys.some(key => FORBIDDEN_KEYS.has(key))) throw new AgenticCommercialReceiptCodecError('FORBIDDEN_KEY');
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`;
  }
  throw new AgenticCommercialReceiptCodecError('NONCANONICAL_VALUE');
}
function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString('base64url'); }
function materialize(value: unknown, depth = 0, total = { bytes: 0, text: 0, nodes: 0 }): unknown {
  if (depth > MAX_DEPTH) throw new AgenticCommercialReceiptCodecError('DEPTH_LIMIT');
  if (++total.nodes > MAX_NODES) throw new AgenticCommercialReceiptCodecError('NODE_LIMIT');
  if (value instanceof Uint8Array) { total.bytes += value.length; if (value.length > MAX_BYTES || total.bytes > MAX_TOTAL_BYTES) throw new AgenticCommercialReceiptCodecError('BYTE_LIMIT'); return { data: base64url(value), encoding: 'base64url', sha256: digest(value), size: value.length }; }
  if (typeof value === 'string') { total.text += Buffer.byteLength(value, 'utf8'); if (total.text > MAX_TEXT_BYTES) throw new AgenticCommercialReceiptCodecError('TEXT_LIMIT'); return value; }
  if (Array.isArray(value)) { if (value.length > MAX_ARRAY) throw new AgenticCommercialReceiptCodecError('ARRAY_LIMIT'); return value.map(item => materialize(item, depth + 1, total)); }
  if (value && typeof value === 'object') { const object = value as Record<string, unknown>; const keys = Object.keys(object); if (keys.length > MAX_OBJECT_KEYS) throw new AgenticCommercialReceiptCodecError('OBJECT_KEY_LIMIT'); if (keys.some(key => FORBIDDEN_KEYS.has(key))) throw new AgenticCommercialReceiptCodecError('FORBIDDEN_KEY'); const result: Record<string, unknown> = {}; for (const key of keys) result[key] = materialize(object[key], depth + 1, total); return result; }
  return value;
}
function dematerialize(value: unknown, depth = 0, total = { bytes: 0 }): unknown {
  if (depth > MAX_DEPTH) throw new AgenticCommercialReceiptCodecError('DEPTH_LIMIT');
  if (Array.isArray(value)) { if (value.length > MAX_ARRAY) throw new AgenticCommercialReceiptCodecError('ARRAY_LIMIT'); return value.map(item => dematerialize(item, depth + 1, total)); }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>; const keys = Object.keys(object); if (keys.length > MAX_OBJECT_KEYS) throw new AgenticCommercialReceiptCodecError('OBJECT_KEY_LIMIT'); if (keys.some(key => FORBIDDEN_KEYS.has(key))) throw new AgenticCommercialReceiptCodecError('FORBIDDEN_KEY');
    if ('encoding' in object) {
      if (keys.length !== 4 || object.encoding !== 'base64url' || typeof object.data !== 'string' || typeof object.size !== 'number' || !Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_BYTES || typeof object.sha256 !== 'string' || !SHA256.test(object.sha256) || !BASE64URL.test(object.data) || object.data.includes('=')) throw new AgenticCommercialReceiptCodecError('BINARY_SHAPE_INVALID');
      const bytes = new Uint8Array(Buffer.from(object.data, 'base64url')); if (base64url(bytes) !== object.data || bytes.length !== object.size || digest(bytes) !== object.sha256) throw new AgenticCommercialReceiptCodecError('BINARY_HASH_INVALID'); total.bytes += bytes.length; if (total.bytes > MAX_TOTAL_BYTES) throw new AgenticCommercialReceiptCodecError('BYTE_LIMIT'); return bytes;
    }
    const result: Record<string, unknown> = {}; for (const key of keys) result[key] = dematerialize(object[key], depth + 1, total); return result;
  }
  return value;
}

function strictJson(text: string): unknown {
  let index = 0;
  let nodes = 0;
  let textBytes = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '')) index++; };
  const string = (): string => { const start = index; if (text[index++] !== '"') throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); while (index < text.length) { const char = text[index++]; if (char === '\\') { index++; continue; } if (char === '"') { try { const parsed = JSON.parse(text.slice(start, index)) as string; textBytes += Buffer.byteLength(parsed, 'utf8'); if (textBytes > MAX_TEXT_BYTES) throw new AgenticCommercialReceiptCodecError('TEXT_LIMIT'); return parsed; } catch (error) { if (error instanceof AgenticCommercialReceiptCodecError) throw error; throw new AgenticCommercialReceiptCodecError('UTF8_OR_JSON_INVALID'); } } } throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); };
  const value = (depth = 0): unknown => { if (depth > MAX_DEPTH) throw new AgenticCommercialReceiptCodecError('DEPTH_LIMIT'); if (++nodes > MAX_NODES) throw new AgenticCommercialReceiptCodecError('NODE_LIMIT'); whitespace(); const char = text[index]; if (char === '{') { index++; const result: Record<string, unknown> = {}; const keys = new Set<string>(); whitespace(); if (text[index] === '}') { index++; return result; } while (true) { whitespace(); const key = string(); if (FORBIDDEN_KEYS.has(key) || keys.has(key)) throw new AgenticCommercialReceiptCodecError('DUPLICATE_OR_FORBIDDEN_KEY'); keys.add(key); if (keys.size > MAX_OBJECT_KEYS) throw new AgenticCommercialReceiptCodecError('OBJECT_KEY_LIMIT'); whitespace(); if (text[index++] !== ':') throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); result[key] = value(depth + 1); whitespace(); if (text[index] === '}') { index++; return result; } if (text[index++] !== ',') throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); } }
    if (char === '[') { index++; const result: unknown[] = []; whitespace(); if (text[index] === ']') { index++; return result; } while (true) { result.push(value(depth + 1)); if (result.length > MAX_ARRAY) throw new AgenticCommercialReceiptCodecError('ARRAY_LIMIT'); whitespace(); if (text[index] === ']') { index++; return result; } if (text[index++] !== ',') throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); } }
    if (char === '"') return string(); const start = index; while (index < text.length && !/[\s,\]}]/.test(text[index])) index++; const token = text.slice(start, index); if (token === 'true') return true; if (token === 'false') return false; if (token === 'null') return null; if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) { const number = Number(token); if (!Number.isFinite(number)) throw new AgenticCommercialReceiptCodecError('NONFINITE_NUMBER'); return number; } throw new AgenticCommercialReceiptCodecError('JSON_INVALID'); };
  const parsed = value(); whitespace(); if (index !== text.length) throw new AgenticCommercialReceiptCodecError('JSON_TRAILING_DATA'); return parsed;
}

export function encodeAgenticCommercialReceiptEnvelope(kind: AgenticReceiptEnvelopeKind, payload: Record<string, unknown>): Uint8Array {
  if (kind !== 'candidate' && kind !== 'final') throw new AgenticCommercialReceiptCodecError('ENVELOPE_KIND_INVALID');
  const material = materialize(payload); if (!material || Array.isArray(material) || typeof material !== 'object') throw new AgenticCommercialReceiptCodecError('PAYLOAD_SHAPE_INVALID');
  const payloadBytes = new Uint8Array(Buffer.from(canonical(material), 'utf8'));
  if (payloadBytes.length > MAX_TOTAL_BYTES) throw new AgenticCommercialReceiptCodecError('PAYLOAD_SIZE_INVALID');
  const envelope = { schema: 'nexyfab.agentic-commercial-receipt-envelope.v1' as const, kind, payload: material, payloadSize: payloadBytes.length, payloadSha256: digest(payloadBytes) };
  const encoded = new Uint8Array(Buffer.from(canonical(envelope), 'utf8'));
  if (encoded.length > MAX_TOTAL_BYTES) throw new AgenticCommercialReceiptCodecError('ENVELOPE_SIZE_INVALID');
  return encoded;
}
export function decodeAgenticCommercialReceiptEnvelope(bytes: Uint8Array): DecodedAgenticCommercialReceiptEnvelope {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_TOTAL_BYTES) throw new AgenticCommercialReceiptCodecError('ENVELOPE_SIZE_INVALID');
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new AgenticCommercialReceiptCodecError('UTF8_INVALID'); }
  const parsed = strictJson(text); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AgenticCommercialReceiptCodecError('ENVELOPE_SHAPE_INVALID');
  const envelope = parsed as Record<string, unknown>; const keys = Object.keys(envelope).sort(); if (keys.join(',') !== 'kind,payload,payloadSha256,payloadSize,schema' || envelope.schema !== 'nexyfab.agentic-commercial-receipt-envelope.v1' || (envelope.kind !== 'candidate' && envelope.kind !== 'final') || typeof envelope.payloadSize !== 'number' || !Number.isSafeInteger(envelope.payloadSize) || envelope.payloadSize < 1 || envelope.payloadSize > MAX_TOTAL_BYTES || typeof envelope.payloadSha256 !== 'string' || !SHA256.test(envelope.payloadSha256) || !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) throw new AgenticCommercialReceiptCodecError('ENVELOPE_SHAPE_INVALID');
  const material = envelope.payload as Record<string, unknown>; const payloadBytes = new Uint8Array(Buffer.from(canonical(material), 'utf8')); if (payloadBytes.length !== envelope.payloadSize || digest(payloadBytes) !== envelope.payloadSha256) throw new AgenticCommercialReceiptCodecError('PAYLOAD_HASH_INVALID');
  const payload = dematerialize(material); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AgenticCommercialReceiptCodecError('PAYLOAD_SHAPE_INVALID');
  const reencoded = encodeAgenticCommercialReceiptEnvelope(envelope.kind, payload as Record<string, unknown>); if (reencoded.length !== bytes.length || !reencoded.every((byte, index) => byte === bytes[index])) throw new AgenticCommercialReceiptCodecError('NONCANONICAL_ENVELOPE');
  return { kind: envelope.kind, payload: payload as Record<string, unknown>, envelope: { schema: envelope.schema, kind: envelope.kind, payload: payload as Record<string, unknown>, payloadSize: envelope.payloadSize, payloadSha256: envelope.payloadSha256 }, bytes: new Uint8Array(bytes) };
}
