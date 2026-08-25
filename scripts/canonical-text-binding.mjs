import { createHash } from 'node:crypto';

export const TEXT_BINDING_CANONICALIZATION = 'utf8-crlf-to-lf';

export function canonicalizeText(value) {
  const text = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value).toString('utf8')
    : String(value);
  return text.replaceAll('\r\n', '\n');
}

export function canonicalTextBuffer(value) {
  return Buffer.from(canonicalizeText(value), 'utf8');
}

export function canonicalTextSha256(value) {
  return createHash('sha256').update(canonicalTextBuffer(value)).digest('hex');
}

export function canonicalTextBinding(value) {
  const bytes = canonicalTextBuffer(value);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    canonicalization: TEXT_BINDING_CANONICALIZATION,
  };
}

export function canonicalTextEqual(left, right) {
  return canonicalizeText(left) === canonicalizeText(right);
}
