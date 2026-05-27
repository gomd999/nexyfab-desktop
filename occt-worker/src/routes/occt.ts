/**
 * /occt/op/* — OCCT operation endpoints.
 *
 * Wave 1 W11-W15: all 10 ops (boolean / fillet / chamfer / shell /
 * extrude / revolve / mirror / pattern / sweep / loft) are live.
 * PLACEHOLDER_OPS is now empty — every documented op routes to a
 * real handler. Chained-op surface (R2-imported shape as input)
 * remains W16+ scope.
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
import { type MirrorParams, type MirrorPlane } from '../occt/mirror.js';
import { type PatternParams } from '../occt/pattern.js';
import { type SweepParams } from '../occt/sweep.js';
import { type LoftParams } from '../occt/loft.js';
import { parseSvgPath } from '../occt/_svg.js';
import type { SerializedResult } from '../occt/_types.js';
import { r2Put, r2OpKey } from '../r2.js';
import type { AuthedRequest } from '../middleware/auth.js';
import type { RequestWithId } from '../middleware/requestId.js';
import { getPool, QueueFullError, OpTimeoutError, WorkerCrashError } from '../pool/workerPool.js';
import type { OcctOp } from '../pool/protocol.js';

export const occtRoute: Router = Router();

// Empty — all 10 ops have real handlers as of W15. Kept for future
// op additions: any name not in OcctOp falls through the 501 branch.
const PLACEHOLDER_OPS: ReadonlySet<string> = new Set();

// ─── Reusable dispatch ────────────────────────────────────────────────────────
// Every live op follows the same flow: validate → pool.execute → write
// STL + STEP to R2 → respond. Hoisting it avoids 4 copies of the same
// 30 lines and keeps HTTP-status mapping in one place.
async function dispatchOp(
  op: OcctOp,
  validator: (body: unknown, userId: string) => unknown,
  req: Request,
  res: Response,
): Promise<void> {
  const t0 = Date.now();
  const userId = (req as AuthedRequest).userId ?? 'anonymous';
  const requestId = (req as RequestWithId).requestId;

  try {
    const params = validator(req.body, userId);
    const result = await getPool().execute(op, params, userId) as SerializedResult;

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
occtRoute.post('/op/mirror',  (req, res) => dispatchOp('mirror',  validateMirrorParams,  req, res));
occtRoute.post('/op/pattern', (req, res) => dispatchOp('pattern', validatePatternParams, req, res));
occtRoute.post('/op/sweep',   (req, res) => dispatchOp('sweep',   validateSweepParams,   req, res));
occtRoute.post('/op/loft',    (req, res) => dispatchOp('loft',    validateLoftParams,    req, res));

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

/** W16 D1-2: 3D-host ops accept host XOR sourceR2Key. Either-or
 *  validation; sourceR2Key must start with `occt-ops/<userId>/` (the
 *  worker re-checks this in _input.ts but failing here keeps the
 *  kernel from being touched for malicious payloads). */
