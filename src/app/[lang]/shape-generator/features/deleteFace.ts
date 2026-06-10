/**
 * deleteFace — direct editing Phase 1 (SolidWorks-parity roadmap).
 *
 * Removes a selected face SET (boss / pocket / hole) from the solid and heals
 * the openings with planar caps. B-rep ONLY: there is no geometrically sound
 * mesh approximation of face healing (deleting triangles leaves a hole;
 * "filling" it without surface knowledge fabricates geometry), so when OCCT is
 * unavailable the feature fails with a clear error on the tree node instead of
 * shipping silently-wrong geometry.
 *
 * OCCT route (occtDeleteFaces): sew-and-cap defeaturing — BRepAlgoAPI_Defeaturing
 * is NOT bound in the shipped WASM, so the supported scope is face sets whose
 * opening is an interior loop on the remaining faces (the boss/pocket/hole
 * cases). Out-of-scope selections throw structured errors explaining why.
 *
 * Imported bodies: meshes without an upstream occtHandle are bridged through
 * importSTL + UnifySameDomain (meshToSimplifiedBrepHandle), which gives real
 * planar face topology for prismatic imports — the STEP-defeaturing use case.
 */
import type { FeatureDefinition } from './types';
import {
  occtDeleteFaces,
  meshToSimplifiedBrepHandle,
  isOcctReady,
} from './occtEngine';

export const deleteFaceFeature: FeatureDefinition = {
  type: 'deleteFace',
  icon: '🧹',
  // No numeric params — the operation is fully defined by the face selection
  // stored on the node (faceSelections).
  params: [],
  apply() {
    // Sync/mesh pipeline → honest refusal (policy: never silently wrong geometry).
    throw new Error(
      'Delete Face requires the precise B-rep (OCCT) engine — enable OCCT mode and rebuild. '
      + 'A mesh approximation of face healing would produce wrong geometry, so none is offered.',
    );
  },
  async applyAsync(geometry, _params, ctx) {
    const sels = ctx?.faceSelections;
    if (!sels || sels.length === 0) {
      throw new Error('Delete Face: no face selected — pick the face(s) of the boss, pocket, or hole to remove, then add the feature.');
    }
    if (!isOcctReady()) {
      throw new Error('Delete Face requires the precise B-rep (OCCT) engine — enable OCCT mode and rebuild.');
    }
    let handle = (geometry.userData?.occtHandle as string | undefined) ?? null;
    if (!handle) {
      // Imported / mesh-only body → bridge to a simplified B-rep.
      handle = await meshToSimplifiedBrepHandle(geometry);
    }
    if (!handle) {
      throw new Error('Delete Face: this body has no B-rep and could not be converted (non-manifold mesh?) — repair the mesh or rebuild the body with OCCT mode on.');
    }
    const result = occtDeleteFaces(
      handle,
      sels.map(s => ({ position: s.position, normal: s.normal })),
    );
    if (!result.handle) {
      throw new Error('Delete Face: healing failed on this body.');
    }
    result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  },
};
