/**
 * importMetadata.ts — Extract non-geometric metadata from STEP files.
 *
 * STEP carries a surprising amount of business-relevant info beyond
 * geometry: author / organisation, units, design dates, schema,
 * material assignments (AP242), tolerance specs, custom property
 * values. NexyFab's partner-RFQ funnel uses this to pre-fill quote
 * forms ("Material: Al6061-T6, Source: Acme R&D 2026-01-12") so the
 * user doesn't retype data already in their file.
 *
 * This module is regex-light and forgiving — STEP metadata is sparse
 * and inconsistent across exporters (NX vs SW vs CATIA emit very
 * different formats). We extract what we can and leave the rest as
 * `undefined`.
 */

export interface ImportMetadata {
  /** From HEADER FILE_NAME. Includes author + organisation. */
  fileName?: string;
  author?: string[];
  organisation?: string[];
  preprocessorVersion?: string;
  originatingSystem?: string;
  authorization?: string;

  /** From HEADER FILE_DESCRIPTION. */
  description?: string;

  /** From HEADER FILE_SCHEMA. */
  schema?: string;

  /** Creation timestamps when present. */
  fileTimestamp?: string;

  /** From DATA section — units. */
  unitLength?: 'mm' | 'cm' | 'm' | 'inch';
  unitAngle?: 'rad' | 'deg';

  /** Material name(s) discovered from AP242 PROPERTY_DEFINITION
   *  + DESCRIPTIVE_REPRESENTATION_ITEM blocks. */
  materials: string[];

  /** Custom properties (user-defined attributes). Sparse map. */
  properties: Record<string, string>;
}

const HEADER_BLOCK_RX = /HEADER;([\s\S]*?)ENDSEC;/i;
const FILE_NAME_RX = /FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/i;
const FILE_DESCRIPTION_RX = /FILE_DESCRIPTION\s*\(\s*\(([^)]*)\)/i;
const FILE_SCHEMA_RX = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i;
const SI_UNIT_LENGTH_RX = /SI_UNIT\s*\(\s*\.([^.]+)\.\s*,\s*\.METRE\./gi;
const SI_UNIT_ANGLE_RX = /SI_UNIT\s*\(\s*\$?\s*,\s*\.RADIAN\./i;
const CONVERSION_INCH_RX = /CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i;

/** Split a STEP-quoted comma-separated string into trimmed items
 *  (e.g. `'a','b','c'` → ['a','b','c']). */
function splitQuoted(raw: string): string[] {
  if (!raw.trim()) return [];
  const out: string[] = [];
  const rx = /'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) out.push(m[1]!);
  return out;
}

export function extractMetadata(stepText: string): ImportMetadata {
  const meta: ImportMetadata = {
    materials: [],
    properties: {},
  };

  const header = stepText.match(HEADER_BLOCK_RX)?.[1] ?? '';

  const fn = header.match(FILE_NAME_RX);
  if (fn) {
    meta.fileName = fn[1] || undefined;
    meta.fileTimestamp = fn[2] || undefined;
    meta.author = splitQuoted(fn[3] || '');
    meta.organisation = splitQuoted(fn[4] || '');
    meta.preprocessorVersion = fn[5] || undefined;
    meta.originatingSystem = fn[6] || undefined;
    meta.authorization = fn[7] || undefined;
  }

  const fd = header.match(FILE_DESCRIPTION_RX);
  if (fd) {
    const items = splitQuoted(fd[1] || '');
    if (items.length > 0) meta.description = items.join('; ');
  }

  const fs = header.match(FILE_SCHEMA_RX);
  if (fs) meta.schema = fs[1] || undefined;

  // Unit detection — first match wins.
  if (CONVERSION_INCH_RX.test(stepText)) {
    meta.unitLength = 'inch';
  } else {
    const lenMatches = Array.from(stepText.matchAll(SI_UNIT_LENGTH_RX));
    for (const lm of lenMatches) {
      const prefix = (lm[1] || '').toUpperCase();
      if (prefix === 'MILLI') { meta.unitLength = 'mm'; break; }
      if (prefix === 'CENTI') { meta.unitLength = 'cm'; break; }
      if (prefix === '$' || prefix === '') { meta.unitLength = 'm'; break; }
    }
    if (!meta.unitLength && lenMatches.length > 0) meta.unitLength = 'm';
  }

  if (SI_UNIT_ANGLE_RX.test(stepText)) meta.unitAngle = 'rad';

  // Materials — AP242 puts material name in DESCRIPTIVE_REPRESENTATION_ITEM
  // with descriptor like 'material'. Simple, naive scan.
  const matRx = /DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'([^']*)'\s*,\s*'([^']*material[^']*)'/gi;
  for (const mm of stepText.matchAll(matRx)) {
    const candidate = mm[1] || mm[2] || '';
    if (candidate && !meta.materials.includes(candidate)) {
      meta.materials.push(candidate);
    }
  }

  // Custom properties — PROPERTY_DEFINITION with a name that is not
  // 'shape', 'pmi', or one of the standard system ones we skip.
  const propRx = /PROPERTY_DEFINITION\s*\(\s*'([^']*)'\s*,\s*'([^']*)'/gi;
  const skipNames = new Set(['shape', 'pmi', 'product', 'material property']);
  for (const pm of stepText.matchAll(propRx)) {
    const name = (pm[1] || '').toLowerCase();
    const value = pm[2] || '';
    if (!name || skipNames.has(name)) continue;
    if (!(name in meta.properties)) meta.properties[name] = value;
  }

  return meta;
}

/** Render a one-line human summary of the metadata for the
 *  import-confirm panel. */
export function summarizeMetadata(meta: ImportMetadata): string {
  const parts: string[] = [];
  if (meta.originatingSystem) parts.push(`From: ${meta.originatingSystem}`);
  if (meta.author && meta.author.length > 0) parts.push(`Author: ${meta.author.join(', ')}`);
  if (meta.unitLength) parts.push(`Units: ${meta.unitLength}`);
  if (meta.materials.length > 0) parts.push(`Material: ${meta.materials.join(', ')}`);
  if (meta.schema) parts.push(`Schema: ${meta.schema}`);
  return parts.length === 0 ? 'No metadata extracted' : parts.join(' · ');
}
