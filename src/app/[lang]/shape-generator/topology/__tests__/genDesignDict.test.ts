import { describe, it, expect } from 'vitest';
import { genDesignDict } from '../genDesignDict';

const LANGS = ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const;

describe('genDesignDict i18n completeness', () => {
  it('exposes all six language blocks', () => {
    for (const lang of LANGS) {
      expect(genDesignDict[lang], `lang block ${lang}`).toBeTruthy();
    }
  });

  it('every key resolves to a non-empty string/array in all six languages', () => {
    const allKeys = new Set<string>();
    for (const lang of LANGS) {
      for (const k of Object.keys(genDesignDict[lang])) allKeys.add(k);
    }
    const present = (v: unknown): boolean =>
      (typeof v === 'string' && v.length > 0) || (Array.isArray(v) && v.length > 0);
    const missing: string[] = [];
    for (const lang of LANGS) {
      const block = genDesignDict[lang] as unknown as Record<string, unknown>;
      for (const k of allKeys) {
        if (!present(block[k])) missing.push(`${lang}.${k}`);
      }
    }
    expect(missing, `missing/blank keys: ${missing.join(', ')}`).toEqual([]);
  });

  // GenDesignViewer.tsx (the topology-optimization 3D canvas) used to hardcode
  // its toolbar/HUD text in English regardless of route lang — the 6-language
  // genDesignDict existed (used by the surrounding panel in ShapeGeneratorInner)
  // but the canvas overlay never imported it. Spot-check that the keys added to
  // wire GenDesignViewer into the dict are real translations, not English
  // fallbacks, in every non-English/Korean locale.
  it('GenDesignViewer toolbar keys (viewSolid/viewWireframe/resetCamera) are really translated', () => {
    expect(genDesignDict.ko.viewSolid).toBe('솔리드');
    expect(genDesignDict.ko.viewWireframe).toBe('와이어프레임');
    expect(genDesignDict.ko.resetCamera).toBe('카메라 리셋');

    expect(genDesignDict.ja.viewSolid).toBe('ソリッド');
    expect(genDesignDict.ja.viewWireframe).toBe('ワイヤーフレーム');
    expect(genDesignDict.ja.resetCamera).toBe('カメラをリセット');

    expect(genDesignDict.cn.viewSolid).toBe('实体');
    expect(genDesignDict.cn.viewWireframe).toBe('线框');
    expect(genDesignDict.cn.resetCamera).toBe('重置相机');

    expect(genDesignDict.es.viewSolid).toBe('Solido');
    expect(genDesignDict.es.viewWireframe).toBe('Alambre');
    expect(genDesignDict.es.resetCamera).toBe('Restablecer Camara');

    expect(genDesignDict.ar.viewSolid).toBe('مصمت');
    expect(genDesignDict.ar.viewWireframe).toBe('إطار سلكي');
    expect(genDesignDict.ar.resetCamera).toBe('إعادة ضبط الكاميرا');

    for (const lang of LANGS) {
      if (lang === 'en') continue;
      expect(genDesignDict[lang].viewSolid).not.toBe(genDesignDict.en.viewSolid);
      expect(genDesignDict[lang].resetCamera).not.toBe(genDesignDict.en.resetCamera);
    }
  });
});
