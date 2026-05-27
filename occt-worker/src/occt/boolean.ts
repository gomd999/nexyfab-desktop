/**
 * Server-side boolean op — Wave 1 W10 D1-3 (ADR-007).
 *
 * Mirrors the main app's `occtBoxBooleanWithPrimitive` but runs in the
 * worker's Node + WASM context. Inputs arrive as an STL buffer from
 * R2; output is an OCCT B-rep handle which we serialize to STEP + STL
 * before returning. The handle id stays in-process and is meaningful
 * only for chained ops in the same request — across requests we rely
 * on R2 keys.
 *
 * Scope: box - cylinder (the fixture case from the main app's
 * boolean.ts and the W10 D1-3 commitment in ADR-007). Other tool
 * shapes (sphere, custom) land in W10 D4-5 or W11 alongside the other
 * ops (fillet / chamfer / shell).
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { resolveShape, type OpContext } from './_input.js';
import type { ReplicadLike, OcctShape, SerializedResult } from './_types.js';

export interface BooleanParams {
  /** Primitive box host. Exactly one of host or sourceR2Key required. */
  host?: { w: number; h: number; d: number };
  /** R2 key pointing to a STEP file (chained-op input, W16 D1-2). */
  sourceR2Key?: string;
  /** Tool primitive selector. 0 = cylinder, 1 = sphere. Required when
   *  toolSourceR2Key is unset; ignored otherwise. */
  toolShape?: number;
  /** Tool radius (cylinder/sphere) — required when toolSourceR2Key
   *  is unset; ignored otherwise. */
  r?: number;
  /** Cylinder height — primitive tool only. */
  height?: number;
  /** Tool placement offset from host centre (mm). Applies to BOTH
   *  primitive and R2-imported tools — the R2 shape is translated by
   *  this offset after import. */
  cx?: number;
  cy?: number;
  cz?: number;
  /** R2 key pointing to a STEP file used AS the tool (W17 shape-vs-
   *  shape boolean). Mutually exclusive with toolShape/r/height. */
  toolSourceR2Key?: string;
  /** Boolean type — 'cut' subtracts the tool from the host;
   *  'fuse' unions them. */
  type?: 'cut' | 'fuse' | 'intersect';
}

export type BooleanResult = SerializedResult;

/** Default cylinder height when neither `params.height` nor primitive
 *  host dimensions are available (R2-imported host). 100mm covers
 *  typical engineering features; if the imported shape is bigger
 *  the cylinder doesn't quite span — caller passes `height` then. */
const DEFAULT_CYLINDER_HEIGHT_MM = 100;

export async function runBoolean(params: BooleanParams, ctx: OpContext): Promise<BooleanResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  if (!replicad.makeBaseCylinder || !replicad.makeBaseSphere) {
    throw new Error(
      'replicad primitives unavailable — verify replicad-opencascadejs WASM loaded',
    );
  }

  const host = await resolveShape(replicad, params, ctx.userId);

  // Tool: R2-imported shape (W17) or primitive cylinder/sphere (W10).
  // The two paths share the same translate step below.
  let tool: OcctShape;
  if (params.toolSourceR2Key) {
    // resolveShape's input shape is host-flavoured, but reusing it
    // here means the per-user prefix check + STEP import already
    // works identically. The "host:" naming is a leak we accept —
    // future refactor can rename to resolveR2Shape if it bothers.
    tool = await resolveShape(
      replicad,
      { sourceR2Key: params.toolSourceR2Key },
      ctx.userId,
    );
  } else if (params.toolShape === 1) {
    if (params.r === undefined) {
      throw new Error('invalid params: r required for primitive tool');
    }
    tool = replicad.makeBaseSphere(params.r) as OcctShape;
  } else {
    if (params.r === undefined) {
      throw new Error('invalid params: r required for primitive tool');
    }
    const h = params.height ?? (params.host
      ? Math.max(params.host.w, params.host.h, params.host.d)
      : DEFAULT_CYLINDER_HEIGHT_MM);
    tool = replicad.makeBaseCylinder(params.r, h) as OcctShape;
  }
  const cx = params.cx ?? 0;
  const cy = params.cy ?? 0;
  const cz = params.cz ?? 0;
  if ((cx !== 0 || cy !== 0 || cz !== 0) && tool.translate) {
    tool = tool.translate([cx, cy, cz]);
  }

  // Apply the boolean.
  const opKind = params.type ?? 'cut';
  let result: OcctShape | undefined;
  if (opKind === 'cut' && host.cut) result = host.cut(tool);
  else if (opKind === 'fuse' && host.fuse) result = host.fuse(tool);
  else if (opKind === 'intersect' && host.intersect) result = host.intersect(tool);
  if (!result) {
    throw new Error(`replicad shape has no ${opKind}() method — op aborted`);
  }

  return serializeShape(replicad, result);
}
