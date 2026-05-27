import * as THREE from 'three';
import { runJscadCode } from '../openscad/jscadRunner';

// ─── Message protocol ───────────────────────────────────────────────────────
export interface SerializedGeometry {
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
}

export interface JscadWorkerInput {
  type: 'RUN_JSCAD';
  payload: { code: string; timeoutMs?: number };
}

export interface JscadWorkerOutput {
  type: 'JSCAD_RESULT';
  geometry?: SerializedGeometry;
  warnings?: string[];
  triCount?: number;
  error?: string;
}

function serialize(geo: THREE.BufferGeometry): { msg: SerializedGeometry; transfer: Transferable[] } {
  const positions = new Float32Array(geo.attributes.position.array as ArrayLike<number>);
  const transfer: Transferable[] = [positions.buffer];
  const msg: SerializedGeometry = { positions };
  if (geo.attributes.normal) {
    const normals = new Float32Array(geo.attributes.normal.array as ArrayLike<number>);
    msg.normals = normals;
    transfer.push(normals.buffer);
  }
  if (geo.index) {
    const indices = new Uint32Array(geo.index.array as ArrayLike<number>);
    msg.indices = indices;
    transfer.push(indices.buffer);
  }
  return { msg, transfer };
}

/** App `tsconfig` types `self` as `Window`; workers use the transfer overload. */
function post(message: JscadWorkerOutput, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage: (m: JscadWorkerOutput, t?: Transferable[]) => void }).postMessage(message, transfer);
}

self.addEventListener('message', (e: MessageEvent<JscadWorkerInput>) => {
  const data = e.data;
  if (data.type !== 'RUN_JSCAD') return;
  try {
    const { geometry, warnings, triCount } = runJscadCode(data.payload.code, { timeoutMs: data.payload.timeoutMs });
    const { msg, transfer } = serialize(geometry);
    post({ type: 'JSCAD_RESULT', geometry: msg, warnings, triCount }, transfer);
  } catch (err) {
    post({ type: 'JSCAD_RESULT', error: err instanceof Error ? err.message : String(err) });
  }
});
