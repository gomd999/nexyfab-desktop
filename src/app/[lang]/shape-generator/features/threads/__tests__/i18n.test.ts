/**
 * threads/__tests__/i18n.test.ts — Wave 2 Phase 2 Track D6 localisation smoke.
 *
 * Asserts the 6-lang dict pattern works as expected for the threads UI.
 * Mirrors the `referenceGeometry/__tests__/i18n.test.ts` structure (D4)
 * so future i18n audits can grep both files with the same patterns.
 */

import { describe, it, expect } from 'vitest';
import {
  pickThreadsDict,
  seriesLabel,
  THREADS_DICT_EN,
  THREADS_DICT_KO,
  THREADS_DICT_JA,
  THREADS_DICT_ZH,
  THREADS_DICT_ES,
  THREADS_DICT_AR,
} from '../i18n';

describe('pickThreadsDict (6-lang dict selector)', () => {
  it('returns the English dict when lang is undefined', () => {
    expect(pickThreadsDict(undefined)).toBe(THREADS_DICT_EN);
  });

  it('returns the English dict for unknown lang codes', () => {
    expect(pickThreadsDict('xx')).toBe(THREADS_DICT_EN);
  });

  it('returns each canonical lang for the 6 supported codes', () => {
    for (const code of ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const) {
      const d = pickThreadsDict(code);
      expect(d.sectionTitle).toBeTruthy();
      expect(d.addThreadButton).toBeTruthy();
      expect(d.save).toBeTruthy();
      expect(d.cancel).toBeTruthy();
    }
  });

  it('aliases kr→ko, cn→zh, jp→ja (route segment normalisation)', () => {
    expect(pickThreadsDict('kr')).toBe(THREADS_DICT_KO);
    expect(pickThreadsDict('cn')).toBe(THREADS_DICT_ZH);
    expect(pickThreadsDict('jp')).toBe(THREADS_DICT_JA);
  });
});

describe('Korean canonical strings (spec §10.5)', () => {
  it('thread = 나사산', () => {
    expect(THREADS_DICT_KO.sectionTitle).toBe('나사산');
    expect(THREADS_DICT_KO.addThreadButton).toBe('나사 추가');
  });

  it('male/external = 수나사, female/internal = 암나사', () => {
    expect(THREADS_DICT_KO.kindExternal).toBe('수나사');
    expect(THREADS_DICT_KO.kindInternal).toBe('암나사');
  });

  it('right-hand = 오른나사, left-hand = 왼나사', () => {
    expect(THREADS_DICT_KO.directionRight).toContain('오른나사');
    expect(THREADS_DICT_KO.directionLeft).toContain('왼나사');
  });

  it('pitch = 피치, tap drill = 탭 드릴', () => {
    expect(THREADS_DICT_KO.hintPitch).toBe('피치');
    expect(THREADS_DICT_KO.hintTapDrill).toBe('탭 드릴');
  });

  it('save = 저장, cancel = 취소, delete = 삭제', () => {
    expect(THREADS_DICT_KO.save).toBe('저장');
    expect(THREADS_DICT_KO.cancel).toBe('취소');
    expect(THREADS_DICT_KO.deleteThread).toBe('삭제');
  });
});

describe('Series-label translator', () => {
  it('returns a non-empty label for every series in every lang', () => {
    const series = [
      'ISO_M_COARSE',
      'ISO_M_FINE',
      'UNC',
      'UNF',
      'NPT',
      'BSP_PARALLEL',
      'BSP_TAPERED',
    ] as const;
    for (const lang of ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const) {
      const dict = pickThreadsDict(lang);
      for (const s of series) {
        const label = seriesLabel(dict, s);
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('ISO M coarse/fine labels are distinct (no collision)', () => {
    expect(seriesLabel(THREADS_DICT_KO, 'ISO_M_COARSE')).not.toBe(
      seriesLabel(THREADS_DICT_KO, 'ISO_M_FINE'),
    );
    expect(seriesLabel(THREADS_DICT_EN, 'ISO_M_COARSE')).not.toBe(
      seriesLabel(THREADS_DICT_EN, 'ISO_M_FINE'),
    );
  });
});

describe('All 6 langs populate every key (no missing strings)', () => {
  const keys = Object.keys(THREADS_DICT_EN) as Array<keyof typeof THREADS_DICT_EN>;
  const langs = [
    ['ko', THREADS_DICT_KO],
    ['en', THREADS_DICT_EN],
    ['ja', THREADS_DICT_JA],
    ['zh', THREADS_DICT_ZH],
    ['es', THREADS_DICT_ES],
    ['ar', THREADS_DICT_AR],
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

describe('English regression check — common labels', () => {
  it('Add Thread is the canonical button label', () => {
    expect(THREADS_DICT_EN.addThreadButton).toBe('Add Thread');
  });

  it('badge labels are the lowercase 1-word forms used in §10.1 mock', () => {
    expect(THREADS_DICT_EN.badgeCosmetic).toBe('cosmetic');
    expect(THREADS_DICT_EN.badgeGeometric).toBe('geometric');
  });

  it('cancel/save match SolidWorks-style modal language', () => {
    expect(THREADS_DICT_EN.cancel).toBe('Cancel');
    expect(THREADS_DICT_EN.save).toBe('Save');
  });
});
