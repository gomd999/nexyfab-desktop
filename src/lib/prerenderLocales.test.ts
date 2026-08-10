import { describe, expect, it } from 'vitest';
import { resolvePrerenderLocales, SUPPORTED_LOCALES } from './prerenderLocales';

describe('resolvePrerenderLocales', () => {
  it('limits web build fan-out while keeping primary locales warm', () => {
    expect(resolvePrerenderLocales(undefined)).toEqual(['kr', 'en']);
  });

  it('deduplicates and ignores unsupported values', () => {
    expect(resolvePrerenderLocales('en,ja,en,bad')).toEqual(['en', 'ja']);
  });

  it('keeps every locale in desktop static exports', () => {
    expect(resolvePrerenderLocales('kr', true)).toEqual([...SUPPORTED_LOCALES]);
  });
});
