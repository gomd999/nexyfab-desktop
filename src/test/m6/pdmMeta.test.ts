/**
 * M6 v0: PDM-lite meta block (`nexyfabPdm`) parse/merge + .nfab roundtrip smoke.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  NFAB_PDM_META_KEY,
  parsePdmFromMeta,
  buildSerializedMeta,
  DEFAULT_PDM_META_SLICE,
} from '@/app/[lang]/shape-generator/io/nfabPdmMeta';
import { parseProject } from '@/app/[lang]/shape-generator/io/nfabFormat';

describe('M6 nfabPdmMeta', () => {
  it('splits nexyfabPdm from arbitrary meta', () => {
    const { slice, extraMeta } = parsePdmFromMeta({
      author: 'qa',
      [NFAB_PDM_META_KEY]: { partNumber: ' BR-001 ', lifecycle: 'released', revisionLabel: ' B ' },
    });
    expect(slice.partNumber).toBe('BR-001');
    expect(slice.revisionLabel).toBe('B');
    expect(slice.lifecycle).toBe('released');
    expect(extraMeta).toEqual({ author: 'qa' });
  });

  it('buildSerializedMeta merges slice back', () => {
    const meta = buildSerializedMeta(
      { author: 'qa' },
      { partNumber: 'P-1', revisionLabel: '', lifecycle: 'released' },
    );
    expect(meta).toEqual({
      author: 'qa',
      [NFAB_PDM_META_KEY]: { partNumber: 'P-1', lifecycle: 'released' },
    });
  });

  it('omits nexyfabPdm when slice is default empty', () => {
    const meta = buildSerializedMeta({ tag: 'x' }, DEFAULT_PDM_META_SLICE);
    expect(meta).toEqual({ tag: 'x' });
  });

  it('parses golden nfab with injected meta', () => {
    const path = join(process.cwd(), 'tests/golden/m0-minimal.nfab.json');
    const base = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    base.meta = {
      units: 'mm',
      [NFAB_PDM_META_KEY]: { partNumber: 'GOLD-PART', lifecycle: 'wip' },
    };
    const p = parseProject(JSON.stringify(base));
    const m = p.meta as Record<string, unknown>;
    expect(m.units).toBe('mm');
    expect(m[NFAB_PDM_META_KEY]).toEqual({ partNumber: 'GOLD-PART', lifecycle: 'wip' });
  });
});
