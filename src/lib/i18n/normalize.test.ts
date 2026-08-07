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
    expect(toIsoLang('kr')).toBe('ko');
    expect(toIsoLang('cn')).toBe('zh');
  });

  it('canonicalizes legacy locale URL segments without touching other paths', () => {
    expect(canonicalizeLocalePath('/ko')).toBe('/kr');
    expect(canonicalizeLocalePath('/ko/shape-generator')).toBe('/kr/shape-generator');
    expect(canonicalizeLocalePath('/zh/quick-quote')).toBe('/cn/quick-quote');
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
