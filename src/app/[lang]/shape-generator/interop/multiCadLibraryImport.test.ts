import { describe, it, expect } from 'vitest';
import {
  createLibrary,
  detectFormat,
  computeSignature,
  importBatch,
  scoreEntry,
  searchLibrary,
  summarize,
  type ImportEntry,
} from './multiCadLibraryImport';

function makeEntry(opts: Partial<ImportEntry> & { partId: string }): ImportEntry {
  return {
    partId: opts.partId,
    filename: opts.filename ?? `${opts.partId}.step`,
    format: opts.format ?? 'STEP',
    fileSize: opts.fileSize ?? 1024,
    triangleCount: opts.triangleCount ?? 1000,
    bboxMm: opts.bboxMm ?? [10, 10, 10],
    geometrySignature: opts.geometrySignature ?? 'sig-default',
    importedAtMs: opts.importedAtMs ?? Date.now(),
    ...(opts.vendor !== undefined ? { vendor: opts.vendor } : {}),
    ...(opts.category !== undefined ? { category: opts.category } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
  };
}

describe('detectFormat', () => {
  it('detects STEP', () => {
    expect(detectFormat('part.step')).toBe('STEP');
    expect(detectFormat('part.stp')).toBe('STEP');
  });

  it('detects IGES', () => {
    expect(detectFormat('part.iges')).toBe('IGES');
    expect(detectFormat('part.igs')).toBe('IGES');
  });

  it('detects mesh formats', () => {
    expect(detectFormat('p.stl')).toBe('STL');
    expect(detectFormat('p.obj')).toBe('OBJ');
    expect(detectFormat('p.glb')).toBe('GLB');
  });

  it('unknown extension → unknown', () => {
    expect(detectFormat('p.xyz')).toBe('unknown');
  });
});

describe('computeSignature', () => {
  it('deterministic for same inputs', () => {
    const s1 = computeSignature({ vertexCount: 100, triangleCount: 200, bboxMm: [10, 10, 10] });
    const s2 = computeSignature({ vertexCount: 100, triangleCount: 200, bboxMm: [10, 10, 10] });
    expect(s1).toBe(s2);
  });

  it('differs for different bbox', () => {
    const s1 = computeSignature({ vertexCount: 100, triangleCount: 200, bboxMm: [10, 10, 10] });
    const s2 = computeSignature({ vertexCount: 100, triangleCount: 200, bboxMm: [20, 10, 10] });
    expect(s1).not.toBe(s2);
  });

  it('8-char signature', () => {
    const s = computeSignature({ vertexCount: 100, triangleCount: 200, bboxMm: [10, 10, 10] });
    expect(s).toHaveLength(8);
  });
});

describe('importBatch', () => {
  it('adds new entries', () => {
    const lib = createLibrary();
    const r = importBatch(lib, [makeEntry({ partId: 'A', geometrySignature: 'sig-A' })]);
    expect(r.added).toHaveLength(1);
    expect(lib.entries.size).toBe(1);
  });

  it('dedupes by signature', () => {
    const lib = createLibrary();
    importBatch(lib, [makeEntry({ partId: 'A', geometrySignature: 'sig-shared' })]);
    const r = importBatch(lib, [makeEntry({ partId: 'B', geometrySignature: 'sig-shared' })]);
    expect(r.deduped).toHaveLength(1);
    expect(r.deduped[0]!.matchedPartId).toBe('A');
  });

  it('supersedes when same partId, different version', () => {
    const lib = createLibrary();
    importBatch(lib, [makeEntry({ partId: 'A', version: 'v1', geometrySignature: 'sigA' })]);
    const r = importBatch(lib, [makeEntry({ partId: 'A', version: 'v2', geometrySignature: 'sigA' })]);
    expect(r.superseded).toHaveLength(1);
    expect(lib.entries.get('A')!.active.version).toBe('v2');
    expect(lib.entries.get('A')!.history).toHaveLength(1);
  });

  it('exact duplicate (same partId + version) is deduped', () => {
    const lib = createLibrary();
    importBatch(lib, [makeEntry({ partId: 'A', version: 'v1' })]);
    const r = importBatch(lib, [makeEntry({ partId: 'A', version: 'v1' })]);
    expect(r.deduped).toHaveLength(1);
  });
});

describe('scoreEntry', () => {
  it('full metadata → high score', () => {
    const e = makeEntry({ partId: 'A', vendor: 'X', category: 'fastener', version: 'v1' });
    const score = scoreEntry(e);
    expect(score.score).toBeGreaterThan(80);
  });

  it('unknown format → low score', () => {
    const e = makeEntry({ partId: 'A', format: 'unknown' });
    expect(scoreEntry(e).score).toBeLessThan(80);
  });

  it('huge file flagged', () => {
    const e = makeEntry({ partId: 'A', fileSize: 50_000_000 });
    expect(scoreEntry(e).flags.some(f => f.includes('10MB'))).toBe(true);
  });

  it('low triangle count flagged', () => {
    const e = makeEntry({ partId: 'A', triangleCount: 4 });
    expect(scoreEntry(e).flags.some(f => f.includes('low'))).toBe(true);
  });
});

describe('searchLibrary', () => {
  it('filter by vendor', () => {
    const lib = createLibrary();
    importBatch(lib, [
      makeEntry({ partId: 'A', vendor: 'McMaster', geometrySignature: 's1' }),
      makeEntry({ partId: 'B', vendor: 'Misumi', geometrySignature: 's2' }),
    ]);
    expect(searchLibrary(lib, { vendor: 'McMaster' })).toHaveLength(1);
  });

  it('filter by required tags', () => {
    const lib = createLibrary();
    importBatch(lib, [
      makeEntry({ partId: 'A', tags: ['m6', 'shcs'], geometrySignature: 's1' }),
      makeEntry({ partId: 'B', tags: ['m6'], geometrySignature: 's2' }),
    ]);
    expect(searchLibrary(lib, { requiredTags: ['shcs'] })).toHaveLength(1);
  });

  it('minQualityScore filters low-quality', () => {
    const lib = createLibrary();
    importBatch(lib, [
      makeEntry({ partId: 'A', vendor: 'X', category: 'c', version: 'v1', geometrySignature: 's1' }),
      makeEntry({ partId: 'B', format: 'unknown', geometrySignature: 's2' }),
    ]);
    const filtered = searchLibrary(lib, { minQualityScore: 80 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.partId).toBe('A');
  });
});

describe('summarize', () => {
  it('empty library', () => {
    const s = summarize(createLibrary());
    expect(s.partCount).toBe(0);
  });

  it('counts by format + vendor', () => {
    const lib = createLibrary();
    importBatch(lib, [
      makeEntry({ partId: 'A', format: 'STEP', vendor: 'X', geometrySignature: 's1' }),
      makeEntry({ partId: 'B', format: 'STL', vendor: 'X', geometrySignature: 's2' }),
      makeEntry({ partId: 'C', format: 'STEP', vendor: 'Y', geometrySignature: 's3' }),
    ]);
    const s = summarize(lib);
    expect(s.byFormat.STEP).toBe(2);
    expect(s.byVendor.X).toBe(2);
  });
});
