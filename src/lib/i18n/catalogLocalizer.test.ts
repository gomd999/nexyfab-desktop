import { describe, expect, it } from 'vitest';
import { createCatalogLocalizer, createFlatCatalogLocalizer, type LocalizedCatalog } from './catalogLocalizer';

const catalog: LocalizedCatalog = {
  '{{0}}': { ja: '{{0}}個', zh: '{{0}}个', es: '{{0}} elementos', ar: '{{0}} عنصر' },
};

describe('createCatalogLocalizer bare count placeholders', () => {
  it('localizes numeric values while leaving units and identifiers unchanged', () => {
    const ja = createCatalogLocalizer('ja', catalog);
    const zh = createCatalogLocalizer('cn', catalog);

    expect(ja('', '3')).toBe('3個');
    expect(zh('', '3')).toBe('3个');
    expect(ja('', '₩/kg')).toBe('₩/kg');
    expect(zh('', 'material')).toBe('material');
  });

  it('applies the same numeric-only guard to flat locale catalogs', () => {
    const localize = createFlatCatalogLocalizer('ja', { '{{0}}': '{{0}}個' });

    expect(localize('', '12')).toBe('12個');
    expect(localize('', '₩/m')).toBe('₩/m');
    expect(localize('', 'cut')).toBe('cut');
  });
});
