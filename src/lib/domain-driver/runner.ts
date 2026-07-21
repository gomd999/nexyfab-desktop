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
 *   ④ package— module.package(...) ONLY when every gate passed.
 *
 * The runner NEVER fabricates a verdict or a package — it only routes the
 * module's real results into the refusal / package IR.
 */

import type { DomainDriverResult, DomainModule } from './types';

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
  const gates = await module.gates(plan, artifacts);
  const failed = gates.filter((g) => !g.pass);
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
  return { ok: true, domain, plan, gates, package: pkg };
}
