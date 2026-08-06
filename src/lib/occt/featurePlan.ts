/**
 * featurePlan — translate a FeatureTree into an ordered OCCT command IR
 * (K1a of ADR-014). Pure + deterministic: the plan is unit-tested without the
 * 65 MB wasm; the executor (K1b) runs each command through `OcctBridge`,
 * threading result handles by id.
 *
 * Supported ops mirror the `OcctBridge` surface: extrude, revolve, boolean,
 * fillet, chamfer, and drilled/counterbore/countersink hole cuts. Other feature kinds
 * (sweep/loft/pattern/rib/sweep_path)
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
import type { HoleFeature } from '@/lib/cad/holeProfile';
import type { ShellFeature } from '@/lib/cad/shellProfile';
import { validateTree } from '@/lib/cad/featureTree';
import { emitContextForTree, resolveChildExtrude } from '@/lib/cad/upstreamResolve';

// ─── command IR ──────────────────────────────────────────────────────────

export type OcctCommand =
  | { op: 'extrude'; resultId: string; feature: ExtrudeFeature }
  | { op: 'revolve'; resultId: string; feature: RevolveFeature }
  | { op: 'boolean'; resultId: string; kind: 'union' | 'subtract' | 'intersect'; base: string; tools: string[] }
  | { op: 'fillet'; resultId: string; target: string; edgeIds: string[]; radius: number }
  | { op: 'chamfer'; resultId: string; target: string; edgeIds: string[]; distance: number }
  | { op: 'hole'; resultId: string; target: string; feature: HoleFeature }
  | { op: 'shell'; resultId: string; target: string; faceIds: string[]; thickness: number };

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
  /**
   * Fillet/chamfer nodes whose child body came from the embedded
   * `childExtrude` snapshot because the payload names no `childId`
   * (legacy tree). Their geometry does NOT follow upstream edits.
   *
   * Reported rather than silent: a ref-mode node absent from this list is
   * guaranteed to have been resolved against the live tree. An empty array
   * means the whole plan is parametric.
   */
  embeddedChildNodes: string[];
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
  const embeddedChildNodes: string[] = [];
  // Node ids consumed by a downstream feature are not the final result:
  // a boolean's bodies, and (W2-0) any body a fillet/chamfer references.
  const consumed = new Set<string>();
  // Payload-only context: fillet/chamfer need the upstream extrude's
  // parameters, never its rendered SCAD, so a static context suffices.
  const ctx = emitContextForTree(tree);

  /**
   * Resolve the body a fillet/chamfer operates on and return the resultId
   * the kernel should apply the edge op to.
   *
   * Ref mode targets the upstream node's OWN result — the extrude command
   * for it was already pushed, so re-extruding a snapshot copy would build
   * the same solid twice and, worse, from possibly stale parameters. The
   * upstream is then marked consumed so it cannot win `finalResultId`,
   * mirroring replayTree's consumption rule.
   *
   * Legacy mode (no `childId`) keeps the original synthetic `__body`
   * extrude, byte-identical to the pre-W2 plan.
   */
  function planChildBody(node: { id: string; payload: FeaturePayload }): string {
    const resolved = resolveChildExtrude(node.payload, node.id, ctx);
    if (!resolved) {
      throw new Error(
        `featureTreeToOcctPlan: '${node.payload.kind}' node ${node.id} has no child body ` +
          `(neither childId nor childExtrude)`,
      );
    }
    if (resolved.source === 'ref') {
      consumed.add(resolved.refId!);
      return resolved.refId!;
    }
    embeddedChildNodes.push(node.id);
    const bodyId = `${node.id}__body`;
    commands.push({ op: 'extrude', resultId: bodyId, feature: resolved.child });
    return bodyId;
  }

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
        const bodyId = planChildBody(node);
        commands.push({
          op: 'fillet',
          resultId: node.id,
          target: bodyId,
          edgeIds: f.edgeRefs?.length ? [...f.edgeRefs] : [`sel:${f.edgeSelection}`],
          radius: f.radius,
        });
        break;
      }
      case 'chamfer': {
        const c = p as ChamferFeature;
        const bodyId = planChildBody(node);
        commands.push({
          op: 'chamfer',
          resultId: node.id,
          target: bodyId,
          edgeIds: c.edgeRefs?.length ? [...c.edgeRefs] : [`sel:${c.edgeSelection}`],
          distance: c.distance,
        });
        break;
      }
      case 'hole': {
        const h = p as HoleFeature;
        const target = node.dependencies[0];
        if (!target) {
          unsupported.push({ resultId: node.id, kind: p.kind, reason: `hole ${node.id} requires its host body as the first dependency` });
          break;
        }
        consumed.add(target);
        commands.push({ op: 'hole', resultId: node.id, target, feature: h });
        break;
      }
      case 'shell': {
        const shell = p as ShellFeature;
        const faceIds = [
          ...(shell.openTopFace ? ['f.cap.top'] : []),
          ...(shell.openBottomFace ? ['f.cap.bottom'] : []),
        ];
        if (faceIds.length === 0) {
          unsupported.push({
            resultId: node.id,
            kind: p.kind,
            reason: `closed hollow shell ${node.id} remains on the exact SCAD subtraction path`,
          });
          break;
        }
        const target = planChildBody(node);
        commands.push({ op: 'shell', resultId: node.id, target, faceIds, thickness: shell.thickness });
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

  return { commands, finalResultId, unsupported, embeddedChildNodes };
}
