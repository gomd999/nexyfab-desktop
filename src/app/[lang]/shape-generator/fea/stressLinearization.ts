/**
 * stressLinearization.ts — ASME Section VIII Div. 2 stress
 * linearization along a "stress classification line" (SCL).
 *
 * For pressure vessel design, raw FEA stress values aren't directly
 * comparable to code limits. ASME prescribes *linearization* of
 * stress through the wall thickness:
 *
 *   - **Membrane stress** = average through-thickness (uniform).
 *   - **Bending stress** = linear-through-thickness component.
 *   - **Peak stress** = residual nonlinear component.
 *
 * For a stress component σ(t) along thickness t ∈ [0, T]:
 *
 *   σ_m = (1/T) · ∫σ dt
 *   σ_b(t) = (12·t - 6·T)/T² · ∫σ·(t - T/2) dt
 *   σ_peak(t) = σ(t) - σ_m - σ_b(t)
 *
 * Module accepts a discrete sampling of stress components along an
 * SCL and produces the linearized values + classification.
 */

export interface StressTensor {
  /** Through-thickness coordinate t (0 = inner, T = outer). */
  positionMm: number;
  /** Cauchy stress components in part frame (MPa). */
  sigmaXX: number;
  sigmaYY: number;
  sigmaZZ: number;
  sigmaXY: number;
  sigmaYZ: number;
  sigmaZX: number;
}

export interface LinearizedComponent {
  /** Component name (xx, yy, ...). */
  name: 'xx' | 'yy' | 'zz' | 'xy' | 'yz' | 'zx';
  /** Membrane stress (uniform through thickness). */
  membrane: number;
  /** Bending stress at outer fiber (t = T). */
  bendingOuter: number;
  /** Bending stress at inner fiber (t = 0). */
  bendingInner: number;
  /** Peak stress at outer fiber. */
  peakOuter: number;
  /** Peak stress at inner fiber. */
  peakInner: number;
}

export interface LinearizationResult {
  components: LinearizedComponent[];
  /** Equivalent (von Mises) membrane stress. */
  vonMisesMembrane: number;
  /** von Mises Pm+Pb (membrane plus bending). */
  vonMisesMembranePlusBending: number;
  /** Outer-fiber total von Mises. */
  vonMisesOuter: number;
  /** Inner-fiber total von Mises. */
  vonMisesInner: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function linearizeStress(samples: StressTensor[]): LinearizationResult {
  if (samples.length < 2) {
    return {
      components: [],
      vonMisesMembrane: 0,
      vonMisesMembranePlusBending: 0,
      vonMisesOuter: 0,
      vonMisesInner: 0,
    };
  }
  // Sort by position.
  const sorted = [...samples].sort((a, b) => a.positionMm - b.positionMm);
  const thickness = sorted[sorted.length - 1]!.positionMm - sorted[0]!.positionMm;
  const tOrigin = sorted[0]!.positionMm;
  const tMid = tOrigin + thickness / 2;

  // For each component, integrate.
  const compNames = ['xx', 'yy', 'zz', 'xy', 'yz', 'zx'] as const;
  const result: LinearizedComponent[] = [];

  for (const name of compNames) {
    const valuesAt = sorted.map(s => getComponent(s, name));
    const positions = sorted.map(s => s.positionMm);
    // σ_m = (1/T) · ∫σ dt → trapezoidal.
    const membrane = thickness > 0 ? trapezoidal(positions, valuesAt) / thickness : 0;
    // bending coefficient = (12/T²) · ∫σ·(t - T/2) dt — linear distribution.
    const valuesTimesShift = valuesAt.map((v, i) => v * (positions[i]! - tMid));
    const linearCoeff = thickness > 0 ? (12 / (thickness * thickness)) * trapezoidal(positions, valuesTimesShift) : 0;
    // Bending stress at outer fiber: σ_b(T) = linearCoeff · T/2.
    const bendOuter = linearCoeff * (thickness / 2);
    const bendInner = -bendOuter;
    // Peak = σ(T) - σ_m - σ_b(T), σ(0) - σ_m - σ_b(0).
    const valueOuter = valuesAt[valuesAt.length - 1]!;
    const valueInner = valuesAt[0]!;
    const peakOuter = valueOuter - membrane - bendOuter;
    const peakInner = valueInner - membrane - bendInner;
    result.push({
      name,
      membrane,
      bendingOuter: bendOuter,
      bendingInner: bendInner,
      peakOuter,
      peakInner,
    });
  }

  // von Mises for membrane.
  const vmMembrane = vonMisesFromComponents(result, 'membrane', 'membrane');
  const vmMpB = vonMisesFromComponents(result, 'membrane', 'bendingOuter');
  const vmOuter = vonMisesAtOuter(result);
  const vmInner = vonMisesAtInner(result);

  return {
    components: result,
    vonMisesMembrane: vmMembrane,
    vonMisesMembranePlusBending: vmMpB,
    vonMisesOuter: vmOuter,
    vonMisesInner: vmInner,
  };
}

// ── von Mises helpers ─────────────────────────────────────────

function getComponent(s: StressTensor, name: LinearizedComponent['name']): number {
  switch (name) {
    case 'xx': return s.sigmaXX;
    case 'yy': return s.sigmaYY;
    case 'zz': return s.sigmaZZ;
    case 'xy': return s.sigmaXY;
    case 'yz': return s.sigmaYZ;
    case 'zx': return s.sigmaZX;
  }
}

function vonMisesFromComponents(components: LinearizedComponent[], normalKey: 'membrane', addKey?: 'membrane' | 'bendingOuter' | 'bendingInner'): number {
  const get = (name: LinearizedComponent['name']) => {
    const c = components.find(x => x.name === name);
    if (!c) return 0;
    let v = c[normalKey];
    if (addKey && addKey !== normalKey) v += c[addKey];
    return v;
  };
  const sx = get('xx');
  const sy = get('yy');
  const sz = get('zz');
  const txy = get('xy');
  const tyz = get('yz');
  const tzx = get('zx');
  return Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (txy * txy + tyz * tyz + tzx * tzx));
}

