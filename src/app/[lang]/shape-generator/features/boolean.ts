import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, OcctNotReadyError, hostBoxFromGeometry } from './occtEngine';

// ─── Internal helpers ───────────────────────────────────────────────────────

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

function getCSGOperation(type: 'union' | 'subtract' | 'intersect'): number {
  switch (type) {
    case 'subtract':
      return SUBTRACTION;
    case 'intersect':
      return INTERSECTION;
    default:
      return ADDITION;
  }
}

function operationCodeToType(code: number): 'union' | 'subtract' | 'intersect' {
  switch (code) {
    case 1:
      return 'subtract';
    case 2:
      return 'intersect';
    default:
      return 'union';
  }
}

function buildToolGeometry(params: Record<string, number>): THREE.BufferGeometry {
  const toolShape = Math.round(params.toolShape);
  const { toolWidth, toolHeight, toolDepth, posX, posY, posZ, rotX, rotY, rotZ } = params;

  let toolGeo: THREE.BufferGeometry;
  switch (toolShape) {
    case 1: // Cylinder
      toolGeo = new THREE.CylinderGeometry(toolWidth / 2, toolWidth / 2, toolHeight, 32);
      break;
    case 2: // Sphere
      toolGeo = new THREE.SphereGeometry(toolWidth / 2, 32, 24);
      break;
    default: // Box
      toolGeo = new THREE.BoxGeometry(toolWidth, toolHeight, toolDepth);
      break;
  }

  const euler = new THREE.Euler(
    (rotX * Math.PI) / 180,
    (rotY * Math.PI) / 180,
    (rotZ * Math.PI) / 180,
  );
  const mat4 = new THREE.Matrix4().makeRotationFromEuler(euler);
  mat4.setPosition(posX, posY, posZ);
  toolGeo.applyMatrix4(mat4);

  return toolGeo;
}

// ─── Synchronous CSG (used both as feature apply and as worker fallback) ────

/**
 * Perform a CSG boolean on two arbitrary BufferGeometry objects synchronously
 * on the current thread. Exported so the Web Worker hook can use it as a
 * fallback when the worker is unavailable.
 */
export interface BooleanSyncResult {
  geometry: THREE.BufferGeometry | null;
  error: string | null;
}

/**
 * Throws on failure so the pipeline can capture the error on the FeatureInstance
 * and surface it in the UI. Callers that need a silent fallback should wrap
 * this in their own try/catch.
 */
export function applyBooleanSync(
  type: 'union' | 'subtract' | 'intersect',
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const evaluator = new Evaluator();
  const brushA = makeBrush(geoA);
  const brushB = makeBrush(geoB);
  const result: Brush = evaluator.evaluate(brushA, brushB, getCSGOperation(type));
  if (
    !result.geometry ||
    !result.geometry.attributes.position ||
    result.geometry.attributes.position.count === 0
  ) {
    throw new Error(`Boolean ${type}: empty result — 도구와 본체가 교차하지 않거나 일치합니다`);
  }
  return result.geometry;
}

