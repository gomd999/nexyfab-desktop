/**
 * Client wrapper for the nexyfab-occt-worker service.
 *
 * Wave 1 W10 (boolean wrapper) + W16 (host-or-R2-key chained input +
 * fillet / chamfer / shell / mirror / pattern wrappers).
 *
 * Pure HTTP boundary — converts the client-side op call into the
 * worker's REST shape and parses the response. Geometry blobs travel
 * through R2 (NOT this wrapper's request body) so the wrapper itself
 * stays light: params in, R2 keys out.
 *
 * Chain pattern:
 *   const a = await serverExtrude(profile, opts);          // a.stepR2Key
 *   const b = await serverFillet({ sourceR2Key: a.stepR2Key, radius: 2 }, opts);
 *   const c = await serverBoolean({ sourceR2Key: b.stepR2Key, … }, opts);
 *   const d = await serverPattern({ sourceR2Key: c.stepR2Key, … }, opts);
 *
 * (Note: extrude wrapper is W16 D3-5 follow-up; this PR ships the 6
 * 3D-host wrappers that match the W16 D1-2 worker-side update.)
 */

import { reportError, reportInfo } from '@/app/[lang]/shape-generator/lib/telemetry';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Heuristic threshold — when the input geometry exceeds this, prefer
 *  server OCCT. Below it, the latency floor of the HTTP round trip
 *  (~150 ms KR→US-East per ADR-007) costs more than the client OCCT
 *  call. Re-tune after W12 soak data. */
export const SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3 = 1_000_000;

// ─── Common shapes ──────────────────────────────────────────────────────────

/** Host input — primitive box XOR R2 STEP key. Caller picks one;
 *  worker validates exactly-one (W16 D1-2). */
export interface ChainableHost {
  host?: { w: number; h: number; d: number };
  /** R2 key from a previous op's `stepR2Key` output. Must start with
   *  `occt-ops/<userId>/` — worker rejects cross-user keys as 400. */
  sourceR2Key?: string;
}

