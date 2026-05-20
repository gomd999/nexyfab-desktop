import { describe, it, expect } from 'vitest';
import {
  computeShDiffuse,
  evaluateShIrradiance,
  prefilterEnvironmentMap,
  generateBrdfLut,
  buildPresetCubemap,
  STUDIO_PRESETS,
} from './imageBasedLighting';

describe('buildPresetCubemap', () => {
  it('produces 6 faces', () => {
    const env = buildPresetCubemap('daylight_softbox', 16);
    expect(env.faces).toHaveLength(6);
  });

  it('each face is faceWidth² × 3 floats', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    for (const f of env.faces) {
      expect(f.length).toBe(8 * 8 * 3);
    }
  });

  it('sky face brighter than ground', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    const skyAvg = env.faces[2]![0]!;
    const groundAvg = env.faces[3]![0]!;
    expect(skyAvg).toBeGreaterThan(groundAvg);
  });

  it('falls back gracefully for unknown preset', () => {
    const env = buildPresetCubemap('unknown', 8);
    expect(env.faces).toHaveLength(6);
  });
});

describe('computeShDiffuse', () => {
  it('produces 27 coefficients (9 RGB)', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    const sh = computeShDiffuse(env);
    expect(sh.coefficients).toHaveLength(27);
  });

  it('SH coefficients finite', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    const sh = computeShDiffuse(env);
    for (const c of sh.coefficients) expect(isFinite(c)).toBe(true);
  });
});

describe('evaluateShIrradiance', () => {
  it('returns non-negative RGB', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    const sh = computeShDiffuse(env);
    const r = evaluateShIrradiance(sh, [0, 1, 0]);
    expect(r[0]).toBeGreaterThanOrEqual(0);
    expect(r[1]).toBeGreaterThanOrEqual(0);
    expect(r[2]).toBeGreaterThanOrEqual(0);
  });

  it('upward normal samples bright sky', () => {
    const env = buildPresetCubemap('daylight_softbox', 8);
    const sh = computeShDiffuse(env);
    const up = evaluateShIrradiance(sh, [0, 1, 0]);
    const down = evaluateShIrradiance(sh, [0, -1, 0]);
    // Sky is brighter than ground in this preset.
    expect(up[2]).toBeGreaterThan(down[2]);
  });
});

describe('prefilterEnvironmentMap', () => {
  it('produces mipCount levels', () => {
    const env = buildPresetCubemap('daylight_softbox', 16);
    const mips = prefilterEnvironmentMap(env, 4);
    expect(mips).toHaveLength(4);
  });

  it('roughness grows with mip level', () => {
    const env = buildPresetCubemap('daylight_softbox', 16);
    const mips = prefilterEnvironmentMap(env, 4);
    for (let i = 1; i < mips.length; i++) {
      expect(mips[i]!.roughness).toBeGreaterThanOrEqual(mips[i - 1]!.roughness);
    }
  });

  it('subsequent mips downsample', () => {
    const env = buildPresetCubemap('daylight_softbox', 32);
    const mips = prefilterEnvironmentMap(env, 3);
    expect(mips[2]!.faceWidth).toBeLessThan(mips[0]!.faceWidth);
  });
});

describe('generateBrdfLut', () => {
  it('produces resolution² × 2 floats', () => {
    const lut = generateBrdfLut(8, 4);
    expect(lut.resolution).toBe(8);
    expect(lut.data.length).toBe(8 * 8 * 2);
  });

  it('values in reasonable range', () => {
    const lut = generateBrdfLut(8, 4);
    for (const v of lut.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2);
    }
  });
});

describe('STUDIO_PRESETS', () => {
  it('contains common presets', () => {
    expect(STUDIO_PRESETS.daylight_softbox).toBeDefined();
    expect(STUDIO_PRESETS.sunset).toBeDefined();
    expect(STUDIO_PRESETS.overcast).toBeDefined();
  });

  it('sunset has warm sun color', () => {
    expect(STUDIO_PRESETS.sunset!.sun[0]).toBeGreaterThan(STUDIO_PRESETS.sunset!.sun[2]);
  });
});
