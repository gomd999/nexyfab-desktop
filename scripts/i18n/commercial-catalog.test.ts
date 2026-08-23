import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { qualifyCommercialCatalog } from './commercial-catalog.mjs';

describe('commercial six-language catalog', () => {
  it('covers every migrated commercial source pair without legacy binary branches', () => {
    const catalog = JSON.parse(readFileSync('src/lib/i18n/commercialTranslations.generated.json', 'utf8'));
    const result = qualifyCommercialCatalog(catalog);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.legacyBilingualLiterals).toEqual([]);
    expect(result.pairs.length).toBeGreaterThan(650);
  });

  it('keeps the Studio route-local catalog complete so it does not import the full commercial catalog', () => {
    const catalog = JSON.parse(readFileSync('src/lib/i18n/studioTranslations.generated.json', 'utf8'));
    const result = qualifyCommercialCatalog(catalog, ['src/app/[lang]/studio']);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.legacyBilingualLiterals).toEqual([]);
    expect(result.pairs.length).toBeGreaterThan(100);
  });
});
