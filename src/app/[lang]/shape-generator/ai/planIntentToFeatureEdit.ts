/**
 * planIntentToFeatureEdit — map the LLM/regex PlanIntent (from
 * /api/featureTree-intent) onto in-context FeatureEditIntent[] for the viewport
 * AI prompt.
 *
 * The deterministic parser (nlFeatureEditParser) covers the common direct
 * commands. When it misses, the AI shell escalates to the featureTree-intent
 * endpoint, which returns a richer PlanIntent (regex- or LLM-derived). This pure
 * mapper turns those intents into edits the dispatcher can apply:
 *   - create_* → set the base shape (+ stack the requested fillet/holes/…)
 *   - add_*    → add a feature (selection-aware: offset/draft a picked face,
 *                fillet/chamfer a picked edge)
 *   - update_last_param / remove_last → resolved against the live feature tree
 *     (the last feature) via the passed-in context
 */

import type { FeatureEditIntent } from './featureEditDispatcher';
import type { FeatureType } from '../features/types';
import type { ElementSelectionInfo } from '../editing/selectionInfo';
import type { SketchProfile, SketchConfig } from '../sketch/types';
import { selectionToArrays } from './nlFeatureEditParser';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';
import { FACE_SELECTION_CONSUMERS, EDGE_SELECTION_CONSUMERS } from '@/lib/ai/addableFeatureTypes';

export interface MappedPlan {
  intents: FeatureEditIntent[];
  explanation: string;
}

/** Live model context the mapper needs to resolve "the last feature" + selection. */
export interface MapperContext {
  features?: ReadonlyArray<{ id: string; type: string }>;
  selection?: ElementSelectionInfo | null;
}

/** Build an add intent for a feature, attaching the active selection when the
 *  feature consumes one (offset/draft a face, fillet/chamfer an edge). */
function addFeature(
  featureType: FeatureType,
  params: Record<string, number>,
  selection: ElementSelectionInfo | null | undefined,
): FeatureEditIntent {
  const { faces, edges } = selectionToArrays(selection);
  if (FACE_SELECTION_CONSUMERS.includes(featureType) && faces.length > 0) {
    return { kind: 'add_feature_on_selection', featureType, params, faceSelections: faces };
  }
  if (EDGE_SELECTION_CONSUMERS.includes(featureType) && edges.length > 0) {
    return { kind: 'add_feature_on_selection', featureType, params, edgeSelections: edges };
  }
  return { kind: 'add_feature', featureType, params };
}

