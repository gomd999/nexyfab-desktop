/**
 * modalFEM — natural-frequency analysis on the real HEX8 FEM kernel, verified
 * against the analytic cantilever beam. (The crude voxel approximation was
 * replaced by assembling the verified element stiffness + lumped mass and solving
 * K φ = ω² M φ with the now-CG-backed inverse power iteration.)
 */
import { describe, it, expect } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { hex8Modes, hex8Participation, hex8HarmonicResponse, hex8RandomVibration, fixedFaceNodes } from './modalFEM';

const E = 210000, nu = 0.3, rho = 7.85e-9; // steel, N-mm-tonne-MPa units

/** Euler–Bernoulli cantilever first bending frequency (Hz). */
function analyticFirst(L: number, width: number, thick: number): number {
  const I = (width * thick ** 3) / 12, A = width * thick;
  return (1.875 ** 2 / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * A * L ** 4));
}
function modes(nx: number, ny: number, nz: number, h: number, n = 4): number[] {
  const grid = new TopologyGrid(nx, ny, nz);
  return hex8Modes(grid, { E, nu, rho, cell: h, fixed: fixedFaceNodes(grid, 'x'), nModes: n }).frequenciesHz;
}

describe('modalFEM — cantilever natural frequency (FEA, verified)', () => {
  it('first frequency matches the analytic cantilever within ~10%', () => {
    const f = modes(20, 3, 3, 8, 1)[0];          // finer through-thickness → least locking
    const analytic = analyticFirst(20 * 8, 3 * 8, 3 * 8);
    expect(f).toBeGreaterThan(0);
    expect(f / analytic).toBeGreaterThan(0.9);
    expect(f / analytic).toBeLessThan(1.1);
  });

  it('resolves the degenerate first-bending PAIR of a square section (M-orthogonal)', () => {
    const f = modes(16, 2, 2, 10, 3);
    // a square cantilever bends equally in Y and Z → two near-equal lowest modes.
    expect(f[0]).toBeGreaterThan(0);
    expect(f[1] / f[0]).toBeGreaterThan(0.95);
    expect(f[1] / f[0]).toBeLessThan(1.05);
    // the next mode is clearly higher (2nd bending), not a spurious ~0.
    expect(f[2]).toBeGreaterThan(f[1] * 2);
  });

  it('obeys the beam scaling laws: f ∝ 1/L² and f ∝ √E', () => {
    const fL12 = modes(12, 2, 2, 10, 1)[0];
    const fL24 = modes(24, 2, 2, 10, 1)[0];
    expect(fL12 / fL24).toBeGreaterThan(3.6);    // ideal 4 (×2 length → /4)
    expect(fL12 / fL24).toBeLessThan(4.4);

    const grid = new TopologyGrid(12, 2, 2);
    const fixed = fixedFaceNodes(grid, 'x');
    const fE = hex8Modes(grid, { E, nu, rho, cell: 10, fixed, nModes: 1 }).frequenciesHz[0];
    const f4E = hex8Modes(grid, { E: 4 * E, nu, rho, cell: 10, fixed, nModes: 1 }).frequenciesHz[0];
    expect(f4E / fE).toBeGreaterThan(1.95);      // ideal 2 (×4 stiffness → ×√4)
    expect(f4E / fE).toBeLessThan(2.05);
  });
});

