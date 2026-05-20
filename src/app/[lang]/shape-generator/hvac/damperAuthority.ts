/**
 * damperAuthority.ts — Compute control-damper (or valve) AUTHORITY and
 * the resulting installed characteristic, the key sizing check for HVAC
 * control loops.
 *
 * Authority β = Δp_damper(open) / Δp_total(branch)
 *
 * where Δp_damper(open) is the pressure drop across the fully-open
 * damper and Δp_total is the drop across the controlled branch (damper +
 * series resistances) at design flow.
 *
 *   β ≥ 0.5  → good control, near-linear installed characteristic
 *   β 0.3-0.5→ acceptable
 *   β < 0.3  → poor; valve does most of its work in a small stroke range
 *
 * The installed characteristic distorts the inherent one. For an
 * equal-percentage damper the installed flow at fractional stroke h:
 *
 *   q(h) = 1 / sqrt( (1/β)·(1/φ(h)²) − (1/β − 1) )
 *
 * where φ(h) is the inherent characteristic (linear or equal-%).
 */

export type DamperCharacteristic = 'linear' | 'equal-percentage';

export interface DamperAuthorityInput {
  damperOpenDropPa: number;   // Δp across fully-open damper at design flow
  seriesDropPa: number;       // Δp across the rest of the controlled branch
  characteristic: DamperCharacteristic;
  rangeability?: number;      // R for equal-% (e.g. 50), default 50
}

export interface InstalledPoint {
  stroke: number;   // 0..1
  inherentFlow: number;
  installedFlow: number;
}

export interface DamperAuthorityResult {
  authority: number;
  grade: 'good' | 'acceptable' | 'poor';
  installedCurve: InstalledPoint[];
  linearityError: number; // max |installedFlow − stroke| over the curve
  warnings: string[];
}

export function analyze(input: DamperAuthorityInput, samples: number = 11): DamperAuthorityResult {
  const warnings: string[] = [];
  const total = input.damperOpenDropPa + input.seriesDropPa;
  if (total <= 0) warnings.push('Total branch pressure drop must be positive.');
  const beta = total > 0 ? input.damperOpenDropPa / total : 0;
  if (beta < 0.3) warnings.push(`Authority ${beta.toFixed(2)} < 0.3: poor control; increase damper drop or reduce series resistance.`);

  const grade: 'good' | 'acceptable' | 'poor' = beta >= 0.5 ? 'good' : beta >= 0.3 ? 'acceptable' : 'poor';
  const R = input.rangeability ?? 50;

  const curve: InstalledPoint[] = [];
  let maxLinErr = 0;
  for (let i = 0; i <= samples; i++) {
    const h = i / samples;
    const phi = inherent(h, input.characteristic, R);
    // installed flow with authority distortion
    const installed = installedFlow(phi, beta);
    curve.push({ stroke: h, inherentFlow: phi, installedFlow: installed });
    maxLinErr = Math.max(maxLinErr, Math.abs(installed - h));
  }

  return { authority: beta, grade, installedCurve: curve, linearityError: maxLinErr, warnings };
}

function inherent(h: number, characteristic: DamperCharacteristic, R: number): number {
  if (characteristic === 'linear') return h;
  // equal-percentage: φ(h) = R^(h−1), normalized so φ(0)=1/R, φ(1)=1.
  return Math.pow(R, h - 1);
}

function installedFlow(phi: number, beta: number): number {
  if (phi <= 0) return 0;
  if (beta <= 0) return phi;
  // q = 1 / sqrt( (1/β)·(1/φ²) − (1/β − 1) )
  const inner = (1 / beta) * (1 / (phi * phi)) - (1 / beta - 1);
  if (inner <= 0) return 1;
  return 1 / Math.sqrt(inner);
}

/** Required open damper drop to hit a target authority given series resistance. */
export function requiredDamperDropPa(seriesDropPa: number, targetAuthority: number): number {
  if (targetAuthority <= 0 || targetAuthority >= 1) return Infinity;
  // β = d/(d+s) → d = β·s/(1−β)
  return (targetAuthority * seriesDropPa) / (1 - targetAuthority);
}

export function summarize(r: DamperAuthorityResult): { authority: number; grade: 'good' | 'acceptable' | 'poor'; linearityError: number } {
  return { authority: r.authority, grade: r.grade, linearityError: r.linearityError };
}
