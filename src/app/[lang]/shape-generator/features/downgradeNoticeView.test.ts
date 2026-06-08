/**
 * downgradeNoticeView — banner presentation logic (dedup, severity order, i18n).
 */
import { describe, it, expect } from 'vitest';
import { summarizeDowngrades } from './downgradeNoticeView';
import type { MeshDowngradeNotice } from './downgradeNotice';

function approx(op: string): MeshDowngradeNotice {
  return { op, severity: 'approximated', i18nKey: 'downgrade.approximated', fallbackMessage: '' };
}
function blocked(op: string): MeshDowngradeNotice {
  return { op, severity: 'blocked', i18nKey: 'downgrade.blocked', fallbackMessage: '' };
}

describe('summarizeDowngrades', () => {
  it('empty input → total 0, no worst, no items (banner hidden)', () => {
    const m = summarizeDowngrades([], 'en');
    expect(m.total).toBe(0);
    expect(m.worst).toBeNull();
    expect(m.items).toEqual([]);
  });

  it('counts blocked vs approximated', () => {
    const m = summarizeDowngrades([approx('Fillet'), blocked('Boolean'), approx('Shell')], 'en');
    expect(m.total).toBe(3);
    expect(m.blocked).toBe(1);
    expect(m.approximated).toBe(2);
    expect(m.worst).toBe('blocked'); // any blocked dominates
  });

  it('worst is approximated when nothing is blocked', () => {
    expect(summarizeDowngrades([approx('Fillet')], 'en').worst).toBe('approximated');
  });

  it('dedupes by op+severity and counts collisions', () => {
    const m = summarizeDowngrades([approx('Fillet'), approx('Fillet'), approx('Fillet')], 'en');
    expect(m.items).toHaveLength(1);
    expect(m.items[0]!.op).toBe('Fillet');
    expect(m.items[0]!.count).toBe(3);
    expect(m.total).toBe(3); // total is pre-dedup
  });

  it('same op at two severities stays two rows', () => {
    const m = summarizeDowngrades([approx('Fillet'), blocked('Fillet')], 'en');
    expect(m.items).toHaveLength(2);
  });

  it('orders blocked rows before approximated, then alphabetically', () => {
    const m = summarizeDowngrades(
      [approx('Sweep'), approx('Boolean'), blocked('Hole')],
      'en',
    );
    expect(m.items.map((i) => `${i.severity}:${i.op}`)).toEqual([
      'blocked:Hole', 'approximated:Boolean', 'approximated:Sweep',
    ]);
  });

  it('localizes headline + message (ko / en / ar) and interpolates the op', () => {
    const en = summarizeDowngrades([approx('Fillet')], 'en');
    expect(en.headline).toBe('Precision notice');
    expect(en.items[0]!.message).toContain('Fillet');
    expect(en.items[0]!.message.toLowerCase()).toContain('b-rep');

    const ko = summarizeDowngrades([approx('Fillet')], 'kr');
    expect(ko.headline).toBe('정밀도 주의');
    expect(ko.items[0]!.message).toContain('Fillet');
    expect(ko.items[0]!.message).toContain('B-rep');

    const ar = summarizeDowngrades([blocked('Boolean')], 'ar');
    expect(ar.headline).toBe('تنبيه الدقة');
    expect(ar.items[0]!.message).toContain('Boolean');
  });

  it('unknown lang falls back to English', () => {
    const m = summarizeDowngrades([approx('Fillet')], 'xx');
    expect(m.headline).toBe('Precision notice');
  });
});
