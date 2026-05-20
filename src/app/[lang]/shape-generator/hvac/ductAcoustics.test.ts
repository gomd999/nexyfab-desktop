import { describe, it, expect } from 'vitest';
import { compute, linedLengthForTarget, summarize, type DuctAcousticsInput } from './ductAcoustics';

const base: DuctAcousticsInput = {
  sourcePWLdB: 85, ductWidthMm: 300, ductHeightMm: 300,
  linedLengthM: 3, liningThicknessMm: 25,
};

describe('compute', () => {
  it('lined attenuation positive', () => {
    expect(compute(base).linedAttenuationDB).toBeGreaterThan(0);
  });

  it('longer lined run → more attenuation', () => {
    const short = compute({ ...base, linedLengthM: 1 });
    const long = compute({ ...base, linedLengthM: 6 });
    expect(long.linedAttenuationDB).toBeGreaterThan(short.linedAttenuationDB);
  });

  it('thicker lining → more attenuation per metre', () => {
    const thin = compute({ ...base, liningThicknessMm: 12 });
    const thick = compute({ ...base, liningThicknessMm: 50 });
    expect(thick.linedAttenuationPerMdB).toBeGreaterThan(thin.linedAttenuationPerMdB);
  });

  it('smaller duct attenuates more (higher P/A)', () => {
    const big = compute({ ...base, ductWidthMm: 600, ductHeightMm: 600 });
    const small = compute({ ...base, ductWidthMm: 150, ductHeightMm: 150 });
    expect(small.linedAttenuationPerMdB).toBeGreaterThan(big.linedAttenuationPerMdB);
  });

  it('elbows add attenuation', () => {
    const none = compute(base);
    const elbows = compute({ ...base, linedElbows: 2 });
    expect(elbows.elbowAttenuationDB).toBeGreaterThan(none.elbowAttenuationDB);
  });

  it('room PWL = source − total attenuation', () => {
    const r = compute(base);
    expect(r.roomPWLdB).toBeCloseTo(85 - r.totalAttenuationDB, 5);
  });

  it('NC target check', () => {
    const ok = compute({ ...base, linedLengthM: 10, ncTargetDB: 70 });
    const fail = compute({ ...base, linedLengthM: 0.5, ncTargetDB: 40 });
    expect(ok.meetsTarget).toBe(true);
    expect(fail.meetsTarget).toBe(false);
    expect(fail.warnings.length).toBeGreaterThan(0);
  });

  it('zero duct size → warning', () => {
    expect(compute({ ...base, ductWidthMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('linedLengthForTarget', () => {
  it('returns positive length when attenuation needed', () => {
    const { linedLengthM, ...rest } = base;
    void linedLengthM;
    const len = linedLengthForTarget(rest, 60);
    expect(len).toBeGreaterThan(0);
  });

  it('zero when already below target', () => {
    const { linedLengthM, ...rest } = base;
    void linedLengthM;
    expect(linedLengthForTarget(rest, 200)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports attenuation + room PWL', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.totalAttenuationDB).toBe(r.totalAttenuationDB);
    expect(s.roomPWLdB).toBe(r.roomPWLdB);
  });
});
