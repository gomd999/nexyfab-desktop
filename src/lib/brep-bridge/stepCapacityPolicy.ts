import {
  BREP_STEP_BROWSER_MAX_BYTES,
  BREP_STEP_LARGE_JOB_MAX_BYTES,
  BREP_STEP_MAX_BYTES,
  BREP_STEP_SYNC_MAX_BYTES,
} from './constants';

export type StepProcessingRoute =
  | 'server-sync-inline'
  | 'server-async-inline'
  | 'browser-worker'
  | 'large-job-required'
  | 'unsupported-size';

export interface StepCapacityDecision {
  route: StepProcessingRoute;
  maxBytes: number;
  reason: string;
}

/**
 * One source of truth for STEP capacity. It prevents a UI limit increase from
 * accidentally sending a very large ArrayBuffer to browser WASM or JSON/base64.
 */
export function decideStepProcessingRoute(
  bytes: number,
  options: { authenticated: boolean; serverEnabled: boolean },
): StepCapacityDecision {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    return { route: 'unsupported-size', maxBytes: BREP_STEP_LARGE_JOB_MAX_BYTES, reason: 'invalid-size' };
  }

  if (options.authenticated && options.serverEnabled && bytes <= BREP_STEP_SYNC_MAX_BYTES) {
    return { route: 'server-sync-inline', maxBytes: BREP_STEP_SYNC_MAX_BYTES, reason: 'small-server-job' };
  }
  if (options.authenticated && options.serverEnabled && bytes <= BREP_STEP_MAX_BYTES) {
    return { route: 'server-async-inline', maxBytes: BREP_STEP_MAX_BYTES, reason: 'server-job' };
  }
  if (bytes <= BREP_STEP_BROWSER_MAX_BYTES) {
    return { route: 'browser-worker', maxBytes: BREP_STEP_BROWSER_MAX_BYTES, reason: 'browser-safe-range' };
  }
  if (bytes <= BREP_STEP_LARGE_JOB_MAX_BYTES) {
    return { route: 'large-job-required', maxBytes: BREP_STEP_LARGE_JOB_MAX_BYTES, reason: 'streaming-job-required' };
  }
  return { route: 'unsupported-size', maxBytes: BREP_STEP_LARGE_JOB_MAX_BYTES, reason: 'product-limit-exceeded' };
}

export function formatStepCapacityMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
