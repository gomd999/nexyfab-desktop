/**
 * OCCT WASM lifecycle for the worker. Loads occt-import-js + replicad
 * once at boot; subsequent op handlers call into the loaded instance.
 *
 * W9 D5 scope: load happens lazily on first /health probe, with the
 * worker reporting `starting` until ready. W11 D1-2 (concurrency)
 * will move this into a per-thread worker pool.
 */

let occtReady = false;
let occtError: string | null = null;
let occtPromise: Promise<void> | null = null;

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

async function loadOcct(): Promise<void> {
  const t0 = Date.now();
  try {
    // Dynamic import to avoid bundler / type-check coupling. The actual
    // OCCT engine code lands in W10 D1-3; for the scaffold we just
    // verify the modules resolve and replicad's makeBaseBox works.
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
    (replicadMod as unknown as { setOC: (oc: unknown) => void }).setOC(oc);

    occtReady = true;
    const elapsed = Date.now() - t0;
    console.log(`[occt-worker] OCCT ready (${elapsed} ms)`);
  } catch (err) {
    occtError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}
