/**
 * auto-match factory selection — customer preference vs scorer.
 */
import { describe, it, expect } from 'vitest';
import { scoreFactory, pickAssignedFactory, type RfqRow, type FactoryRow } from './matchSelection';

function rfq(over: Partial<RfqRow> = {}): RfqRow {
  return {
    id: 'rfq1', material_id: 'al6061', dfm_process: 'cnc', volume_cm3: 10,
    quantity: 100, shape_name: 'bracket', status: 'pending', preferred_factory_id: null,
    ...over,
  };
}
function factory(id: string, over: Partial<FactoryRow> = {}): FactoryRow {
  return {
    id, name: `Factory ${id}`, partner_email: `${id}@x.com`, contact_email: null,
    processes: JSON.stringify(['cnc']), rating: 4, price_level: 2, ...over,
  };
}

describe('scoreFactory', () => {
  it('rewards a process match (+40 over a non-match)', () => {
    const match = scoreFactory(rfq(), factory('a', { processes: JSON.stringify(['cnc']) }));
    const noMatch = scoreFactory(rfq(), factory('b', { processes: JSON.stringify(['injection']) }));
    expect(match - noMatch).toBeCloseTo(40, 5);
  });

  it('higher rating and lower price_level score higher', () => {
    const good = scoreFactory(rfq(), factory('a', { rating: 5, price_level: 1 }));
    const poor = scoreFactory(rfq(), factory('b', { rating: 1, price_level: 3 }));
    expect(good).toBeGreaterThan(poor);
  });

  it('tolerates malformed processes JSON (no crash, no process bonus)', () => {
    const s = scoreFactory(rfq(), factory('a', { processes: '{not json' }));
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe('pickAssignedFactory — preference overrides score', () => {
  const lowScorer = factory('pref', { processes: JSON.stringify(['injection']), rating: 1, price_level: 3 });
  const highScorer = factory('best', { processes: JSON.stringify(['cnc']), rating: 5, price_level: 1 });

  it('assigns the customer-preferred factory even when it scores worst', () => {
    const picked = pickAssignedFactory(rfq({ preferred_factory_id: 'pref' }), [lowScorer, highScorer]);
    expect(picked).not.toBeNull();
    expect(picked!.factory.id).toBe('pref');
    expect(picked!.matchedBy).toBe('preference');
    expect(picked!.score).toBe(-1);
  });

  it('falls back to scoring when the preferred factory is not active/known', () => {
    const picked = pickAssignedFactory(rfq({ preferred_factory_id: 'ghost' }), [lowScorer, highScorer]);
    expect(picked!.factory.id).toBe('best'); // ghost not in the active set → score wins
    expect(picked!.matchedBy).toBe('score');
  });

  it('with no preference, the highest scorer wins', () => {
    const picked = pickAssignedFactory(rfq(), [lowScorer, highScorer]);
    expect(picked!.factory.id).toBe('best');
    expect(picked!.matchedBy).toBe('score');
  });

  it('returns null when there are no factories', () => {
    expect(pickAssignedFactory(rfq(), [])).toBeNull();
  });
});
