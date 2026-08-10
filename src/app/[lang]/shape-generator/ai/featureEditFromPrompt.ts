/**
 * featureEditFromPrompt — orchestrates the viewport AI prompt: the deterministic
 * parser first, then an LLM-backed fallback for the long tail.
 *
 *   1. parseFeatureEditPrompt (offline, zero cost) — common direct commands.
 *   2. On miss → POST /api/featureTree-intent (regex → LLM → fallback) WITH a
 *      compact model context (feature tree + selection + base shape) so the LLM
 *      can resolve "make it taller", "remove the fillet", "this face". The
 *      PlanIntent is mapped to in-context FeatureEditIntent[] via
 *      planIntentToFeatureEdits (selection-aware, base-shape-aware).
 *   3. Still nothing → return the parser's guidance explanation.
 *
 * The plan fetch is injectable so this is unit-tested without a network call.
 */

import { parseFeatureEditPrompt } from './nlFeatureEditParser';
import { planIntentToFeatureEdits } from './planIntentToFeatureEdit';
import type { FeatureInstance } from '../features/types';
import type { FeatureEditIntent } from './featureEditDispatcher';
import type { ElementSelectionInfo } from '../editing/selectionInfo';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';
import type { AiModelContext } from '@/lib/ai/modelContext';
import { selectionContextFromElement } from '@/lib/ai/selectionContext';
import type { SelectionContext } from '@/lib/ai/selectionContext';
import type { DesignDomainId, UserExperienceLevel } from '@/lib/ai/domainProfile';

export type PlanFetcher = (text: string, context?: AiModelContext) => Promise<PlanIntent | null>;

export interface ResolveOpts {
  domainWorkspace?: { domain: DesignDomainId; experience: UserExperienceLevel };
  selection?: ElementSelectionInfo | null;
  baseShape?: string | null;
  projectRevision?: string;
  assemblyPath?: string[];
  partInstanceId?: string;
  bodyId?: string;
  featureId?: string;
}

/** Default fetcher — hits the featureTree-intent endpoint (regex → LLM). */
async function defaultFetchPlan(text: string, context?: AiModelContext): Promise<PlanIntent | null> {
  const res = await fetch('/api/featureTree-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, context }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; intent?: PlanIntent | null };
  return data.ok ? (data.intent ?? null) : null;
}

/** Compact, JSON-serialisable model summary sent to the LLM. */
function buildContext(
  features: ReadonlyArray<FeatureInstance>,
  selection: ElementSelectionInfo | null | undefined,
  baseShape: string | null | undefined,
  opts: ResolveOpts,
): AiModelContext {
  return {
    domainWorkspace: opts.domainWorkspace,
    baseShape: baseShape ?? null,
    features: features.map((f) => ({ id: f.id, type: f.type, params: f.params })),
    selection: selectionToContext(selection),
    selectionContext: selectionContextFromElement(selection ?? null, {
      projectRevision: opts.projectRevision ?? 'unversioned',
      assemblyPath: opts.assemblyPath,
      partInstanceId: opts.partInstanceId,
      bodyId: opts.bodyId,
      featureId: opts.featureId,
    }),
  };
}

function selectionToContext(sel: ElementSelectionInfo | null | undefined): AiModelContext['selection'] {
  if (!sel) return null;
  if (sel.type === 'face') return { kind: 'face', label: sel.normalLabel };
  if (sel.type === 'edge') return { kind: 'edge', label: 'edge' };
  return { kind: 'multi', label: `${sel.faces.length} faces` };
}

export async function resolveFeatureEditPrompt(
  prompt: string,
  features: ReadonlyArray<FeatureInstance>,
  fetchPlan: PlanFetcher = defaultFetchPlan,
  opts: ResolveOpts = {},
): Promise<{ intents: FeatureEditIntent[]; explanation: string; baseRevision?: string; selectionContext?: SelectionContext }> {
  const { selection, baseShape } = opts;
  const selectionContext = selectionContextFromElement(selection ?? null, {
    projectRevision: opts.projectRevision ?? 'unversioned',
    assemblyPath: opts.assemblyPath,
    partInstanceId: opts.partInstanceId,
    bodyId: opts.bodyId,
    featureId: opts.featureId,
  });

  // 1. Deterministic parser (selection-aware: offset/delete/draft a picked face,
  //    fillet/chamfer a picked edge).
  const local = parseFeatureEditPrompt(prompt, features, selection);
  if (local.intents.length > 0) return { ...local, baseRevision: opts.projectRevision, selectionContext };

  // 2. Escalate to the regex→LLM endpoint for the long tail, WITH model context.
  let plan: PlanIntent | null = null;
  try {
    plan = await fetchPlan(prompt, buildContext(features, selection, baseShape, opts));
  } catch {
    plan = null;
  }
  const mapped = planIntentToFeatureEdits(plan, { features, selection });
  if (mapped.intents.length > 0) {
    return { intents: mapped.intents, explanation: `(AI) ${mapped.explanation}`, baseRevision: opts.projectRevision, selectionContext };
  }

  // 3. Nothing mapped — surface the deterministic guidance.
  return { ...local, baseRevision: opts.projectRevision, selectionContext };
}
