import { describe, expect, it } from 'vitest';
import {
  canonicalizeLocalePath,
  isChinese,
  isKorean,
  langDir,
  toIsoLang,
  toRouteLang,
} from './normalize';

describe('locale normalization', () => {
  it('maps stored ISO locales to canonical route locales', () => {
    expect(toRouteLang('ko')).toBe('kr');
    expect(toRouteLang('zh')).toBe('cn');
    expect(toRouteLang('jp')).toBe('ja');
    expect(toIsoLang('kr')).toBe('ko');
    expect(toIsoLang('cn')).toBe('zh');
  });

  it('normalizes regional and script locale values from browsers and OAuth providers', () => {
    expect(toRouteLang('ko-KR')).toBe('kr');
    expect(toRouteLang('ko_KR')).toBe('kr');
    expect(toRouteLang('zh-Hans')).toBe('cn');
    expect(toRouteLang('ZH-cn')).toBe('cn');
    expect(toIsoLang('es-MX')).toBe('es');
    expect(toIsoLang('ar-SA')).toBe('ar');
  });

  it('canonicalizes legacy locale URL segments without touching other paths', () => {
    expect(canonicalizeLocalePath('/ko')).toBe('/kr');
    expect(canonicalizeLocalePath('/ko/shape-generator')).toBe('/kr/shape-generator');
    expect(canonicalizeLocalePath('/zh/quick-quote')).toBe('/cn/quick-quote');
    expect(canonicalizeLocalePath('/jp/pricing')).toBe('/ja/pricing');
    expect(canonicalizeLocalePath('/kr/shape-generator')).toBe('/kr/shape-generator');
    expect(canonicalizeLocalePath('/api/ko/status')).toBe('/api/ko/status');
    expect(canonicalizeLocalePath('/korean')).toBe('/korean');
  });

  it('keeps UI language and direction helpers compatible with legacy values', () => {
    expect(isKorean('kr')).toBe(true);
    expect(isKorean('ko-KR')).toBe(true);
    expect(isChinese('cn')).toBe(true);
    expect(isChinese('zh-Hans')).toBe(true);
    expect(langDir('ar')).toBe('rtl');
    expect(langDir('en')).toBe('ltr');
  });
});
