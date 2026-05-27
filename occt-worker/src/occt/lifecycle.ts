/**
 * OCCT WASM lifecycle for the worker. Loads occt-import-js + replicad
 * once at boot; subsequent op handlers call into the loaded instance.
 *
 * W9 D5 scope: load happens lazily on first /health probe or first
 * op call, with the worker reporting `starting` until ready.
 * W11 D1-2 (concurrency) will move this into a per-thread worker
 * pool.
 */

let occtReady = false;
let occtError: string | null = null;
let occtPromise: Promise<void> | null = null;
let replicadModule: unknown = null;

export interface OcctStatus {
  ready: boolean;
  error: string | null;
}

export function getOcctStatus(): OcctStatus {
  // Kick off lazy load on first probe. Subsequent calls reuse the
  // in-flight promise.
  if (!occtPromise) {
    occtPromise = loadOcct().catch(err => {
      occtError = err instanceof Error ? err.message : String(err);
      console.error('[occt-worker] OCCT load failed:', err);
    });
  }
  return { ready: occtReady, error: occtError };
}

/** Block until OCCT is ready. Op handlers (boolean / fillet / etc.)
 *  call this before touching the kernel. */
export async function ensureOcctReady(): Promise<void> {
  if (occtReady) return;
  if (!occtPromise) {
    occtPromise = loadOcct().catch(err => {
      occtError = err instanceof Error ? err.message : String(err);
      console.error('[occt-worker] OCCT load failed:', err);
    });
  }
  await occtPromise;
  if (!occtReady) {
    throw new Error(`OCCT not ready: ${occtError ?? 'unknown reason'}`);
  }
}

/** Return the loaded replicad module. Caller is responsible for
 *  having awaited `ensureOcctReady()` first; we throw if it wasn't.
 *  Typing is intentionally loose because replicad's TS surface is
 *  thin — call sites narrow with their own interfaces. */
export function getReplicad(): unknown {
  if (!occtReady || !replicadModule) {
    throw new Error('replicad not loaded — await ensureOcctReady() first');
  }
  return replicadModule;
}

async function loadOcct(): Promise<void> {
  const t0 = Date.now();
  try {
    // Dynamic imports to avoid bundler / type-check coupling. Both
    // modules ship their own ambient types so this resolves at
    // runtime; the boolean handler narrows via local interfaces.
    const occtimport = (await import('occt-import-js')).default as unknown as (
      opts?: { locateFile?: (p: string) => string },
    ) => Promise<unknown>;
    const replicadMod = await import('replicad');
    const replicadOcc = await import('replicad-opencascadejs');

    // Initialize occt-import-js (file path resolved automatically when
    // running from dist/ in the Railway container).
    await occtimport({
      locateFile: (p: string) => p,
    });

    // Initialize replicad's OCCT kernel — needs the WASM blob path.
    const ocLoader = (replicadOcc as unknown as { default: () => Promise<unknown> }).default;
    const oc = await ocLoader();
    const setOC = (replicadMod as unknown as { setOC?: (oc: unknown) => void }).setOC;
    if (setOC) setOC(oc);

    replicadModule = replicadMod;
    occtReady = true;
    const elapsed = Date.now() - t0;
    console.log(`[occt-worker] OCCT ready (${elapsed} ms)`);
  } catch (err) {
    occtError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
