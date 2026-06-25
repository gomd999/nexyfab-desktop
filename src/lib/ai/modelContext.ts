/**
 * modelContext — compact, JSON-serialisable summary of the current model that
 * the viewport AI sends to `/api/featureTree-intent` so the LLM can resolve
 * context-dependent commands ("make it taller", "remove the fillet",
 * "this face"). Without it the model is blind to what's on screen.
 *
 * Pure data + a prompt-rendering helper (no client/three imports) so both the
 * server route and the client builder can use it.
 */

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
  /** Base primitive id (e.g. "box", "cylinder") when one is set, else null. */
  baseShape?: string | null;
  /** Feature tree, oldest→newest. The last entry is "the last feature". */
  features: AiContextFeature[];
  /** Current face/edge selection, or null. */
  selection?: AiContextSelection | null;
}

/**
 * Render the context as a short prompt section. Returns '' when there's
 * nothing useful to say (keeps the prompt lean for first-shot creation).
 */
export function renderModelContext(ctx: AiModelContext | undefined | null): string {
  if (!ctx) return '';
  const lines: string[] = [];

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

  return lines.join('\n');
}
