/**
 * fatigue.ts — variable-amplitude fatigue: ASTM E1049 RAINFLOW cycle counting,
 * the Basquin S-N curve, and Miner's linear cumulative-damage rule.
 *
 *   rainflow:  decompose an irregular stress history into closed hysteresis cycles
 *   S-N:       N_f · σ_aᵐ = C   (Basquin) ⇒ cycles to failure at amplitude σ_a
 *   Miner:     D = Σ n_i / N_f(σ_a,i),   failure at D = 1
 *
 * Verified against the hand-countable rainflow example, constant-amplitude blocks,
 * the Basquin life law, and Miner two-block summation.
 */

export interface Cycle {
  /** Stress range Δσ (peak-to-valley). */
  range: number;
  /** Mean stress. */
  mean: number;
  /** 1 = full cycle, 0.5 = half cycle. */
  count: number;
}

/** Reduce a series to its turning points (peaks and valleys), dropping plateaus. */
export function turningPoints(series: ArrayLike<number>): number[] {
  const n = series.length;
  if (n === 0) return [];
  const out: number[] = [series[0]];
  for (let i = 1; i < n - 1; i++) {
    const a = series[i] - series[i - 1], b = series[i + 1] - series[i];
    if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) out.push(series[i]); // sign change ⇒ turning point
  }
  if (n > 1) out.push(series[n - 1]);
  return out;
}

/**
 * ASTM E1049 three-point rainflow counting. Returns the extracted cycles
 * (full + residual half cycles).
 */
export function rainflowCount(series: ArrayLike<number>): Cycle[] {
  const points = turningPoints(series);
  const stack: number[] = [];
  const cycles: Cycle[] = [];
  for (const x of points) {
    stack.push(x);
    while (stack.length >= 3) {
      const n = stack.length;
      const A = stack[n - 3], B = stack[n - 2], C = stack[n - 1];
      const Y = Math.abs(B - A), X = Math.abs(C - B);
      if (X < Y) break;
      if (n - 3 === 0) {
        // Y involves the very first point ⇒ half cycle; slide the bottom off.
        cycles.push({ range: Y, mean: (A + B) / 2, count: 0.5 });
        stack.splice(0, 1);
      } else {
        // Y is a closed full cycle ⇒ remove its inner pair.
        cycles.push({ range: Y, mean: (A + B) / 2, count: 1 });
        stack.splice(n - 3, 2);
      }
    }
  }
  for (let i = 0; i < stack.length - 1; i++) {
    cycles.push({ range: Math.abs(stack[i + 1] - stack[i]), mean: (stack[i] + stack[i + 1]) / 2, count: 0.5 });
  }
  return cycles;
}

/** Aggregate cycles by range (binned to `tol`), summing counts. */
export function binCycles(cycles: Cycle[], tol = 1e-6): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cycles) {
    const key = Math.round(c.range / tol) * tol;
    m.set(key, (m.get(key) ?? 0) + c.count);
  }
  return m;
}

export interface BasquinSN {
  /** Basquin coefficient C in N·σ_aᵐ = C. */
  C: number;
  /** Basquin exponent m (>0). */
  m: number;
  /** Optional endurance limit: σ_a below this ⇒ infinite life. */
  enduranceLimit?: number;
}

/** Cycles to failure at a stress amplitude σ_a (Basquin S-N). Infinity below the limit. */
export function basquinLife(amplitude: number, sn: BasquinSN): number {
  if (amplitude <= 0) return Infinity;
  if (sn.enduranceLimit !== undefined && amplitude < sn.enduranceLimit) return Infinity;
  return sn.C * Math.pow(amplitude, -sn.m);
}

export interface DamageResult {
  damage: number;          // Miner sum D
  /** Estimated repeats of the whole history to failure (1/D), Infinity if D=0. */
  blocksToFailure: number;
}

/**
 * Miner cumulative damage of a stress history: rainflow-count it, then sum
 * n_i/N_f(σ_a,i). A mean-stress correction (Goodman) can be applied via
 * `ultimateStrength`.
 */
export function minerDamage(series: ArrayLike<number>, sn: BasquinSN, ultimateStrength?: number): DamageResult {
  const cycles = rainflowCount(series);
  let D = 0;
  for (const c of cycles) {
    let amp = c.range / 2;
    if (ultimateStrength !== undefined && c.mean > 0) {
      // Goodman: equivalent fully-reversed amplitude σ_ar = σ_a / (1 − σ_m/σ_u).
      const denom = 1 - c.mean / ultimateStrength;
      amp = denom > 1e-6 ? amp / denom : Infinity;
    }
    const Nf = basquinLife(amp, sn);
    if (Nf !== Infinity) D += c.count / Nf;
  }
  return { damage: D, blocksToFailure: D > 0 ? 1 / D : Infinity };
}