function validateHostOrR2Key(
  p: Record<string, unknown>,
  userId: string,
): { host?: { w: number; h: number; d: number }; sourceR2Key?: string } {
  const hasHost = p.host !== undefined;
  const hasKey = p.sourceR2Key !== undefined;
  if (hasHost === hasKey) {
    throw new Error('invalid params: exactly one of host or sourceR2Key must be set');
  }
  if (hasHost) {
    return { host: validateHost(p) };
  }
  const key = p.sourceR2Key;
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
    throw new Error('invalid params: sourceR2Key must be a string ≤ 512 chars');
  }
  if (key.includes('..') || key.startsWith('/')) {
    throw new Error('invalid params: sourceR2Key has illegal path components');
  }
  const expectedPrefix = `occt-ops/${userId}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new Error(
      `invalid params: sourceR2Key must start with ${expectedPrefix} (per-user scope)`,
    );
  }
  return { sourceR2Key: key };
}

function validateBooleanParams(body: unknown, userId: string): BooleanParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
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
  return { ...input, toolShape, r, height, cx, cy, cz, type };
}

const FILLET_SCOPES: ReadonlySet<FilletEdgeScope> = new Set(['all', 'vertical', 'top', 'bottom']);
function validateFilletParams(body: unknown, userId: string): FilletParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
  const radius = numField(p, 'radius', 0.001, 2500);
  const edges = p.edges;
  if (edges !== undefined && (typeof edges !== 'string' || !FILLET_SCOPES.has(edges as FilletEdgeScope))) {
    throw new Error(`invalid params: edges must be one of ${[...FILLET_SCOPES].join(' | ')}`);
  }
  return { ...input, radius, edges: edges as FilletEdgeScope | undefined };
}

const CHAMFER_SCOPES: ReadonlySet<ChamferEdgeScope> = new Set(['all', 'vertical', 'top', 'bottom']);
function validateChamferParams(body: unknown, userId: string): ChamferParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
  const distance = numField(p, 'distance', 0.001, 2500);
  const edges = p.edges;
  if (edges !== undefined && (typeof edges !== 'string' || !CHAMFER_SCOPES.has(edges as ChamferEdgeScope))) {
    throw new Error(`invalid params: edges must be one of ${[...CHAMFER_SCOPES].join(' | ')}`);
  }
  return { ...input, distance, edges: edges as ChamferEdgeScope | undefined };
}

const SHELL_FACES: ReadonlySet<ShellOpenFace> = new Set(['top', 'bottom', 'front', 'back', 'left', 'right']);
function validateShellParams(body: unknown, userId: string): ShellParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
  const thickness = numField(p, 'thickness', 0.001, 2500);
  const openFace = p.openFace;
  if (openFace !== undefined && (typeof openFace !== 'string' || !SHELL_FACES.has(openFace as ShellOpenFace))) {
    throw new Error(`invalid params: openFace must be one of ${[...SHELL_FACES].join(' | ')}`);
  }
  return { ...input, thickness, openFace: openFace as ShellOpenFace | undefined };
}

const EXTRUDE_PLANES: ReadonlySet<ExtrudePlane> = new Set(['XY', 'XZ', 'YZ']);

const POLYGON_MAX_POINTS = 1024; // Defensive — guards against payload abuse; real CAD profiles stay well below.
const SVG_PATH_MAX_LENGTH = 65_536; // 64 KB — same defensive cap idea for SVG `d` strings.

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
  if (kind === 'polygon') {
    const pts = raw.points;
    if (!Array.isArray(pts)) {
      throw new Error('invalid params: polygon.points must be an array');
    }
    if (pts.length < 3) {
      throw new Error('invalid params: polygon needs ≥ 3 points');
    }
    if (pts.length > POLYGON_MAX_POINTS) {
      throw new Error(`invalid params: polygon points exceed ${POLYGON_MAX_POINTS}`);
    }
    const points: [number, number][] = pts.map((entry, i) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error(`invalid params: polygon.points[${i}] must be [x, y]`);
      }
      const [x, y] = entry;
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
        throw new Error(`invalid params: polygon.points[${i}] coords must be finite numbers`);
      }
      if (x < -5000 || x > 5000 || y < -5000 || y > 5000) {
        throw new Error(`invalid params: polygon.points[${i}] out of [-5000, 5000]`);
      }
      return [x, y];
    });
    return { kind: 'polygon', points };
  }
  if (kind === 'svgPath') {
    const d = raw.d;
    if (typeof d !== 'string') {
      throw new Error('invalid params: svgPath.d must be a string');
    }
    if (d.length > SVG_PATH_MAX_LENGTH) {
      throw new Error(`invalid params: svgPath.d exceeds ${SVG_PATH_MAX_LENGTH} chars`);
    }
    // Optional Bezier flattening tolerance. 0.001..10 mm range — below
    // 0.001 the vertex count balloons (cap hit) and above 10 the
    // approximation is too coarse for engineering use.
    const toleranceRaw = raw.tolerance;
    let tolerance: number | undefined;
    if (toleranceRaw !== undefined) {
      if (typeof toleranceRaw !== 'number' || !Number.isFinite(toleranceRaw)) {
        throw new Error('invalid params: svgPath.tolerance must be a finite number');
      }
      if (toleranceRaw < 0.001 || toleranceRaw > 10) {
        throw new Error('invalid params: svgPath.tolerance out of [0.001, 10] mm');
      }
      tolerance = toleranceRaw;
    }
    // parseSvgPath throws "invalid params: ..." on malformed input,
    // so the dispatchOp 400 mapping catches it uniformly.
    const { points } = parseSvgPath(d, { tolerance });
    if (points.length > POLYGON_MAX_POINTS) {
      throw new Error(`invalid params: svgPath produced ${points.length} vertices, exceeds ${POLYGON_MAX_POINTS} (raise tolerance to reduce subdivision)`);
    }
    // Range check the parsed coords with the same bounds as the
    // polygon validator above.
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i]!;
      if (x < -5000 || x > 5000 || y < -5000 || y > 5000) {
        throw new Error(`invalid params: svgPath vertex ${i} out of [-5000, 5000]`);
      }
    }
    return { kind: 'polygon', points };
  }
  throw new Error('invalid params: profile.kind must be rectangle | circle | polygon | svgPath');
}
function validateExtrudeParams(body: unknown, _userId: string): ExtrudeParams {
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
function validateRevolveParams(body: unknown, _userId: string): RevolveParams {
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

const MIRROR_PLANES: ReadonlySet<MirrorPlane> = new Set(['XY', 'YZ', 'XZ']);
function validateMirrorParams(body: unknown, userId: string): MirrorParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
  const plane = p.plane;
  if (typeof plane !== 'string' || !MIRROR_PLANES.has(plane as MirrorPlane)) {
    throw new Error(`invalid params: plane must be one of ${[...MIRROR_PLANES].join(' | ')}`);
  }
  return { ...input, plane: plane as MirrorPlane };
}

const PATTERN_AXES: ReadonlySet<'X' | 'Y' | 'Z'> = new Set(['X', 'Y', 'Z']);
function validatePatternParams(body: unknown, userId: string): PatternParams {
  const p = unwrapParams(body);
  const input = validateHostOrR2Key(p, userId);
  const kind = p.kind;
  if (kind !== 'linear' && kind !== 'circular') {
    throw new Error('invalid params: pattern.kind must be linear | circular');
  }
  const count = numField(p, 'count', 2, 256);
  if (!Number.isInteger(count)) {
    throw new Error('invalid params: pattern.count must be an integer');
  }
  const axisRaw = p.axis;
  if (typeof axisRaw !== 'string' || !PATTERN_AXES.has(axisRaw as 'X' | 'Y' | 'Z')) {
    throw new Error('invalid params: pattern.axis must be X | Y | Z');
  }
  const axis = axisRaw as 'X' | 'Y' | 'Z';
  if (kind === 'linear') {
    return { kind: 'linear', ...input, count, axis, spacing: numField(p, 'spacing', 0.01, 5000) };
  }
  return {
    kind: 'circular', ...input, count, axis,
    totalAngleDeg: numField(p, 'totalAngleDeg', -360, 360),
  };
}

const SWEEP_PLANES: ReadonlySet<'XY' | 'XZ' | 'YZ'> = new Set(['XY', 'XZ', 'YZ']);
function validateSweepParams(body: unknown, _userId: string): SweepParams {
  const p = unwrapParams(body);
  // Profile shares vocabulary with extrude. Sweep doesn't accept
  // svgPath directly — pre-compile via the polygon path.
  const profile = validateProfile(p);
  const pathRaw = p.path;
  if (!Array.isArray(pathRaw) || pathRaw.length < 2) {
    throw new Error('invalid params: sweep.path must be an array of ≥ 2 points');
  }
  if (pathRaw.length > 256) {
    throw new Error('invalid params: sweep.path exceeds 256 points');
  }
  const path: [number, number, number][] = pathRaw.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3) {
      throw new Error(`invalid params: sweep.path[${i}] must be [x, y, z]`);
    }
    const [x, y, z] = entry;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number'
        || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`invalid params: sweep.path[${i}] must be finite numbers`);
    }
    if (Math.abs(x) > 5000 || Math.abs(y) > 5000 || Math.abs(z) > 5000) {
      throw new Error(`invalid params: sweep.path[${i}] out of [-5000, 5000]`);
    }
    return [x, y, z];
  });
  const plane = p.plane;
  if (plane !== undefined && (typeof plane !== 'string' || !SWEEP_PLANES.has(plane as 'XY' | 'XZ' | 'YZ'))) {
    throw new Error(`invalid params: plane must be one of ${[...SWEEP_PLANES].join(' | ')}`);
  }
  return { profile, path, plane: plane as 'XY' | 'XZ' | 'YZ' | undefined };
}

function validateLoftParams(body: unknown, _userId: string): LoftParams {
  const p = unwrapParams(body);
  const sectionsRaw = p.sections;
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length < 2) {
    throw new Error('invalid params: loft.sections must be an array of ≥ 2 entries');
  }
  if (sectionsRaw.length > 32) {
    throw new Error('invalid params: loft.sections exceeds 32 entries');
  }
  let lastOffset = -Infinity;
  const sections = sectionsRaw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`invalid params: loft.sections[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    // Reuse profile validation. Wrap profile in the shape unwrap*
    // helper expects (params.profile).
    const profile = validateProfile({ profile: e.profile });
    const offset = numField(e, 'offset', -5000, 5000);
    if (offset <= lastOffset) {
      throw new Error(
        `invalid params: loft.sections[${i}].offset must be strictly increasing`,
      );
    }
    lastOffset = offset;
    return { profile, offset };
  });
  const plane = p.plane;
  if (plane !== undefined && (typeof plane !== 'string' || !SWEEP_PLANES.has(plane as 'XY' | 'XZ' | 'YZ'))) {
    throw new Error(`invalid params: plane must be one of ${[...SWEEP_PLANES].join(' | ')}`);
  }
  return { sections, plane: plane as 'XY' | 'XZ' | 'YZ' | undefined };
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
  validateMirrorParams,
  validatePatternParams,
  validateSweepParams,
  validateLoftParams,
};
