import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal server-only Replicad surface used by STEP HLR verification. */
export interface ServerReplicad {
  importSTEP(blob: Blob): Promise<unknown>;
  drawProjection(shape: unknown, view?: string): unknown;
  drawCircle(radius: number): unknown;
  Drawing: new () => unknown;
}

let ready: Promise<ServerReplicad> | null = null;

/**
 * Load Replicad's OCCT WASM with a path that also works in a bundled Next
 * server. The promise is process-cached because the WASM instance is large.
 */
export function loadServerReplicad(): Promise<ServerReplicad> {
  if (!ready) {
    ready = (async () => {
      const ocModule = await import('replicad-opencascadejs/src/replicad_single.js');
      const factory = ocModule.default as unknown as (
        options?: { locateFile?: (path: string) => string },
      ) => Promise<unknown>;
      const wasmPath = [
        join(process.cwd(), 'public', 'replicad_single.wasm'),
        join(process.cwd(), 'node_modules', 'replicad-opencascadejs', 'src', 'replicad_single.wasm'),
      ].find(candidate => {
        try { return existsSync(candidate); } catch { return false; }
      });
      const oc = await factory(wasmPath
        ? { locateFile: path => path.endsWith('.wasm') ? wasmPath : path }
        : undefined);
      const replicad = await import('replicad');
      replicad.setOC(oc as Parameters<typeof replicad.setOC>[0]);
      return replicad as unknown as ServerReplicad;
    })().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
