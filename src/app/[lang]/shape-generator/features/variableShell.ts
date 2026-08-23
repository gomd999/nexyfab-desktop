import type * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { applyExactMeshShell } from './shell';
import {
  hostBoxFromGeometry,
  isBboxFaithfulBox,
  occtBoxBooleanWithPrimitive,
  resolveBrepHostHandle,
} from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';
import { requireValidBrepResult } from './kernelOperationQuality';

export interface VariableShellParams {
  topThickness: number;
  sideThickness: number;
  bottomThickness: number;
  openFace: number;
}

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`VARIABLE_SHELL_INVALID_THICKNESS: ${label} must be finite and greater than 0`);
  }
}

/**
 * Exact bounded product path for an axis-aligned box. The public OCCT bridge
 * currently exposes primitive booleans, but not general per-face thickening;
 * consequently a non-box is refused rather than replaced by its bounding box.
 */
export function applyVariableShellExactBox(
  geometry: THREE.BufferGeometry,
  params: VariableShellParams,
): THREE.BufferGeometry {
  const { topThickness, sideThickness, bottomThickness } = params;
  const openFace = Math.round(params.openFace);
  requireFinitePositive(topThickness, 'top thickness');
  requireFinitePositive(sideThickness, 'side thickness');
  requireFinitePositive(bottomThickness, 'bottom thickness');
  if (!Number.isFinite(params.openFace) || openFace < 0 || openFace > 2) {
    throw new Error(`VARIABLE_SHELL_INVALID_OPEN_FACE: ${String(params.openFace)}`);
  }
  if (!isBboxFaithfulBox(geometry)) {
    throw new Error(
      'VARIABLE_SHELL_EXACT_BOX_REQUIRED: general per-face B-Rep thickening is unavailable',
    );
  }

  const host = hostBoxFromGeometry(geometry);
  const innerW = host.w - 2 * sideThickness;
  const innerD = host.d - 2 * sideThickness;
  const pad = 1;
  const innerMinY = openFace === 2
    ? host.cy - host.h / 2 - pad
    : host.cy - host.h / 2 + bottomThickness;
  const innerMaxY = openFace === 1
    ? host.cy + host.h / 2 + pad
    : host.cy + host.h / 2 - topThickness;
  const innerH = innerMaxY - innerMinY;
  if (!(innerW > 0 && innerH > 0 && innerD > 0)) {
    throw new Error(
      'VARIABLE_SHELL_THICKNESS_TOO_LARGE: requested walls leave no positive inner cavity',
    );
  }

  const upstreamHandle = resolveBrepHostHandle(geometry);
  const result = requireValidBrepResult(occtBoxBooleanWithPrimitive(
    'subtract',
    host,
    {
      shape: 'box',
      w: innerW,
      h: innerH,
      d: innerD,
      cx: host.cx,
      cy: (innerMinY + innerMaxY) / 2,
      cz: host.cz,
      rx: 0,
      ry: 0,
      rz: 0,
    },
    undefined,
    upstreamHandle,
  ));
  if (!result.handle) throw new Error('Variable shell kernel returned no registered B-Rep handle');
  result.geometry.userData = {
    ...(geometry.userData ?? {}),
    ...(result.geometry.userData ?? {}),
    occtHandle: result.handle,
  };
  return result.geometry;
}

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

    const out = applyExactMeshShell(
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
    return noteMeshFallback(out, { op: 'Variable Shell', featureId: ctx?.featureId });
  },
  async applyAsync(geometry, params, ctx) {
    const parsed: VariableShellParams = {
      topThickness: Math.max(0.05, params.topThickness),
      sideThickness: Math.max(0.05, params.sideThickness),
      bottomThickness: Math.max(0.05, params.bottomThickness),
      openFace: Math.round(params.openFace),
    };
    if (shouldUseOcctEngine()) {
      try {
        return applyVariableShellExactBox(geometry, parsed);
      } catch (error) {
        console.warn('[NEXYCAD] Exact variable shell unavailable; using marked mesh fallback.', error);
      }
    }
    const out = applyExactMeshShell(
      geometry,
      (normal) => {
        const absX = Math.abs(normal.x);
        const absY = Math.abs(normal.y);
        const absZ = Math.abs(normal.z);
        if (absY > absX && absY > absZ) {
          return normal.y > 0 ? parsed.topThickness : parsed.bottomThickness;
        }
        return parsed.sideThickness;
      },
      parsed.openFace,
      ctx,
    );
    return noteMeshFallback(out, { op: 'Variable Shell', featureId: ctx?.featureId });
  },
};
