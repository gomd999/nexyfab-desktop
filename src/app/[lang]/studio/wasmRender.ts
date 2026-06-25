'use client';
/**
 * Main-thread API for the client-side OpenSCAD render worker. A small pool of
 * workers renders SCAD → binary STL bytes in the browser (no server round-trip,
 * no auth gate, no byte cap). Round-robins requests across the pool so the
 * colour-isolation passes (one render per colour) run a few at a time.
 */

export interface WasmResult { ok: boolean; data?: Uint8Array; error?: string }

const POOL_SIZE = 3;
let workers: Worker[] | null = null;
let broken = false;
const pending = new Map<number, (r: WasmResult) => void>();
let seq = 0;
let rr = 0;

function ensureWorkers(): Worker[] {
  if (workers) return workers;
  workers = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const w = new Worker(new URL('./openscadWorker.ts', import.meta.url));
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; data?: Uint8Array; error?: string }>) => {
      const cb = pending.get(e.data.id);
      if (cb) { pending.delete(e.data.id); cb({ ok: e.data.ok, data: e.data.data, error: e.data.error }); }
    };
    w.onerror = () => { broken = true; }; // module/load failure → caller falls back to server
    workers.push(w);
  }
  return workers;
}

/** Is the in-browser renderer usable in this environment? */
export function wasmAvailable(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && !broken;
}

/** Render SCAD to binary STL bytes entirely client-side. Resolves {ok:false}
 *  (never throws) so callers can fall back to the server render. */
export function renderScadWasm(scad: string, timeoutMs = 30000): Promise<WasmResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: WasmResult) => { if (!done) { done = true; resolve(r); } };
    try {
      const pool = ensureWorkers();
      const id = ++seq;
      pending.set(id, finish);
      pool[rr++ % pool.length]!.postMessage({ id, scad });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); finish({ ok: false, error: 'timeout' }); } }, timeoutMs);
    } catch (e) {
      broken = true;
      finish({ ok: false, error: e instanceof Error ? e.message : 'worker init failed' });
    }
  });
}
