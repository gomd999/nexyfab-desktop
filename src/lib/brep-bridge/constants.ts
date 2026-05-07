/** Max decoded STEP payload size (bytes). */
export const BREP_STEP_MAX_BYTES = 32 * 1024 * 1024;

/** Inline sync path only when decoded buffer is under this size (bytes). */
export const BREP_STEP_SYNC_MAX_BYTES = 3 * 1024 * 1024;

/** Job TTL (ms). */
export const BREP_JOB_TTL_MS = 60 * 60 * 1000;

/** Worker HTTP timeout (ms); override with `BREP_WORKER_TIMEOUT_MS`. */
export function brepWorkerTimeoutMs(): number {
  const n = Number(process.env.BREP_WORKER_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 5000) return Math.floor(n);
  return 120_000;
}
