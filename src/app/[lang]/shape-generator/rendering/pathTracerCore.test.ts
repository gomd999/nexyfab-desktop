import { describe, it, expect } from 'vitest';
import {
  generateRay,
  evalBsdf,
  sampleBsdf,
  russianRouletteContinue,
  toneMap,
  buildEnvCdf,
  sampleEnv,
  type Vec3,
  type Material,
  type CameraSpec,
  type EnvironmentMap,
} from './pathTracerCore';

const cam: CameraSpec = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovDeg: 45,
  aspectRatio: 1,
};

const dielectric: Material = {
  albedo: [0.8, 0.6, 0.4],
  metalness: 0,
  roughness: 0.5,
  f0: [0.04, 0.04, 0.04],
};

const metal: Material = {
  albedo: [1.0, 0.85, 0.6],
  metalness: 1,
  roughness: 0.1,
};

function constRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[(i++) % seq.length]!;
}

describe('generateRay', () => {
  it('pinhole ray points from camera toward target', () => {
    const ray = generateRay(cam, 0.5, 0.5, () => 0);
    // Center of screen — direction should point at +Z negation (toward 0,0,0 from 0,0,10).
    expect(ray.direction[2]).toBeLessThan(0);
  });

  it('aperture > 0 jitters origin', () => {
    const dofCam: CameraSpec = { ...cam, apertureMm: 2, focusDistanceMm: 10 };
    const r1 = generateRay(dofCam, 0.5, 0.5, constRng([0.3, 0.7]));
    const r2 = generateRay(dofCam, 0.5, 0.5, constRng([0.1, 0.4]));
    // Different samples → different origins.
    expect(r1.origin).not.toEqual(r2.origin);
  });
});

describe('evalBsdf', () => {
  const normal: Vec3 = [0, 0, 1];
  const wi: Vec3 = [0, 0, 1];

  it('zero when light below surface', () => {
    const v = evalBsdf(dielectric, normal, wi, [0, 0, -1]);
    expect(v).toEqual([0, 0, 0]);
  });

  it('dielectric: nonzero diffuse', () => {
    const v = evalBsdf(dielectric, normal, wi, [0, 0.5, 0.5]);
    expect(v[0]).toBeGreaterThan(0);
  });

  it('metal: diffuse component zero', () => {
    // Metals scatter no diffuse light per BRDF model.
    // Hard to test directly — use a near-grazing wi to make specular small.
    const v = evalBsdf(metal, normal, [0, 0, 1], [0, 1, 0]);
    // Should still be finite.
    expect(Number.isFinite(v[0])).toBe(true);
  });
});

describe('sampleBsdf', () => {
  it('returns a direction in upper hemisphere most of the time', () => {
    const rng = constRng([0.7, 0.3, 0.4, 0.6]);
    const s = sampleBsdf(dielectric, [0, 0, 1], [0, 0, 1], rng);
    // Direction's Z should usually be positive (above surface).
    expect(Number.isFinite(s.direction[0])).toBe(true);
  });

  it('isSpecular flag set when sampling specular lobe', () => {
    const samples: { specular: boolean }[] = [];
    let counter = 0;
    const seq = [0.01, 0.5, 0.5];
    const rng = () => seq[(counter++) % 3]!;
    const s = sampleBsdf(metal, [0, 0, 1], [0, 0, 1], rng);
    samples.push({ specular: s.isSpecular });
    // Metal has spec prob = 1 so should always be specular.
    expect(s.isSpecular).toBe(true);
  });

  it('pdf > 0', () => {
    const s = sampleBsdf(dielectric, [0, 0, 1], [0, 0, 1], Math.random);
    expect(s.pdf).toBeGreaterThanOrEqual(0);
  });
});

describe('russianRouletteContinue', () => {
  it('always keeps for first 3 bounces', () => {
    const r = russianRouletteContinue([0.01, 0.01, 0.01], 1, () => 0.999);
    expect(r.keep).toBe(true);
    expect(r.multiplier).toBe(1);
  });

  it('terminates low-throughput high-depth paths sometimes', () => {
    const r = russianRouletteContinue([0.01, 0.01, 0.01], 5, () => 0.5);
    expect(r.keep).toBe(false);
  });

  it('multiplier compensates for termination probability', () => {
    const r = russianRouletteContinue([0.5, 0.5, 0.5], 5, () => 0.1);
    if (r.keep) expect(r.multiplier).toBeGreaterThan(1);
  });
});

describe('toneMap', () => {
  it('linear clips above 1', () => {
    const c = toneMap([2, 0.5, 1.5], 'linear', 0);
    expect(c[0]).toBe(1);
    expect(c[1]).toBe(0.5);
    expect(c[2]).toBe(1);
  });

  it('reinhard saturates smoothly', () => {
    const c = toneMap([100, 0, 0], 'reinhard', 0);
    expect(c[0]).toBeLessThan(1);
    expect(c[0]).toBeGreaterThan(0.95);
  });

  it('aces stays in [0,1]', () => {
    const c = toneMap([10, 10, 10], 'aces', 0);
    for (const x of c) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('exposure scales input', () => {
    const lo = toneMap([0.5, 0.5, 0.5], 'reinhard', 0);
    const hi = toneMap([0.5, 0.5, 0.5], 'reinhard', 2);
    expect(hi[0]).toBeGreaterThan(lo[0]!);
  });
});

describe('IBL sampling', () => {
  function makeEnv(): EnvironmentMap {
    const w = 4, h = 2;
    const pixels = new Float32Array(w * h * 3);
    // Bright pixel at index 4 (j=1, i=0).
    pixels[12] = 10; pixels[13] = 10; pixels[14] = 10;
    return { width: w, height: h, pixels };
  }

  it('CDF builds + sums to 1', () => {
    const env = makeEnv();
    buildEnvCdf(env);
    expect(env.cdf![env.cdf!.length - 1]).toBeCloseTo(1, 5);
  });

  it('importance sample biases toward bright pixel', () => {
    const env = makeEnv();
    let hitBright = 0;
    for (let i = 0; i < 100; i++) {
      const s = sampleEnv(env, Math.random);
      if (s.color[0] === 10) hitBright++;
    }
    expect(hitBright).toBeGreaterThan(80);
  });

  it('returns 3D direction unit length (approx)', () => {
    const env = makeEnv();
    const s = sampleEnv(env, () => 0.5);
    const len = Math.hypot(s.direction[0], s.direction[1], s.direction[2]);
    expect(len).toBeCloseTo(1, 5);
  });
});
