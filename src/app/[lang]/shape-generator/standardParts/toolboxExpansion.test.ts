import { describe, it, expect } from 'vitest';
import {
  ISO_METRIC, isoSize, expandIsoCatalog, clearanceHole, tapDrill, stockLengthsFor,
} from './isoCatalogFull';
import { ANSI_INCH, ansiSize, expandAnsiCatalog, inchToMm } from './ansiCatalog';
import { suggestFasteners, classifyHole, isStandardClearanceHole } from './autoFitFastener';
import { snapToCatalogSize, snapToStockLength, computeSizingPreview, estimateMassG, recommendedPreloadN } from './sizingHelper';
import { importCsv, importJson, mergeCatalog } from './customCatalogImport';

describe('ISO catalog', () => {
  it('ships at least 9 sizes from M3 to M20', () => {
    expect(ISO_METRIC.length).toBeGreaterThanOrEqual(9);
    expect(ISO_METRIC[0]!.size).toBe(3);
    expect(ISO_METRIC[ISO_METRIC.length - 1]!.size).toBe(20);
  });

  it('isoSize finds M6', () => {
    expect(isoSize(6)?.coarsePitch).toBe(1.0);
  });

  it('clearanceHole returns medium for M6', () => {
    expect(clearanceHole(6, 'medium')).toBe(6.6);
  });

  it('tapDrill returns 2.5 for M3', () => {
    expect(tapDrill(3)).toBe(2.5);
  });

  it('stockLengthsFor returns reasonable list', () => {
    const r = stockLengthsFor(6);
    expect(r.length).toBeGreaterThan(5);
    expect(r[0]).toBeGreaterThanOrEqual(4);
  });

  it('expandIsoCatalog produces hex-bolt entries', () => {
    const r = expandIsoCatalog('hex-bolt', { diameters: [6] });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.designation).toContain('M6');
  });
});

describe('ANSI catalog', () => {
  it('includes 1/4 size', () => {
    expect(ansiSize('1/4')?.unc).toBe(20);
  });

  it('expandAnsiCatalog UNC produces specs', () => {
    const r = expandAnsiCatalog('hex-bolt', { diameters: ['1/4'], series: 'UNC' });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.designation).toContain('1/4');
  });

  it('expandAnsiCatalog UNF differs from UNC', () => {
    const unc = expandAnsiCatalog('hex-bolt', { diameters: ['1/4'], series: 'UNC' })[0]!;
    const unf = expandAnsiCatalog('hex-bolt', { diameters: ['1/4'], series: 'UNF' })[0]!;
    expect(unc.thread.pitchMm).not.toEqual(unf.thread.pitchMm);
  });

  it('inchToMm converts 1 inch to 25.4 mm', () => {
    expect(inchToMm(1)).toBeCloseTo(25.4, 6);
  });
});

describe('auto-fit', () => {
  it('suggests M6 clearance for 6.6mm hole', () => {
    const r = suggestFasteners({ diameterMm: 6.6 });
    expect(r.some(s => s.sizeLabel === 'M6' && s.fitType === 'clearance-medium')).toBe(true);
  });

  it('classifyHole detects tap for M6 tap drill', () => {
    expect(classifyHole(5.0, 6)).toBe('tap');
  });

  it('classifyHole detects clearance-medium', () => {
    expect(classifyHole(6.6, 6)).toBe('clearance-medium');
  });

  it('isStandardClearanceHole identifies M6 close', () => {
    const r = isStandardClearanceHole(6.4);
    expect(r.isStandard).toBe(true);
    expect(r.matches.some(m => m.size === 'M6')).toBe(true);
  });

  it('respects topN limit', () => {
    const r = suggestFasteners({ diameterMm: 6.6, topN: 1 });
    expect(r.length).toBe(1);
  });
});

describe('sizing helper', () => {
  it('snapToCatalogSize 5.7 snaps to 6 (closer)', () => {
    expect(snapToCatalogSize(5.7)).toBe(6);
  });
  it('snapToCatalogSize 5.4 snaps to 5 (closer)', () => {
    expect(snapToCatalogSize(5.4)).toBe(5);
  });

  it('snapToStockLength 22 → 20 (closer than 25)', () => {
    expect(snapToStockLength(22)).toBe(20);
  });

  it('estimateMassG returns positive for M6 × 25', () => {
    const spec = { standard: 'ISO' as const, kind: 'hex-bolt' as const, designation: 'ISO 4014 M6 × 25',
      thread: { diameterMm: 6, pitchMm: 1 }, lengthMm: 25, material: 'steel-8.8' as const };
    expect(estimateMassG(spec)).toBeGreaterThan(0);
  });

  it('recommendedPreloadN scales with grade', () => {
    const make = (g: 'steel-8.8' | 'steel-12.9') => ({
      standard: 'ISO' as const, kind: 'hex-bolt' as const, designation: 'x',
      thread: { diameterMm: 8, pitchMm: 1.25 }, lengthMm: 30, material: g,
    });
    expect(recommendedPreloadN(make('steel-12.9'))).toBeGreaterThan(recommendedPreloadN(make('steel-8.8')));
  });

  it('computeSizingPreview includes mass + preload', () => {
    const spec = { standard: 'ISO' as const, kind: 'hex-bolt' as const, designation: 'x',
      thread: { diameterMm: 8, pitchMm: 1.25 }, lengthMm: 30, material: 'steel-8.8' as const };
    const p = computeSizingPreview(spec);
    expect(p.massG).toBeGreaterThan(0);
    expect(p.preloadN).toBeGreaterThan(0);
    expect(p.size).toBe(8);
  });
});

describe('custom catalog import', () => {
  it('imports valid CSV', () => {
    const csv = 'kind,diameter_mm,pitch_mm,length_mm,material\nhex-bolt,6,1.0,25,steel-8.8\n';
    const r = importCsv(csv);
    expect(r.imported).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects invalid CSV rows', () => {
    const csv = 'kind,diameter_mm,pitch_mm,length_mm\nbad-kind,6,1.0,25\n';
    const r = importCsv(csv);
    expect(r.imported).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it('imports valid JSON', () => {
    const json = JSON.stringify([{
      kind: 'hex-bolt',
      thread: { diameterMm: 6, pitchMm: 1 },
      lengthMm: 25,
      material: 'steel-8.8',
    }]);
    const r = importJson(json);
    expect(r.imported).toHaveLength(1);
  });

  it('rejects malformed JSON', () => {
    expect(importJson('not json').errors.length).toBeGreaterThan(0);
  });

  it('mergeCatalog dedupes by designation', () => {
    const a = { standard: 'ISO' as const, kind: 'hex-bolt' as const, designation: 'ISO 4014 M6 × 25',
      thread: { diameterMm: 6, pitchMm: 1 }, lengthMm: 25, material: 'steel-8.8' as const };
    const merged = mergeCatalog([a], [{ ...a, material: 'a2-stainless' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.material).toBe('a2-stainless');
  });
});
