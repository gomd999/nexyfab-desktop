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
import { buildInterferenceArtifact, interferenceGate } from './interferenceGate';
import { manufacturingGate } from './manufacturingGate';
import {
  buildFlatPatternArtifact,
  flatPatternGate,
  type FlatPatternArtifact,
} from './flatPatternGate';
import {
  buildWeldmentArtifact,
  weldmentGate,
  type WeldmentArtifact,
} from './weldmentGate';
import {
  buildFastenerArtifact,
  fastenerGate,
  type FastenerArtifact,
} from './fastenerGate';
import {
  buildPatternArtifact,
  patternGate,
  type PatternArtifact,
} from './patternGate';
import {
  buildCurvedArtifact,
  curvedGate,
  type CurvedArtifact,
} from './curvedGate';
import {
  buildHoleArtifact,
  holeGate,
  type HoleArtifact,
} from './holeGate';
import { buildDrawingArtifact, drawingGate } from './drawingGate';
import { buildGdtArtifact, gdtGate } from './gdtGate';
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
  // Sheet-metal unfold (WB-2). Build failures are CAPTURED (stored as null) so
  // the flat-pattern gate refuses the plan rather than throwing out the pipeline.
  const flatPatterns = new Map<string, FlatPatternArtifact | null>();
  for (const part of plan.parts) {
    if (!part.sheetMetal) continue;
    try {
      flatPatterns.set(part.partId, buildFlatPatternArtifact(part));
    } catch {
      flatPatterns.set(part.partId, null);
    }
  }
  // Weldment cut list (WB-3). Build failures CAPTURED as null (gate refuses).
  const weldments = new Map<string, WeldmentArtifact | null>();
  for (const part of plan.parts) {
    if (!part.weldment) continue;
    try {
      weldments.set(part.partId, buildWeldmentArtifact(part));
    } catch {
      weldments.set(part.partId, null);
    }
  }
  // Standard-thread schedule (WB-8). Build failures CAPTURED as null.
  const fasteners = new Map<string, FastenerArtifact | null>();
  for (const part of plan.parts) {
    if (!part.fasteners || part.fasteners.length === 0) continue;
    try {
      fasteners.set(part.partId, buildFastenerArtifact(part));
    } catch {
      fasteners.set(part.partId, null);
    }
  }
  // Feature-pattern layout (WB-7). Build failures CAPTURED as null.
  const patterns = new Map<string, PatternArtifact | null>();
  for (const part of plan.parts) {
    if (!part.patterns || part.patterns.length === 0) continue;
    try {
      patterns.set(part.partId, buildPatternArtifact(part));
    } catch {
      patterns.set(part.partId, null);
    }
  }
  // Curved (OCCT fillet/shell) — async kernel op (WB-6). Only runs for parts that
  // declare `curved`, so no OCCT load happens otherwise. Failures CAPTURED.
  const curveds = new Map<string, CurvedArtifact | null>();
  for (const part of plan.parts) {
    if (!part.curved) continue;
    try {
      curveds.set(part.partId, await buildCurvedArtifact(part));
    } catch {
      curveds.set(part.partId, null);
    }
  }
  // Holes (OCCT boolean cut) — async kernel op (WB-9). Same policy as curved:
  // only parts that declare `holes` load the kernel; failures are CAPTURED so a
  // kernel problem becomes a gate refusal, never a silent pass.
  const holeArtifacts = new Map<string, HoleArtifact | null>();
  for (const part of plan.parts) {
    if (!part.holes || part.holes.length === 0) continue;
    try {
      holeArtifacts.set(part.partId, await buildHoleArtifact(part));
    } catch {
      holeArtifacts.set(part.partId, null);
    }
  }
  const drawingArtifact = buildDrawingArtifact(plan);
  // WB-5: GD&T auto-propose + verify over the named topology; declared specs are
  // enforced (build never throws — refusals become gate reasons).
  const gdtArtifact = buildGdtArtifact(plan, drawingArtifact.topologies);

  // ── ③ verify — gate chain ─────────────────────────────────────────────
  const gates: GateResult[] = [];
  for (const part of plan.parts) {
    gates.push(geometryGate(part, geometries.get(part.partId)!));
  }
  if (plan.assembly && assemblyArtifact) {
    gates.push(assemblyGate(plan, assemblyArtifact));
    // Interference is checked ONLY on a CONVERGED placement (실행한 배치만
    // 판정 — a non-converged pose is meaningless to collision-check, and the
    // assembly gate already refuses that plan).
    if (assemblyArtifact.result?.converged) {
      gates.push(
        interferenceGate(plan, buildInterferenceArtifact(plan, assemblyArtifact, geometries)),
      );
    }
  }
  for (const part of plan.parts) {
    gates.push(manufacturingGate(part, geometries.get(part.partId)!));
  }
  for (const part of plan.parts) {
    if (part.sheetMetal) {
      gates.push(flatPatternGate(part, flatPatterns.get(part.partId) ?? null));
    }
  }
  for (const part of plan.parts) {
    if (part.weldment) {
      gates.push(weldmentGate(part, weldments.get(part.partId) ?? null));
    }
  }
  for (const part of plan.parts) {
    if (part.fasteners && part.fasteners.length > 0) {
      gates.push(fastenerGate(part, fasteners.get(part.partId) ?? null));
    }
  }
  for (const part of plan.parts) {
    if (part.patterns && part.patterns.length > 0) {
      gates.push(patternGate(part, patterns.get(part.partId) ?? null));
    }
  }
  for (const part of plan.parts) {
    if (part.curved) {
      gates.push(curvedGate(part, curveds.get(part.partId) ?? null));
    }
  }
  for (const part of plan.parts) {
    if (part.holes && part.holes.length > 0) {
      gates.push(holeGate(part, holeArtifacts.get(part.partId) ?? null));
    }
  }
  gates.push(drawingGate(plan, drawingArtifact));
  gates.push(gdtGate(plan, gdtArtifact));

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
    flatPatterns,
    weldments,
    fasteners,
    patterns,
    curveds,
    holeArtifacts,
    gdt: gdtArtifact,
  });
  return { ok: true, plan, gates, package: pkg };
}
