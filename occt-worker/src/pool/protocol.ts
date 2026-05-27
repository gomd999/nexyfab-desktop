/**
 * Parent ↔ worker_threads message protocol for the OCCT pool.
 *
 * W11 D1-2 (ADR-007). Discriminated union so TypeScript narrows on
 * `type` and missing cases trip the noFallthroughCasesInSwitch flag.
 *
 * Geometry blobs (STL buffers) travel through the structured-clone
 * channel inside `result`; the message stays small because R2 keys —
 * not raw bytes — are the actual op output. We pay the clone cost
 * only on the STL preview buffer.
 */

import type { BooleanParams } from '../occt/boolean.js';
import type { FilletParams } from '../occt/fillet.js';
import type { ChamferParams } from '../occt/chamfer.js';
import type { ShellParams } from '../occt/shell.js';
import type { ExtrudeParams } from '../occt/extrude.js';
import type { RevolveParams } from '../occt/revolve.js';
import type { MirrorParams } from '../occt/mirror.js';
import type { PatternParams } from '../occt/pattern.js';
import type { SweepParams } from '../occt/sweep.js';
import type { LoftParams } from '../occt/loft.js';

export type OcctOp =
  | 'boolean' | 'fillet' | 'chamfer' | 'shell'
  | 'extrude' | 'revolve'
  | 'mirror' | 'pattern' | 'sweep' | 'loft';

/** Per-op param shapes; the discriminator on `op` lets the worker
 *  entry's switch narrow without casting. */
export type OcctParamsByOp = {
  boolean: BooleanParams;
  fillet: FilletParams;
  chamfer: ChamferParams;
  shell: ShellParams;
  extrude: ExtrudeParams;
  revolve: RevolveParams;
  mirror: MirrorParams;
  pattern: PatternParams;
  sweep: SweepParams;
  loft: LoftParams;
};

export interface OcctOpRequest {
  type: 'op';
  jobId: string;
  op: OcctOp;
  /** Pool keeps params opaque (it's just routing the bytes); each op
   *  handler narrows via OcctParamsByOp at the worker entry. */
  params: unknown;
  /** Authenticated caller's user id from the route's JWT. Threaded
   *  through so 3D-host op handlers can enforce per-user prefix on
   *  the sourceR2Key alternative input (W16 D1-2). Required even for
   *  ops that don't read R2 — keeps the message shape uniform and
   *  future-proof for per-user quotas / telemetry. */
  userId: string;
}

export interface OcctReadyMessage {
  /** Worker finished loading OCCT WASM and is ready for ops. */
  type: 'ready';
  pid: number;
  loadMs: number;
}

/** Worker-pushed memory snapshot — emitted after each op completes so
 *  the pool can track V8 heap growth per slot without an extra RPC.
 *  All sizes in MB rounded to 1 decimal (don't need byte precision
 *  for soak observability). */
export interface OcctMemUpdate {
  type: 'mem';
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
}

export interface OcctResultOk {
  type: 'result';
  jobId: string;
  ok: true;
  result: unknown;
}

export interface OcctResultErr {
  type: 'result';
  jobId: string;
  ok: false;
  error: string;
}

export type ParentToWorker = OcctOpRequest;
export type WorkerToParent = OcctReadyMessage | OcctResultOk | OcctResultErr | OcctMemUpdate;
