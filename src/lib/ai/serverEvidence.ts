import { createHash, timingSafeEqual } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;

/** Canonical JSON for server trust boundaries. Ambiguous values fail closed. */
export function canonicalEvidenceJson(value: unknown): string {
  const stack = new Set<object>();
  const encode = (item: unknown, inArray = false): string | undefined => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Evidence contains a non-finite number.');
      return Object.is(item, -0) ? '0' : JSON.stringify(item);
    }
    if (item === undefined) return inArray ? 'null' : undefined;
    if (typeof item !== 'object') throw new TypeError(`Evidence contains unsupported ${typeof item}.`);
    if (stack.has(item)) throw new TypeError('Evidence contains a cycle.');
    stack.add(item);
    try {
      if (Array.isArray(item)) return `[${item.map(value => encode(value, true) ?? 'null').join(',')}]`;
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Evidence must contain only plain JSON objects.');
      const entries = Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, value]) => {
          const encoded = encode(value);
          return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
        });
      return `{${entries.join(',')}}`;
    } finally {
      stack.delete(item);
    }
  };
  return encode(value) ?? 'null';
}

export function serverEvidenceSha256(value: unknown): string {
  return createHash('sha256').update(canonicalEvidenceJson(value), 'utf8').digest('hex');
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

export function evidenceHashMatches(value: unknown, expected: string): boolean {
  if (!isSha256(expected)) return false;
  const actual = Buffer.from(serverEvidenceSha256(value), 'hex');
  const reference = Buffer.from(expected, 'hex');
  return actual.length === reference.length && timingSafeEqual(actual, reference);
}
