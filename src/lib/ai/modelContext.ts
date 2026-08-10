/**
 * modelContext — compact, JSON-serialisable summary of the current model that
 * the viewport AI sends to `/api/featureTree-intent` so the LLM can resolve
 * context-dependent commands ("make it taller", "remove the fillet",
 * "this face"). Without it the model is blind to what's on screen.
 *
 * Pure data + a prompt-rendering helper (no client/three imports) so both the
 * server route and the client builder can use it.
 */

import type { SelectionContext } from './selectionContext';
import type { DesignDomainId, UserExperienceLevel } from './domainProfile';

export interface AiContextFeature {
  /** Stable feature id (used by update/remove intents to target it). */
  id: string;
  /** FeatureType registry key. */
  type: string;
  /** Primary numeric params (compact — caller may trim to the notable ones). */
  params?: Record<string, number>;
}

export interface AiContextSelection {
  kind: 'face' | 'edge' | 'multi';
  /** Human label, e.g. "+Y Top", "edge", "3 faces". */
  label?: string;
}

export interface AiModelContext {
  /** Active discipline and UX contract selected in the shared workspace bar. */
  domainWorkspace?: {
    domain: DesignDomainId;
    experience: UserExperienceLevel;
  };
  /** Base primitive id (e.g. "box", "cylinder") when one is set, else null. */
  baseShape?: string | null;
  /** Feature tree, oldest→newest. The last entry is "the last feature". */
  features: AiContextFeature[];
  /** Current face/edge selection, or null. */
  selection?: AiContextSelection | null;
  /** Manufacturing-grade target identity used for safe, revision-bound edits. */
  selectionContext?: SelectionContext | null;
}

/**
 * Render the context as a short prompt section. Returns '' when there's
 * nothing useful to say (keeps the prompt lean for first-shot creation).
 */
export function renderModelContext(ctx: AiModelContext | undefined | null): string {
  if (!ctx) return '';
  const lines: string[] = [];

  if (ctx.domainWorkspace) {
    const { domain, experience } = ctx.domainWorkspace;
    lines.push(`Design domain: ${domain}. User workflow: ${experience}.`);
    lines.push(`Use ${domain}-specific objects, units, terminology, and validation; do not silently reinterpret the request as mechanical CAD.`);
  }

  if (ctx.baseShape) {
    lines.push(`Base shape: ${ctx.baseShape}`);
  }

  if (ctx.features.length === 0) {
    lines.push('Feature tree: (empty — no features yet)');
  } else {
    lines.push('Feature tree (oldest→newest; the LAST line is "the last feature"):');
    ctx.features.forEach((f, i) => {
      const p = f.params && Object.keys(f.params).length
        ? ' ' + Object.entries(f.params).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      lines.push(`  ${i + 1}. ${f.type}${p}  [id=${f.id}]`);
    });
  }

  if (ctx.selection) {
    const lbl = ctx.selection.label ? ` (${ctx.selection.label})` : '';
    lines.push(`Current selection: a ${ctx.selection.kind}${lbl} is selected — "this face/edge" refers to it.`);
  } else {
    lines.push('Current selection: none.');
  }

  if (ctx.selectionContext) {
    const s = ctx.selectionContext;
    lines.push(`Selection revision: ${s.projectRevision}; units=${s.units}; frame=${s.coordinateFrame}.`);
    if (s.partInstanceId) lines.push(`Selected part instance: ${s.partInstanceId}.`);
    if (s.bodyId) lines.push(`Selected body: ${s.bodyId}.`);
    if (s.featureId) lines.push(`Selected feature: ${s.featureId}.`);
    for (const ref of s.topology) {
      const role = ref.semanticRole ? `; role=${ref.semanticRole}` : '';
      lines.push(`Topology target: ${ref.kind}; ref=${ref.persistentRef}; quality=${ref.referenceQuality}${role}.`);
    }
  }

  return lines.join('\n');
}
