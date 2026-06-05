/**
 * responseSpectrum.ts — response-spectrum (design earthquake / shock) analysis on
 * the HEX8 modal kernel. Given a design spectrum S_a(f) and the natural modes, the
 * peak response is estimated per mode and combined statistically (SRSS).
 *
 * For ground excitation in direction d, mode i (mass-normalised φ_i) has:
 *   participation factor   Γ_i = Σ_{dof∥d} m·φ_i        (effective mass M_eff,i = Γ_i²)
 *   spectral displacement  S_d,i = S_a(ω_i) / ω_i²
 *   peak modal disp.       u_i = Γ_i · φ_i · S_d,i
 *   modal base shear       V_i = Γ_i² · S_a(ω_i) = M_eff,i · S_a(ω_i)
 * Modal peaks are combined by SRSS: R = sqrt(Σ R_i²).
 *
 * Verified against the standard identities (Σ M_eff = M_total "missing-mass"
 * theorem; flat-spectrum base shear = S_a · Σ M_eff; linearity in S_a).
 *
 * Reuses the verified modal solve — consistent units (N, mm, tonne, Hz).
 */
import { TopologyGrid } from '../analysis/topology3D';
import { assembleHex8Modal, Hex8ModalOptions } from './modalFEM';
import { computeModes } from './modalAnalysis';

export interface ResponseSpectrumOptions extends Hex8ModalOptions {
  /** Excitation direction (0=x,1=y,2=z). */
  direction: 0 | 1 | 2;
  /** Design spectrum: spectral ACCELERATION S_a as a function of frequency (Hz). */
  spectrum: (freqHz: number) => number;
  /** Modal damping ratio ζ for the CQC correlation (default 0.05). */
  zeta?: number;
}

export interface ResponseSpectrumResult {
  /** Per-mode summary in the excitation direction. */
  perMode: Array<{ frequencyHz: number; participation: number; effectiveMass: number; spectralAccel: number; baseShear: number }>;
  /** SRSS-combined peak base shear (the design value). */
  baseShearSRSS: number;
  /** CQC-combined peak base shear (accounts for closely-spaced-mode correlation). */
  baseShearCQC: number;
  /** Algebraic sum of modal base shears (= S_a·ΣM_eff for a flat spectrum). */
  baseShearSum: number;
  /** SRSS-combined peak displacement magnitude per free DOF. */
  peakDispByFreeDof: Float64Array;
  /** CQC-combined peak displacement magnitude per free DOF. */
  peakDispByFreeDofCQC: Float64Array;
  /** Movable mass in the excitation direction. */
  totalMass: number;
  /** Σ effective mass captured by the computed modes. */
  capturedMass: number;
}

/**
 * Der Kiureghian cross-modal correlation coefficient ρ_ij for two modes (Hz, with
 * damping ratios). ρ_ii = 1; ρ_ij → 1 as the frequencies coincide and → 0 as they
 * separate (so CQC → SRSS for well-separated modes).
 */
export function modalCorrelation(fi: number, fj: number, zetaI: number, zetaJ: number = zetaI): number {
  if (fi <= 0 || fj <= 0) return 0;
  const r = fj / fi;
  const num = 8 * Math.sqrt(zetaI * zetaJ) * (zetaI + r * zetaJ) * Math.pow(r, 1.5);
  const den = (1 - r * r) ** 2 + 4 * zetaI * zetaJ * r * (1 + r * r) + 4 * (zetaI * zetaI + zetaJ * zetaJ) * r * r;
  return den > 0 ? num / den : 0;
}

/**
 * Complete Quadratic Combination: R = sqrt(ΣΣ ρ_ij R_i R_j). Generalises SRSS by
 * including the cross-modal correlation — the correct combination when modal
 * frequencies are closely spaced (SRSS, which drops the off-diagonal terms, can
 * then badly under- or over-estimate the peak).
 */
export function cqcCombine(responses: number[], freqsHz: number[], zeta: number): number {
  let s = 0;
  for (let i = 0; i < responses.length; i++) {
    for (let j = 0; j < responses.length; j++) {
      s += modalCorrelation(freqsHz[i], freqsHz[j], zeta) * responses[i] * responses[j];
    }
  }
  return Math.sqrt(Math.max(0, s));
}

/**
 * Response-spectrum analysis on the real FEM kernel. Computes the modal peak
 * responses to a design spectrum and combines them by SRSS.
 */
