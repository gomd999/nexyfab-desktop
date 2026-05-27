/**
 * /occt/op/* — OCCT operation endpoints.
 *
 * Wave 1 W11 (D3-5 + follow-up): boolean / fillet / chamfer / shell /
 * extrude / revolve are live. The 4 remaining ops (sweep / loft /
 * pattern / mirror) return 501 until W12+.
 *
 * Request shape (all ops follow this):
 *   POST /occt/op/{operation}
 *   headers: Authorization: Bearer <main-app JWT>
 *   body: { params: object }      // geometry blobs go through R2,
 *                                  // not the request body
 *   response:
 *     201 { stlR2Key, stepR2Key, meta: { volume, surface, bbox, triangles, manifold }, elapsedMs, requestId }
 *     400 invalid params / unknown op
 *     401 invalid JWT
 *     500 OCCT failure
 *     501 op not implemented yet
 *     503 pool queue full (client should back off)
 *     504 op timed out (slot recycled)
 */

import { Router, type Request, type Response } from 'express';
import { type BooleanParams } from '../occt/boolean.js';
import { type FilletParams, type FilletEdgeScope } from '../occt/fillet.js';
import { type ChamferParams, type ChamferEdgeScope } from '../occt/chamfer.js';
import { type ShellParams, type ShellOpenFace } from '../occt/shell.js';
import { type ExtrudeParams, type ExtrudePlane, type ExtrudeProfile } from '../occt/extrude.js';
import { type RevolveParams, type RevolvePlane, type RevolveAxis, type RevolveProfile } from '../occt/revolve.js';
import type { SerializedResult } from '../occt/_types.js';
import { r2Put, r2OpKey } from '../r2.js';
import type { AuthedRequest } from '../middleware/auth.js';
import type { RequestWithId } from '../middleware/requestId.js';
import { getPool, QueueFullError, OpTimeoutError, WorkerCrashError } from '../pool/workerPool.js';
import type { OcctOp } from '../pool/protocol.js';

export const occtRoute: Router = Router();

// 4 ops still landing later. fillet/chamfer/shell came off in W11 D3-5;
// extrude/revolve came off in W11 follow-up.
const PLACEHOLDER_OPS = new Set([
  'sweep', 'loft', 'pattern', 'mirror',
]);

