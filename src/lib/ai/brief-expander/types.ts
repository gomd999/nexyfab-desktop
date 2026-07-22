/**
 * brief-expander/types — the "명료화 → 구조화 브리프" (clarify → structured brief)
 * contract.
 *
 * This is the UPSTREAM front of the design pipeline. A user types a rough
 * one-liner ("수처리 기기 설계하려해 RO가 들어가고 필터도 다 있어야해"); the expander
 * turns it into a STRUCTURED DRAFT that the EXISTING planners
 * (scad-intent-from-nl · design-driver/llmPlanner · eng-domain planners)
 * consume — it never generates geometry itself.
 *
 * Honesty invariant (LLM_METHODOLOGY.md · result/README '불변 규칙'):
 *   Every parameter carries a SOURCE label — it is NEVER a bare fabricated
 *   number:
 *     - `given`       — the user literally stated it (code-verified against the
 *                       raw text, not the model's say-so).
 *     - `assumption`  — a defensible default; MUST be labeled 가정 and carry a
 *                       `note` stating its basis.
 *     - `needs_input` — low confidence / no defensible default → `value: null`,
 *                       surfaced as a question back to the user.
 *   "추정값에 실측 표기 금지 · 확신 없는 필드는 null." A value the model cannot
 *   ground is downgraded, never presented as fact.
 */

/** Where a parameter's value comes from — the anti-fabrication label. */
export type ParamSource = 'given' | 'assumption' | 'needs_input';

/**
 * Domains the expander can tag, mapped 1:1 to the downstream planner families.
 * `generic` = no specialised planner (falls through to scad-intent-from-nl).
 */
export type BriefDomain =
  | 'mech'
  | 'civil'
  | 'construction'
  | 'interior'
  | 'landscape'
  | 'generic';

export const BRIEF_DOMAINS: readonly BriefDomain[] = [
  'mech', 'civil', 'construction', 'interior', 'landscape', 'generic',
];

/** One drafted parameter. `value` is null iff `source === 'needs_input'`. */
export interface BriefParam {
  key: string;
  value: number | string | null;
  unit: string | null;
  source: ParamSource;
  /** 가정의 근거(assumption) 또는 물어봐야 하는 이유(needs_input). */
  note?: string;
}

/** A distinct component/sub-system extracted from the brief. */
export interface BriefComponent {
  name: string;
  params: BriefParam[];
}

/** The structured draft — the expander's output. */
export interface StructuredBrief {
  title: string;
  domain: BriefDomain;
  components: BriefComponent[];
  /** needs_input parameters surfaced as crisp questions back to the user. */
  questions: string[];
  /** human-readable 가정 list (every labeled assumption). */
  assumptions: string[];
  /** the original user text, kept for traceability / downstream context. */
  raw: string;
}

/**
 * The shape the EXISTING planners consume (design-driver `DesignBrief`,
 * civil/interior/... `*Brief`): `{ id, text, params }`. Only `given`
 * parameters become authoritative `params`; assumptions are surfaced in `text`
 * with a 가정 label so downstream never treats a default as a hard fact.
 */
export interface PlannerBrief {
  id: string;
  text: string;
  params: Record<string, number | string>;
}
