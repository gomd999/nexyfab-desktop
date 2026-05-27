import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, OcctNotReadyError, hostBoxFromGeometry } from './occtEngine';
import { reportWarning, reportInfo } from '../lib/telemetry';
import { stampFaceFeatureIdAll, FACE_FEATURE_ID_ATTR } from './faceProvenance';
import {
  serverBoolean,
  shouldUseServerBoolean,
  fetchR2Bytes,
  ServerOcctUnavailableError,
  type ServerBooleanParams,
} from '@/lib/occt-server-client';
import { parseSTL } from '../io/importers';

// ─── Internal helpers ───────────────────────────────────────────────────────

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/** Ensure a geometry carries the per-vertex face-feature-id attribute so a CSG
 *  evaluator told to process it never reads `.array` of an absent attribute.
 *  Sentinel 0 = "unattributed" (what an unstamped base should read back as). */
function fillSentinelFaceId(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute(FACE_FEATURE_ID_ATTR)) return;
  const vertCount = geo.attributes.position.count;
  geo.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(new Uint32Array(vertCount), 1));
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
  // B1 deep follow-up — preserve per-triangle feature id when either input
  // carries the attribute. Same wiring as CSGOperations.applyCSG; keeps
  // boolean output's mixed provenance intact.
  if (geoA.getAttribute(FACE_FEATURE_ID_ATTR) || geoB.getAttribute(FACE_FEATURE_ID_ATTR)) {
    // three-bvh-csg requires BOTH operands to carry an attribute it's told to
    // process. A leading boolean on a fresh (unstamped) base has it on the tool
    // only — fill the missing side with the sentinel (0 = unattributed) so the
    // evaluator doesn't read `.array` of an absent attribute.
    fillSentinelFaceId(geoA);
    fillSentinelFaceId(geoB);
    evaluator.attributes = [...evaluator.attributes, FACE_FEATURE_ID_ATTR];
  }
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
  // Merge nfabFeatureIdMap from both inputs onto the result, matching the
  // contract in CSGOperations.applyCSG so getFaceFeatureId() resolves
  // numeric ids back to feature strings on the output.
  const baseMap = geoA.userData?.nfabFeatureIdMap as Record<number, string> | undefined;
  const toolMap = geoB.userData?.nfabFeatureIdMap as Record<number, string> | undefined;
  if (baseMap || toolMap) {
    result.geometry.userData = {
      ...result.geometry.userData,
      nfabFeatureIdMap: { ...(baseMap ?? {}), ...(toolMap ?? {}) },
    };
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

/** Options for the server-OCCT path (W16). When omitted, applyBooleanAsync
 *  behaves exactly as pre-W16 — worker → sync fallback chain. */
export interface ServerOpts {
  jwtToken: string;
  /** Override `NEXT_PUBLIC_OCCT_WORKER_URL`. */
  baseUrl?: string;
  /** Override the main-app base for r2-fetch. Defaults to same-origin. */
  appBaseUrl?: string;
  /** Override the heuristic (default: shouldUseServerBoolean). */
  forceServer?: boolean;
  /** Abort the server round trip from a caller-owned controller. */
  signal?: AbortSignal;
}

const TOOL_SHAPE_FOR_SERVER: Record<number, number> = {
  // Worker accepts 0=cylinder, 1=sphere. Local toolShape 0=box has no
  // direct server-side primitive — caller stays on the local path for
  // those. We map local 1=cyl → server 0, local 2=sphere → server 1.
  1: 0,
  2: 1,
};

/** Map local feature params → ServerBooleanParams. Returns null when
 *  the shape can't be expressed for the server path. Two paths:
 *
 *  1. Chained tool (W17): when the geometry's userData carries a
 *     `toolSourceR2Key` (set by an upstream UI / handler), emit the
 *     R2 chain shape. Primitive tool fields are skipped — worker
 *     enforces XOR.
 *  2. Primitive tool: existing W16 path. toolShape 1/2 map to
 *     cylinder/sphere; box (0) returns null (no server primitive). */
function toServerParams(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
): ServerBooleanParams | null {
  const host = hostBoxFromGeometry(geometry);
  const operation = Math.round(params.operation);
  const type = operation === 1 ? 'cut' : operation === 2 ? 'intersect' : 'fuse';

  // Path 1 — chained shape-vs-shape. Stashed by some upstream flow:
  // either the user picked "use imported shape as tool" from the UI,
  // or a programmatic chain set it before calling apply.
  const toolStepKey = geometry.userData?.toolSourceR2Key;
  if (typeof toolStepKey === 'string' && toolStepKey.length > 0) {
    return {
      host: { w: host.w, h: host.h, d: host.d },
      toolSourceR2Key: toolStepKey,
      cx: params.posX,
      cy: params.posY,
      cz: params.posZ,
      type,
    };
  }

  // Path 2 — primitive tool.
  const toolShape = Math.round(params.toolShape);
  const serverTool = TOOL_SHAPE_FOR_SERVER[toolShape];
  if (serverTool === undefined) return null; // box tool — no server primitive

  // toolWidth is the diameter for cyl/sphere on the local side; server
  // expects radius. Halve it.
  const r = Math.max(0.01, params.toolWidth / 2);

  return {
    host: { w: host.w, h: host.h, d: host.d },
    toolShape: serverTool,
    r,
    height: toolShape === 1 ? params.toolHeight : undefined,
    cx: params.posX,
    cy: params.posY,
    cz: params.posZ,
    type,
  };
}

/** Server path: serverBoolean → fetchR2Bytes(stl) → parseSTL. Returns
 *  null when the caller-provided conditions don't permit the server
 *  call (so the caller falls through to worker/sync). Throws only on
 *  hard server failures the caller might want to surface. */
async function tryServerBoolean(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  opts: ServerOpts,
): Promise<THREE.BufferGeometry | null> {
  const serverParams = toServerParams(geometry, params);
  if (!serverParams) return null;

  const useServer = opts.forceServer ?? shouldUseServerBoolean(serverParams);
  if (!useServer) return null;

  const t0 = Date.now();
  try {
    const resp = await serverBoolean(serverParams, {
      jwtToken: opts.jwtToken,
      baseUrl: opts.baseUrl,
      signal: opts.signal,
    });
    const stlBuf = await fetchR2Bytes(resp.stlR2Key, {
      jwtToken: opts.jwtToken,
      baseUrl: opts.appBaseUrl,
      signal: opts.signal,
    });
    const geo = parseSTL(stlBuf);
    // Stash the server's STEP key as the upstream handle so a chained
    // boolean / fillet on this result can use sourceR2Key.
    geo.userData.serverStepR2Key = resp.stepR2Key;
    fillSentinelFaceId(geo);
    reportInfo('csg', 'server_boolean_path_ok', {
      elapsedMs: Date.now() - t0,
      serverElapsedMs: resp.elapsedMs,
      triangles: resp.meta.triangles,
    });
    return geo;
  } catch (err) {
    if (err instanceof ServerOcctUnavailableError && err.status === 400) {
      // Bad params: throw — caller's fallback would also fail since
      // the params are the same shape locally.
      throw err;
    }
    // Network / 5xx / timeout: report and let the caller fall back.
    reportWarning('csg', err, {
      phase: 'server_boolean_fallback',
      elapsedMs: Date.now() - t0,
    });
    return null;
  }
}

/**
 * Perform a CSG boolean off the main thread via a Web Worker.
 *
 * W16 — also tries the server OCCT path first when `serverOpts` is
 * provided. Fallback chain: server → worker → sync. Existing callers
 * that omit serverOpts get unchanged behaviour.
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
  serverOpts?: ServerOpts,
): Promise<THREE.BufferGeometry> {
  const operation = Math.round(params.operation);
  const type = operationCodeToType(operation);

  // W16 server path — non-breaking: only fires when caller supplies opts.
  if (serverOpts?.jwtToken) {
    const serverResult = await tryServerBoolean(geometry, params, serverOpts);
    if (serverResult) return serverResult;
    // Server unavailable / opted out → continue to worker / sync.
  }

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
      default: 1,
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
  apply(geometry, params, ctx) {
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
        // Report as warning (not error) since the legacy fallback path keeps
        // the user productive. Telemetry lets us track OCCT regression rates.
        reportWarning('csg', err, {
          phase: 'occt_to_legacy_fallback',
          op: type,
          toolShape: Math.round(params.toolShape),
        });
        // Fall through to legacy path.
      }
    }

    const toolGeo = buildToolGeometry(params);
    // B1 deep follow-up — tag the tool with the current feature's id so
    // that after applyCSG (which preserves nfabFaceFeatureId through the
    // boolean op) the output carries mixed provenance: base triangles
    // keep their upstream id, new triangles from the tool carry this
    // boolean feature's id. We pass `avoidIdsFrom: geometry` so the
    // tool's numeric ids don't collide with base's — both maps coexist
    // in the merged result, and collision would erase one of them.
    if (ctx?.featureId) {
      stampFaceFeatureIdAll(toolGeo, ctx.featureId, { avoidIdsFrom: geometry });
    }
    return applyBooleanSync(type, geometry, toolGeo);
  },
};
