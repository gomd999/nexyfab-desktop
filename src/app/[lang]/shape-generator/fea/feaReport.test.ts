import { describe, it, expect } from 'vitest';
import { buildFeaReport, formatReportText } from './feaReport';
import type { StressField } from './stressField';

function field(stresses: number[], disps?: number[][]): StressField {
  const disp = new Float32Array(stresses.length * 3);
  if (disps) {
    for (let i = 0; i < disps.length; i++) {
      disp[i * 3] = disps[i][0];
      disp[i * 3 + 1] = disps[i][1];
      disp[i * 3 + 2] = disps[i][2];
    }
  }
  return {
    vertexCount: stresses.length,
    vonMises: new Float32Array(stresses),
    displacement: disp,
  };
}

describe('buildFeaReport', () => {
  it('returns inconclusive verdict for unknown material', () => {
    const r = buildFeaReport(field([10, 20, 30]), { materialId: 'unobtanium' });
    expect(r.verdict).toBe('inconclusive');
    expect(r.safetyFactor).toBeNull();
  });

  it('passes when all SF ≥ 1', () => {
    const r = buildFeaReport(field([10, 20, 30]), { materialId: 'aluminum' });
    expect(r.verdict).toBe('pass');
    expect(r.safetyFactor?.decision).toBe('pass');
  });

  it('fails when any SF < 1', () => {
    // Aluminum yield 276; stress 500 → SF ≈ 0.55 → fail.
    const r = buildFeaReport(field([10, 500]), { materialId: 'aluminum' });
    expect(r.verdict).toBe('fail');
  });

  it('captures stress + displacement statistics', () => {
    const r = buildFeaReport(
      field([10, 20, 30], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
      { materialId: 'aluminum' },
    );
    expect(r.stressMPa.max).toBe(30);
    expect(r.stressMPa.min).toBe(10);
    expect(r.displacementMm.max).toBeCloseTo(1, 3);
    expect(r.displacementMm.min).toBeCloseTo(1, 3);
  });

  it('returns top-N hotspots', () => {
    const r = buildFeaReport(field([1, 100, 50, 200]), {
      materialId: 'aluminum',
      hotspotCount: 2,
    });
    expect(r.hotspots).toHaveLength(2);
    expect(r.hotspots[0].stress).toBe(200);
    expect(r.hotspots[1].stress).toBe(100);
  });

  it('uses injected now() for generatedAt', () => {
    const r = buildFeaReport(field([10]), {
      materialId: 'aluminum',
      now: () => 1234567890,
    });
    expect(r.generatedAt).toBe(1234567890);
  });
});

describe('formatReportText', () => {
  it('emits a printable block with verdict line', () => {
    const r = buildFeaReport(field([10, 20]), { materialId: 'aluminum' });
    const txt = formatReportText(r);
    expect(txt).toContain('FEA Preview Report');
    expect(txt).toContain('Verdict:  PASS');
    expect(txt).toContain('Material: aluminum');
  });

  it('includes hotspots section when present', () => {
    const r = buildFeaReport(field([10, 100, 50]), { materialId: 'aluminum' });
    const txt = formatReportText(r);
    expect(txt).toContain('Top hotspots:');
  });

  it('warns about preview-grade analysis', () => {
    const r = buildFeaReport(field([10]), { materialId: 'aluminum' });
    expect(formatReportText(r)).toContain('Ansys');
  });

  it('handles inconclusive verdict (no SF section)', () => {
    const r = buildFeaReport(field([10]), { materialId: 'unobtanium' });
    const txt = formatReportText(r);
    expect(txt).toContain('Verdict:  INCONCLUSIVE');
  });
});
