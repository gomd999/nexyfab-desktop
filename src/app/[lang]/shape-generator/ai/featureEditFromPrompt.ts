/**
 * featureEditFromPrompt — orchestrates the viewport AI prompt: the deterministic
 * parser first, then an LLM-backed fallback for the long tail.
 *
 *   1. parseFeatureEditPrompt (offline, zero cost) — common direct commands.
 *   2. On miss → POST /api/featureTree-intent (regex → LLM → fallback), whose
 *      PlanIntent is mapped to in-context FeatureEditIntent[] via
 *      planIntentToFeatureEdits.
 *   3. Still nothing → return the parser's guidance explanation.
 *
 * The plan fetch is injectable so this is unit-tested without a network call.
 */

import { parseFeatureEditPrompt } from './nlFeatureEditParser';
import { planIntentToFeatureEdits } from './planIntentToFeatureEdit';
import type { FeatureInstance } from '../features/types';
import type { FeatureEditIntent } from './featureEditDispatcher';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';

export type PlanFetcher = (text: string) => Promise<PlanIntent | null>;

/** Default fetcher — hits the featureTree-intent endpoint (regex → LLM). */
async function defaultFetchPlan(text: string): Promise<PlanIntent | null> {
  const res = await fetch('/api/featureTree-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; intent?: PlanIntent | null };
  return data.ok ? (data.intent ?? null) : null;
}

export async function resolveFeatureEditPrompt(
  prompt: string,
  features: ReadonlyArray<FeatureInstance>,
  fetchPlan: PlanFetcher = defaultFetchPlan,
): Promise<{ intents: FeatureEditIntent[]; explanation: string }> {
  // 1. Deterministic parser.
  const local = parseFeatureEditPrompt(prompt, features);
  if (local.intents.length > 0) return local;

  // 2. Escalate to the regex→LLM endpoint for the long tail.
  let plan: PlanIntent | null = null;
  try {
    plan = await fetchPlan(prompt);
  } catch {
    plan = null;
  }
  const mapped = planIntentToFeatureEdits(plan);
  if (mapped.intents.length > 0) {
    return { intents: mapped.intents, explanation: `(AI) ${mapped.explanation}` };
  }

  // 3. Nothing mapped — surface the deterministic guidance.
  return local;
}
