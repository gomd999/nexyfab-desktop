/**
 * Internal quote provider — math + structure.
 *
 * The numeric tolerances are deliberately loose — same philosophy as
 * costEstimation tests. We assert structure + qualitative ordering
 * (positive total for an Al cube on CNC, unit-price = total / quantity,
 * lead-time matches the heuristic table, line items propagate).
 *
 * The provider must NEVER claim 'binding' confidence (reserved for real
 * shop quotes) — that's the most load-bearing contract.
 */
import { describe, it, expect } from 'vitest';
import { internalQuoteProvider } from '../internalProvider';

describe('internalQuoteProvider', () => {
  it('returns ok with a quote for a valid CNC + aluminum + bbox request', async () => {
    const r = await internalQuoteProvider.getQuote({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 1,
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.quote.providerId).toBe('internal');
    expect(r.quote.providerName).toMatch(/internal/i);
    expect(r.quote.lineItems.length).toBeGreaterThan(0);
    expect(r.quote.validUntilMs).toBeGreaterThan(Date.now());
    expect(r.quote.orderUrl).toBeNull();
    expect(r.quote.notes.length).toBeGreaterThan(0);
  });

  it('totalUsd is strictly positive for a 50mm Al cube via CNC', async () => {
    const r = await internalQuoteProvider.getQuote({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 1,
      measuredVolumeMm3: 125_000,
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.quote.totalUsd).toBeGreaterThan(0);
  });

  it('unitPriceUsd equals totalUsd / quantity for qty > 1', async () => {
    const r = await internalQuoteProvider.getQuote({
      process: 'fdm',
      material: 'pla',
      quantity: 10,
      measuredVolumeMm3: 10_000,
      bboxMm: { wMm: 20, hMm: 20, dMm: 25 },
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.quote.unitPriceUsd).toBeCloseTo(r.quote.totalUsd / 10, 6);
  });

  it("confidence is never 'binding' for the internal estimator", async () => {
    // Spot-check across several (process, material, geometry-completeness)
    // combinations — the contract is universal, not per-process.
    const samples = [
      { process: 'cnc_mill', material: 'aluminum_6061', measuredVolumeMm3: 8000, bboxMm: { wMm: 20, hMm: 20, dMm: 20 } },
      { process: 'fdm',      material: 'pla',           measuredVolumeMm3: 8000, bboxMm: { wMm: 20, hMm: 20, dMm: 20 } },
      { process: 'sla',      material: 'abs',           bboxMm: { wMm: 20, hMm: 20, dMm: 20 } },
      { process: 'sheet',    material: 'stainless_304', bboxMm: { wMm: 100, hMm: 100, dMm: 2 } },
    ] as const;
    for (const s of samples) {
      const r = await internalQuoteProvider.getQuote({ quantity: 1, ...s });
      if (!r.ok) throw new Error(`expected ok for ${s.process}/${s.material}`);
      expect(['indicative', 'rough']).toContain(r.quote.confidence);
      expect(r.quote.confidence).not.toBe('binding');
    }
  });

  it('lead time matches the per-process heuristic table', async () => {
    const expected: Record<string, number> = {
      fdm: 2, sla: 3, cnc_mill: 5, sheet: 4, injection_molding: 14, die_cast: 21,
    };
    for (const [process, days] of Object.entries(expected)) {
      const r = await internalQuoteProvider.getQuote({
        process: process as 'fdm' | 'sla' | 'cnc_mill' | 'sheet' | 'injection_molding' | 'die_cast',
        // die_cast + plastic is blocked at the estimator level — pick a metal
        // for the casting processes; plastic for the printing processes so
        // every entry is a real (not incompatible) combo.
        material: (process === 'fdm' || process === 'sla') ? 'pla' : 'aluminum_6061',
        quantity: 1,
        bboxMm: { wMm: 30, hMm: 30, dMm: 30 },
      });
      if (!r.ok) throw new Error(`expected ok for process ${process}`);
      expect(r.quote.leadTimeDays).toBe(days);
    }
  });

  it('all CostBreakdown line items propagate into the quote', async () => {
    const r = await internalQuoteProvider.getQuote({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 5,
      measuredVolumeMm3: 50_000,
      bboxMm: { wMm: 40, hMm: 40, dMm: 30 },
    });
    if (!r.ok) throw new Error('expected ok');
    // Estimator emits material + machine + setup → at least 3 lines for
    // a non-degenerate request.
    expect(r.quote.lineItems.length).toBeGreaterThanOrEqual(3);
    // The line-item amounts must sum within rounding of totalUsd. Allow a
    // 0.01 cent of float drift since some breakdown lines are derived
    // from per-unit math.
    const sum = r.quote.lineItems.reduce((acc, li) => acc + li.amountUsd, 0);
    expect(Math.abs(sum - r.quote.totalUsd)).toBeLessThan(0.01);
  });
});
