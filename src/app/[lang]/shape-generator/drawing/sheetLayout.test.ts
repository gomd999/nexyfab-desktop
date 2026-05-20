import { describe, it, expect } from 'vitest';
import { planSheetLayout } from './sheetLayout';

describe('planSheetLayout', () => {
  it('picks 1:1 scale for small part on A4', () => {
    const r = planSheetLayout({
      sheet: 'A4',
      bbox: { widthMm: 50, depthMm: 30, heightMm: 40 },
      views: ['front', 'top', 'side'],
    });
    expect(r.scaleDenominator).toBe(1);
    expect(r.overflowed).toBe(false);
  });

  it('drops scale for big part on A4', () => {
    const r = planSheetLayout({
      sheet: 'A4',
      bbox: { widthMm: 500, depthMm: 200, heightMm: 300 },
      views: ['front', 'top', 'side'],
    });
    expect(r.scaleDenominator).toBeGreaterThan(1);
  });

  it('fits a moderate part with iso view on A3', () => {
    const r = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: 200, depthMm: 100, heightMm: 150 },
      views: ['front', 'top', 'side', 'iso'],
    });
    expect(r.views).toHaveLength(4);
    expect(r.overflowed).toBe(false);
  });

  it('places top above front in third-angle projection', () => {
    const r = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: 50, depthMm: 30, heightMm: 40 },
      views: ['front', 'top'],
    });
    const front = r.views.find(v => v.kind === 'front')!;
    const top = r.views.find(v => v.kind === 'top')!;
    expect(top.originYmm).toBeLessThan(front.originYmm);
  });

  it('places side to the right of front', () => {
    const r = planSheetLayout({
      sheet: 'A3',
      bbox: { widthMm: 50, depthMm: 30, heightMm: 40 },
      views: ['front', 'side'],
    });
    const front = r.views.find(v => v.kind === 'front')!;
    const side = r.views.find(v => v.kind === 'side')!;
    expect(side.originXmm).toBeGreaterThan(front.originXmm);
  });

  it('flags overflow for absurd parts', () => {
    const r = planSheetLayout({
      sheet: 'A4',
      bbox: { widthMm: 100_000, depthMm: 100_000, heightMm: 100_000 },
      views: ['front', 'top', 'side'],
    });
    expect(r.overflowed).toBe(true);
  });

  it('portrait orientation swaps sheet dimensions', () => {
    const land = planSheetLayout({
      sheet: 'A4',
      orientation: 'landscape',
      bbox: { widthMm: 50, depthMm: 30, heightMm: 40 },
      views: ['front'],
    });
    const port = planSheetLayout({
      sheet: 'A4',
      orientation: 'portrait',
      bbox: { widthMm: 50, depthMm: 30, heightMm: 40 },
      views: ['front'],
    });
    expect(land.sheetWidthMm).toBeGreaterThan(land.sheetHeightMm);
    expect(port.sheetHeightMm).toBeGreaterThan(port.sheetWidthMm);
  });
});
