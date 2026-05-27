import { describe, it, expect } from 'vitest';
import {
  computeMargin,
  defaultShopRules,
  quotePriceFromCost,
  summarize,
  type QuoteContext,
  type MarginRule,
} from './marginRulesEngine';

function baseCtx(overrides: Partial<QuoteContext> = {}): QuoteContext {
  return {
    quantity: 100,
    complexity: 'medium',
    customerTier: 'oem',
    leadTimeDays: 30,
    ...overrides,
  };
}

describe('computeMargin', () => {
  it('no rules → base margin unchanged', () => {
    const r = computeMargin(baseCtx(), [], 25);
    expect(r.finalMarginPct).toBe(25);
    expect(r.applied).toEqual([]);
  });

  it('add rule increases margin', () => {
    const rule: MarginRule = {
      id: 'test', description: '', condition: () => true,
      action: { type: 'add', percentPoints: 10 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 20);
    expect(r.finalMarginPct).toBe(30);
  });

  it('rule that does not fire is skipped', () => {
    const rule: MarginRule = {
      id: 'test', description: '', condition: () => false,
      action: { type: 'add', percentPoints: 10 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 20);
    expect(r.finalMarginPct).toBe(20);
    expect(r.skipped).toContain('test');
  });

  it('floor rule raises low margins', () => {
    const rule: MarginRule = {
      id: 'floor10', description: '', condition: () => true,
      action: { type: 'floor', percent: 10 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 5);
    expect(r.finalMarginPct).toBe(10);
  });

  it('ceiling rule caps high margins', () => {
    const rule: MarginRule = {
      id: 'cap50', description: '', condition: () => true,
      action: { type: 'ceiling', percent: 50 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 100);
    expect(r.finalMarginPct).toBe(50);
  });

  it('set rule overrides', () => {
    const rule: MarginRule = {
      id: 'set40', description: '', condition: () => true,
      action: { type: 'set', percent: 40 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 20);
    expect(r.finalMarginPct).toBe(40);
  });

  it('priority order respected', () => {
    const rules: MarginRule[] = [
      { id: 'r1', description: '', condition: () => true, action: { type: 'add', percentPoints: 10 }, priority: 1 },
      { id: 'r2', description: '', condition: () => true, action: { type: 'set', percent: 0 }, priority: 2 },
    ];
    const r = computeMargin(baseCtx(), rules, 20);
    expect(r.finalMarginPct).toBe(0);
  });

  it('records before/after per rule', () => {
    const rule: MarginRule = {
      id: 'test', description: 'd', condition: () => true,
      action: { type: 'add', percentPoints: 5 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 20);
    expect(r.applied[0]!.marginBeforePct).toBe(20);
    expect(r.applied[0]!.marginAfterPct).toBe(25);
    expect(r.applied[0]!.deltaPct).toBe(5);
  });

  it('multiply rule scales', () => {
    const rule: MarginRule = {
      id: 'x2', description: '', condition: () => true,
      action: { type: 'multiply', factor: 2 }, priority: 1,
    };
    const r = computeMargin(baseCtx(), [rule], 20);
    expect(r.finalMarginPct).toBe(40);
  });
});

describe('defaultShopRules', () => {
  it('rush order increases margin', () => {
    const r = computeMargin(baseCtx({ leadTimeDays: 3 }), defaultShopRules(), 20);
    expect(r.finalMarginPct).toBeGreaterThan(20);
  });

  it('large volume drops margin', () => {
    const r = computeMargin(baseCtx({ quantity: 1000 }), defaultShopRules(), 20);
    expect(r.finalMarginPct).toBeLessThan(20);
  });

  it('complex job adds surcharge', () => {
    const r = computeMargin(baseCtx({ complexity: 'extreme' }), defaultShopRules(), 20);
    expect(r.finalMarginPct).toBeGreaterThan(20);
  });

  it('distributor tier reduces margin', () => {
    const normal = computeMargin(baseCtx({ customerTier: 'oem' }), defaultShopRules(), 20);
    const dist = computeMargin(baseCtx({ customerTier: 'distributor' }), defaultShopRules(), 20);
    expect(dist.finalMarginPct).toBeLessThan(normal.finalMarginPct);
  });

  it('floor at 8% even with discount stack', () => {
    const r = computeMargin(
      baseCtx({ quantity: 10000, customerTier: 'distributor' }),
      defaultShopRules(),
      5,
    );
    expect(r.finalMarginPct).toBeGreaterThanOrEqual(8);
  });
});

describe('quotePriceFromCost', () => {
  it('price = cost × (1 + margin/100)', () => {
    const q = quotePriceFromCost(100, 25);
    expect(q.priceUsd).toBe(125);
  });

  it('zero margin → price = cost', () => {
    const q = quotePriceFromCost(50, 0);
    expect(q.priceUsd).toBe(50);
  });
});

describe('summarize', () => {
  it('counts fired and skipped rules', () => {
    const r = computeMargin(baseCtx(), defaultShopRules(), 20);
    const s = summarize(r, 20);
    expect(s.rulesFired + s.rulesSkipped).toBe(defaultShopRules().length);
  });

  it('totalAdjustmentPct = final - base', () => {
    const r = computeMargin(baseCtx({ leadTimeDays: 3 }), defaultShopRules(), 20);
    const s = summarize(r, 20);
    expect(s.totalAdjustmentPct).toBeCloseTo(r.finalMarginPct - 20, 5);
  });
});
