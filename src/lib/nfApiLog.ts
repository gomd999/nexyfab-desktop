/**
 * Lightweight structured logs for Nexyfab HTTP API routes (STEP/OpenSCAD bridge).
 * Set `NF_API_DEBUG=1` for verbose lines (worker retries, timings).
 */

export function nfApiInfo(scope: string, event: string, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.info(`[nf-api] ${scope} ${event}`, fields);
  } else {
    console.info(`[nf-api] ${scope} ${event}`);
  }
}

export function nfApiWarn(scope: string, event: string, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.warn(`[nf-api] ${scope} ${event}`, fields);
  } else {
    console.warn(`[nf-api] ${scope} ${event}`);
  }
}

export function nfApiDebug(scope: string, event: string, fields?: Record<string, unknown>): void {
  if (process.env.NF_API_DEBUG !== '1') return;
  if (fields && Object.keys(fields).length > 0) {
    console.debug(`[nf-api:debug] ${scope} ${event}`, fields);
  } else {
    console.debug(`[nf-api:debug] ${scope} ${event}`);
  }
}
