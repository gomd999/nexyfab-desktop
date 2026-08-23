import crypto from 'node:crypto';

export const SHA256 = /^[a-f0-9]{64}$/;

// Receipt hashes are over a key-sorted representation so object insertion order
// cannot change the meaning of an evidence packet.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(
    Buffer.isBuffer(value) ? value : canonicalJson(value),
  ).digest('hex');
}

export function attachReceiptSha256(receipt) {
  const { receiptSha256: _ignored, ...unsigned } = receipt ?? {};
  return { ...unsigned, receiptSha256: sha256(unsigned) };
}

export function verifyReceiptSha256(receipt) {
  if (!SHA256.test(String(receipt?.receiptSha256 ?? ''))) return false;
  const { receiptSha256: _ignored, ...unsigned } = receipt;
  return sha256(unsigned) === receipt.receiptSha256;
}