export function hex8ResponseSpectrum(grid: TopologyGrid, opts: ResponseSpectrumOptions): ResponseSpectrumResult {
  const { Kff, Mdiag, freeAxis, nFree } = assembleHex8Modal(grid, opts);
  const empty: ResponseSpectrumResult = {
    perMode: [], baseShearSRSS: 0, baseShearCQC: 0, baseShearSum: 0,
    peakDispByFreeDof: new Float64Array(0), peakDispByFreeDofCQC: new Float64Array(0),
    totalMass: 0, capturedMass: 0,
  };
  if (nFree === 0) return empty;

  const modes = computeModes({ stiffness: Kff, massDiag: Mdiag, modeCount: opts.nModes ?? 6, maxIters: 300 });
  const zeta = opts.zeta ?? 0.05;

  let totalMass = 0;
  for (let j = 0; j < nFree; j++) if (freeAxis[j] === opts.direction) totalMass += Mdiag[j];

  // per-mode quantities (kept for both SRSS and the cross-correlated CQC).
  const perMode: ResponseSpectrumResult['perMode'] = [];
  const freqs: number[] = [], shears: number[] = [], scales: number[] = [];
  const vectors: number[][] = [];
  let shearSumSq = 0, shearSum = 0, capturedMass = 0;

  for (const m of modes) {
    const omega = 2 * Math.PI * m.frequencyHz;
    if (omega <= 0) continue;
    // participation factor Γ = Σ_{dof∥dir} m·φ  (modes are mass-normalised ⇒ M_eff = Γ²)
    let gamma = 0;
    for (let j = 0; j < nFree; j++) if (freeAxis[j] === opts.direction) gamma += Mdiag[j] * m.vector[j]!;
    const Meff = gamma * gamma;
    const Sa = opts.spectrum(m.frequencyHz);
    const Sd = Sa / (omega * omega);
    const Vi = Meff * Sa;
    perMode.push({ frequencyHz: m.frequencyHz, participation: gamma, effectiveMass: Meff, spectralAccel: Sa, baseShear: Vi });
    shearSumSq += Vi * Vi; shearSum += Vi; capturedMass += Meff;
    freqs.push(m.frequencyHz); shears.push(Vi); scales.push(gamma * Sd); vectors.push(m.vector);
  }

  // correlation matrix ρ_ij (symmetric, ρ_ii = 1).
  const nM = freqs.length;
  const rho: number[][] = Array.from({ length: nM }, () => new Array<number>(nM).fill(0));
  for (let i = 0; i < nM; i++) for (let j = 0; j < nM; j++) rho[i][j] = modalCorrelation(freqs[i], freqs[j], zeta);

  // base shear: SRSS (diagonal only) vs CQC (full ρ).
  let cqcSq = 0;
  for (let i = 0; i < nM; i++) for (let j = 0; j < nM; j++) cqcSq += rho[i][j] * shears[i] * shears[j];

  // peak displacement per DOF: u_i[j] = scale_i·φ_i[j], combined by SRSS and CQC.
  const peakDisp = new Float64Array(nFree);
  const peakDispCQC = new Float64Array(nFree);
  for (let j = 0; j < nFree; j++) {
    let srss = 0, cqc = 0;
    for (let i = 0; i < nM; i++) {
      const ui = scales[i] * vectors[i][j]!;
      srss += ui * ui;
      for (let k = 0; k < nM; k++) cqc += rho[i][k] * ui * (scales[k] * vectors[k][j]!);
    }
    peakDisp[j] = Math.sqrt(Math.max(0, srss));
    peakDispCQC[j] = Math.sqrt(Math.max(0, cqc));
  }

  return {
    perMode,
    baseShearSRSS: Math.sqrt(shearSumSq),
    baseShearCQC: Math.sqrt(Math.max(0, cqcSq)),
    baseShearSum: shearSum,
    peakDispByFreeDof: peakDisp,
    peakDispByFreeDofCQC: peakDispCQC,
    totalMass,
    capturedMass,
  };
}

/** A simple plateau design spectrum: constant S_a0 up to a corner frequency, then
 *  decaying as 1/f (constant spectral velocity) — a textbook code-spectrum shape. */
export function plateauSpectrum(Sa0: number, cornerHz: number): (f: number) => number {
  return (f: number) => (f <= cornerHz ? Sa0 : Sa0 * (cornerHz / f));
}
