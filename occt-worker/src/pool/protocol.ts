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

export type OcctOp = 'boolean';

export interface OcctOpRequest {
  type: 'op';
  jobId: string;
  op: OcctOp;
  params: BooleanParams;
}

export interface OcctReadyMessage {
  /** Worker finished loading OCCT WASM and is ready for ops. */
  type: 'ready';
  pid: number;
  loadMs: number;
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
export type WorkerToParent = OcctReadyMessage | OcctResultOk | OcctResultErr;
