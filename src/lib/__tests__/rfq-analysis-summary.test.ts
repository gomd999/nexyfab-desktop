import { describe, it, expect } from 'vitest';
import {
  serializeRfqAnalysisSummary,
  parseStoredAnalysisSummary,
} from '../rfq-analysis-summary';

describe('serializeRfqAnalysisSummary', () => {
  it('accepts minimal v1 payload and stamps provenance', () => {
    const json = serializeRfqAnalysisSummary({
      v: 1,
      feaLinear: { maxMpa: 120, yieldMpa: 250, pass: true },
    });
    expect(json).toBeTruthy();
    const o = JSON.parse(json!);
    expect(o.provenance).toBe('client_self_report');
    expect(o.v).toBe(1);
    expect(o.feaLinear.maxMpa).toBe(120);
  });

  it('returns null for wrong version', () => {
    expect(serializeRfqAnalysisSummary({ v: 2 })).toBeNull();
  });

  it('returns null for extra keys (strict)', () => {
    expect(
      serializeRfqAnalysisSummary({
        v: 1,
        extra: 1,
      }),
    ).toBeNull();
  });

  it('parseStoredAnalysisSummary round-trips stored JSON', () => {
    const s = serializeRfqAnalysisSummary({ v: 1, modal: { firstHz: 140 } })!;
    const p = parseStoredAnalysisSummary(s);
    expect(p?.modal?.firstHz).toBe(140);
    expect(p?.provenance).toBe('client_self_report');
  });
});
