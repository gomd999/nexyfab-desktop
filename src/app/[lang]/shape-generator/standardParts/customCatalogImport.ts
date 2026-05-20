/**
 * customCatalogImport.ts — Bring-your-own toolbox.
 *
 * Korean fabricators often use KS-spec parts that ship under the
 * same ISO designation but with a slightly different head height or
 * tolerance. NexyFab lets users import their own CSV / JSON catalog
 * that gets merged into the toolbox search.
 *
 * Two formats supported:
 *   - CSV with header row: designation, diameter_mm, pitch_mm,
 *     length_mm, material, finish, supplier.
 *   - JSON array of FastenerSpec-shaped objects.
 *
 * Validation: every imported row must pass `validateFastener`
 * before landing in the catalog. Invalid rows surface in the
 * `errors` array for the UI to display.
 */

import {
  buildFastener,
  validateFastener,
  type FastenerSpec,
  type FastenerKind,
} from './fastenerSchema';

export interface CustomCatalogImportResult {
  imported: FastenerSpec[];
  errors: Array<{ rowIndex: number; reason: string }>;
}

const VALID_KINDS: ReadonlyArray<FastenerKind> = [
  'hex-bolt', 'socket-head-cap', 'button-head', 'flat-head',
  'set-screw', 'hex-nut', 'lock-nut', 'flat-washer', 'spring-washer', 'tooth-washer',
];

function isValidKind(s: string): s is FastenerKind {
  return (VALID_KINDS as readonly string[]).includes(s);
}

/** Parse CSV header row + body into FastenerSpec[]. */
export function importCsv(csv: string): CustomCatalogImportResult {
  const out: CustomCatalogImportResult = { imported: [], errors: [] };
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    out.errors.push({ rowIndex: 0, reason: 'CSV needs a header row + at least 1 data row' });
    return out;
  }
  const header = lines[0]!.split(',').map(s => s.trim().toLowerCase());
  const idx = {
    kind:        header.indexOf('kind'),
    diameter:    header.indexOf('diameter_mm'),
    pitch:       header.indexOf('pitch_mm'),
    length:      header.indexOf('length_mm'),
    material:    header.indexOf('material'),
    finish:      header.indexOf('finish'),
    designation: header.indexOf('designation'),
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(',').map(s => s.trim());
    const kindStr = idx.kind >= 0 ? cells[idx.kind] : 'hex-bolt';
    if (!kindStr || !isValidKind(kindStr)) {
      out.errors.push({ rowIndex: i, reason: `Unknown fastener kind: ${kindStr}` });
      continue;
    }
    const d = Number(cells[idx.diameter]);
    const len = Number(cells[idx.length]);
    if (!Number.isFinite(d) || d <= 0) {
      out.errors.push({ rowIndex: i, reason: 'Invalid diameter' });
      continue;
    }
    if (!Number.isFinite(len) || len <= 0) {
      out.errors.push({ rowIndex: i, reason: 'Invalid length' });
      continue;
    }
    const pitch = Number(cells[idx.pitch]);
    try {
      const spec = buildFastener({
        kind: kindStr,
        diameterMm: d,
        lengthMm: len,
        pitchMm: Number.isFinite(pitch) ? pitch : undefined,
        material: (cells[idx.material] || undefined) as FastenerSpec['material'],
        finish: cells[idx.finish] || undefined,
      });
      // Designation override if provided.
      const designationOverride = idx.designation >= 0 ? cells[idx.designation] : '';
      if (designationOverride) spec.designation = designationOverride;
      const errs = validateFastener(spec);
      if (errs.length > 0) {
        out.errors.push({ rowIndex: i, reason: errs.join('; ') });
        continue;
      }
      out.imported.push(spec);
    } catch (err) {
      out.errors.push({ rowIndex: i, reason: (err as Error).message });
    }
  }
  return out;
}

/** Parse JSON array of FastenerSpec into validated catalog. */
export function importJson(json: string): CustomCatalogImportResult {
  const out: CustomCatalogImportResult = { imported: [], errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    out.errors.push({ rowIndex: 0, reason: `Invalid JSON: ${(err as Error).message}` });
    return out;
  }
  if (!Array.isArray(parsed)) {
    out.errors.push({ rowIndex: 0, reason: 'Root JSON must be an array' });
    return out;
  }
  parsed.forEach((row, i) => {
    if (!row || typeof row !== 'object') {
      out.errors.push({ rowIndex: i, reason: 'Row is not an object' });
      return;
    }
    const r = row as Record<string, unknown>;
    if (!r.thread || typeof r.thread !== 'object') {
      out.errors.push({ rowIndex: i, reason: 'Missing thread spec' });
      return;
    }
    const thread = r.thread as { diameterMm?: unknown; pitchMm?: unknown };
    if (typeof thread.diameterMm !== 'number' || typeof thread.pitchMm !== 'number') {
      out.errors.push({ rowIndex: i, reason: 'Thread missing diameter/pitch' });
      return;
    }
    if (typeof r.lengthMm !== 'number' || r.lengthMm <= 0) {
      out.errors.push({ rowIndex: i, reason: 'Invalid lengthMm' });
      return;
    }
    if (typeof r.kind !== 'string' || !isValidKind(r.kind)) {
      out.errors.push({ rowIndex: i, reason: 'Invalid kind' });
      return;
    }
    const spec: FastenerSpec = {
      standard: (r.standard as FastenerSpec['standard']) ?? 'ISO',
      kind: r.kind,
      designation: typeof r.designation === 'string' ? r.designation : 'custom',
      thread: { diameterMm: thread.diameterMm, pitchMm: thread.pitchMm },
      lengthMm: r.lengthMm,
      material: r.material as FastenerSpec['material'],
      finish: typeof r.finish === 'string' ? r.finish : undefined,
    };
    const errs = validateFastener(spec);
    if (errs.length > 0) {
      out.errors.push({ rowIndex: i, reason: errs.join('; ') });
      return;
    }
    out.imported.push(spec);
  });
  return out;
}

/** Merge a custom catalog with built-in tables, deduping by
 *  designation (newer overrides older). */
export function mergeCatalog(base: FastenerSpec[], custom: FastenerSpec[]): FastenerSpec[] {
  const map = new Map<string, FastenerSpec>();
  for (const b of base) map.set(b.designation, b);
  for (const c of custom) map.set(c.designation, c);
  return Array.from(map.values());
}
