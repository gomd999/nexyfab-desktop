import { describe, it, expect } from 'vitest';
import {
  checkCnc,
  checkInjectionMold,
  checkSheetMetal,
  checkFdm,
  checkSla,
  runDfmChecks,
  summarizeDfm,
  type DfmAnalysisInput,
} from './dfmRules';

const baseInput = (): DfmAnalysisInput => ({
  bbox: { min: [0, 0, 0], max: [100, 100, 100] },
});

describe('checkCnc', () => {
  it('flags thin wall', () => {
    const f = checkCnc({ ...baseInput(), minWallMm: 0.5 });
    expect(f.some(x => x.code === 'CNC-01')).toBe(true);
    expect(f[0]!.severity).toBe('error');
  });

  it('flags deep hole (ratio > 8)', () => {
    const f = checkCnc({
      ...baseInput(),
      holes: [{ position: [0, 0, 0], diameterMm: 3, depthMm: 30 }],
    });
    expect(f.some(x => x.code === 'CNC-02' && x.severity === 'error')).toBe(true);
  });

  it('warns on ratio 5-8 (pecking needed)', () => {
    const f = checkCnc({
      ...baseInput(),
      holes: [{ position: [0, 0, 0], diameterMm: 3, depthMm: 20 }],
    });
    expect(f.some(x => x.code === 'CNC-02' && x.severity === 'warn')).toBe(true);
  });

  it('flags hole too close to edge', () => {
    const f = checkCnc({
      ...baseInput(),
      holes: [{ position: [0, 0, 0], diameterMm: 6, depthMm: 10, distanceToEdgeMm: 4 }],
    });
    expect(f.some(x => x.code === 'CNC-03')).toBe(true);
  });

  it('flags sharp internal corners', () => {
    const f = checkCnc({
      ...baseInput(),
      internalCorners: [{ radiusMm: 0.3, location: [0, 0, 0] }],
    });
    expect(f.some(x => x.code === 'CNC-04' && x.severity === 'error')).toBe(true);
  });

  it('returns empty for clean design', () => {
    const f = checkCnc({
      ...baseInput(),
      minWallMm: 2,
      holes: [{ position: [50, 50, 50], diameterMm: 5, depthMm: 10, distanceToEdgeMm: 20 }],
      internalCorners: [{ radiusMm: 3, location: [0, 0, 0] }],
    });
    expect(f).toHaveLength(0);
  });
});

describe('checkInjectionMold', () => {
  it('errors on draft < 1°', () => {
    const f = checkInjectionMold({
      ...baseInput(),
      drafts: [{ angleDeg: 0.5, location: [0, 0, 0] }],
    });
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.code).toBe('IM-01');
  });

  it('warns on draft 1-3°', () => {
    const f = checkInjectionMold({
      ...baseInput(),
      drafts: [{ angleDeg: 2, location: [0, 0, 0] }],
    });
    expect(f[0]!.severity).toBe('warn');
  });

  it('accepts draft ≥ 3°', () => {
    const f = checkInjectionMold({
      ...baseInput(),
      drafts: [{ angleDeg: 4, location: [0, 0, 0] }],
    });
    expect(f).toHaveLength(0);
  });

  it('flags thin wall < 1mm', () => {
    const f = checkInjectionMold({ ...baseInput(), minWallMm: 0.8 });
    expect(f.some(x => x.code === 'IM-02')).toBe(true);
  });
});

describe('checkSheetMetal', () => {
  it('flags bend radius < thickness', () => {
    const f = checkSheetMetal({
      ...baseInput(),
      sheetThicknessMm: 2,
      bendRadii: [1],
    });
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.code).toBe('SM-01');
  });

  it('warns when r < 2t', () => {
    const f = checkSheetMetal({
      ...baseInput(),
      sheetThicknessMm: 2,
      bendRadii: [3],
    });
    expect(f[0]!.severity).toBe('warn');
  });

  it('flags hole-to-bend < 3t', () => {
    const f = checkSheetMetal({
      ...baseInput(),
      sheetThicknessMm: 2,
      holes: [{ position: [0, 0, 0], diameterMm: 5, depthMm: 2, distanceToEdgeMm: 4 }],
    });
    expect(f.some(x => x.code === 'SM-02')).toBe(true);
  });

  it('no findings when sheetThickness undefined', () => {
    const f = checkSheetMetal({ ...baseInput(), bendRadii: [0.5] });
    expect(f).toHaveLength(0);
  });
});

describe('checkFdm', () => {
  it('flags 60° overhang as error', () => {
    const f = checkFdm({
      ...baseInput(),
      overhangs: [{ angleDeg: 65, areaMm2: 500 }],
    });
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.code).toBe('FDM-01');
  });

  it('warns on 45-60° overhang', () => {
    const f = checkFdm({
      ...baseInput(),
      overhangs: [{ angleDeg: 50, areaMm2: 500 }],
    });
    expect(f[0]!.severity).toBe('warn');
  });

  it('flags part too big for FDM bed', () => {
    const f = checkFdm({
      bbox: { min: [0, 0, 0], max: [400, 100, 100] },
    });
    expect(f.some(x => x.code === 'FDM-03')).toBe(true);
  });

  it('flags wall < 0.8mm', () => {
    const f = checkFdm({ ...baseInput(), minWallMm: 0.5 });
    expect(f.some(x => x.code === 'FDM-02')).toBe(true);
  });
});

describe('checkSla', () => {
  it('flags wall < 0.4mm', () => {
    const f = checkSla({ ...baseInput(), minWallMm: 0.3 });
    expect(f.some(x => x.code === 'SLA-01')).toBe(true);
  });

  it('accepts 0.5mm wall', () => {
    const f = checkSla({ ...baseInput(), minWallMm: 0.5 });
    expect(f).toHaveLength(0);
  });
});

describe('runDfmChecks dispatcher', () => {
  it('CNC dispatches to checkCnc', () => {
    const f = runDfmChecks('cnc-mill', { ...baseInput(), minWallMm: 0.5 });
    expect(f[0]!.code).toContain('CNC');
  });

  it('FDM dispatches to checkFdm', () => {
    const f = runDfmChecks('fdm', {
      ...baseInput(),
      overhangs: [{ angleDeg: 70, areaMm2: 200 }],
    });
    expect(f.some(x => x.code === 'FDM-01')).toBe(true);
  });
});

describe('summarizeDfm', () => {
  it('counts by severity', () => {
    const findings = runDfmChecks('cnc-mill', {
      ...baseInput(),
      minWallMm: 0.3, // error
      internalCorners: [{ radiusMm: 1, location: [0, 0, 0] }], // warn
    });
    const s = summarizeDfm(findings);
    expect(s.errors).toBeGreaterThan(0);
    expect(s.warnings).toBeGreaterThan(0);
    expect(s.acceptable).toBe(false);
  });

  it('acceptable when zero errors', () => {
    const findings = runDfmChecks('cnc-mill', {
      ...baseInput(),
      internalCorners: [{ radiusMm: 1, location: [0, 0, 0] }],
    });
    const s = summarizeDfm(findings);
    expect(s.errors).toBe(0);
    expect(s.acceptable).toBe(true);
  });
});
