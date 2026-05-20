import { describe, it, expect } from 'vitest';
import {
  generateDwells,
  insertDwells,
  timeImpact,
  suggestReductions,
  summarize,
  DEFAULT_POLICIES,
  type DwellEvent,
} from './dwellSequencer';

function event(id: string, trigger: DwellEvent['trigger'], duration?: number): DwellEvent {
  return duration !== undefined ? { id, trigger, durationMs: duration } : { id, trigger };
}

describe('generateDwells', () => {
  it('empty → no dwells', () => {
    const r = generateDwells([]);
    expect(r.events).toEqual([]);
    expect(r.totalDwellMs).toBe(0);
  });

  it('drill-bottom uses policy default', () => {
    const r = generateDwells([event('e1', 'drill-bottom')]);
    expect(r.events[0]!.durationMs).toBe(DEFAULT_POLICIES.drillBottomMs);
  });

  it('custom duration override', () => {
    const r = generateDwells([event('e1', 'drill-bottom', 1000)]);
    expect(r.events[0]!.durationMs).toBe(1000);
  });

  it('G04 P emission', () => {
    const r = generateDwells([event('e1', 'drill-bottom')]);
    expect(r.events[0]!.gcode).toMatch(/^G04 P\d+/);
  });

  it('total dwell sums', () => {
    const r = generateDwells([event('e1', 'drill-bottom'), event('e2', 'tap-bottom')]);
    expect(r.totalDwellMs).toBe(DEFAULT_POLICIES.drillBottomMs + DEFAULT_POLICIES.tapBottomMs);
  });

  it('zero duration skipped', () => {
    const r = generateDwells([event('e1', 'drill-bottom', 0)]);
    expect(r.events).toEqual([]);
  });

  it('longest tracked', () => {
    const r = generateDwells([event('short', 'tap-bottom'), event('long', 'probe-touch')]);
    expect(r.longest?.id).toBe('long');
  });
});

describe('insertDwells', () => {
  it('inserts G04 after specified line', () => {
    const gcode = ['G1 Z-10', 'G0 Z5'];
    const events = new Map();
    events.set(0, event('e1', 'drill-bottom'));
    const out = insertDwells(gcode, events);
    expect(out).toContain('G04 P200');
    expect(out).toHaveLength(3);
  });

  it('no-op when no events', () => {
    const gcode = ['G1 X10', 'G1 Y20'];
    expect(insertDwells(gcode, new Map())).toEqual(gcode);
  });
});

describe('timeImpact', () => {
  it('compute dwell fraction', () => {
    const r = generateDwells([event('e1', 'drill-bottom')]);
    const impact = timeImpact(r, 10);
    expect(impact.dwellFraction).toBeGreaterThan(0);
    expect(impact.dwellFraction).toBeLessThan(1);
  });
});

describe('suggestReductions', () => {
  it('flags long dwells', () => {
    const r = generateDwells([event('e1', 'drill-bottom', 1500)]);
    const sug = suggestReductions(r, 500);
    expect(sug.length).toBe(1);
  });

  it('no suggestions for short dwells', () => {
    const r = generateDwells([event('e1', 'drill-bottom', 100)]);
    expect(suggestReductions(r, 500)).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports counts + total', () => {
    const r = generateDwells([event('e1', 'drill-bottom'), event('e2', 'probe-touch')]);
    const s = summarize(r);
    expect(s.eventCount).toBe(2);
    expect(s.totalDwellMs).toBe(r.totalDwellMs);
  });
});
