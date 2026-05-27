/**
 * multiCadLibraryImport.ts — Multi-format CAD part library importer.
 *
 * `interop/multiCadImport.ts` provides the per-file adapter framework.
 * This module is a *library-scale* importer: many parts from many
 * formats, deduplicated by geometry hash, organized by category +
 * vendor, with version tracking. Useful for:
 *
 *   - Onboarding a customer's existing CAD library (3,000 brackets,
 *     2,500 fasteners across 5 CAD systems).
 *   - Aggregating vendor catalogs (McMaster + Misumi + Digi-Key).
 *   - Vendor switching: same logical part, different CAD source.
 *
 * Features:
 *
 *   - Dedup via **bbox + vertex-count + checksum** signature.
 *   - **Vendor / category tagging** per import batch.
 *   - **Version supersession** — newer revisions of the same part-id
 *     replace older ones but keep history.
 *   - **Quality scoring** — file size, triangle count, missing
 *     metadata flags.
 */

export type CadFormat = 'STEP' | 'STP' | 'IGES' | 'STL' | 'OBJ' | 'GLTF' | 'GLB' | '3MF' | 'X_T' | 'IPT' | 'PRT' | 'CATPART' | 'unknown';

export interface ImportEntry {
  /** Canonical part id (vendor-agnostic). */
  partId: string;
  /** Source file. */
  filename: string;
  /** Format detected. */
  format: CadFormat;
  /** File size (bytes). */
  fileSize: number;
  /** Triangle count after import. */
  triangleCount: number;
  /** Bounding-box dims (mm). */
  bboxMm: [number, number, number];
  /** Geometry signature — short hash used for dedup. */
  geometrySignature: string;
  /** Vendor / catalog source. */
  vendor?: string;
  /** Category (e.g. 'fastener', 'bearing'). */
  category?: string;
  /** Version string from vendor (semver, date, or revision letter). */
  version?: string;
  /** Imported timestamp (ms epoch). */
  importedAtMs: number;
  /** Tags / metadata. */
  tags?: string[];
}

export interface LibraryEntry {
  partId: string;
  /** Active version (the most recent or chosen). */
  active: ImportEntry;
  /** Older versions retained for audit. */
  history: ImportEntry[];
}

export interface ImportLibrary {
  /** Entries keyed by partId. */
  entries: Map<string, LibraryEntry>;
  /** Signature → partId lookup for dedup. */
  signatureIndex: Map<string, string>;
}

// ── Construction ────────────────────────────────────────────────

export function createLibrary(): ImportLibrary {
  return { entries: new Map(), signatureIndex: new Map() };
}

// ── Format detection ───────────────────────────────────────────

export function detectFormat(filename: string): CadFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'step': case 'stp': return 'STEP';
    case 'iges': case 'igs': return 'IGES';
    case 'stl': return 'STL';
    case 'obj': return 'OBJ';
    case 'gltf': return 'GLTF';
    case 'glb': return 'GLB';
    case '3mf': return '3MF';
    case 'x_t': return 'X_T';
    case 'ipt': return 'IPT';
    case 'prt': return 'PRT';
    case 'catpart': return 'CATPART';
    default: return 'unknown';
  }
}

// ── Geometry signature ─────────────────────────────────────────

export interface GeometryHashInputs {
  vertexCount: number;
  triangleCount: number;
  /** Bounding-box dimensions rounded for fuzz tolerance. */
  bboxMm: [number, number, number];
  /** Optional: total surface area / volume, for stronger dedup. */
  surfaceAreaMm2?: number;
  volumeMm3?: number;
}

/** Compute a 8-char signature; collisions possible but very rare for
 *  CAD parts with distinct bbox + vertex counts. */
export function computeSignature(inputs: GeometryHashInputs, fuzzMm: number = 0.5): string {
  const quant = (x: number) => Math.round(x / fuzzMm);
  const text = [
    inputs.vertexCount,
    inputs.triangleCount,
    quant(inputs.bboxMm[0]),
    quant(inputs.bboxMm[1]),
    quant(inputs.bboxMm[2]),
    inputs.surfaceAreaMm2 !== undefined ? Math.round(inputs.surfaceAreaMm2) : 0,
    inputs.volumeMm3 !== undefined ? Math.round(inputs.volumeMm3) : 0,
  ].join('|');
  return fnv1a32(text);
}

function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(8, '0').slice(0, 8);
}

// ── Importing ─────────────────────────────────────────────────

export interface ImportResult {
  /** Newly added (no dedup hit). */
  added: ImportEntry[];
  /** Skipped due to dedup. */
  deduped: Array<{ entry: ImportEntry; matchedPartId: string }>;
  /** Versions superseded by newer imports. */
  superseded: Array<{ partId: string; oldVersion?: string; newVersion?: string }>;
}

