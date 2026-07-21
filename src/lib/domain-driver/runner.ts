/**
 * domain-driver/runner — `runDomainDriver(brief, module)`: the generic, domain-
 * agnostic orchestrator (다분야 확장 Phase 1). Executes a `DomainModule` with the
 * SAME honesty invariants the mechanical `runDesignDriver` hard-codes:
 *
 *   ① plan   — module.plan(brief); a throw ⇒ stage:'plan' refusal.
 *   ①b struct— module.structuralError(plan); non-null ⇒ stage:'plan' refusal.
 *   ② build  — module.build(plan); a throw ⇒ stage:'verify' refusal (unbuildable
 *              ⇒ unverifiable, no gates, no package).
 *   ③ verify — module.gates(plan, artifacts). ALL gates run; ONE fail ⇒
 *              stage:'verify' refusal carrying every failed gate id.
 *   ③b fix   — (opt-in) on failure, module.autoFix reconciles SAFE claims to their
 *              computed values (never geometry); re-build + re-gate ONCE. A package
 *              produced this way carries `adjustments` (verified, pending review).
 *   ④ package— module.package(...) ONLY when every gate passed.
 *
 * The runner NEVER fabricates a verdict or a package — it only routes the
 * module's real results into the refusal / package IR.
 */

import type { DomainAdjustment, DomainDriverResult, DomainGateResult, DomainModule } from './types';

export async function runDomainDriver<Brief, Plan, Artifacts, Package>(
  brief: Brief,
  module: DomainModule<Brief, Plan, Artifacts, Package>,
): Promise<DomainDriverResult<Plan, Package>> {
  const domain = module.name;

  // ── ① plan ───────────────────────────────────────────────────────────────
  let plan: Plan;
  try {
    plan = await module.plan(brief);
  } catch (err) {
    return {
      ok: false,
      domain,
      gates: [],
      refusal: {
        stage: 'plan',
        reason: `planner '${domain}' refused: ${(err as Error).message}`,
        failedGateIds: [],
      },
    };
  }

  // ── ①b structural pre-build validation ───────────────────────────────────
  const structural = module.structuralError?.(plan) ?? null;
  if (structural) {
    return {
      ok: false,
      domain,
      plan,
      gates: [],
      refusal: {
        stage: 'plan',
        reason: `structurally invalid plan: ${structural}`,
        failedGateIds: [],
      },
    };
  }

  // ── ② build (a throw ⇒ verify-stage refusal, no gates) ────────────────────
  let artifacts: Artifacts;
  try {
    artifacts = await module.build(plan);
  } catch (err) {
    return {
      ok: false,
      domain,
      plan,
      gates: [],
      refusal: {
        stage: 'verify',
        reason: `build failed: ${(err as Error).message}`,
        failedGateIds: [],
      },
    };
  }

  // ── ③ verify — every gate runs; one fail ⇒ 패키지 미산출 ───────────────────
  // A gate that THROWS (a coercible-but-invalid parameter reaching a check that
  // guards with a throw) becomes a clean verify-stage refusal here, never an
  // uncaught exception — the same honesty as a failed gate (패키지 미산출). Each
  // module SHOULD still wrap per-gate for granular ids, but this is the spine's
  // systemic safety net so no domain can crash the driver on bad input.
  let gates: DomainGateResult[];
  try {
    gates = await module.gates(plan, artifacts);
  } catch (err) {
    return {
      ok: false,
      domain,
      plan,
      gates: [],
      refusal: {
        stage: 'verify',
        reason: `gate chain failed: ${(err as Error).message}`,
        failedGateIds: [],
      },
    };
  }
  let failed = gates.filter((g) => !g.pass);

  // ── ③b Step ② auto-fix (ONE-SHOT): reconcile safe claims, re-build, re-gate ─
  // Called only on failure and only if the module opts in. The module may ONLY
  // reconcile a deterministically-computed CLAIM to its computed value — never
  // geometry / physical parameters (형상·물성은 사람 몫). We re-verify ONCE (no
  // unbounded loop); adjustments are surfaced on the result for human review.
  let adjustments: DomainAdjustment[] = [];
  if (failed.length > 0 && module.autoFix) {
    let fix: ReturnType<NonNullable<typeof module.autoFix>> = null;
    try {
      fix = module.autoFix(plan, failed);
    } catch {
      fix = null; // an autoFix throw must never crash the driver (treated as unfixable)
    }
    if (fix && fix.adjustments.length > 0) {
      plan = fix.plan;
      adjustments = fix.adjustments;
      try {
        artifacts = await module.build(plan);
        gates = await module.gates(plan, artifacts);
      } catch (err) {
        return {
          ok: false,
          domain,
          plan,
          gates: [],
          refusal: {
            stage: 'verify',
            reason: `auto-fix re-verify failed: ${(err as Error).message}`,
            failedGateIds: [],
          },
        };
      }
      failed = gates.filter((g) => !g.pass);
    }
  }

  if (failed.length > 0) {
    return {
      ok: false,
      domain,
      plan,
      gates,
      refusal: {
        stage: 'verify',
        reason: failed.map((g) => `[${g.id}] ${g.reason ?? 'failed'}`).join(' | '),
        failedGateIds: failed.map((g) => g.id),
      },
    };
  }

  // ── ④ package (all gates green) ───────────────────────────────────────────
  const pkg = module.package(plan, artifacts, gates);
  return {
    ok: true,
    domain,
    plan,
    gates,
    package: pkg,
    ...(adjustments.length > 0 ? { adjustments } : {}),
  };
}
