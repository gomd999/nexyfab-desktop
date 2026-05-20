import { describe, it, expect } from 'vitest';
import {
  buildCallout,
  generateBatch,
  validateCallout,
  summarize,
  METRIC_COARSE_PITCH,
  type ThreadSpec,
} from './threadCalloutGenerator';

function metric(nominal: number, internal: boolean = true, depth: number = 10): ThreadSpec {
  return { standard: 'metric', nominalMm: nominal, internal, direction: 'right', depthMm: depth };
}

describe('METRIC_COARSE_PITCH', () => {
  it('M6 pitch = 1.0', () => {
    expect(METRIC_COARSE_PITCH[6]).toBe(1.0);
  });
});

describe('buildCallout', () => {
  it('M6 internal', () => {
    const r = buildCallout(metric(6));
    expect(r.text).toContain('M6');
    expect(r.text).toContain('6H');
  });

  it('M6 external uses 6g', () => {
    const r = buildCallout(metric(6, false));
    expect(r.text).toContain('6g');
  });

  it('depth appended', () => {
    const r = buildCallout(metric(6, true, 15));
    expect(r.text).toContain('DP 15');
  });

  it('left hand suffix', () => {
    const r = buildCallout({ ...metric(6), direction: 'left' });
    expect(r.text).toContain('LH');
  });

  it('drill diameter for internal thread', () => {
    const r = buildCallout(metric(6));
    expect(r.drillDiameterMm).toBeDefined();
    expect(r.drillDiameterMm).toBeLessThan(6);
  });

  it('no drill for external thread', () => {
    const r = buildCallout(metric(6, false));
    expect(r.drillDiameterMm).toBeUndefined();
  });

  it('unknown nominal → warning', () => {
    const r = buildCallout(metric(99));
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('UNC 1/4-20', () => {
    const r = buildCallout({ standard: 'unc', nominalMm: 6.35, internal: true, direction: 'right', depthMm: 10 });
    expect(r.text).toContain('UNC');
  });

  it('NPT formatting', () => {
    const r = buildCallout({ standard: 'npt', nominalMm: 6.35, internal: true, direction: 'right', depthMm: 0 });
    expect(r.text).toContain('NPT');
  });

  it('drill depth optional clause', () => {
    const r = buildCallout({ ...metric(6), drillDepthMm: 20 });
    expect(r.text).toContain('DRILL DP 20');
  });
});

describe('generateBatch', () => {
  it('produces N outputs', () => {
    const r = generateBatch([metric(6), metric(8), metric(10)]);
    expect(r).toHaveLength(3);
  });
});

describe('validateCallout', () => {
  it('valid metric → no issues', () => {
    const r = buildCallout(metric(6));
    expect(validateCallout(r.text).valid).toBe(true);
  });

  it('invalid metric (no pitch) → issue', () => {
    const v = validateCallout('M6 LH');
    expect(v.valid).toBe(false);
  });
});

describe('summarize', () => {
  it('reports text + drill flag', () => {
    const r = buildCallout(metric(6));
    const s = summarize(r);
    expect(s.text).toBe(r.text);
    expect(s.hasDrill).toBe(true);
  });
});
