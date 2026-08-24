import type { FeatureExecutionRuntime } from '@/lib/cad/featureRegistryDecision';
import type { OcctBridge } from './bridge';
import { createNodeOcctBridge } from './nodeOcctBridge';
import { loadOcctNode, type OcctModule } from './nodeOcctLoader';
import type { NodeOcctRuntimeIdentity } from './nodeOcctRuntimeIdentity';

export type NodeOcctCommercialRuntimeResult =
  | {
      ok: true;
      oc: OcctModule;
      bridge: OcctBridge;
      identity: NodeOcctRuntimeIdentity;
      capabilities: FeatureExecutionRuntime;
    }
  | { ok: false; reason: string };

function capabilities(identity: NodeOcctRuntimeIdentity, bridge: OcctBridge): FeatureExecutionRuntime {
  const handlers: string[] = [];
  if (typeof bridge.buildPlanarFace === 'function' && typeof bridge.buildPlanarFaceOriented === 'function'
    && typeof bridge.inspectShapeDetailed === 'function' && typeof bridge.exportSTEP === 'function'
    && typeof bridge.importSTEP === 'function') handlers.push('occt.sketch.convex-line-loop-planar-face');
  if (typeof bridge.buildFromExtrude === 'function') handlers.push('occt.sketchExtrude');
  if (typeof bridge.buildFromRevolve === 'function') handlers.push('occt.revolve');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.boolean?.subtract === 'function') handlers.push('occt.hole');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.boolean?.subtract === 'function') handlers.push('occt.cut.through-rect');
  if (typeof bridge.fillet === 'function') handlers.push('occt.fillet');
  if (typeof bridge.chamfer === 'function') handlers.push('occt.chamfer');
  if (typeof bridge.variableFillet === 'function') handlers.push('occt.variableFillet');
  if (typeof bridge.draft === 'function') handlers.push('occt.draft');
  if (typeof bridge.uniformScale === 'function') handlers.push('occt.scale.uniform');
  if (typeof bridge.translate === 'function') handlers.push('occt.move-copy.translation');
  if (typeof bridge.mirror === 'function') handlers.push('occt.mirror.plane');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.boolean?.union === 'function') handlers.push('occt.rib.single');
  if (typeof bridge.translate === 'function' && typeof bridge.boolean?.union === 'function') handlers.push('occt.linear-pattern.connected-fused');
  if (typeof bridge.rotate === 'function' && typeof bridge.boolean?.union === 'function') handlers.push('occt.circular-pattern.connected-fused');
  if (typeof bridge.buildLoftSections === 'function') handlers.push('occt.loft.ruled-convex');
  if (typeof bridge.buildOrthogonalPolylineSweep === 'function') handlers.push('occt.sweep.orthogonal-polyline-rect');
  if (typeof bridge.buildOrthogonalPolylineSweep === 'function') handlers.push('occt.sweep-path.orthogonal-polyline-rect.v1');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.boolean?.intersect === 'function') handlers.push('occt.split-body.keep-side-axis-plane');
  if (typeof bridge.buildCylinderAt === 'function' && typeof bridge.boolean?.subtract === 'function'
    && typeof bridge.deleteBlindHoleFacesAndCap === 'function') handlers.push('occt.delete-face.blind-hole-cap');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.buildSingleRectangularSheetBend === 'function') handlers.push('occt.bend.single-rectangular-sheet');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.buildSingleRectangularSheetBend === 'function') handlers.push('occt.flange.single-positive-end');
  if (typeof bridge.buildPlanarFace === 'function' && typeof bridge.inspectShapeDetailed === 'function'
    && typeof bridge.exportSTEP === 'function' && typeof bridge.importSTEP === 'function') handlers.push('occt.flat-pattern.single-bend-step-dxf');
  if (typeof bridge.buildPrismAt === 'function' && typeof bridge.makeCompound === 'function'
    && typeof bridge.inspectShapeDetailed === 'function' && typeof bridge.exportSTEP === 'function'
    && typeof bridge.importSTEP === 'function') handlers.push('occt.weldment.two-member-corner-cut-list');
  if (typeof bridge.buildFromExtrude === 'function' && typeof bridge.listFaceRefs === 'function'
    && typeof bridge.pushPullFace === 'function') handlers.push('occt.offset-face.top');
  if (typeof bridge.buildCylinderAt === 'function' && typeof bridge.buildThreadHelixCutter === 'function'
    && typeof bridge.boolean?.subtract === 'function') handlers.push('occt.thread.cylindrical');
  if (typeof bridge.solidShell === 'function') handlers.push('occt.shell.open');
  if (typeof bridge.boolean?.union === 'function') handlers.push('occt.boolean.union');
  if (typeof bridge.boolean?.subtract === 'function') handlers.push('occt.boolean.subtract');
  if (typeof bridge.boolean?.intersect === 'function') handlers.push('occt.boolean.intersect');
  const verifiers: string[] = [];
  if (typeof bridge.inspectShapeDetailed === 'function') verifiers.push('part-exact-brep');
  if (typeof bridge.exportSTEP === 'function' && typeof bridge.importSTEP === 'function'
    && typeof bridge.inspectShapeDetailed === 'function') verifiers.push('part-step-roundtrip');
  return Object.freeze({
    executor: 'REAL_OCCT',
    identitySha256: identity.runtimeIdentitySha256,
    stubFallback: false,
    handlerIds: Object.freeze(handlers),
    verifierIds: Object.freeze(verifiers),
  });
}

/**
 * Server-only trusted construction path. Request data cannot provide or
 * override runtime identity, handler capabilities, or verifier capabilities.
 */
export async function loadNodeOcctCommercialRuntime(): Promise<NodeOcctCommercialRuntimeResult> {
  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc || !loaded.identity) {
    return { ok: false, reason: `OCCT_NODE_UNAVAILABLE:${loaded.reason ?? 'identity_missing'}` };
  }
  try {
    const bridge = createNodeOcctBridge(loaded.oc);
    return {
      ok: true,
      oc: loaded.oc,
      bridge,
      identity: loaded.identity,
      capabilities: capabilities(loaded.identity, bridge),
    };
  } catch (error) {
    return { ok: false, reason: `OCCT_BRIDGE_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}` };
  }
}