export function applyBooleanSyncSafe(
  type: 'union' | 'subtract' | 'intersect',
  geoA: THREE.BufferGeometry,
  geoB: THREE.BufferGeometry,
): BooleanSyncResult {
  try {
    const evaluator = new Evaluator();
    const brushA = makeBrush(geoA);
    const brushB = makeBrush(geoB);
    const result: Brush = evaluator.evaluate(brushA, brushB, getCSGOperation(type));
    if (
      !result.geometry ||
      !result.geometry.attributes.position ||
      result.geometry.attributes.position.count === 0
    ) {
      return {
        geometry: null,
        error: 'Boolean operation produced no geometry — meshes may not intersect',
      };
    }
    return { geometry: result.geometry, error: null };
  } catch (err) {
    return {
      geometry: null,
      error: `Boolean ${type} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }
}

// ─── Async CSG (delegates to Web Worker when possible) ──────────────────────

/**
 * Perform a CSG boolean off the main thread via a Web Worker.
 *
 * Accepts a `performCSG` function (from `useCsgWorker`) so this module stays
 * framework-agnostic and testable. Falls back to synchronous execution when
 * `workerPerformCSG` is not provided.
 */
export async function applyBooleanAsync(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  workerPerformCSG?: (
    type: 'union' | 'subtract' | 'intersect',
    geoA: THREE.BufferGeometry,
    geoB: THREE.BufferGeometry,
  ) => Promise<THREE.BufferGeometry>,
): Promise<THREE.BufferGeometry> {
  const operation = Math.round(params.operation);
  const type = operationCodeToType(operation);
  const toolGeo = buildToolGeometry(params);

  if (workerPerformCSG) {
    const result = await workerPerformCSG(type, geometry, toolGeo);
    if (!result || !result.attributes.position || result.attributes.position.count === 0) {
      throw new Error(`Boolean ${type}: empty result from worker — 교차 없음 또는 non-manifold 입력`);
    }
    return result;
  }
  return applyBooleanSync(type, geometry, toolGeo);
}

// ─── Feature definition (synchronous, for the pipeline) ─────────────────────

export const booleanFeature: FeatureDefinition = {
  type: 'boolean',
  icon: '🔲',
  params: [
    {
      key: 'operation',
      labelKey: 'paramOperation',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumUnion' },
        { value: 1, labelKey: 'enumSubtract' },
        { value: 2, labelKey: 'enumIntersect' },
      ],
    },
    {
      key: 'toolShape',
      labelKey: 'paramToolShape',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumToolBox' },
        { value: 1, labelKey: 'enumToolCylinder' },
        { value: 2, labelKey: 'enumToolSphere' },
      ],
    },
    { key: 'toolWidth', labelKey: 'paramToolWidth', default: 50, min: 5, max: 500, step: 1, unit: 'mm' },
    { key: 'toolHeight', labelKey: 'paramToolHeight', default: 50, min: 5, max: 500, step: 1, unit: 'mm' },
    { key: 'toolDepth', labelKey: 'paramToolDepth', default: 50, min: 5, max: 500, step: 1, unit: 'mm' },
    { key: 'posX', labelKey: 'paramPosX', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'posY', labelKey: 'paramPosY', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'posZ', labelKey: 'paramPosZ', default: 0, min: -500, max: 500, step: 1, unit: 'mm' },
    { key: 'rotX', labelKey: 'paramRotX', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    { key: 'rotY', labelKey: 'paramRotY', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    { key: 'rotZ', labelKey: 'paramRotZ', default: 0, min: -180, max: 180, step: 1, unit: '°' },
    // #98 phase 2b: engine selector. 0 = legacy three-bvh-csg (default,
    // unchanged behaviour), 1 = OCCT via replicad. OCCT path requires
    // ensureOcctReady() to have been awaited already — if not, we silently
    // fall back to the legacy path and log so the user still gets a result.
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params) {
    const operation = Math.round(params.operation);
    const type = operationCodeToType(operation);
    const engine = Math.round(params.engine ?? 0);

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      // OCCT path. Prefer an upstream B-rep handle (phase 2d chain) so the
      // op composes against the real prior shape. Falls back to a bbox-
      // derived box host when no handle is present.
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);

        const toolShapeCode = Math.round(params.toolShape);
        const shape: 'box' | 'cylinder' | 'sphere' =
          toolShapeCode === 1 ? 'cylinder' : toolShapeCode === 2 ? 'sphere' : 'box';

        const result = occtBoxBooleanWithPrimitive(
          type,
          host,
          {
            shape,
            w: params.toolWidth,
            h: params.toolHeight,
            d: params.toolDepth,
            cx: params.posX,
            cy: params.posY,
            cz: params.posZ,
            rx: params.rotX,
            ry: params.rotY,
            rz: params.rotZ,
          },
          undefined,
          upstreamHandle,
        );
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        if (err instanceof OcctNotReadyError) {
          // Shouldn't happen — we just checked isOcctReady. But be defensive.
        }
        // eslint-disable-next-line no-console
        console.warn('[boolean] OCCT path failed, falling back to three-bvh-csg:', err);
        // Fall through to legacy path.
      }
    }

    const toolGeo = buildToolGeometry(params);
    return applyBooleanSync(type, geometry, toolGeo);
  },
};