describe('modalFEM — modal mass participation (resonance assessment)', () => {
  // A cantilever thin in Y (ny < nz) → the lowest mode is bending in Y.
  const grid = new TopologyGrid(16, 2, 4);
  const part = hex8Participation(grid, { E: 210000, nu: 0.3, rho: 7.85e-9, cell: 10, fixed: fixedFaceNodes(grid, 'x'), nModes: 8 });

  it("the first bending mode captures ~the analytic 61% of the section's mass, in its bending direction only", () => {
    const m1 = part.perMode[0];
    const fy = m1.effectiveMass.y / part.totalMass.y;
    expect(fy).toBeGreaterThan(0.55);            // Euler–Bernoulli first mode ≈ 0.613
    expect(fy).toBeLessThan(0.70);
    // it's a pure-Y bending mode: negligible participation in x and z.
    expect(m1.effectiveMass.x / part.totalMass.x).toBeLessThan(0.02);
    expect(m1.effectiveMass.z / part.totalMass.z).toBeLessThan(0.02);
  });

  it('finds an axial mode dominating the X direction', () => {
    const axial = part.perMode.find((m) => m.effectiveMass.x / part.totalMass.x > 0.5);
    expect(axial, 'an axial mode should appear with > 50% X effective mass').toBeTruthy();
  });

  it('cumulative effective mass rises monotonically toward 100% and is bounded by 1', () => {
    let prev = 0;
    for (const c of part.cumulativeFraction) {
      expect(c.y).toBeGreaterThanOrEqual(prev - 1e-9); // monotonic
      expect(c.y).toBeLessThan(1.02);                  // can't exceed total mass
      prev = c.y;
    }
    // with 8 modes a slender cantilever reaches the response-spectrum 90% target in Y.
    expect(part.cumulativeFraction[part.cumulativeFraction.length - 1].y).toBeGreaterThan(0.85);
  });
});

describe('modalFEM — harmonic (frequency) response by modal superposition', () => {
  const nx = 16, ny = 2, nz = 4, h = 10;
  const grid = new TopologyGrid(nx, ny, nz);
  const fixed = fixedFaceNodes(grid, 'x');
  const mat = { E: 210000, nu: 0.3, rho: 7.85e-9, cell: h, fixed };
  const f1 = hex8Modes(grid, { ...mat, nModes: 1 }).frequenciesHz[0];
  const tip = grid.node(nx, 1, 2);
  const freqsHz: number[] = [];
  for (let f = 10; f <= 2000; f += 10) freqsHz.push(f);
  const zeta = 0.02;
  const resp = hex8HarmonicResponse(grid, {
    ...mat, nModes: 8, loadNode: tip, loadAxis: 1, loadMag: 1000, probeNode: tip, probeAxis: 1, freqsHz, zeta,
  });
  const peak = resp.amplitude.reduce((acc, a, i) => (a > acc.a ? { a, f: resp.freqHz[i] } : acc), { a: 0, f: 0 });

  it('resonates at the first natural frequency (peak amplitude near f1)', () => {
    expect(peak.f).toBeGreaterThan(f1 * 0.9);
    expect(peak.f).toBeLessThan(f1 * 1.1);
  });

  it('the ω→0 response equals the static deflection', () => {
    expect(resp.amplitude[0]).toBeGreaterThan(0);
    expect(Math.abs(resp.amplitude[0] - resp.staticAmplitude) / resp.staticAmplitude).toBeLessThan(0.02);
  });

  it('amplifies at resonance by ~the quality factor Q = 1/(2ζ)', () => {
    const Q = 1 / (2 * zeta); // = 25
    const amp = peak.a / resp.staticAmplitude;
    expect(amp).toBeGreaterThan(0.5 * Q);   // dominant-mode amplification
    expect(amp).toBeLessThan(1.3 * Q);
  });
});

/**
 * hex8RandomVibration — 3D 랜덤 진동 (260801).
 *
 * 채점 기준은 **닫힌해**다. 백색잡음 가진을 받는 단일모드 계의 RMS 응답은
 *   σ² = ∫|H|²·S df,  단일모드 근사에서  σ² ≈ (π/2)·f_n·S·|H(f_n)|²
 * 이고, 공진 피크 |H(f_n)| = φ²/(2ζω_n²) 이므로 **σ ∝ 1/√ζ** 가 성립해야 한다.
 * 「값이 나온다」가 아니라 **물리가 맞는가**를 본다.
 */
