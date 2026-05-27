/**
 * Client wrapper for the nexyfab-occt-worker service.
 *
 * Wave 1 W10 D4-5 (ADR-007). Pure HTTP boundary — converts the
 * client-side op call into the worker's REST shape and parses the
 * response. Geometry blobs travel through R2 (NOT this wrapper's
 * request body) so the wrapper itself stays light: params in, R2
 * keys out.
 *
 * Integration into `features/boolean.ts` apply() is deferred to W11
 * because the current apply() is synchronous and server OCCT is
 * inherently async. Two options for the W11 refactor:
 *
 *   1. Promote apply() to async-aware (breaking change for the
 *      synchronous pipeline path).
 *   2. Add a pre-pass step in the pipeline that runs `serverBoolean`
 *      for ops marked as `engine === 1` and host bbox > threshold,
 *      then feeds the result back as the upstream handle to the
 *      sync apply().
 *
 * This module ships the wrapper + its tests; W11 picks the path.
 */

import { reportError, reportInfo } from '@/app/[lang]/shape-generator/lib/telemetry';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Heuristic threshold — when the input geometry exceeds this, prefer
 *  server OCCT. Below it, the latency floor of the HTTP round trip
 *  (~150 ms KR→US-East per ADR-007) costs more than the client OCCT
 *  call. Re-tune after W12 soak data. */
export const SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3 = 1_000_000;

export interface ServerBooleanParams {
  host: { w: number; h: number; d: number };
  /** 0 = cylinder (default), 1 = sphere. Matches main app's
   *  `toolShape` parameter so a single numeric protocol works for
   *  both server and client paths. */
  toolShape: number;
  r: number;
  height?: number;
  cx?: number;
  cy?: number;
  cz?: number;
  type?: 'cut' | 'fuse' | 'intersect';
}

export interface ServerBooleanResponse {
  stlR2Key: string;
  stepR2Key: string;
  meta: {
    volume: number;
    surface: number;
    bbox: { min: [number, number, number]; max: [number, number, number] };
    triangles: number;
    manifold: boolean;
  };
  elapsedMs: number;
  requestId: string;
}

/** True when params shape + size make server OCCT the better choice
 *  vs in-tab client OCCT. Heuristic from ADR-007 §"R2-mediated for
 *  large geometry". */
export function shouldUseServerBoolean(params: ServerBooleanParams): boolean {
  const v = params.host.w * params.host.h * params.host.d;
  return v >= SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3;
}

export class ServerOcctUnavailableError extends Error {
  override readonly name = 'ServerOcctUnavailableError';
  constructor(
    message: string,
    public readonly status?: number,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

/** POST /occt/op/boolean. Throws on 4xx/5xx (caller's job to fall
 *  back to client OCCT). On success returns R2 keys + meta. */
export async function serverBoolean(
  params: ServerBooleanParams,
  options: { jwtToken: string; baseUrl?: string; signal?: AbortSignal; timeoutMs?: number } = { jwtToken: '' },
): Promise<ServerBooleanResponse> {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_OCCT_WORKER_URL ?? '';
  if (!baseUrl) {
    throw new ServerOcctUnavailableError('NEXT_PUBLIC_OCCT_WORKER_URL not configured');
  }
  if (!options.jwtToken) {
    throw new ServerOcctUnavailableError('jwtToken required');
  }

  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller!.signal;
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    : null;

  const t0 = Date.now();
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/occt/op/boolean`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.jwtToken}`,
      },
      body: JSON.stringify({ params }),
      signal,
    });

    if (resp.status === 400) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string; requestId?: string };
      throw new ServerOcctUnavailableError(
        `invalid params: ${body.error ?? 'unknown'}`,
        400,
        body.requestId,
      );
    }
    if (resp.status === 401) {
      throw new ServerOcctUnavailableError('jwt rejected', 401);
    }
    if (resp.status === 501) {
      throw new ServerOcctUnavailableError('server op not implemented', 501);
    }
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string; requestId?: string };
      throw new ServerOcctUnavailableError(
        `server error ${resp.status}: ${body.error ?? 'unknown'}`,
        resp.status,
        body.requestId,
      );
    }

    const json = (await resp.json()) as ServerBooleanResponse;
    const elapsed = Date.now() - t0;
    reportInfo('csg', 'server_boolean_ok', {
      elapsedMs: elapsed,
      serverElapsedMs: json.elapsedMs,
      triangles: json.meta.triangles,
      manifold: json.meta.manifold,
    });
    return json;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err instanceof ServerOcctUnavailableError) {
      reportInfo('csg', 'server_boolean_unavailable', {
        status: err.status,
        message: err.message,
        elapsedMs: Date.now() - t0,
      });
      throw err;
    }
    // Network / timeout / parse error. Convert to ServerOcctUnavailableError
    // so callers don't need to know `fetch` failure modes.
    const wrapped = new ServerOcctUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
    reportError('csg', wrapped, {
      phase: 'server_boolean_network',
      elapsedMs: Date.now() - t0,
    });
    throw wrapped;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fetch R2 bytes via the main app's signed-URL endpoint. Two-step:
 *
 *    1. GET /api/nexyfab/r2-fetch?key=… → { signedUrl }
 *       (path-scope checked: caller must own the key)
 *    2. GET signedUrl → bytes (no auth header — R2 signs the query)
 *
 *  This avoids proxying op-output bytes through the main app's dyno;
 *  the client redirects directly to R2 after the small JSON hop. */
export async function fetchR2Bytes(
  r2Key: string,
  options: { jwtToken: string; baseUrl?: string; signal?: AbortSignal } = { jwtToken: '' },
): Promise<ArrayBuffer> {
  const baseUrl = options.baseUrl ?? '';
  if (!options.jwtToken) {
    throw new ServerOcctUnavailableError('jwtToken required for r2-fetch');
  }
  // Step 1 — exchange the R2 key for a signed URL via the main app.
  const signResp = await fetch(
    `${baseUrl}/api/nexyfab/r2-fetch?key=${encodeURIComponent(r2Key)}`,
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${options.jwtToken}` },
      signal: options.signal,
    },
  );
  if (!signResp.ok) {
    throw new ServerOcctUnavailableError(
      `r2-fetch sign ${r2Key} failed with ${signResp.status}`,
      signResp.status,
    );
  }
  const { signedUrl } = (await signResp.json()) as { signedUrl: string };
  if (!signedUrl) {
    throw new ServerOcctUnavailableError('r2-fetch returned no signedUrl');
  }

  // Step 2 — fetch bytes directly from R2 (no main-app proxy).
  const dataResp = await fetch(signedUrl, { signal: options.signal });
  if (!dataResp.ok) {
    throw new ServerOcctUnavailableError(
      `r2 signed-url fetch failed with ${dataResp.status}`,
      dataResp.status,
    );
  }
  return dataResp.arrayBuffer();
}

/** @deprecated Renamed to `fetchR2Bytes` to reflect that the helper
 *  is format-agnostic (STL / STEP / anything the worker wrote). Kept
 *  as a thin alias so any pre-W10-D5 caller keeps compiling. */
export const fetchR2Stl = fetchR2Bytes;
