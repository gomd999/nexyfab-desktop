/**
 * partNumberingScheme.ts — Configurable part-number generator.
 *
 * Every shop has its own part-numbering policy:
 *
 *   - "BR-2026-0042"  — prefix + year + sequence
 *   - "A1-001-X-CR"   — category + size + revision + finish
 *   - "PN-25KX9ZA"    — short alphanumeric hash from project ID
 *
 * Implementing a shop's policy correctly matters because:
 *
 *   - **Duplicate prevention** — the same physical part must always
 *     get the same number across revisions.
 *   - **Lookup ergonomics** — humans should be able to read the
 *     number and infer family / generation.
 *   - **ERP / MRP integration** — downstream systems expect specific
 *     field positions.
 *
 * This module ships a small DSL of "segments" that get concatenated
 * with a configurable separator. Each segment kind:
 *
 *   - `literal`     — fixed text ("BR")
 *   - `sequence`    — auto-incrementing counter scoped by category
 *   - `year`        — 2- or 4-digit year
 *   - `month`       — 2-digit month
 *   - `category`    — lookup table value
 *   - `attribute`   — field from the part's metadata (material, size)
 *   - `checksum`    — Luhn / mod-26 alphabetic checksum
 *   - `hash`        — short base-N hash of the project / id
 */

export type SegmentKind =
  | 'literal' | 'sequence' | 'year' | 'month'
  | 'category' | 'attribute' | 'checksum' | 'hash';

export interface LiteralSegment {
  kind: 'literal';
  value: string;
}

export interface SequenceSegment {
  kind: 'sequence';
  /** Width with leading zeros (e.g. 4 → "0042"). */
  width: number;
  /** Scope key — the counter for this scope increments independently. */
  scope: string;
}

export interface YearSegment {
  kind: 'year';
  /** 2 or 4 digits. */
  digits: 2 | 4;
}

export interface MonthSegment {
  kind: 'month';
}

export interface CategorySegment {
  kind: 'category';
  /** Attribute key in the part metadata to look up. */
  attributeKey: string;
  /** Mapping of attribute value → category code. */
  mapping: Record<string, string>;
  /** Fallback if unknown. */
  fallback: string;
}

export interface AttributeSegment {
  kind: 'attribute';
  attributeKey: string;
  /** Optional uppercase transform. */
  upperCase?: boolean;
  /** Max characters. */
  maxLength?: number;
}

export interface ChecksumSegment {
  kind: 'checksum';
  algorithm: 'luhn' | 'mod26' | 'iso7064-mod37-2';
}

export interface HashSegment {
  kind: 'hash';
  /** Attribute key whose value is hashed. */
  attributeKey: string;
  /** Base for the encoded hash. */
  base: 16 | 26 | 32 | 36;
  /** Number of characters. */
  length: number;
}

export type Segment = LiteralSegment | SequenceSegment | YearSegment | MonthSegment | CategorySegment | AttributeSegment | ChecksumSegment | HashSegment;

export interface PartNumberScheme {
  /** Display name. */
  name: string;
  /** Segments in order. */
  segments: Segment[];
  /** Separator between segments (e.g. "-"). */
  separator: string;
}

export interface PartMetadata {
  /** Generation date (defaults to now). */
  date?: Date;
  /** Arbitrary fields used by category/attribute/hash segments. */
  attributes: Record<string, string>;
}

// ── Sequence counter ───────────────────────────────────────────

export class SequenceCounter {
  private counters = new Map<string, number>();

  next(scope: string): number {
    const v = (this.counters.get(scope) ?? 0) + 1;
    this.counters.set(scope, v);
    return v;
  }

  peek(scope: string): number {
    return this.counters.get(scope) ?? 0;
  }

  setFromSnapshot(snapshot: Record<string, number>): void {
    this.counters.clear();
    for (const [k, v] of Object.entries(snapshot)) this.counters.set(k, v);
  }

  toSnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[k] = v;
    return out;
  }
}

// ── Top-level entry ─────────────────────────────────────────────

export function generatePartNumber(
  scheme: PartNumberScheme,
  metadata: PartMetadata,
  counter: SequenceCounter,
): string {
  const date = metadata.date ?? new Date();
  const segments: string[] = [];
  for (const seg of scheme.segments) {
    segments.push(renderSegment(seg, metadata, counter, date, segments));
  }
  return segments.join(scheme.separator);
}

