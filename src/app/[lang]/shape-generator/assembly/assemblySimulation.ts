/**
 * assemblySimulation — multi-body static check for an assembly.
 *
 * Combines the two physical questions a user asks of a multi-part assembly:
 *   1. Does it STAND UP?  (static stability — centre of mass over the support,
 *      from computeAssemblyBalance)
 *   2. Do the parts FIT?  (interference — do any two parts overlap in space,
 *      from the existing AABB sweep-and-prune + triangle-SAT detector)
 *
 * Returns a single report with a pass/fail verdict and human-readable issues,
 * so changing a part (size / material / position) immediately re-answers
 * "is this assembly physically valid?".
 *
 * Pure + headless-testable.
 */
import type { PlacedPart } from './PartPlacementPanel';
import { buildShapeResult } from '../shapes';
import { computeAssemblyBalance, partWorldMatrix, type AssemblyBalance, type BalanceOptions } from './assemblyBalance';
import { detectInterference, type PartInput } from './InterferenceDetection';

export interface SimIssue {
  kind: 'empty' | 'tipping' | 'interference';
  severity: 'warning' | 'error';
  message: string;
}

export interface AssemblySimReport {
  balance: AssemblyBalance;
  interferences: { partA: string; partB: string; volumeCm3: number }[];
  /** Static stability (CoM over the support footprint). */
  stable: boolean;
  /** Any two parts overlap in space. */
  hasInterference: boolean;
  /** Overall verdict — stands up AND no clashes AND has parts. */
  ok: boolean;
  issues: SimIssue[];
}

export interface SimOptions extends BalanceOptions {
  /** Overlap volume (cm³) below which two parts are "touching", not clashing. */
  minOverlapCm3?: number;
}

export function simulateAssembly(parts: PlacedPart[], opts: SimOptions = {}): AssemblySimReport {
  const balance = computeAssemblyBalance(parts, opts);

  // Build interference inputs from the same resolved geometry + world transform.
  const inputs: PartInput[] = [];
  for (const p of parts) {
    const res = buildShapeResult(p.shapeId, p.params);
    if (!res) continue;
    inputs.push({ id: p.id, geometry: res.geometry, transform: partWorldMatrix(p) });
  }
  // Parts that merely TOUCH (stacked faces, a peg seated in a hole) report a
  // near-zero overlap volume — that's contact, not interference. Only a
  // meaningful penetration counts. `minOverlapCm3` is the contact tolerance.
  const minOverlap = opts.minOverlapCm3 ?? 0.05; // 50 mm³
  const raw = inputs.length >= 2 ? detectInterference(inputs) : [];
  const interferences = raw
    .filter(r => r.volume > minOverlap)
    .map(r => ({ partA: r.partA, partB: r.partB, volumeCm3: r.volume }));

  const issues: SimIssue[] = [];
  if (parts.length === 0) {
    issues.push({ kind: 'empty', severity: 'warning', message: 'No parts to simulate' });
  }
  if (balance.totalMassG > 0 && !balance.stable) {
    issues.push({
      kind: 'tipping',
      severity: 'error',
      message: `Tips over — centre of mass falls ${Math.abs(balance.marginMm).toFixed(0)}mm past the support`,
    });
  }
  for (const it of interferences) {
    issues.push({
      kind: 'interference',
      severity: 'error',
      message: `${it.partA} ↔ ${it.partB} overlap (${it.volumeCm3.toFixed(2)} cm³)`,
    });
  }

  const hasInterference = interferences.length > 0;
  const ok = parts.length > 0 && balance.stable && !hasInterference;
  return { balance, interferences, stable: balance.stable, hasInterference, ok, issues };
}
