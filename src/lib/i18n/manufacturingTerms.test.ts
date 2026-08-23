import { describe, expect, it } from 'vitest';
import { manufacturingRegion, manufacturingTerm } from './manufacturingTerms';

describe('manufacturing display vocabulary', () => {
  it('localizes stable product and process values for every supported locale', () => {
    expect(manufacturingTerm('Bracket', 'kr')).toBe('브래킷');
    expect(manufacturingTerm('Bracket', 'ja')).toBe('ブラケット');
    expect(manufacturingTerm('cnc_milling', 'cn')).toBe('CNC铣削');
    expect(manufacturingTerm('Stainless Steel', 'es')).toBe('Acero inoxidable');
    expect(manufacturingTerm('quoted', 'ar')).toBe('تم التسعير');
    expect(manufacturingTerm('CNC가공', 'es')).toBe('Mecanizado CNC');
    expect(manufacturingTerm('3D Printing', 'ar')).toBe('طباعة ثلاثية الأبعاد');
    expect(manufacturingTerm('Automotive', 'ja')).toBe('自動車');
    expect(manufacturingTerm('stainless_304', 'zh')).toBe('304不锈钢');
    expect(manufacturingTerm('aluminum_7075', 'ja')).toBe('アルミニウム7075');
    expect(manufacturingTerm('steel_mild', 'ar')).toBe('فولاذ منخفض الكربون');
    expect(manufacturingTerm('laser_cutting', 'es')).toBe('Corte láser');
  });

  it('normalizes route aliases for region labels and preserves unknown identifiers', () => {
    expect(manufacturingRegion('KR', 'cn')).toBe('🇰🇷 韩国');
    expect(manufacturingRegion('ZZ', 'en')).toBe('ZZ');
    expect(manufacturingTerm('custom-material', 'en')).toBe('custom-material');
  });

  it('covers profile taxonomy labels in every route locale without changing identifiers', () => {
    const locales = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
    for (const locale of locales) {
      for (const process of ['fdm_3d_printing', 'sls_3d_printing', 'sand_casting']) {
        expect(manufacturingTerm(process, locale)).not.toBe(process);
      }
      for (const certification of ['AS9100', 'IATF16949', 'ISO13485', 'RoHS', 'REACH']) {
        expect(manufacturingTerm(certification, locale)).toBeTruthy();
      }
      expect(manufacturingRegion('Malaysia', locale)).toBeTruthy();
      expect(manufacturingRegion('South Korea', locale)).toBeTruthy();
      for (const locale of locales.filter((value) => value !== 'en')) {
        expect(manufacturingRegion('Malaysia', locale)).not.toBe('Malaysia');
        expect(manufacturingRegion('South Korea', locale)).not.toBe('South Korea');
      }
    }
  });
});
