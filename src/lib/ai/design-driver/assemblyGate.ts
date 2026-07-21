/**
 * design-driver/assemblyGate — gate (b): mate-constraint convergence.
 *
 * Consumes (수정 없음): `solveMates` from src/lib/assembly/api — the public
 * facade over the iterative / Newton-Lagrange engines. The plan's
 * `PlanAssembly` is ALREADY in solveMates input form, so the gate is a
 * direct execution plus verdict extraction:
 *
 *   pass ⇔ solve ran without rejection AND converged === true
 *          AND finalMaxResidual ≤ tolerance.
 *
 * `solveMates` throws `AssemblyApiError` (and validation errors) with
 * explicit reasons for malformed input — those are captured as gate
 * failures, not crashes. Wiring check: every solver partId must be a
 * declared plan part (BOM ↔ geometry ↔ assembly linkage honesty).
 */

import { solveMates, type SolveMatesResult } from '@/lib/assembly/api';
import type { DesignPlan, GateResult, PlanAssembly } from './types';

/** Default residual tolerance for convergence (mm-scale residual units). */
export const ASSEMBLY_DEFAULT_TOL = 1e-6;

export interface AssemblySolveArtifact {
  result: SolveMatesResult | null;
  toleranceUsed: number;
  /** Rejection message when the solver refused the input. */
  error?: string;
}

/** Execute the plan's assembly solve, capturing rejections. */
export function solvePlanAssembly(assembly: PlanAssembly): AssemblySolveArtifact {
  const toleranceUsed = assembly.tolerance ?? ASSEMBLY_DEFAULT_TOL;
  try {
    const result = solveMates(assembly.parts, assembly.mates, {
      tolerance: toleranceUsed,
      ...(assembly.engine ? { engine: assembly.engine } : {}),
    });
    return { result, toleranceUsed };
  } catch (err) {
    return { result: null, toleranceUsed, error: (err as Error).message };
  }
}

export function assemblyGate(plan: DesignPlan, artifact: AssemblySolveArtifact): GateResult {
  const assembly = plan.assembly;
  const notes: string[] = [
    'solveMates(src/lib/assembly/api) 소비 — converged + finalMaxResidual 실측 판정. 간섭(interference) 검사는 WA-A 미포함(한계 명시)',
  ];
  const reasons: string[] = [];
  const metrics: Record<string, number> = {
    partCount: assembly?.parts.length ?? 0,
    mateCount: assembly?.mates.length ?? 0,
    tolerance: artifact.toleranceUsed,
  };

  if (!assembly) {
    // Defensive — the driver only calls this gate when a plan has an assembly.
    return {
      id: 'assembly',
      kind: 'assembly',
      pass: false,
      metrics,
      reason: 'plan has no assembly declaration',
      notes,
    };
  }

  // Wiring: solver part ids must be declared plan parts.
  const planPartIds = new Set(plan.parts.map((p) => p.partId));
  for (const spec of assembly.parts) {
    const id = spec.partId ?? spec.id;
    if (id !== undefined && !planPartIds.has(id)) {
      reasons.push(`assembly part '${id}' is not a declared plan part (BOM/geometry linkage broken)`);
    }
  }

  if (artifact.error) {
    reasons.push(`solver rejected the assembly — ${artifact.error}`);
  } else if (artifact.result) {
    const r = artifact.result;
    metrics.iterations = r.iterations;
    metrics.finalMaxResidual = r.finalMaxResidual;
    if (!r.converged) {
      reasons.push(
        `mates did not converge — finalMaxResidual ${r.finalMaxResidual} > tolerance ${artifact.toleranceUsed} after ${r.iterations} iteration(s)`,
      );
    } else if (r.finalMaxResidual > artifact.toleranceUsed) {
      reasons.push(
        `converged flag inconsistent with residual — finalMaxResidual ${r.finalMaxResidual} > tolerance ${artifact.toleranceUsed}`,
      );
    }
  }

  return {
    id: 'assembly',
    kind: 'assembly',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
