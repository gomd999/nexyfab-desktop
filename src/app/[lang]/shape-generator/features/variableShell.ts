import type { FeatureDefinition } from './types';
import { applyExactMeshShell } from './shell';

/**
 * K5 — Variable shell (per-direction thickness).
 *
 * Standard shell.ts applies a single uniform wall thickness everywhere. Real
 * injection-moulded parts use different thicknesses per direction — top/
 * bottom/side.
 *
 * W5-C: rebuilt on the exact planar-convex mesh-shell core (shell.ts —
 * applyExactMeshShell). Each FACE PLANE gets its thickness from the dominant
 * axis of the plane normal (Y-dominant → top/bottom thickness, else side),
 * and the inner cavity is solved as the intersection of the per-plane offset
 * planes — exact walls per face instead of the old vertex-normal offset
 * (which produced a non-solid inner "surface" and garbage CSG output).
 *
 * Support scope and refusals are the same as shell.ts's mesh path: convex
 * planar-faced polyhedra with ≤ 3 distinct planes per vertex; out-of-scope
 * bodies are refused with a typed SHELL_UNSUPPORTED_* reason.
 */
export const variableShellFeature: FeatureDefinition = {
  type: 'variableShell',
  icon: '🥚',
  params: [
    { key: 'topThickness',    labelKey: 'paramVarShellTop',    default: 2, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    { key: 'sideThickness',   labelKey: 'paramVarShellSide',   default: 1.5, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    { key: 'bottomThickness', labelKey: 'paramVarShellBottom', default: 3, min: 0.3, max: 50, step: 0.5, unit: 'mm' },
    {
      key: 'openFace',
      labelKey: 'paramShellOpenFace',
      default: 1,
      min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'openFaceNone' },
        { value: 1, labelKey: 'openFaceTop' },
        { value: 2, labelKey: 'openFaceBottom' },
      ],
    },
  ],
  apply(geometry, params, ctx) {
    const topT = Math.max(0.05, params.topThickness);
    const sideT = Math.max(0.05, params.sideThickness);
    const botT = Math.max(0.05, params.bottomThickness);
    const openFace = Math.round(params.openFace);

    return applyExactMeshShell(
      geometry,
      (n) => {
        const absX = Math.abs(n.x);
        const absY = Math.abs(n.y);
        const absZ = Math.abs(n.z);
        if (absY > absX && absY > absZ) return n.y > 0 ? topT : botT;
        return sideT;
      },
      openFace,
      ctx,
    );
  },
};