/** Map a PlanIntent to in-context feature edits (empty when not applicable). */
export function planIntentToFeatureEdits(
  intent: PlanIntent | null,
  context: MapperContext = {},
): MappedPlan {
  if (!intent) return { intents: [], explanation: '' };
  const sel = context.selection;
  const features = context.features ?? [];
  const last = features.length > 0 ? features[features.length - 1] : undefined;

  switch (intent.kind) {
    case 'add_fillet_to_last':
      return {
        intents: [addFeature('fillet', { radius: intent.radius }, sel)],
        explanation: `Added a fillet (radius ${intent.radius}mm).`,
      };
    case 'add_chamfer_to_last':
      return {
        intents: [addFeature('chamfer', { distance: intent.distance }, sel)],
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
    case 'add_feature_to_last':
      // Generic feature add — the LLM picked a feature type from the allowlist.
      // featureType is validated server-side against ADDABLE_FEATURE_TYPES, so
      // the cast is safe. Selection-consuming features attach the live selection.
      return {
        intents: [addFeature(intent.featureType as FeatureType, intent.params, sel)],
        explanation: `Added a ${intent.featureType}.`,
      };

    // ── Context-aware edits ────────────────────────────────────────────────
    case 'update_last_param': {
      if (!last) return { intents: [], explanation: 'There is no feature to update.' };
      return {
        intents: [{ kind: 'update_param', featureId: last.id, paramKey: intent.paramKey, value: intent.value }],
        explanation: `Set the ${last.type}'s ${intent.paramKey} to ${intent.value}.`,
      };
    }
    case 'remove_last': {
      if (!last) return { intents: [], explanation: 'There is no feature to remove.' };
      return {
        intents: [{ kind: 'remove_feature', featureId: last.id }],
        explanation: `Removed the ${last.type} feature.`,
      };
    }

    // ── Free-form custom outline → extruded solid ──────────────────────────
    case 'create_sketch_extrude': {
      const pts = intent.profile;
      // Closed polygon: one line segment per edge, last point back to the first.
      const profile: SketchProfile = {
        segments: pts.map((p, i) => ({
          type: 'line' as const,
          points: [{ x: p.x, y: p.y }, { x: pts[(i + 1) % pts.length]!.x, y: pts[(i + 1) % pts.length]!.y }],
        })),
        closed: true,
      };
      const config: SketchConfig = {
        mode: 'extrude',
        depth: intent.depth,
        revolveAngle: 360,
        revolveAxis: 'y',
        segments: 32,
      };
      return {
        intents: [{
          kind: 'add_sketch_extrude',
          sketchData: { profile, config, plane: intent.plane ?? 'xy', operation: intent.operation ?? 'add', planeOffset: 0 },
        }],
        explanation: `Created a custom ${pts.length}-sided profile extruded ${intent.depth}mm.`,
      };
    }

    // ── Heterogeneous assembly: several different parts, positioned ────────
    case 'assemble_parts': {
      return {
        intents: [{ kind: 'set_assembly_parts', parts: intent.parts }],
        explanation: `Assembled ${intent.parts.length} parts: ${intent.parts.map((p) => p.name || p.shapeId).join(', ')}.`,
      };
    }

    // ── Multi-step: base primitive + an ordered list of features ───────────
    case 'build_part': {
      const intents: FeatureEditIntent[] = [
        { kind: 'set_base_shape', shapeId: intent.base.shapeId, params: intent.base.params },
        ...intent.features.map((f): FeatureEditIntent => ({
          kind: 'add_feature', featureType: f.type as FeatureType, params: f.params,
        })),
      ];
      return {
        intents,
        explanation: `Built a ${intent.base.shapeId} with ${intent.features.length} feature(s): ${intent.features.map((f) => f.type).join(', ') || 'none'}.`,
      };
    }

    // ── Base-shape creation (+ stack the requested follow-on features) ──────
    case 'create_box_with_holes': {
      const intents: FeatureEditIntent[] = [boxBase(intent.size)];
      for (const h of intent.holes) {
        if (Number.isFinite(h.diameter) && h.diameter > 0) {
          intents.push({ kind: 'add_feature', featureType: 'hole', params: { diameter: h.diameter, posX: h.x, posZ: h.y } });
        }
      }
      return { intents, explanation: `Created a ${dims(intent.size)} box with ${intent.holes.length} hole(s).` };
    }
    case 'create_box_with_fillet':
      return {
        intents: [boxBase(intent.size), { kind: 'add_feature', featureType: 'fillet', params: { radius: intent.filletRadius } }],
        explanation: `Created a ${dims(intent.size)} box with a ${intent.filletRadius}mm fillet.`,
      };
    case 'create_box_with_chamfer':
      return {
        intents: [boxBase(intent.size), { kind: 'add_feature', featureType: 'chamfer', params: { distance: intent.chamferDistance } }],
        explanation: `Created a ${dims(intent.size)} box with a ${intent.chamferDistance}mm chamfer.`,
      };
    case 'create_box_with_pocket':
      return {
        intents: [boxBase(intent.size), { kind: 'add_feature', featureType: 'hole', params: { diameter: intent.pocketRadius * 2, depth: intent.pocketDepth } }],
        explanation: `Created a ${dims(intent.size)} box with a pocket.`,
      };
    case 'create_cylinder':
      return {
        intents: [cylinderBase(intent.radius, intent.height)],
        explanation: `Created a cylinder Ø${intent.radius * 2}×${intent.height}mm.`,
      };
    case 'create_cylinder_with_hole':
      return {
        intents: [cylinderBase(intent.radius, intent.height, intent.holeRadius * 2)],
        explanation: `Created a tube Ø${intent.radius * 2}/Ø${intent.holeRadius * 2}×${intent.height}mm.`,
      };

    default:
      // create_assembly_stack / create_pattern_grid / create_revolve_axis build
      // richer scenes the shape picker / dedicated tools own — out of scope here.
      return { intents: [], explanation: '' };
  }
}

function boxBase(size: { x: number; y: number; z: number }): FeatureEditIntent {
  return { kind: 'set_base_shape', shapeId: 'box', params: { width: size.x, height: size.y, depth: size.z } };
}
function cylinderBase(radius: number, height: number, innerDiameter = 0): FeatureEditIntent {
  return { kind: 'set_base_shape', shapeId: 'cylinder', params: { diameter: radius * 2, height, innerDiameter } };
}
function dims(s: { x: number; y: number; z: number }): string {
  return `${s.x}×${s.y}×${s.z}`;
}
