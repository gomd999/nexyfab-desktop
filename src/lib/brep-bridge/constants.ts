/**
 * Max decoded STEP payload accepted by the current inline server contract.
 * This is deliberately lower than the product-level large-file target: the
 * inline contract materializes JSON, base64 and a decoded Buffer at once.
 */
export const BREP_STEP_MAX_BYTES = 32 * 1024 * 1024;

/** Inline sync path only when decoded buffer is under this size (bytes). */
export const BREP_STEP_SYNC_MAX_BYTES = 3 * 1024 * 1024;

/** Max STEP payload that may be transferred into browser OCCT/WASM. */
export const BREP_STEP_BROWSER_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Product-level target for the future object-storage/job-queue contract.
 * Files above the browser/inline limits must not be routed there until that
 * streaming contract is available.
 */
export const BREP_STEP_LARGE_JOB_MAX_BYTES = 512 * 1024 * 1024;

/** Job TTL (ms). */
export const BREP_JOB_TTL_MS = 60 * 60 * 1000;

/** Worker HTTP timeout (ms); override with `BREP_WORKER_TIMEOUT_MS`. */
export function brepWorkerTimeoutMs(): number {
  const n = Number(process.env.BREP_WORKER_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 5000) return Math.floor(n);
  return 120_000;
}
