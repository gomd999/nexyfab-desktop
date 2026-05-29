/**
 * stepRoundtripReport.test.ts — pure-math drift tests.
 *
 * The WASM chain (`runStepRoundtripReport`) lives in the existing
 * RUN_OCCT_FEASIBILITY=1 gated suite; this file covers the
 * `computeRoundtripDrift` math without loading WASM so it runs in the
 * default CI suite.
 *
 * Covers:
 *  - perfect match → verdict='clean', all zeroes
 *  - tiny drift < 0.5% → 'clean'
 *  - 1% drift → 'minor'
 *  - 5% drift → 'lossy'
 *  - 50% drift → 'broken'
 *  - zero-volume edge case → fallback (no NaN)
 *  - bbox max delta picks worst axis
 *  - hashChanged flag respected
 *  - formatRoundtripDrift produces a one-line summary
 */

import { describe, it, expect } from 'vitest';
import type { GeometrySignature } from '../../__tests__/geometrySignature';
import {
  computeRoundtripDrift,
  formatRoundtripDrift,
} from '../stepRoundtripReport';

function sig(over: Partial<GeometrySignature> = {}): GeometrySignature {
  return {
    vertexCount: 100,
    triangleCount: 50,
    indexed: false,
    hasNormals: true,
    bbox: { min: [-5, -5, -5], max: [5, 5, 5] },
    volume_mm3: 1000,
    surfaceArea_mm2: 600,
    positionHash: 'abc123',
    ...over,
  };
}

describe('computeRoundtripDrift', () => {
  it('perfect match → clean / all-zero', () => {
    const s = sig();
    const d = computeRoundtripDrift(s, s);
    expect(d.verdict).toBe('clean');
    expect(d.volumeDriftPct).toBe(0);
    expect(d.surfaceDriftPct).toBe(0);
    expect(d.bboxDeltaMax).toBe(0);
    expect(d.vertexCountDelta).toBe(0);
    expect(d.triangleCountDelta).toBe(0);
    expect(d.hashChanged).toBe(false);
  });

  it('< 0.5% drift → clean', () => {
    const before = sig({ volume_mm3: 1000, surfaceArea_mm2: 600 });
    const after = sig({ volume_mm3: 1002, surfaceArea_mm2: 601 });
    const d = computeRoundtripDrift(before, after);
    expect(d.volumeDriftPct).toBeCloseTo(0.2, 1);
    expect(d.verdict).toBe('clean');
  });

  it('1% volume drift → minor', () => {
    const before = sig({ volume_mm3: 1000 });
    const after = sig({ volume_mm3: 1010 });
    const d = computeRoundtripDrift(before, after);
    expect(d.volumeDriftPct).toBeCloseTo(1, 2);
    expect(d.verdict).toBe('minor');
  });

  it('5% volume drift → lossy', () => {
    const before = sig({ volume_mm3: 1000 });
    const after = sig({ volume_mm3: 1050 });
    const d = computeRoundtripDrift(before, after);
    expect(d.volumeDriftPct).toBeCloseTo(5, 2);
    expect(d.verdict).toBe('lossy');
  });

  it('50% surface drift → broken', () => {
    const before = sig({ surfaceArea_mm2: 600 });
    const after = sig({ surfaceArea_mm2: 900 });
    const d = computeRoundtripDrift(before, after);
    expect(d.surfaceDriftPct).toBeCloseTo(50, 1);
    expect(d.verdict).toBe('broken');
  });

  it('zero-volume before falls back to absolute delta (no NaN)', () => {
    const before = sig({ volume_mm3: 0 });
    const after = sig({ volume_mm3: 0.001 });
    const d = computeRoundtripDrift(before, after);
    expect(Number.isFinite(d.volumeDriftPct)).toBe(true);
    expect(d.volumeDriftPct).toBeCloseTo(0.001, 5);
  });

  it('worst-of(volume, surface) decides verdict', () => {
    // Volume clean, surface lossy → should pick lossy.
    const before = sig({ volume_mm3: 1000, surfaceArea_mm2: 600 });
    const after = sig({ volume_mm3: 1001, surfaceArea_mm2: 630 });
    const d = computeRoundtripDrift(before, after);
    expect(d.verdict).toBe('lossy');
  });

  it('bbox max delta picks the worst single-axis change', () => {
    const before = sig({ bbox: { min: [-5, -5, -5], max: [5, 5, 5] } });
    const after = sig({ bbox: { min: [-5, -5, -5], max: [5.05, 5, 5.001] } });
    const d = computeRoundtripDrift(before, after);
    expect(d.bboxDeltaMax).toBeCloseTo(0.05, 3);
  });

  it('hashChanged is true when positionHash differs', () => {
    const a = sig({ positionHash: 'abc' });
    const b = sig({ positionHash: 'def' });
    const d = computeRoundtripDrift(a, b);
    expect(d.hashChanged).toBe(true);
  });

  it('vertex/triangle count delta surfaces growth + shrink', () => {
    const a = sig({ vertexCount: 100, triangleCount: 50 });
    const b = sig({ vertexCount: 110, triangleCount: 48 });
    const d = computeRoundtripDrift(a, b);
    expect(d.vertexCountDelta).toBe(10);
    expect(d.triangleCountDelta).toBe(-2);
  });

  it('Infinity input → broken (signature was Infinity-corrupted)', () => {
    const a = sig({ volume_mm3: 1000 });
    const b = sig({ volume_mm3: Infinity });
    const d = computeRoundtripDrift(a, b);
    expect(d.verdict).toBe('broken');
  });
});

describe('formatRoundtripDrift', () => {
  it('produces a single-line summary with all 5 fields', () => {
    const drift = computeRoundtripDrift(
      sig({ volume_mm3: 1000, surfaceArea_mm2: 600, bbox: { min: [-5, -5, -5], max: [5, 5, 5] } }),
      sig({ volume_mm3: 1002, surfaceArea_mm2: 601, bbox: { min: [-5, -5, -5], max: [5.01, 5, 5] } }),
    );
    const line = formatRoundtripDrift(drift);
    expect(line).toContain('clean');
    expect(line).toContain('vol');
    expect(line).toContain('surf');
    expect(line).toContain('bbox');
    expect(line).toContain('mm');
    expect(line.split('·').length).toBe(5);
  });

  it('renders broken verdict explicitly', () => {
    const drift = computeRoundtripDrift(
      sig({ volume_mm3: 1000 }),
      sig({ volume_mm3: 500 }),
    );
    const line = formatRoundtripDrift(drift);
    expect(line.startsWith('broken')).toBe(true);
  });
});