function vonMisesAtOuter(components: LinearizedComponent[]): number {
  const get = (name: LinearizedComponent['name']) => {
    const c = components.find(x => x.name === name);
    if (!c) return 0;
    return c.membrane + c.bendingOuter + c.peakOuter;
  };
  return vonMises6(get('xx'), get('yy'), get('zz'), get('xy'), get('yz'), get('zx'));
}

function vonMisesAtInner(components: LinearizedComponent[]): number {
  const get = (name: LinearizedComponent['name']) => {
    const c = components.find(x => x.name === name);
    if (!c) return 0;
    return c.membrane + c.bendingInner + c.peakInner;
  };
  return vonMises6(get('xx'), get('yy'), get('zz'), get('xy'), get('yz'), get('zx'));
}

function vonMises6(sx: number, sy: number, sz: number, txy: number, tyz: number, tzx: number): number {
  return Math.sqrt(0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) + 3 * (txy * txy + tyz * tyz + tzx * tzx));
}

// ── Trapezoidal integration ──────────────────────────────────

function trapezoidal(positions: number[], values: number[]): number {
  let sum = 0;
  for (let i = 1; i < positions.length; i++) {
    sum += 0.5 * (values[i - 1]! + values[i]!) * (positions[i]! - positions[i - 1]!);
  }
  return sum;
}

// ── ASME limit check ─────────────────────────────────────────

export interface ASMELimits {
  /** Allowable membrane (Pm). */
  pmAllowable: number;
  /** Allowable membrane + bending (Pm+Pb). */
  pmPlusPbAllowable: number;
  /** Allowable total (Pm+Pb+Q). */
  totalAllowable: number;
}

export interface LimitCheck {
  pmRatio: number;
  pmPlusPbRatio: number;
  totalRatio: number;
  pmPass: boolean;
  pmPlusPbPass: boolean;
  totalPass: boolean;
}

export function checkASMELimits(result: LinearizationResult, limits: ASMELimits): LimitCheck {
  const pmRatio = limits.pmAllowable > 0 ? result.vonMisesMembrane / limits.pmAllowable : 0;
  const pmPbRatio = limits.pmPlusPbAllowable > 0 ? result.vonMisesMembranePlusBending / limits.pmPlusPbAllowable : 0;
  const total = Math.max(result.vonMisesOuter, result.vonMisesInner);
  const totalRatio = limits.totalAllowable > 0 ? total / limits.totalAllowable : 0;
  return {
    pmRatio,
    pmPlusPbRatio: pmPbRatio,
    totalRatio,
    pmPass: pmRatio <= 1.0,
    pmPlusPbPass: pmPbRatio <= 1.0,
    totalPass: totalRatio <= 1.0,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface LinearizationSummary {
  thicknessMm: number;
  vonMisesMembrane: number;
  vonMisesMembranePlusBending: number;
  peakAcrossWall: number;
  hasBending: boolean;
}

export function summarize(samples: StressTensor[], result: LinearizationResult): LinearizationSummary {
  const sorted = [...samples].sort((a, b) => a.positionMm - b.positionMm);
  const t = sorted.length >= 2 ? sorted[sorted.length - 1]!.positionMm - sorted[0]!.positionMm : 0;
  const peak = Math.max(result.vonMisesOuter, result.vonMisesInner);
  // Bending detected if any bendingOuter component magnitude > 5% of membrane.
  const hasBending = result.components.some(c => Math.abs(c.bendingOuter) > Math.abs(c.membrane) * 0.05);
  return {
    thicknessMm: t,
    vonMisesMembrane: result.vonMisesMembrane,
    vonMisesMembranePlusBending: result.vonMisesMembranePlusBending,
    peakAcrossWall: peak,
    hasBending,
  };
}
