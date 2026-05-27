import { describe, it, expect } from 'vitest';
import {
  rankStrategies,
  recommend,
  summarize,
  type OperationContext,
  type MachineCapabilities,
} from './coolantStrategyPicker';

const fullCaps: MachineCapabilities = { hasTSC: true, hasMQL: true, hasCryogenic: true };
const basicCaps: MachineCapabilities = { hasTSC: false, hasMQL: false, hasCryogenic: false };

function ctx(material: OperationContext['material'], op: OperationContext['operation'], depthRatio: number = 1): OperationContext {
  return { material, operation: op, depthOverDiameterRatio: depthRatio, spindleRpm: 5000 };
}

describe('rankStrategies', () => {
  it('returns 6 strategies', () => {
    expect(rankStrategies(ctx('aluminum', 'milling-roughing'), fullCaps)).toHaveLength(6);
  });

  it('basic machine marks TSC/MQL/cryo as unavailable', () => {
    const ranked = rankStrategies(ctx('aluminum', 'milling-roughing'), basicCaps);
    const tsc = ranked.find(s => s.strategy === 'through-spindle')!;
    expect(tsc.available).toBe(false);
    expect(tsc.score).toBe(0);
  });

  it('aluminum milling prefers mist/MQL', () => {
    const ranked = rankStrategies(ctx('aluminum', 'milling-roughing'), fullCaps);
    const top = ranked[0]!.strategy;
    expect(['mist', 'mql']).toContain(top);
  });

  it('titanium dry → very low score', () => {
    const ranked = rankStrategies(ctx('titanium', 'milling-roughing'), fullCaps);
    const dry = ranked.find(s => s.strategy === 'dry')!;
    expect(dry.score).toBeLessThan(20);
  });

  it('inconel cryogenic → top', () => {
    const ranked = rankStrategies(ctx('inconel', 'milling-roughing'), fullCaps);
    expect(ranked[0]!.strategy).toBe('cryogenic');
  });

  it('cast iron prefers dry', () => {
    const ranked = rankStrategies(ctx('cast-iron', 'milling-roughing'), fullCaps);
    expect(ranked[0]!.strategy).toBe('dry');
  });

  it('deep drilling prefers TSC', () => {
    const ranked = rankStrategies(ctx('steel', 'drilling', 8), fullCaps);
    expect(ranked[0]!.strategy).toBe('through-spindle');
  });

  it('tapping prefers flood or MQL', () => {
    const ranked = rankStrategies(ctx('steel', 'tapping'), fullCaps);
    expect(['flood', 'mql']).toContain(ranked[0]!.strategy);
  });

  it('grinding prefers flood', () => {
    const ranked = rankStrategies(ctx('steel', 'grinding'), fullCaps);
    expect(ranked[0]!.strategy).toBe('flood');
  });

  it('rationale text non-empty for top choice', () => {
    const ranked = rankStrategies(ctx('titanium', 'milling-roughing'), fullCaps);
    expect(ranked[0]!.rationale.length).toBeGreaterThan(0);
  });
});

describe('recommend', () => {
  it('returns one best strategy', () => {
    const r = recommend(ctx('aluminum', 'milling-roughing'), fullCaps);
    expect(r.best).toBeDefined();
    expect(r.score).toBeGreaterThan(0);
  });

  it('alternates ≥ 60 score', () => {
    const r = recommend(ctx('steel', 'milling-roughing'), fullCaps);
    expect(r.alternates.every(s => s !== r.best)).toBe(true);
  });
});

describe('summarize', () => {
  it('reports availability count', () => {
    const s = summarize(ctx('aluminum', 'milling-roughing'), basicCaps);
    // 3 always-available strategies: flood/mist/dry.
    expect(s.availableStrategyCount).toBe(3);
  });

  it('full capabilities → 6 available', () => {
    expect(summarize(ctx('aluminum', 'milling-roughing'), fullCaps).availableStrategyCount).toBe(6);
  });
});
