/**
 * design-driver/designDriver — WA-A core: `run(brief, deps)`.
 *
 * Pipeline (생성≠검증 — 각 단계는 실행되고 수치로 판정된다):
 *   ① plan   — injected `DesignPlanner` (LLM = WA-D; here fixture/static).
 *              Planner refusal / structurally-invalid plan ⇒ stage:'plan'
 *              refusal, no gates, no package.
 *   ② build  — deterministic execution: meshes (featureToPolyhedron),
 *              topologies (buildExtrudeTopo), assembly solve (solveMates),
 *              sheets (standardThreeViewSheet). Failures are CAPTURED into
 *              the corresponding gate, never silently skipped.
 *   ③ verify — gate chain IR: geometry (per part) → assembly → DFM (per
 *              part) → drawing. Every gate reports {id, pass, metrics,
 *              reason?, notes}. ALL gates always run (rich refusal IR),
 *              but ONE fail ⇒ 패키지 미산출.
 *   ④ package — only when every gate passed: sheets + measured dims + DXF
 *              + BOM + verification report JSON (근사·한계 명시).
 */

import type { DesignPlanner } from './planner';
import {
  assemblyGate,
  solvePlanAssembly,
  type AssemblySolveArtifact,
} from './assemblyGate';
import { buildPartGeometry, geometryGate, type PartGeometry } from './geometryGate';
import { manufacturingGate } from './manufacturingGate';
import { buildDrawingArtifact, drawingGate } from './drawingGate';
import { buildDesignPackage } from './packager';
import type { DesignBrief, DesignPlan, DriverResult, GateResult } from './types';

export interface DriverDeps {
  planner: DesignPlanner;
}

/** Structural plan validation — refuse before spending build work. */
function planStructureError(plan: DesignPlan): string | null {
  if (!plan.planId) return 'plan has no planId';
  if (plan.parts.length === 0) return 'plan has no parts';
  const partIds = new Set<string>();
  for (const part of plan.parts) {
    if (!part.partId) return 'plan part with empty partId';
    if (partIds.has(part.partId)) return `duplicate partId '${part.partId}'`;
    partIds.add(part.partId);
    if (part.bodies.length === 0) return `part '${part.partId}' has no bodies`;
    const bodyIds = new Set<string>();
    for (const body of part.bodies) {
      if (!body.bodyId) return `part '${part.partId}' has a body with empty bodyId`;
      if (bodyIds.has(body.bodyId)) return `part '${part.partId}': duplicate bodyId '${body.bodyId}'`;
      bodyIds.add(body.bodyId);
    }
  }
  const dimIds = new Set<string>();
  for (const d of plan.drawing.dimensions) {
    if (dimIds.has(d.id)) return `duplicate dimension id '${d.id}'`;
    dimIds.add(d.id);
  }
  return null;
}

export async function runDesignDriver(
  brief: DesignBrief,
  deps: DriverDeps,
): Promise<DriverResult> {
  // ── ① plan ─────────────────────────────────────────────────────────────
  let plan: DesignPlan;
  try {
    plan = await deps.planner.plan(brief);
  } catch (err) {
    return {
      ok: false,
      gates: [],
      refusal: {
        stage: 'plan',
        reason: `planner '${deps.planner.name}' refused: ${(err as Error).message}`,
        failedGateIds: [],
      },
    };
  }
  const structural = planStructureError(plan);
  if (structural) {
    return {
      ok: false,
      plan,
      gates: [],
      refusal: {
        stage: 'plan',
        reason: `planner produced a structurally invalid plan: ${structural}`,
        failedGateIds: [],
      },
    };
  }

  // ── ② build (deterministic; failures captured, not thrown) ────────────
  const geometries = new Map<string, PartGeometry>();
  for (const part of plan.parts) {
    geometries.set(part.partId, buildPartGeometry(part));
  }
  const assemblyArtifact: AssemblySolveArtifact | null = plan.assembly
    ? solvePlanAssembly(plan.assembly)
    : null;
  const drawingArtifact = buildDrawingArtifact(plan);

  // ── ③ verify — gate chain ─────────────────────────────────────────────
  const gates: GateResult[] = [];
  for (const part of plan.parts) {
    gates.push(geometryGate(part, geometries.get(part.partId)!));
  }
  if (plan.assembly && assemblyArtifact) {
    gates.push(assemblyGate(plan, assemblyArtifact));
  }
  for (const part of plan.parts) {
    gates.push(manufacturingGate(part, geometries.get(part.partId)!));
  }
  gates.push(drawingGate(plan, drawingArtifact));

  const failed = gates.filter((g) => !g.pass);
  if (failed.length > 0) {
    return {
      ok: false,
      plan,
      gates,
      refusal: {
        stage: 'verify',
        reason: failed.map((g) => `[${g.id}] ${g.reason ?? 'failed'}`).join(' | '),
        failedGateIds: failed.map((g) => g.id),
      },
    };
  }

  // ── ④ package (all gates green) ───────────────────────────────────────
  const pkg = buildDesignPackage({
    brief,
    plan,
    gates,
    geometries,
    drawing: drawingArtifact,
    assembly: assemblyArtifact,
  });
  return { ok: true, plan, gates, package: pkg };
}