// ─── Reusable dispatch ────────────────────────────────────────────────────────
// Every live op follows the same flow: validate → pool.execute → write
// STL + STEP to R2 → respond. Hoisting it avoids 4 copies of the same
// 30 lines and keeps HTTP-status mapping in one place.
async function dispatchOp(
  op: OcctOp,
  validator: (body: unknown) => unknown,
  req: Request,
  res: Response,
): Promise<void> {
  const t0 = Date.now();
  const userId = (req as AuthedRequest).userId ?? 'anonymous';
  const requestId = (req as RequestWithId).requestId;

  try {
    const params = validator(req.body);
    const result = await getPool().execute(op, params) as SerializedResult;

    // Structured-clone across the worker-thread boundary turns Buffer
    // into Uint8Array. r2Put accepts either; re-wrap so content-length
    // and log lines stay accurate.
    const stlBytes = Buffer.isBuffer(result.stl) ? result.stl : Buffer.from(result.stl);

    const stlKey = r2OpKey(userId, op, 'stl');
    const stepKey = r2OpKey(userId, op, 'step');
    await Promise.all([
      r2Put(stlKey, stlBytes, 'model/stl'),
      r2Put(stepKey, result.step, 'application/step'),
    ]);

    const elapsed = Date.now() - t0;
    console.log(`[occt-worker] ${op} ${requestId} ok (${elapsed} ms, ${result.meta.triangles} tris)`);

    res.status(201).json({
      stlR2Key: stlKey,
      stepR2Key: stepKey,
      meta: result.meta,
      elapsedMs: elapsed,
      requestId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[occt-worker] ${op} ${requestId} failed: ${msg}`);
    // Map pool-level errors to specific HTTP codes:
    //   400 = bad input (no retry)
    //   503 = pool overloaded (client should back off)
    //   504 = op timed out (kernel suspect, slot recycled)
    //   500 = kernel/runtime failure (retry on fallback chain)
    let status = 500;
    if (msg.startsWith('invalid params')) status = 400;
    else if (err instanceof QueueFullError) status = 503;
    else if (err instanceof OpTimeoutError) status = 504;
    else if (err instanceof WorkerCrashError) status = 500;
    res.status(status).json({ error: msg, requestId });
  }
}

// ─── Live ops ─────────────────────────────────────────────────────────────────
occtRoute.post('/op/boolean', (req, res) => dispatchOp('boolean', validateBooleanParams, req, res));
occtRoute.post('/op/fillet',  (req, res) => dispatchOp('fillet',  validateFilletParams,  req, res));
occtRoute.post('/op/chamfer', (req, res) => dispatchOp('chamfer', validateChamferParams, req, res));
occtRoute.post('/op/shell',   (req, res) => dispatchOp('shell',   validateShellParams,   req, res));
occtRoute.post('/op/extrude', (req, res) => dispatchOp('extrude', validateExtrudeParams, req, res));
occtRoute.post('/op/revolve', (req, res) => dispatchOp('revolve', validateRevolveParams, req, res));

// ─── Placeholder 501s for ops landing later ──────────────────────────────────
occtRoute.post('/op/:operation', (req: Request, res: Response) => {
  // Express 5 types `params.operation` as `string | string[]`; we
  // never declare a wildcard, so it's always a string in practice.
  const operationRaw = req.params.operation;
  const operation = Array.isArray(operationRaw) ? operationRaw[0] : operationRaw;
  if (!operation || !PLACEHOLDER_OPS.has(operation)) {
    res.status(400).json({ error: 'unknown operation', operation });
    return;
  }
  res.status(501).json({
    error: 'not implemented',
    operation,
    note: 'Wave 1 W12+ will land this. Client should fall back to in-tab OCCT.',
  });
});

// ─── Param validation ────────────────────────────────────────────────────────
// Defensive — bad input is a 400, not a 500. Keep the schema small
// and readable; replace with zod if it grows past ~15 fields per op.

function unwrapParams(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    throw new Error('invalid params: body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const paramsRaw = b.params;
  if (!paramsRaw || typeof paramsRaw !== 'object') {
    throw new Error('invalid params: `params` field required');
  }
  return paramsRaw as Record<string, unknown>;
}

function validateHost(p: Record<string, unknown>): { w: number; h: number; d: number } {
  const host = p.host as Record<string, unknown> | undefined;
  if (!host || typeof host !== 'object') {
    throw new Error('invalid params: params.host required');
  }
  return {
    w: numField(host, 'w', 1, 5000),
    h: numField(host, 'h', 1, 5000),
    d: numField(host, 'd', 1, 5000),
  };
}

function validateBooleanParams(body: unknown): BooleanParams {
  const p = unwrapParams(body);
  const host = validateHost(p);
  const toolShape = typeof p.toolShape === 'number' ? p.toolShape : 0;
  const r = numField(p, 'r', 0.01, 5000);
  const height = p.height === undefined ? undefined : numField(p, 'height', 0.01, 5000);
  const cx = p.cx === undefined ? 0 : numField(p, 'cx', -5000, 5000);
  const cy = p.cy === undefined ? 0 : numField(p, 'cy', -5000, 5000);
  const cz = p.cz === undefined ? 0 : numField(p, 'cz', -5000, 5000);
  const type = p.type;
  if (type !== undefined && type !== 'cut' && type !== 'fuse' && type !== 'intersect') {
    throw new Error('invalid params: type must be cut | fuse | intersect');
  }
  return { host, toolShape, r, height, cx, cy, cz, type };
}

const FILLET_SCOPES: ReadonlySet<FilletEdgeScope> = new Set(['all', 'vertical', 'top', 'bottom']);
function validateFilletParams(body: unknown): FilletParams {
  const p = unwrapParams(body);
  const host = validateHost(p);
  const radius = numField(p, 'radius', 0.001, 2500);
  const edges = p.edges;
  if (edges !== undefined && (typeof edges !== 'string' || !FILLET_SCOPES.has(edges as FilletEdgeScope))) {
    throw new Error(`invalid params: edges must be one of ${[...FILLET_SCOPES].join(' | ')}`);
  }
  return { host, radius, edges: edges as FilletEdgeScope | undefined };
}

const CHAMFER_SCOPES: ReadonlySet<ChamferEdgeScope> = new Set(['all', 'vertical', 'top', 'bottom']);
function validateChamferParams(body: unknown): ChamferParams {
  const p = unwrapParams(body);
  const host = validateHost(p);
  const distance = numField(p, 'distance', 0.001, 2500);
  const edges = p.edges;
  if (edges !== undefined && (typeof edges !== 'string' || !CHAMFER_SCOPES.has(edges as ChamferEdgeScope))) {
    throw new Error(`invalid params: edges must be one of ${[...CHAMFER_SCOPES].join(' | ')}`);
  }
  return { host, distance, edges: edges as ChamferEdgeScope | undefined };
}

const SHELL_FACES: ReadonlySet<ShellOpenFace> = new Set(['top', 'bottom', 'front', 'back', 'left', 'right']);
function validateShellParams(body: unknown): ShellParams {
  const p = unwrapParams(body);
  const host = validateHost(p);
  const thickness = numField(p, 'thickness', 0.001, 2500);
  const openFace = p.openFace;
  if (openFace !== undefined && (typeof openFace !== 'string' || !SHELL_FACES.has(openFace as ShellOpenFace))) {
    throw new Error(`invalid params: openFace must be one of ${[...SHELL_FACES].join(' | ')}`);
  }
  return { host, thickness, openFace: openFace as ShellOpenFace | undefined };
}

const EXTRUDE_PLANES: ReadonlySet<ExtrudePlane> = new Set(['XY', 'XZ', 'YZ']);
function validateProfile(p: Record<string, unknown>): ExtrudeProfile {
  const raw = p.profile as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid params: params.profile required');
  }
  const kind = raw.kind;
  if (kind === 'rectangle') {
    return {
      kind: 'rectangle',
      width: numField(raw, 'width', 0.01, 5000),
      height2D: numField(raw, 'height2D', 0.01, 5000),
    };
  }
  if (kind === 'circle') {
    return { kind: 'circle', radius: numField(raw, 'radius', 0.01, 5000) };
  }
  throw new Error('invalid params: profile.kind must be rectangle | circle');
}
function validateExtrudeParams(body: unknown): ExtrudeParams {
  const p = unwrapParams(body);
  const profile = validateProfile(p);
  const height = numField(p, 'height', 0.01, 5000);
  const plane = p.plane;
  if (plane !== undefined && (typeof plane !== 'string' || !EXTRUDE_PLANES.has(plane as ExtrudePlane))) {
    throw new Error(`invalid params: plane must be one of ${[...EXTRUDE_PLANES].join(' | ')}`);
  }
  return { profile, height, plane: plane as ExtrudePlane | undefined };
}

const REVOLVE_PLANES: ReadonlySet<RevolvePlane> = new Set(['XY', 'XZ', 'YZ']);
const REVOLVE_AXES: ReadonlySet<RevolveAxis> = new Set(['X', 'Y', 'Z']);
function validateRevolveParams(body: unknown): RevolveParams {
  const p = unwrapParams(body);
  // Profile shapes the same as extrude — reuse validator and re-tag.
  const profile = validateProfile(p) as RevolveProfile;
  const plane = p.plane;
  if (plane !== undefined && (typeof plane !== 'string' || !REVOLVE_PLANES.has(plane as RevolvePlane))) {
    throw new Error(`invalid params: plane must be one of ${[...REVOLVE_PLANES].join(' | ')}`);
  }
  const axis = p.axis;
  if (axis !== undefined && (typeof axis !== 'string' || !REVOLVE_AXES.has(axis as RevolveAxis))) {
    throw new Error(`invalid params: axis must be one of ${[...REVOLVE_AXES].join(' | ')}`);
  }
  const angle = p.angle === undefined ? undefined : numField(p, 'angle', -360, 360);
  return {
    profile,
    plane: plane as RevolvePlane | undefined,
    axis: axis as RevolveAxis | undefined,
    angle,
  };
}

function numField(obj: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`invalid params: ${key} must be a finite number`);
  }
  if (v < min || v > max) {
    throw new Error(`invalid params: ${key} out of range [${min}, ${max}]`);
  }
  return v;
}

// Test-only exports for unit tests.
export const _testing = {
  validateBooleanParams,
  validateFilletParams,
  validateChamferParams,
  validateShellParams,
  validateExtrudeParams,
  validateRevolveParams,
};