function renderSegment(seg: Segment, meta: PartMetadata, counter: SequenceCounter, date: Date, soFar: string[]): string {
  switch (seg.kind) {
    case 'literal':
      return seg.value;
    case 'sequence':
      return String(counter.next(seg.scope)).padStart(seg.width, '0');
    case 'year': {
      const y = date.getUTCFullYear();
      return seg.digits === 2 ? String(y % 100).padStart(2, '0') : String(y).padStart(4, '0');
    }
    case 'month':
      return String(date.getUTCMonth() + 1).padStart(2, '0');
    case 'category': {
      const value = meta.attributes[seg.attributeKey];
      if (value === undefined) return seg.fallback;
      return seg.mapping[value] ?? seg.fallback;
    }
    case 'attribute': {
      let v = meta.attributes[seg.attributeKey] ?? '';
      if (seg.upperCase) v = v.toUpperCase();
      if (seg.maxLength !== undefined) v = v.slice(0, seg.maxLength);
      return v;
    }
    case 'checksum': {
      const baseText = soFar.join('');
      return checksum(baseText, seg.algorithm);
    }
    case 'hash': {
      const v = meta.attributes[seg.attributeKey] ?? '';
      return hashString(v, seg.base, seg.length);
    }
  }
}

// ── Checksum algorithms ────────────────────────────────────────

export function checksum(text: string, algorithm: 'luhn' | 'mod26' | 'iso7064-mod37-2'): string {
  switch (algorithm) {
    case 'luhn': return luhnDigit(text);
    case 'mod26': return mod26Digit(text);
    case 'iso7064-mod37-2': return iso7064Mod37(text);
  }
}

function luhnDigit(text: string): string {
  const digits = text.replace(/[^0-9]/g, '').split('').map(Number).reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i]!;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const r = (10 - (sum % 10)) % 10;
  return String(r);
}

function mod26Digit(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return String.fromCharCode(65 + (sum % 26));
}

function iso7064Mod37(text: string): string {
  // Simplified ISO 7064 MOD 37, 2 — used in some shop part schemas.
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ*';
  let p = 2;
  for (const c of text.toUpperCase()) {
    const idx = chars.indexOf(c);
    const code = idx < 0 ? 0 : idx;
    p = ((p + code) * 2) % 37;
  }
  const checkValue = (38 - p) % 37;
  return chars[checkValue] ?? '*';
}

// ── Hash ───────────────────────────────────────────────────────

export function hashString(text: string, base: 16 | 26 | 32 | 36, length: number): string {
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map to alphabet of given base.
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const slice = alphabet.slice(0, base);
  let n = h >>> 0;
  let out = '';
  while (out.length < length) {
    out = slice[n % base] + out;
    n = Math.floor(n / base);
    if (n === 0 && out.length < length) {
      out = slice[0]!.repeat(length - out.length) + out;
      break;
    }
  }
  return out;
}

// ── Validation ─────────────────────────────────────────────────

export interface NumberValidation {
  valid: boolean;
  /** Per-segment expected length / actual length. */
  segmentLengths: number[];
  /** Issues found. */
  issues: string[];
}

export function validateNumber(scheme: PartNumberScheme, numberStr: string): NumberValidation {
  const parts = numberStr.split(scheme.separator);
  const issues: string[] = [];
  if (parts.length !== scheme.segments.length) {
    issues.push(`Expected ${scheme.segments.length} segments, got ${parts.length}`);
  }
  const segmentLengths = parts.map(p => p.length);
  for (let i = 0; i < scheme.segments.length; i++) {
    const seg = scheme.segments[i]!;
    const value = parts[i] ?? '';
    if (seg.kind === 'sequence' && value.length !== seg.width) {
      issues.push(`Segment ${i} (sequence) width ${value.length} ≠ ${seg.width}`);
    }
    if (seg.kind === 'year') {
      if (seg.digits === 2 && !/^\d{2}$/.test(value)) issues.push(`Segment ${i} (year2) invalid`);
      if (seg.digits === 4 && !/^\d{4}$/.test(value)) issues.push(`Segment ${i} (year4) invalid`);
    }
  }
  return { valid: issues.length === 0, segmentLengths, issues };
}

// ── Preset schemes ──────────────────────────────────────────────

export const SCHEMES: Record<string, PartNumberScheme> = {
  category_year_seq: {
    name: 'CAT-YEAR-SEQ',
    separator: '-',
    segments: [
      { kind: 'category', attributeKey: 'category', mapping: { bracket: 'BR', shaft: 'SH', plate: 'PL' }, fallback: 'GN' },
      { kind: 'year', digits: 4 },
      { kind: 'sequence', width: 4, scope: 'default' },
    ],
  },
  short_hash: {
    name: 'PN-HASH',
    separator: '-',
    segments: [
      { kind: 'literal', value: 'PN' },
      { kind: 'hash', attributeKey: 'projectId', base: 36, length: 6 },
    ],
  },
  iso_check: {
    name: 'CAT-SEQ-CK',
    separator: '-',
    segments: [
      { kind: 'category', attributeKey: 'category', mapping: { bracket: 'BR', shaft: 'SH' }, fallback: 'GN' },
      { kind: 'sequence', width: 5, scope: 'default' },
      { kind: 'checksum', algorithm: 'iso7064-mod37-2' },
    ],
  },
};
