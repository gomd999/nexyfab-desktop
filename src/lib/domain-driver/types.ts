/**
 * domain-driver/types — the DOMAIN-AGNOSTIC spine of the "plan → measured gate →
 * verified package" driver (다분야 확장 Phase 1).
 *
 * The mechanical driver (`src/lib/ai/design-driver`) proved the shape: an LLM/
 * fixture planner emits a plan IR, a deterministic build turns it into artifacts,
 * a chain of MEASURED gates judges it (실행하지 않은 판정은 판정이 아니다), and a
 * package exists ONLY when every gate passed (otherwise a refusal IR — 패키지
 * 미산출). That orchestration is identical across domains; only the plan
 * VOCABULARY and the gate MEASUREMENT differ (mechanical = dims/volume, civil =
 * structural code, interior = life-safety code, …).
 *
 * This module is that reusable orchestration as a generic contract. A domain is
 * a `DomainModule`; `runDomainDriver` (runner.ts) executes it with the same
 * honesty invariants the mechanical driver hard-codes. Mechanical is the
 * reference implementation the contract is extracted from; civil/interior/etc.
 * implement this interface fresh (Batch 2 wiring).
 *
 * Honesty invariants (도메인 공통 — the runner enforces them):
 *   - a planner refusal / structurally-invalid plan ⇒ stage:'plan' refusal, no
 *     gates, no package (계획 날조 금지);
 *   - ALL gates always run (rich refusal IR), but ONE fail ⇒ no package;
 *   - a gate's verdict must be backed by measured `metrics`; `reason` is required
 *     on failure.
 */

/**
 * A single measured gate verdict — the domain-agnostic shape (identical to the
 * mechanical `GateResult`, with `kind` widened to a free string so each domain
 * can name its own gate kinds: 'geometry'|'structural'|'egress'|…).
 */
export interface DomainGateResult {
  /** `${kind}:${scope}` — e.g. 'structural:beam1', 'egress:corridor'. */
  id: string;
  /** Domain gate kind (free-form per domain). */
  kind: string;
  pass: boolean;
  /** Measured numbers backing the verdict (never fabricated). */
  metrics: Record<string, number>;
  /** Present iff !pass — the explicit refusal reason. */
  reason?: string;
  /** Explicit approximation / consumption statements (근사 명시). */
  notes: string[];
}

/** Refusal IR — no package was produced (stage says where it stopped). */
export interface DomainRefusal {
  /** 'plan' = planner refused / structurally-invalid; 'verify' = build/gate failed. */
  stage: 'plan' | 'verify';
  reason: string;
  /** Gate ids that failed (empty for plan-stage / build refusals). */
  failedGateIds: string[];
}

export type DomainDriverResult<Plan, Package> =
  | { ok: true; domain: string; plan: Plan; gates: DomainGateResult[]; package: Package }
  | { ok: false; domain: string; plan?: Plan; gates: DomainGateResult[]; refusal: DomainRefusal };

/**
 * A domain plugin. The four stages mirror the mechanical driver:
 *   plan → (structuralError) → build → gates → package.
 * `Brief` is the domain's input (usually a NL brief + params), `Plan` its plan
 * IR, `Artifacts` the deterministic build products (meshes/solves/measurements),
 * `Package` the verified deliverable.
 */
export interface DomainModule<Brief, Plan, Artifacts, Package> {
  /** Domain identity, e.g. 'mechanical' | 'civil' | 'interior'. */
  name: string;
  /**
   * NL brief → domain plan IR. THROW (or return a rejected promise) to refuse a
   * brief the planner cannot express — the runner turns that into a stage:'plan'
   * refusal (계획을 추측으로 만들지 않는다).
   */
  plan(brief: Brief): Plan | Promise<Plan>;
  /**
   * Optional structural pre-build validation. Return a reason string to refuse
   * before spending build work, or null/undefined to proceed.
   */
  structuralError?(plan: Plan): string | null;
  /**
   * Deterministic build: plan → artifacts. Same plan ⇒ same artifacts. A build
   * failure THROWS — the runner turns it into a stage:'verify' refusal (a plan
   * that cannot even be built is not verifiable).
   */
  build(plan: Plan): Artifacts | Promise<Artifacts>;
  /**
   * The measured gate chain. ALL gates must be returned every run (rich refusal
   * IR); the runner refuses the package if ANY has pass:false. Never throws for
   * a gate failure — a failure is a `pass:false` result with a `reason`.
   */
  gates(plan: Plan, artifacts: Artifacts): DomainGateResult[] | Promise<DomainGateResult[]>;
  /**
   * Package assembly. The runner calls this ONLY after every gate passed, so the
   * package never contains an unverified value.
   */
  package(plan: Plan, artifacts: Artifacts, gates: DomainGateResult[]): Package;
}
