import { describe, it, expect } from 'vitest';
import {
  pickDirection,
  freeAreaPercent,
  pickMultiGoal,
  summarize,
  type PanelEnvironment,
} from './louverDirectionPicker';

const env: PanelEnvironment = {
  hotSideDeltaC: 20,
  pressureDifferentialPa: 10,
  splashRisk: false,
};

describe('pickDirection', () => {
  it('outflow + hot delta → up direction wins', () => {
    const r = pickDirection(env, { goal: 'outflow', panelWidthMm: 200, panelHeightMm: 200, louverHeightMm: 10, minRowGapMm: 5 });
    expect(r.bestDirection).toBe('up');
  });

  it('splash-protect → down', () => {
    const r = pickDirection({ ...env, splashRisk: true }, { goal: 'splash-protect', panelWidthMm: 200, panelHeightMm: 200, louverHeightMm: 10, minRowGapMm: 5 });
    expect(r.bestDirection).toBe('down');
  });

  it('row count > 0 for normal panel', () => {
    const r = pickDirection(env);
    expect(r.recommendedRowCount).toBeGreaterThan(0);
  });

  it('warns when too small for 2+ rows', () => {
    const r = pickDirection(env, { panelHeightMm: 10, panelWidthMm: 100, louverHeightMm: 10, minRowGapMm: 5, goal: 'outflow' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('splash risk + up direction warns', () => {
    const r = pickDirection({ ...env, splashRisk: true, hotSideDeltaC: 50 }, { goal: 'outflow', panelHeightMm: 200, panelWidthMm: 200, louverHeightMm: 10, minRowGapMm: 5 });
    expect(r.warnings.some(w => w.includes('Splash'))).toBe(true);
  });

  it('free area fraction in [0, 1]', () => {
    const r = pickDirection(env);
    expect(r.estimatedFreeAreaFraction).toBeGreaterThan(0);
    expect(r.estimatedFreeAreaFraction).toBeLessThan(1);
  });

  it('4 alternative scores returned', () => {
    const r = pickDirection(env);
    expect(r.alternativeScores).toHaveLength(4);
  });

  it('scores sorted descending', () => {
    const r = pickDirection(env);
    for (let i = 1; i < r.alternativeScores.length; i++) {
      expect(r.alternativeScores[i]!.score).toBeLessThanOrEqual(r.alternativeScores[i - 1]!.score);
    }
  });
});

describe('freeAreaPercent', () => {
  it('positive percentage', () => {
    expect(freeAreaPercent({ panelWidthMm: 200, panelHeightMm: 200, louverHeightMm: 10, minRowGapMm: 5, goal: 'outflow' })).toBeGreaterThan(0);
  });

  it('larger gap → smaller percent', () => {
    const tight = freeAreaPercent({ panelWidthMm: 200, panelHeightMm: 200, louverHeightMm: 10, minRowGapMm: 2, goal: 'outflow' });
    const loose = freeAreaPercent({ panelWidthMm: 200, panelHeightMm: 200, louverHeightMm: 10, minRowGapMm: 10, goal: 'outflow' });
    expect(loose).toBeLessThan(tight);
  });
});

describe('pickMultiGoal', () => {
  it('returns result struct', () => {
    const r = pickMultiGoal(env, { outflow: 0.7, 'splash-protect': 0.3 });
    expect(r.bestDirection).toBeDefined();
  });
});

describe('summarize', () => {
  it('reports best direction', () => {
    const r = pickDirection(env);
    const s = summarize(r);
    expect(s.bestDirection).toBe(r.bestDirection);
  });
});
