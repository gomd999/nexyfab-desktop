import { describe, it, expect } from 'vitest';
import { shapeDict } from '../shapeDict';

const LANGS = ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const;

describe('shapeDict i18n completeness', () => {
  it('exposes all six language blocks', () => {
    for (const lang of LANGS) {
      expect(shapeDict[lang], `lang block ${lang}`).toBeTruthy();
    }
  });

  it('every key resolves to a non-empty string in all six languages (backfill safety net)', () => {
    // Union of all keys across blocks — after the module-load backfill every
    // language must have a real value for each (real translation or English).
    const allKeys = new Set<string>();
    for (const lang of LANGS) {
      for (const k of Object.keys(shapeDict[lang] as Record<string, unknown>)) allKeys.add(k);
    }
    const present = (v: unknown): boolean =>
      (typeof v === 'string' && v.length > 0) || (Array.isArray(v) && v.length > 0);
    const missing: string[] = [];
    for (const lang of LANGS) {
      const block = shapeDict[lang] as unknown as Record<string, unknown>;
      for (const k of allKeys) {
        if (!present(block[k])) missing.push(`${lang}.${k}`);
      }
    }
    expect(missing, `missing/blank keys: ${missing.slice(0, 20).join(', ')}`).toEqual([]);
  });

  it('rib feature labels are really translated (not English fallback) in ja/cn/es/ar', () => {
    // Spot-check the supplement actually applied for a feature this work touched.
    expect(shapeDict.ja.paramRibThickness).toBe('リブ厚さ');
    expect(shapeDict.cn.paramRibThickness).toBe('筋板厚度');
    expect(shapeDict.es.featureName_bend).toBe('Pliegue');
    expect(shapeDict.ar.helixLeft).toBe('يسار');
  });
});