describe('hex8RandomVibration — 3D 랜덤 진동', () => {
  const grid = new TopologyGrid(12, 2, 2);
  const base = {
    E, nu, rho, cell: 10, fixed: fixedFaceNodes(grid, 'x'), nModes: 4,
    loadNode: grid.node(12, 1, 1), loadAxis: 2 as const, loadMag: 1,
    probeNode: grid.node(12, 1, 1), probeAxis: 2 as const,
  };
  /** 1차 모드를 확실히 담는 스윕. */
  const f1 = hex8Modes(grid, base).frequenciesHz[0]!;
  const freqs = Array.from({ length: 120 }, (_, i) => (f1 * 2 * (i + 1)) / 120);
  const white = freqs.map(() => 1); // 백색 하중 PSD 1 N²/Hz

  it('RMS 가 유한한 양수이고, 응답 PSD 가 공진에서 최대다', () => {
    const r = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white, zeta: 0.02 });
    expect(r.rmsMm).toBeGreaterThan(0);
    expect(Number.isFinite(r.rmsMm)).toBe(true);
    const iMax = r.psdOut.indexOf(Math.max(...r.psdOut));
    // 공진 근처(±10%)에서 봉우리
    expect(Math.abs(r.freqHz[iMax]! - f1) / f1).toBeLessThan(0.1);
  });

  it('★감쇠가 4배면 RMS 는 약 1/2 — σ ∝ 1/√ζ (물리)', () => {
    const a = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white, zeta: 0.01 });
    const b = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white, zeta: 0.04 });
    const ratio = a.rmsMm / b.rmsMm;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it('입력 PSD 를 2배로 하면 RMS 는 √2 배 — σ ∝ √S (선형계)', () => {
    const a = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white, zeta: 0.02 });
    const b = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white.map((x) => x * 2), zeta: 0.02 });
    expect(b.rmsMm / a.rmsMm).toBeGreaterThan(1.35);
    expect(b.rmsMm / a.rmsMm).toBeLessThan(1.49);
  });

  it('영교차율이 1차 고유진동수 근처다 — 응답이 그 모드에 지배되므로', () => {
    const r = hex8RandomVibration(grid, { ...base, freqsHz: freqs, psdInput: white, zeta: 0.02 });
    expect(r.zeroCrossingHz).not.toBeNull();
    expect(Math.abs(r.zeroCrossingHz! - f1) / f1).toBeLessThan(0.35);
  });
});

describe('★hex8RandomVibration — 모르는 것을 지어내지 않는다', () => {
  const grid = new TopologyGrid(8, 2, 2);
  const base = {
    E, nu, rho, cell: 10, fixed: fixedFaceNodes(grid, 'x'), nModes: 3,
    loadNode: grid.node(8, 1, 1), loadAxis: 2 as const, loadMag: 1,
    probeNode: grid.node(8, 1, 1), probeAxis: 2 as const,
  };

  it('★PSD 길이가 주파수와 다르면 **보간하지 않고 거부**한다', () => {
    const r = hex8RandomVibration(grid, { ...base, freqsHz: [10, 20, 30], psdInput: [1, 1] });
    expect(r.rmsMm).toBe(0);
    expect(r.psdOut).toHaveLength(0);
    expect(r.warnings[0]).toContain('길이');
  });

  it('★스윕이 공진을 안 담으면 경고한다 — 조용히 작은 RMS 를 내지 않는다', () => {
    const f1 = hex8Modes(grid, base).frequenciesHz[0]!;
    const far = [f1 * 5, f1 * 6, f1 * 7];
    const r = hex8RandomVibration(grid, { ...base, freqsHz: far, psdInput: far.map(() => 1) });
    expect(r.warnings.join(' ')).toContain('공진');
  });

  it('표본이 2개 미만이면 적분하지 않는다', () => {
    const r = hex8RandomVibration(grid, { ...base, freqsHz: [50], psdInput: [1] });
    expect(r.rmsMm).toBe(0);
    expect(r.warnings.join(' ')).toContain('2개 미만');
  });

  it('★영교차율은 스펙트럼이 비면 0 이 아니라 null — 0 Hz 는 「진동 안 함」이라는 주장이다', () => {
    const r = hex8RandomVibration(grid, { ...base, freqsHz: [10, 20], psdInput: [0, 0] });
    expect(r.zeroCrossingHz).toBeNull();
  });
});
