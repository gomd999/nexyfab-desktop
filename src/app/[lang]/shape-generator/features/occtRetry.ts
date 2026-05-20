/**
 * occtRetry.ts — Resilient wrapper for OCCT operations that
 * progressively relaxes tolerance on failure.
 *
 * OCCT operations (boolean, fillet, chamfer, shell) routinely fail
 * with "tolerance too tight" / "incompatible sub-shapes" errors on
 * inputs that are dimensionally OK but suffer from float-precision
 * issues at the tessellation seam. The fix in practice is to retry
 * with a looser fuzzy tolerance — which is what every CAD package
 * does internally, including SolidWorks (its "tolerant edge" path).
 *
 * Strategy:
 *   - Run the operation with baseline tolerance.
 *   - On throw, retry with tolerance × 10, then × 100, capped at 3
 *     attempts so we don't burn cron budget on genuinely-broken inputs.
 *   - Each attempt logs the tolerance + error so the burn-in cron can
 *     surface "this model needed N retries" as a soft warning.
 *
 * This module is the OCCT side of the resilience story; the input
 * side is `meshValidation` + `meshHealing` (catches malformed mesh
 * before OCCT ever sees it).
 */

export interface OcctRetryAttempt {
  /** 0-based attempt number. */
  attempt: number;
  /** Tolerance value used in this attempt. */
  tolerance: number;
  /** Error from the failed attempt; null when the attempt succeeded. */
  error: Error | null;
}

export interface OcctRetryResult<T> {
  ok: boolean;
  /** Operation result on success; never on failure. */
  value: T | null;
  /** Last error caught when `ok = false`. */
  finalError: Error | null;
  /** Per-attempt diagnostic trail. */
  attempts: OcctRetryAttempt[];
}

export interface OcctRetryOptions {
  /** Baseline tolerance (first attempt). Operation-specific units —
   *  typically 1e-4 to 1e-2 mm for OCCT fuzzy tolerance. */
  baseTolerance: number;
  /** Multiplier applied to tolerance for each retry. */
  relaxFactor?: number;
  /** Maximum number of attempts (including the first). */
  maxAttempts?: number;
}

const DEFAULT_RELAX = 10;
const DEFAULT_ATTEMPTS = 3;

/**
 * Run an OCCT operation with progressive tolerance relaxation.
 *
 * The `op` callback receives the current tolerance and is expected to
 * throw on failure. The wrapper catches, multiplies tolerance by
 * `relaxFactor`, and retries up to `maxAttempts` times.
 *
 * Returns the operation result on the first successful attempt, with
 * a trail of all attempts (so observability stays even when the
 * first try succeeded — useful to flag "this operation needed retry
 * #2, model may have geometric issues").
 */
export async function withOcctRetry<T>(
  op: (tolerance: number) => Promise<T> | T,
  options: OcctRetryOptions,
): Promise<OcctRetryResult<T>> {
  const relax = options.relaxFactor ?? DEFAULT_RELAX;
  const max = Math.max(1, options.maxAttempts ?? DEFAULT_ATTEMPTS);
  const attempts: OcctRetryAttempt[] = [];

  let tolerance = options.baseTolerance;
  let finalError: Error | null = null;

  for (let i = 0; i < max; i++) {
    try {
      const value = await op(tolerance);
      attempts.push({ attempt: i, tolerance, error: null });
      return { ok: true, value, finalError: null, attempts };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      attempts.push({ attempt: i, tolerance, error: err });
      finalError = err;
      tolerance *= relax;
    }
  }

  return { ok: false, value: null, finalError, attempts };
}

/** Synchronous variant for OCCT ops that don't return a Promise (most
 *  replicad calls are sync once the WASM is loaded). */
export function withOcctRetrySync<T>(
  op: (tolerance: number) => T,
  options: OcctRetryOptions,
): OcctRetryResult<T> {
  const relax = options.relaxFactor ?? DEFAULT_RELAX;
  const max = Math.max(1, options.maxAttempts ?? DEFAULT_ATTEMPTS);
  const attempts: OcctRetryAttempt[] = [];

  let tolerance = options.baseTolerance;
  let finalError: Error | null = null;

  for (let i = 0; i < max; i++) {
    try {
      const value = op(tolerance);
      attempts.push({ attempt: i, tolerance, error: null });
      return { ok: true, value, finalError: null, attempts };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      attempts.push({ attempt: i, tolerance, error: err });
      finalError = err;
      tolerance *= relax;
    }
  }

  return { ok: false, value: null, finalError, attempts };
}
