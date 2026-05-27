/**
 * /occt/op/* — OCCT operation endpoints.
 *
 * Wave 1 W10 D1-3: `POST /occt/op/boolean` is the first live op.
 * The other 9 (fillet / chamfer / shell / extrude / revolve / sweep /
 * loft / pattern / mirror) return 501 until W10 D4-5 + W11.
 *
 * Request shape (all ops follow this):
 *   POST /occt/op/{operation}
 *   headers: Authorization: Bearer <main-app JWT>
 *   body: { params: object }      // geometry blobs go through R2,
 *                                  // not the request body
 *   response:
 *     201 { stlR2Key, stepR2Key, meta: { volume, surface, bbox, triangles, manifold } }
 *     400 invalid params / unknown op
 *     401 invalid JWT
 *     500 OCCT failure
 *     501 op not implemented yet
 */

import { Router, type Request, type Response } from 'express';
import { type BooleanParams, type BooleanResult } from '../occt/boolean.js';
import { r2Put, r2OpKey } from '../r2.js';
import type { AuthedRequest } from '../middleware/auth.js';
import type { RequestWithId } from '../middleware/requestId.js';
import { getPool, QueueFullError, OpTimeoutError, WorkerCrashError } from '../pool/workerPool.js';

export const occtRoute: Router = Router();

const PLACEHOLDER_OPS = new Set([
  'fillet', 'chamfer', 'shell',
  'extrude', 'revolve', 'sweep', 'loft',
  'pattern', 'mirror',
]);

// ─── POST /occt/op/boolean ───────────────────────────────────────────────────
occtRoute.post('/op/boolean', async (req: Request, res: Response) => {
  const t0 = Date.now();
  const userId = (req as AuthedRequest).userId ?? 'anonymous';
  const requestId = (req as RequestWithId).requestId;

  try {
    const params = validateBooleanParams(req.body);
    // Dispatch through the thread pool — actual OCCT call runs in a
    // worker thread with isolated WASM heap (W11 D1-2).
    const result = await getPool().execute('boolean', params) as BooleanResult;

    // Structured-clone across the worker-thread boundary turns Buffer
    // into Uint8Array. r2Put accepts either, but re-wrap so log lines
    // and content-length stay accurate.
    const stlBytes = Buffer.isBuffer(result.stl) ? result.stl : Buffer.from(result.stl);

    // Persist outputs to R2. Two keys: STEP for CAD interchange, STL
    // for the client viewport. Both keys returned to the caller.
    const stlKey = r2OpKey(userId, 'boolean', 'stl');
    const stepKey = r2OpKey(userId, 'boolean', 'step');
    await Promise.all([
      r2Put(stlKey, stlBytes, 'model/stl'),
      r2Put(stepKey, result.step, 'application/step'),
    ]);

    const elapsed = Date.now() - t0;
    console.log(`[occt-worker] boolean ${requestId} ok (${elapsed} ms, ${result.meta.triangles} tris)`);

    res.status(201).json({
      stlR2Key: stlKey,
      stepR2Key: stepKey,
      meta: result.meta,
      elapsedMs: elapsed,
      requestId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[occt-worker] boolean ${requestId} failed: ${msg}`);
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
});

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
    note: 'Wave 1 W10 D4-5 + W11 will land this. Client should fall back to in-tab OCCT.',
  });
});

// ─── Param validation ────────────────────────────────────────────────────────
// Defensive — bad input is a 400, not a 500. Keep the schema small
// and readable; replace with zod if it grows past ~15 fields.
function validateBooleanParams(body: unknown): BooleanParams {
  if (!body || typeof body !== 'object') {
    throw new Error('invalid params: body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const paramsRaw = b.params;
  if (!paramsRaw || typeof paramsRaw !== 'object') {
    throw new Error('invalid params: `params` field required');
  }
  const p = paramsRaw as Record<string, unknown>;
  const host = p.host as Record<string, unknown> | undefined;
  if (!host || typeof host !== 'object') {
    throw new Error('invalid params: params.host required');
  }
  const w = numField(host, 'w', 1, 5000);
  const h = numField(host, 'h', 1, 5000);
  const d = numField(host, 'd', 1, 5000);
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
  return {
    host: { w, h, d },
    toolShape,
    r,
    height,
    cx,
    cy,
    cz,
    type,
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