export function importBatch(library: ImportLibrary, batch: ImportEntry[]): ImportResult {
  const added: ImportEntry[] = [];
  const deduped: ImportResult['deduped'] = [];
  const superseded: ImportResult['superseded'] = [];

  for (const entry of batch) {
    const existingByPartId = library.entries.get(entry.partId);
    const existingBySignature = library.signatureIndex.get(entry.geometrySignature);

    if (existingByPartId) {
      // Same part-id → either supersession or duplicate version.
      if (existingByPartId.active.version !== entry.version) {
        const old = existingByPartId.active;
        existingByPartId.history.push(old);
        existingByPartId.active = entry;
        superseded.push({ partId: entry.partId, oldVersion: old.version, newVersion: entry.version });
        library.signatureIndex.set(entry.geometrySignature, entry.partId);
      } else {
        deduped.push({ entry, matchedPartId: entry.partId });
      }
      continue;
    }

    if (existingBySignature && existingBySignature !== entry.partId) {
      // Different part-id, same geometry → dedup hit (likely an alias).
      deduped.push({ entry, matchedPartId: existingBySignature });
      continue;
    }

    // Net new.
    const libEntry: LibraryEntry = { partId: entry.partId, active: entry, history: [] };
    library.entries.set(entry.partId, libEntry);
    library.signatureIndex.set(entry.geometrySignature, entry.partId);
    added.push(entry);
  }

  return { added, deduped, superseded };
}

// ── Quality scoring ────────────────────────────────────────────

export interface QualityScore {
  partId: string;
  /** 0..100, higher = better. */
  score: number;
  /** Flags raised. */
  flags: string[];
}

export function scoreEntry(entry: ImportEntry): QualityScore {
  const flags: string[] = [];
  let score = 100;

  if (entry.format === 'unknown') {
    flags.push('Unknown format');
    score -= 30;
  }
  if (entry.format === 'STL' || entry.format === 'OBJ') {
    flags.push('Mesh-only format — no parametric history');
    score -= 10;
  }
  if (entry.triangleCount > 100_000) {
    flags.push(`Very high triangle count (${entry.triangleCount})`);
    score -= 15;
  } else if (entry.triangleCount < 12) {
    flags.push('Triangle count suspiciously low');
    score -= 20;
  }
  if (!entry.vendor) {
    flags.push('Missing vendor');
    score -= 5;
  }
  if (!entry.category) {
    flags.push('Missing category');
    score -= 5;
  }
  if (!entry.version) {
    flags.push('Missing version');
    score -= 5;
  }
  if (entry.fileSize > 10 * 1024 * 1024) {
    flags.push('File > 10MB');
    score -= 5;
  }

  return { partId: entry.partId, score: Math.max(0, score), flags };
}

// ── Search / filter ────────────────────────────────────────────

export interface LibrarySearchOptions {
  vendor?: string;
  category?: string;
  format?: CadFormat;
  /** Tags that must all be present. */
  requiredTags?: string[];
  minQualityScore?: number;
}

export function searchLibrary(library: ImportLibrary, options: LibrarySearchOptions): LibraryEntry[] {
  const results: LibraryEntry[] = [];
  for (const entry of library.entries.values()) {
    const a = entry.active;
    if (options.vendor && a.vendor !== options.vendor) continue;
    if (options.category && a.category !== options.category) continue;
    if (options.format && a.format !== options.format) continue;
    if (options.requiredTags) {
      const tags = a.tags ?? [];
      if (!options.requiredTags.every(t => tags.includes(t))) continue;
    }
    if (options.minQualityScore !== undefined) {
      const score = scoreEntry(a);
      if (score.score < options.minQualityScore) continue;
    }
    results.push(entry);
  }
  return results;
}

// ── Stats ──────────────────────────────────────────────────────

export interface LibraryStats {
  partCount: number;
  totalRevisions: number;
  byFormat: Record<CadFormat, number>;
  byVendor: Record<string, number>;
  averageQualityScore: number;
}

export function summarize(library: ImportLibrary): LibraryStats {
  const byFormat: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  let qualitySum = 0;
  let revisions = 0;
  for (const entry of library.entries.values()) {
    const a = entry.active;
    byFormat[a.format] = (byFormat[a.format] ?? 0) + 1;
    if (a.vendor) byVendor[a.vendor] = (byVendor[a.vendor] ?? 0) + 1;
    qualitySum += scoreEntry(a).score;
    revisions += 1 + entry.history.length;
  }
  const count = library.entries.size;
  return {
    partCount: count,
    totalRevisions: revisions,
    byFormat: byFormat as Record<CadFormat, number>,
    byVendor,
    averageQualityScore: count > 0 ? qualitySum / count : 0,
  };
}
