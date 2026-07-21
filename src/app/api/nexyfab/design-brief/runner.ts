/**
 * design-brief runner — the SHARED, planner-injectable core behind ALL three
 * WA-D3 surfaces (API route · MCP `design_brief` tool · web entry). Same brief
 * + same planner ⇒ same payload IR (생성≠검증: the driver runs every gate and
 * packages ONLY when all pass; refusals carry stage + reason + 게이트 수치, and
 * no value is fabricated because a package exists only post-gate).
 *
 * ─── PLANNER INJECTION POINT (WA-D1 swap — DONE 260722d) ──────────────────
 *   `DEFAULT_PLANNER` routes on the brief: an explicit `params.fixture` string
 *   uses the deterministic `fixturePlanner` (demo · known catalog · tests —
 *   no LLM cost, byte-reproducible), and everything else goes to the real LLM
 *   planner (`chatCompletionPlanner`, WA-D1). Everything downstream of `plan`
 *   is deterministic, so the API/MCP/web surfaces are invariant under which
 *   planner ran. This is the single seam; route.ts/mcp/web never hardcode a
 *   planner. Tests always pass `fixture`, so they never touch the LLM path.
 */

import { runDesignDriver } from '@/lib/ai/design-driver/designDriver';
import { fixturePlanner } from '@/lib/ai/design-driver/fixturePlanner';
import { chatCompletionPlanner } from '@/lib/ai/design-driver/llmPlanner';
import type { DesignPlanner } from '@/lib/ai/design-driver/planner';
import type {
  DesignBrief,
  DesignPackage,
  DesignPlan,
  DriverResult,
  GateResult,
} from '@/lib/ai/design-driver/types';

/** The real LLM planner (free-text briefs). Constructed once; the actual
 *  provider call happens only inside `.plan()`, so this is import-safe. */
const llmPlanner = chatCompletionPlanner();

/**
 * Default planner: an explicit `fixture` param routes the deterministic
 * catalog planner (demo/tests/known parts); any other brief goes to the LLM
 * planner. A bad `fixture` key still routes to `fixturePlanner` (which refuses
 * with an explicit "unknown brief" reason) — so the refusal contract holds
 * without an LLM call.
 */
export const DEFAULT_PLANNER: DesignPlanner = {
  name: 'default(fixture|llm)',
  plan(brief: DesignBrief): DesignPlan | Promise<DesignPlan> {
    const hasFixture = typeof brief.params?.fixture === 'string' && brief.params.fixture.length > 0;
    return (hasFixture ? fixturePlanner : llmPlanner).plan(brief);
  },
};

export interface BriefPayloadOk {
  ok: true;
  planId: string;
  /** Verified package: per-part sheet IR + DXF + measured dims, BOM, assembly,
   *  verification report (gates + 근사/한계). */
  package: DesignPackage;
}

export interface BriefPayloadRefused {
  ok: false;
  /** Explicit refusal — stage:'plan' (planner refused / invalid plan) or
   *  stage:'verify' (a measured gate failed). Never a fabricated package. */
  refusal: { stage: 'plan' | 'verify'; reason: string; failedGateIds: string[] };
  /** All gate results (empty when refused at plan stage). */
  gates: GateResult[];
}

export type BriefPayload = BriefPayloadOk | BriefPayloadRefused;

/** Map the driver's `DriverResult` to the surface-shared payload IR. */
export function briefResultToPayload(result: DriverResult): BriefPayload {
  if (result.ok) {
    return { ok: true, planId: result.plan.planId, package: result.package };
  }
  return { ok: false, refusal: result.refusal, gates: result.gates };
}

/**
 * Parse a request/tool body into a `DesignBrief`, or the reason it's invalid.
 * Accepts either `{ brief: { id?, text, params? } }` or a flat
 * `{ text, id?, params?, fixture? }`. A bare `fixture` string is a convenience
 * that routes the deterministic planner (no effect once llmPlanner is wired).
 */
export function parseBrief(body: unknown): { brief: DesignBrief } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const src = b.brief && typeof b.brief === 'object' && !Array.isArray(b.brief)
    ? (b.brief as Record<string, unknown>)
    : b;

  const text = typeof src.text === 'string' ? src.text.trim() : '';
  if (!text) return { error: 'brief.text is required' };
  if (text.length > 4000) return { error: 'brief.text too long (max 4000 chars)' };

  const params: Record<string, number | string> = {};
  const rawParams = src.params;
  if (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
    for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
      else if (typeof v === 'string') params[k] = v;
    }
  }
  if (typeof src.fixture === 'string' && src.fixture.trim()) params.fixture = src.fixture.trim();

  const id = typeof src.id === 'string' && src.id.trim()
    ? src.id.trim()
    : (typeof params.fixture === 'string' ? params.fixture : `brief-${text.slice(0, 24)}`);

  const brief: DesignBrief = {
    id,
    text,
    ...(Object.keys(params).length ? { params } : {}),
  };
  return { brief };
}

/**
 * Run a brief through the design driver with the injected planner (default:
 * deterministic `fixturePlanner`). Returns the surface-shared payload IR —
 * a verified package or an explicit refusal.
 */
export async function runDesignBrief(
  brief: DesignBrief,
  planner: DesignPlanner = DEFAULT_PLANNER,
): Promise<BriefPayload> {
  const result = await runDesignDriver(brief, { planner });
  return briefResultToPayload(result);
}
