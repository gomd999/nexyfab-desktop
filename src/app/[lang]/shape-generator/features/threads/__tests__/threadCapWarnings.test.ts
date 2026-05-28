/**
 * threadCapWarnings.test.ts — Wave 2 Phase 2 Track D7 (W7).
 *
 * Verifies the four cap-warning rules from spec §8.1.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateThreadCapWarnings,
  hasBlockingWarnings,
  warningsOfCode,
  rowForFeature,
  type ThreadCapWarningCode,
} from '../threadCapWarnings';
import { makeThreadFeature } from '../threadFeature';

function geomFeature(opts: { length?: number; startOffset?: number; designation?: string } = {}) {
  return makeThreadFeature({
    id: 'fixture',
    threadRef: { series: 'ISO_M_COARSE', designation: opts.designation ?? 'M8' },
    length: opts.length ?? 20,
    startOffset: opts.startOffset ?? 0,
    mode: 'geometric',
  });
}

function pickCodes(warnings: ReturnType<typeof evaluateThreadCapWarnings>): ThreadCapWarningCode[] {
  return warnings.map((w) => w.code);
}

describe('THREAD_BLOWS_PAST_BODY', () => {
  it('fires when threadEnd > parentBodyLengthMm', () => {
    const f = geomFeature({ length: 30, startOffset: 0 });
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(pickCodes(w)).toContain('THREAD_BLOWS_PAST_BODY');
    const blow = warningsOfCode(w, 'THREAD_BLOWS_PAST_BODY');
    expect(blow[0]!.severity).toBe('error');
    expect(blow[0]!.detail?.excess).toBeCloseTo(10);
  });

  it('does NOT fire when threadEnd ≤ parentBodyLengthMm', () => {
    const f = geomFeature({ length: 15, startOffset: 0 });
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(pickCodes(w)).not.toContain('THREAD_BLOWS_PAST_BODY');
  });

  it('skipped entirely when parentBodyLengthMm is undefined', () => {
    const f = geomFeature({ length: 30 });
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(pickCodes(w)).not.toContain('THREAD_BLOWS_PAST_BODY');
  });
});

describe('THREAD_TOO_CLOSE_TO_END', () => {
  it('fires when clearance < 1·pitch (M8 pitch=1.25; clearance=1mm)', () => {
    const f = geomFeature({ length: 19, startOffset: 0 }); // ends at 19, body=20 → clearance 1mm
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(pickCodes(w)).toContain('THREAD_TOO_CLOSE_TO_END');
    expect(warningsOfCode(w, 'THREAD_TOO_CLOSE_TO_END')[0]!.severity).toBe('warning');
  });

  it('does NOT fire when clearance ≥ 1·pitch (M8: 1.25)', () => {
    const f = geomFeature({ length: 18, startOffset: 0 }); // clearance 2.0mm > 1.25
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(pickCodes(w)).not.toContain('THREAD_TOO_CLOSE_TO_END');
  });

  it('does NOT fire when thread already past body (BLOWS_PAST instead)', () => {
    const f = geomFeature({ length: 25, startOffset: 0 });
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(pickCodes(w)).toContain('THREAD_BLOWS_PAST_BODY');
    // TOO_CLOSE only fires for non-negative clearance
    expect(pickCodes(w)).not.toContain('THREAD_TOO_CLOSE_TO_END');
  });
});

describe('THREAD_LENGTH_NOT_INTEGER_PITCH', () => {
  it('does NOT fire when length / pitch is an integer (20 / 1.25 = 16)', () => {
    const f = geomFeature({ length: 20 });
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(pickCodes(w)).not.toContain('THREAD_LENGTH_NOT_INTEGER_PITCH');
  });

  it('fires when length is mid-pitch (20.5 / 1.25 = 16.4 → remainder 0.5)', () => {
    const f = geomFeature({ length: 20.5 });
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(pickCodes(w)).toContain('THREAD_LENGTH_NOT_INTEGER_PITCH');
  });

  it('tolerates a tiny remainder (within 5% of pitch) — 20.01 mm passes', () => {
    const f = geomFeature({ length: 20.01 });
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(pickCodes(w)).not.toContain('THREAD_LENGTH_NOT_INTEGER_PITCH');
  });

  it('severity is "warning" not "error" (cosmetic-level concern)', () => {
    const f = geomFeature({ length: 20.5 });
    const w = evaluateThreadCapWarnings({ feature: f });
    const ws = warningsOfCode(w, 'THREAD_LENGTH_NOT_INTEGER_PITCH');
    expect(ws[0]!.severity).toBe('warning');
  });
});

describe('THREAD_PROFILE_INVALID', () => {
  it('does NOT fire for the canonical 60° V profile', () => {
    const f = geomFeature();
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(pickCodes(w)).not.toContain('THREAD_PROFILE_INVALID');
  });

  it('fires when a malformed self-intersecting profile is supplied', () => {
    const f = geomFeature();
    // Bowtie polygon
    const bowtie: [number, number][] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    const w = evaluateThreadCapWarnings({ feature: f, profile: bowtie });
    expect(pickCodes(w)).toContain('THREAD_PROFILE_INVALID');
    expect(warningsOfCode(w, 'THREAD_PROFILE_INVALID')[0]!.severity).toBe('error');
  });
});

describe('hasBlockingWarnings + helpers', () => {
  it('returns true when at least one error is present', () => {
    const f = geomFeature({ length: 30, startOffset: 0 });
    const w = evaluateThreadCapWarnings({ feature: f, parentBodyLengthMm: 20 });
    expect(hasBlockingWarnings(w)).toBe(true);
  });

  it('returns false when only warnings (no errors) are present', () => {
    const f = geomFeature({ length: 20.5 });
    const w = evaluateThreadCapWarnings({ feature: f });
    expect(hasBlockingWarnings(w)).toBe(false);
  });

  it('rowForFeature returns the catalog row', () => {
    const f = geomFeature({ designation: 'M10' });
    expect(rowForFeature(f)?.nominalDia).toBe(10);
  });

  it('rowForFeature returns null for unknown designation', () => {
    const fake = {
      ...geomFeature(),
      threadRef: { series: 'ISO_M_COARSE' as const, designation: 'M999' },
    };
    expect(rowForFeature(fake)).toBeNull();
  });
});