/** Standard response shape across all 6 chainable ops. */
export interface ServerOpResponse {
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

export interface ServerDispatchOptions {
  jwtToken: string;
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
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

// ─── Per-op param shapes ────────────────────────────────────────────────────

export interface ServerBooleanParams extends ChainableHost {
  /** 0 = cylinder (default), 1 = sphere. Required when
   *  toolSourceR2Key is unset; ignored otherwise. */
  toolShape?: number;
  /** Tool radius — required when toolSourceR2Key is unset. */
  r?: number;
  /** Cylinder height — primitive tool only. */
  height?: number;
  cx?: number;
  cy?: number;
  cz?: number;
  /** Shape-vs-shape (W17 PR #24). R2 key from a previous op's
   *  stepR2Key, used AS the tool. Mutually exclusive with primitive
   *  tool fields (toolShape / r / height). Worker enforces XOR; the
   *  client trusts it and just plumbs the field through. */
  toolSourceR2Key?: string;
  type?: 'cut' | 'fuse' | 'intersect';
}

export type FilletEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';
export interface ServerFilletParams extends ChainableHost {
  radius: number;
  edges?: FilletEdgeScope;
}

export type ChamferEdgeScope = 'all' | 'vertical' | 'top' | 'bottom';
export interface ServerChamferParams extends ChainableHost {
  distance: number;
  edges?: ChamferEdgeScope;
}

export type ShellOpenFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export interface ServerShellParams extends ChainableHost {
  thickness: number;
  openFace?: ShellOpenFace;
}

export type MirrorPlane = 'XY' | 'YZ' | 'XZ';
export interface ServerMirrorParams extends ChainableHost {
  plane: MirrorPlane;
}

export interface ServerPatternLinearParams extends ChainableHost {
  kind: 'linear';
  count: number;
  spacing: number;
  axis: 'X' | 'Y' | 'Z';
}
export interface ServerPatternCircularParams extends ChainableHost {
  kind: 'circular';
  count: number;
  totalAngleDeg: number;
  axis: 'X' | 'Y' | 'Z';
}
export type ServerPatternParams = ServerPatternLinearParams | ServerPatternCircularParams;

// ─── Sketch-based ops (W16 D3-5) ────────────────────────────────────────────
// Input is a 2D profile, not a 3D host. Each op uses the same
// profile vocabulary so callers learn one shape and reuse it.

export interface ServerRectangleProfile {
  kind: 'rectangle';
  width: number;
  height2D: number;
}
export interface ServerCircleProfile {
  kind: 'circle';
  radius: number;
}
export interface ServerPolygonProfile {
  kind: 'polygon';
  /** Vertex list as [[x, y], ...]; ≥ 3 points, first ≠ last. */
  points: [number, number][];
}
export interface ServerSvgPathProfile {
  kind: 'svgPath';
  d: string;
  /** Bezier flattening chord-height tolerance, mm. Default 0.1. */
  tolerance?: number;
}
export type ServerProfile =
  | ServerRectangleProfile
  | ServerCircleProfile
  | ServerPolygonProfile
  | ServerSvgPathProfile;

export type ExtrudePlane = 'XY' | 'XZ' | 'YZ';
export interface ServerExtrudeParams {
  profile: ServerProfile;
  /** Extrusion distance along plane normal (mm). */
  height: number;
  plane?: ExtrudePlane;
}

export type RevolvePlane = 'XY' | 'XZ' | 'YZ';
export type RevolveAxis = 'X' | 'Y' | 'Z';
export interface ServerRevolveParams {
  profile: ServerProfile;
  plane?: RevolvePlane;
  axis?: RevolveAxis;
  /** Sweep angle (degrees). Default 360. */
  angle?: number;
}

export interface ServerSweepParams {
  profile: ServerProfile;
  /** 3D polyline path; ≥ 2 points. */
  path: [number, number, number][];
  plane?: 'XY' | 'XZ' | 'YZ';
}

export interface ServerLoftSection {
  profile: ServerProfile;
  /** Distance along plane normal (mm). Sections must be strictly
   *  increasing — the worker rejects out-of-order. */
  offset: number;
}
export interface ServerLoftParams {
  /** ≥ 2 cross-sections; strictly increasing offsets. */
  sections: ServerLoftSection[];
  plane?: 'XY' | 'XZ' | 'YZ';
}

// ─── Generic dispatcher ─────────────────────────────────────────────────────
// All 6 chainable ops use the same POST flow — extract to one function
// so the error mapping + telemetry stay consistent.

type OcctOpName =
  | 'boolean' | 'fillet' | 'chamfer' | 'shell' | 'mirror' | 'pattern'
  | 'extrude' | 'revolve' | 'sweep' | 'loft';

async function serverDispatch<P>(
  op: OcctOpName,
  params: P,
  options: ServerDispatchOptions,
): Promise<ServerOpResponse> {
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
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/occt/op/${op}`, {
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

    const json = (await resp.json()) as ServerOpResponse;
    const elapsed = Date.now() - t0;
    reportInfo('csg', `server_${op}_ok`, {
      elapsedMs: elapsed,
      serverElapsedMs: json.elapsedMs,
      triangles: json.meta.triangles,
      manifold: json.meta.manifold,
    });
    return json;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err instanceof ServerOcctUnavailableError) {
      reportInfo('csg', `server_${op}_unavailable`, {
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
      phase: `server_${op}_network`,
      elapsedMs: Date.now() - t0,
    });
    throw wrapped;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Per-op wrappers ────────────────────────────────────────────────────────

/** POST /occt/op/boolean. Throws on 4xx/5xx (caller's job to fall
 *  back to client OCCT). On success returns R2 keys + meta. */
export function serverBoolean(
  params: ServerBooleanParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('boolean', params, options);
}

/** POST /occt/op/fillet — edge rounding by radius. */
export function serverFillet(
  params: ServerFilletParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('fillet', params, options);
}

/** POST /occt/op/chamfer — edge beveling by distance. */
export function serverChamfer(
  params: ServerChamferParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('chamfer', params, options);
}

/** POST /occt/op/shell — hollow with one open face. */
export function serverShell(
  params: ServerShellParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('shell', params, options);
}

/** POST /occt/op/mirror — reflect across a principal plane. */
export function serverMirror(
  params: ServerMirrorParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('mirror', params, options);
}

/** POST /occt/op/pattern — linear or circular array, fused. */
export function serverPattern(
  params: ServerPatternParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('pattern', params, options);
}

/** POST /occt/op/extrude — 2D profile → 3D solid by `height`. */
export function serverExtrude(
  params: ServerExtrudeParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('extrude', params, options);
}

/** POST /occt/op/revolve — 2D profile around an axis by `angle`. */
export function serverRevolve(
  params: ServerRevolveParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('revolve', params, options);
}

/** POST /occt/op/sweep — 2D profile along a 3D polyline path. */
export function serverSweep(
  params: ServerSweepParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('sweep', params, options);
}

/** POST /occt/op/loft — solid blended between ≥ 2 cross-sections. */
export function serverLoft(
  params: ServerLoftParams,
  options: ServerDispatchOptions = { jwtToken: '' },
): Promise<ServerOpResponse> {
  return serverDispatch('loft', params, options);
}

/** @deprecated W16 D1-2 — boolean response shape is now the common
 *  ServerOpResponse. Kept as an alias so callers compile during the
 *  rename. */
export type ServerBooleanResponse = ServerOpResponse;

/** True when params shape + size make server OCCT the better choice
 *  vs in-tab client OCCT. Heuristic from ADR-007 §"R2-mediated for
 *  large geometry". When sourceR2Key OR toolSourceR2Key is used the
 *  imported shape's volume is unknown — assume large and route to
 *  server. (Shape-vs-shape can't run client-side anyway since the
 *  tool isn't a primitive; routing it to server is the only path.) */
export function shouldUseServerBoolean(params: ServerBooleanParams): boolean {
  if (params.sourceR2Key) return true;
  if (params.toolSourceR2Key) return true;
  if (!params.host) return false;
  const v = params.host.w * params.host.h * params.host.d;
  return v >= SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3;
}

// ─── R2 byte fetcher (unchanged from W10 D5) ────────────────────────────────

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
 *  is format-agnostic (STL / STEP / anything the worker wrote). */
export const fetchR2Stl = fetchR2Bytes;
