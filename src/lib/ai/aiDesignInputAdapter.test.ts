import { describe, expect, it } from 'vitest';
import { adaptAiDesignInput, composeAiDesignCheckpoints } from './aiDesignInputAdapter';

const hash = 'a'.repeat(64);
const base = (kind: 'text' | 'image' | 'sketch' | 'drawing_2d' | 'selection_3d') => ({ projectId: 'p-1', revision: 2, sourceId: `s-${kind}`, sourceHash: hash, kind, mimeType: kind === 'text' ? 'text/plain' : 'image/png', sizeBytes: 100, provenance: { rights: 'user_owned' as const, origin: 'user-upload' }, fields: [{ key: 'width', value: { value: 10, unit: 'cm' }, category: 'dimension' as const }] });

describe('ai design input adapter', () => {
  it.each(['text', 'image', 'sketch', 'drawing_2d', 'selection_3d'] as const)('normalizes %s into a checkpoint', kind => {
    const result = adaptAiDesignInput(base(kind));
    expect(result.checkpoint).not.toBeNull();
    expect(result.source.kind).toBe(kind);
    expect(result.source.fields[0]?.value).toEqual({ value: 100, unit: 'mm' });
  });

  it('fails closed for unknown and prohibited rights', () => {
    for (const rights of ['unknown', 'prohibited'] as const) {
      const result = adaptAiDesignInput({ ...base('image'), provenance: { rights, origin: 'external' } });
      expect(result.checkpoint).toBeNull();
      expect(result.blockers).toContain('provenance_rights_blocked');
    }
  });

  it('keeps OCR/vision/drawing extraction as an assumption', () => {
    const result = adaptAiDesignInput({ ...base('drawing_2d'), extracted: true, extractionKind: 'ocr', authority: 'imported_authority' });
    expect(result.source.authority).toBe('ai_assumption');
    expect(result.checkpoint?.importedAuthority).toHaveLength(0);
    expect(result.checkpoint?.aiAssumptions[0]?.requiresConfirmation).toBe(true);
  });

  it('rejects bad hashes, bounds, and secret/raw payloads', () => {
    const result = adaptAiDesignInput({ ...base('image'), sourceHash: 'bad', sizeBytes: 50 * 1024 * 1024 + 1, payload: { rawImage: 'bytes', apiKey: 'do-not-store' } });
    expect(result.checkpoint).toBeNull();
    expect(result.blockers).toEqual(expect.arrayContaining(['source_hash_invalid', 'source_size_out_of_bounds', 'raw_or_secret_payload_rejected']));
  });

  it('rejects non-finite and oversized extracted values before persistence', () => {
    expect(adaptAiDesignInput({ ...base('text'), fields: [{ key: 'note', value: 'x'.repeat(4_097) }] }).blockers).toContain('payload_out_of_bounds_or_nonserializable');
    expect(adaptAiDesignInput({ ...base('text'), fields: [{ key: 'width', value: Number.NaN }] }).blockers).toContain('payload_out_of_bounds_or_nonserializable');
  });

  it('detects source and project binding conflicts while composing', () => {
    const one = adaptAiDesignInput(base('text')).checkpoint!;
    const duplicate = adaptAiDesignInput({ ...base('image'), sourceId: 's-text', sourceHash: 'b'.repeat(64) }).checkpoint!;
    expect(() => composeAiDesignCheckpoints(one, duplicate)).not.toThrow();
    expect(composeAiDesignCheckpoints(one, duplicate).conflicts.map(item => item.key)).toContain('source:s-text');
    const differentRevision = adaptAiDesignInput({ ...base('sketch'), revision: 3 }).checkpoint!;
    expect(composeAiDesignCheckpoints(one, differentRevision).readiness.ready).toBe(false);
  });

  it('composes different source hashes when they bind the same project revision hash', () => {
    const one = adaptAiDesignInput({ ...base('text'), projectContentHash: 'c'.repeat(64) }).checkpoint!;
    const two = adaptAiDesignInput({ ...base('image'), sourceHash: 'b'.repeat(64), projectContentHash: 'c'.repeat(64) }).checkpoint!;
    const composed = composeAiDesignCheckpoints(one, two);
    expect(composed.sources).toHaveLength(2);
    expect(composed.projectContentHash).toBe('c'.repeat(64));
    expect(composed.readiness.ready).toBe(true);
  });

  it('converts dimensional values and tolerances instead of relabeling units', () => {
    const result = adaptAiDesignInput({ ...base('text'), fields: [{ key: 'width', value: { value: 2, tolerance: 0.1, unit: 'in' }, category: 'dimension' }] });
    expect(result.source.fields[0]?.value).toEqual({ value: 50.8, tolerance: 2.54, unit: 'mm' });
  });
});
