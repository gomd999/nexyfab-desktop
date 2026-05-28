/**
 * sheetmetal/__tests__/sheetMetalI18n.test.ts — B5 localisation smoke.
 *
 * Wave 2 Phase 2 Track B Week 5. Asserts the 6-lang dict pattern works
 * for the sheet-metal UI (spec §6.6 / §6.3). Mirrors `threads/i18n.test.ts`
 * structure so future i18n audits can grep both files with the same patterns.
 */

import { describe, it, expect } from 'vitest';
import {
  pickSheetMetalDict,
  SHEET_METAL_DICT_KO,
  SHEET_METAL_DICT_EN,
  SHEET_METAL_DICT_JA,
  SHEET_METAL_DICT_ZH,
  SHEET_METAL_DICT_ES,
  SHEET_METAL_DICT_AR,
} from '../i18n';

describe('pickSheetMetalDict — 6-lang dict selector', () => {
  it('returns the English dict when lang is undefined', () => {
    expect(pickSheetMetalDict(undefined)).toBe(SHEET_METAL_DICT_EN);
  });

  it('returns the English dict for unknown lang codes', () => {
    expect(pickSheetMetalDict('xx')).toBe(SHEET_METAL_DICT_EN);
  });

  it('returns each canonical lang for the 6 supported codes', () => {
    for (const code of ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const) {
      const d = pickSheetMetalDict(code);
      expect(d.rightPaneTitle).toBeTruthy();
      expect(d.autoDrawingButton).toBeTruthy();
      expect(d.closeButton).toBeTruthy();
    }
  });

  it('aliases kr→ko, cn→zh, jp→ja (route segment normalisation)', () => {
    expect(pickSheetMetalDict('kr')).toBe(SHEET_METAL_DICT_KO);
    expect(pickSheetMetalDict('cn')).toBe(SHEET_METAL_DICT_ZH);
    expect(pickSheetMetalDict('jp')).toBe(SHEET_METAL_DICT_JA);
  });
});

describe('Korean canonical strings (spec §6.6)', () => {
  it('bend line = 절곡선', () => {
    expect(SHEET_METAL_DICT_KO.bendLineLabel).toBe('절곡선');
  });

  it('flat pattern = 전개도', () => {
    expect(SHEET_METAL_DICT_KO.flatPatternLabel).toBe('전개도');
  });

  it('K-factor = K-팩터', () => {
    expect(SHEET_METAL_DICT_KO.kFactorLabel).toBe('K-팩터');
  });

  it('bend allowance = 절곡 허용량', () => {
    expect(SHEET_METAL_DICT_KO.bendAllowanceLabel).toBe('절곡 허용량');
  });

  it('outline = 외곽선', () => {
    expect(SHEET_METAL_DICT_KO.outlineLabel).toBe('외곽선');
  });

  it('auto-drawing button = 자동 도면 생성', () => {
    expect(SHEET_METAL_DICT_KO.autoDrawingButton).toBe('자동 도면 생성');
  });

  it('springback = 스프링백', () => {
    expect(SHEET_METAL_DICT_KO.springbackLabel).toBe('스프링백');
  });
});

describe('All 6 langs populate every key (no missing strings)', () => {
  const keys = Object.keys(SHEET_METAL_DICT_EN) as Array<keyof typeof SHEET_METAL_DICT_EN>;
  const langs = [
    ['ko', SHEET_METAL_DICT_KO],
    ['en', SHEET_METAL_DICT_EN],
    ['ja', SHEET_METAL_DICT_JA],
    ['zh', SHEET_METAL_DICT_ZH],
    ['es', SHEET_METAL_DICT_ES],
    ['ar', SHEET_METAL_DICT_AR],
  ] as const;

  for (const [name, dict] of langs) {
    it(`${name} has every key populated`, () => {
      for (const k of keys) {
        const v = dict[k];
        expect(typeof v, `${name}.${String(k)}`).toBe('string');
        expect(v.length, `${name}.${String(k)}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('Per-language native translations of the canonical terms', () => {
  it('Japanese: bend line = 曲げ線', () => {
    expect(SHEET_METAL_DICT_JA.bendLineLabel).toBe('曲げ線');
  });

  it('Chinese: bend line = 折弯线', () => {
    expect(SHEET_METAL_DICT_ZH.bendLineLabel).toBe('折弯线');
  });

  it('Spanish: bend line = Línea de doblado', () => {
    expect(SHEET_METAL_DICT_ES.bendLineLabel).toBe('Línea de doblado');
  });

  it('Arabic: bend line = خط الانثناء', () => {
    expect(SHEET_METAL_DICT_AR.bendLineLabel).toBe('خط الانثناء');
  });

  it('Japanese: flat pattern = 展開図', () => {
    expect(SHEET_METAL_DICT_JA.flatPatternLabel).toBe('展開図');
  });

  it('Chinese: flat pattern = 展开图', () => {
    expect(SHEET_METAL_DICT_ZH.flatPatternLabel).toBe('展开图');
  });

  it('Auto-drawing translates per spec table (each lang non-empty)', () => {
    expect(SHEET_METAL_DICT_KO.autoDrawingButton).toContain('자동 도면');
    expect(SHEET_METAL_DICT_EN.autoDrawingButton).toBe('Auto-drawing');
    expect(SHEET_METAL_DICT_JA.autoDrawingButton).toBe('自動製図');
    expect(SHEET_METAL_DICT_ZH.autoDrawingButton).toBe('自动制图');
    expect(SHEET_METAL_DICT_ES.autoDrawingButton).toContain('Dibujo');
    expect(SHEET_METAL_DICT_AR.autoDrawingButton).toContain('الرسم');
  });
});

describe('English regression check — common labels', () => {
  it('Auto-drawing English label is the canonical button text', () => {
    expect(SHEET_METAL_DICT_EN.autoDrawingButton).toBe('Auto-drawing');
  });

  it('K-factor table column headers are Material / R/t / K', () => {
    expect(SHEET_METAL_DICT_EN.kTableMaterialCol).toBe('Material');
    expect(SHEET_METAL_DICT_EN.kTableRatioCol).toBe('R/t');
    expect(SHEET_METAL_DICT_EN.kTableValueCol).toBe('K');
  });

  it('Deferred-worker note references the K-factor table fallback', () => {
    expect(SHEET_METAL_DICT_EN.autoDrawingDeferredNote.toLowerCase()).toContain('k-factor');
    expect(SHEET_METAL_DICT_EN.autoDrawingTaskRef).toContain('task #31');
  });

  it('Material labels match the existing sheetMetalTables.ts catalog', () => {
    expect(SHEET_METAL_DICT_EN.materialMildSteel).toContain('SPCC');
    expect(SHEET_METAL_DICT_EN.materialStainless304).toContain('STS304');
    expect(SHEET_METAL_DICT_EN.materialAluminum5052).toContain('5052');
    expect(SHEET_METAL_DICT_EN.materialGalvanized).toContain('SGCC');
  });
});
