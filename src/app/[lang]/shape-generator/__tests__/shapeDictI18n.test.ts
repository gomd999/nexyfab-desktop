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
    // Supplement keys are injected at runtime, so read loosely (not in the
    // static literal type). Spot-check the supplement actually applied.
    const ja = shapeDict.ja as unknown as Record<string, string>;
    const cn = shapeDict.cn as unknown as Record<string, string>;
    const es = shapeDict.es as unknown as Record<string, string>;
    const ar = shapeDict.ar as unknown as Record<string, string>;
    expect(ja.paramRibThickness).toBe('リブ厚さ');
    expect(cn.paramRibThickness).toBe('筋板厚度');
    expect(es.featureName_bend).toBe('Pliegue');
    expect(ar.helixLeft).toBe('يسار');
    expect(ja.paramThreadDepth).toBe('ねじ深さ'); // param* batch applied
    // batch B (advanced panels) really translated, not English fallback
    expect(ja.mesh_repair).toBe('メッシュ修復');
    expect(cn.library_hexBolt).toBe('六角螺栓');
    expect(es.gdtTolerance).toBe('Tolerancia');
    expect(ar.tutorialNext).toBe('التالي');
  });
});
