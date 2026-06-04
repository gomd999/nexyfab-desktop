/**
 * planIntentToFeatureEdit — map the LLM/regex PlanIntent (from
 * /api/featureTree-intent) onto in-context FeatureEditIntent[] for the viewport
 * AI prompt.
 *
 * The deterministic parser (nlFeatureEditParser) covers the common direct
 * commands. When it misses, the AI shell escalates to the featureTree-intent
 * endpoint, which returns a richer PlanIntent (regex- or LLM-derived). This pure
 * mapper turns the "edit the current part" subset of those intents into feature
 * adds the dispatcher can apply. PlanIntent kinds that CREATE a whole new base
 * shape (create_box_*, create_cylinder, …) are out of scope for an in-context
 * edit and map to [] — the shape picker owns base-shape creation.
 */

import type { FeatureEditIntent } from './featureEditDispatcher';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';

export interface MappedPlan {
  intents: FeatureEditIntent[];
  explanation: string;
}

/** Map a PlanIntent to in-context feature edits (empty when not applicable). */
export function planIntentToFeatureEdits(intent: PlanIntent | null): MappedPlan {
  if (!intent) return { intents: [], explanation: '' };

  switch (intent.kind) {
    case 'add_fillet_to_last':
      return {
        intents: [{ kind: 'add_feature', featureType: 'fillet', params: { radius: intent.radius } }],
        explanation: `Added a fillet (radius ${intent.radius}mm).`,
      };
    case 'add_chamfer_to_last':
      return {
        intents: [{ kind: 'add_feature', featureType: 'chamfer', params: { distance: intent.distance } }],
        explanation: `Added a chamfer (distance ${intent.distance}mm).`,
      };
    case 'add_pattern_to_last': {
      if (intent.patternKind === 'circular') {
        const params: Record<string, number> = { count: intent.count };
        if (typeof intent.angle === 'number') params.totalAngle = intent.angle;
        return {
          intents: [{ kind: 'add_feature', featureType: 'circularPattern', params }],
          explanation: `Added a circular pattern (${intent.count}×).`,
        };
      }
      const params: Record<string, number> = { count: intent.count };
      if (typeof intent.spacing === 'number') params.spacing = intent.spacing;
      return {
        intents: [{ kind: 'add_feature', featureType: 'linearPattern', params }],
        explanation: `Added a linear pattern (${intent.count}×).`,
      };
    }
    default:
      // create_* kinds build a fresh base shape — not an in-context feature edit.
      return { intents: [], explanation: '' };
  }
}
