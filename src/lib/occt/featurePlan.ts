/**
 * featurePlan — translate a FeatureTree into an ordered OCCT command IR
 * (K1a of ADR-014). Pure + deterministic: the plan is unit-tested without the
 * 65 MB wasm; the executor (K1b) runs each command through `OcctBridge`,
 * threading result handles by id.
 *
 * Supported ops mirror the `OcctBridge` surface: extrude, revolve, boolean,
 * fillet, chamfer. Other feature kinds (sweep/loft/pattern/hole/rib/sweep_path)
 * have no direct kernel primitive yet and are emitted as `unsupported` so the
 * caller can fall back to the SCAD path for those nodes.
 *
 * Edge selection: fillet/chamfer carry a symbolic selector (the feature's
 * edgeSelection) — real edge ids require K2 stable topological naming and are
 * resolved at execution time, not here.
 */

import type { FeatureTree, FeaturePayload } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { BooleanFeature } from '@/lib/cad/booleanFeature';
import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { ChamferFeature } from '@/lib/cad/chamferProfile';
import { validateTree } from '@/lib/cad/featureTree';

// ─── command IR ──────────────────────────────────────────────────────────

export type OcctCommand =
  | { op: 'extrude'; resultId: string; feature: ExtrudeFeature }
  | { op: 'revolve'; resultId: string; feature: RevolveFeature }
  | { op: 'boolean'; resultId: string; kind: 'union' | 'subtract' | 'intersect'; base: string; tools: string[] }
  | { op: 'fillet'; resultId: string; target: string; edgeIds: string[]; radius: number }
  | { op: 'chamfer'; resultId: string; target: string; edgeIds: string[]; distance: number };

export interface UnsupportedNode {
  resultId: string;
  kind: string;
  reason: string;
}

export interface OcctPlan {
  /** Ordered commands; later commands reference earlier `resultId`s. */
  commands: OcctCommand[];
  /** The node id whose result is the assembly's final solid, or null. */
  finalResultId: string | null;
  /** Nodes the OCCT path can't build yet (caller should SCAD-fallback these). */
  unsupported: UnsupportedNode[];
}

const BOOLEAN_KIND: Record<BooleanFeature['op'], 'union' | 'subtract' | 'intersect'> = {
  union: 'union',
  difference: 'subtract',
  intersection: 'intersect',
};

/**
 * Build the OCCT command plan for a feature tree. Throws (via validateTree) on
 * a structurally invalid tree.
 */
export function featureTreeToOcctPlan(tree: FeatureTree): OcctPlan {
  validateTree(tree);
  const commands: OcctCommand[] = [];
  const unsupported: UnsupportedNode[] = [];
  // Node ids consumed as a boolean's bodies are not the final result.
  const consumed = new Set<string>();

  for (const node of tree.nodes) {
    const p: FeaturePayload = node.payload;
    switch (p.kind) {
      case 'extrude':
        commands.push({ op: 'extrude', resultId: node.id, feature: p as ExtrudeFeature });
        break;
      case 'revolve':
        commands.push({ op: 'revolve', resultId: node.id, feature: p as RevolveFeature });
        break;
      case 'boolean': {
        const b = p as BooleanFeature;
        for (const id of b.bodies) consumed.add(id);
        commands.push({
          op: 'boolean',
          resultId: node.id,
          kind: BOOLEAN_KIND[b.op],
          base: b.bodies[0],
          tools: b.bodies.slice(1),
        });
        break;
      }
      case 'fillet': {
        const f = p as FilletFeature;
        // Fillet carries its body inline (childExtrude) → build it first.
        const bodyId = `${node.id}__body`;
        commands.push({ op: 'extrude', resultId: bodyId, feature: f.childExtrude });
        commands.push({
          op: 'fillet',
          resultId: node.id,
          target: bodyId,
          edgeIds: [`sel:${f.edgeSelection}`],
          radius: f.radius,
        });
        break;
      }
      case 'chamfer': {
        const c = p as ChamferFeature;
        const bodyId = `${node.id}__body`;
        commands.push({ op: 'extrude', resultId: bodyId, feature: c.childExtrude });
        commands.push({
          op: 'chamfer',
          resultId: node.id,
          target: bodyId,
          edgeIds: [`sel:${c.edgeSelection}`],
          distance: c.distance,
        });
        break;
      }
      default:
        unsupported.push({
          resultId: node.id,
          kind: p.kind,
          reason: `OCCT path has no primitive for '${p.kind}' yet — use the SCAD fallback`,
        });
        break;
    }
  }

  // Final result = last tree node that produced a command and isn't consumed
  // by a later boolean. (Unsupported nodes don't produce an OCCT result.)
  const produced = new Set(commands.map((c) => c.resultId));
  let finalResultId: string | null = null;
  for (const node of tree.nodes) {
    if (produced.has(node.id) && !consumed.has(node.id)) finalResultId = node.id;
  }

  return { commands, finalResultId, unsupported };
}
