/**
 * Shared server-OCCT fallback helper — W17 (ADR-007).
 *
 * fillet / chamfer / shell each have local sync + async paths, plus a
 * mesh-CSG fallback. Their server-fallback logic is the same shape as
 * boolean's (PR #19) but with op-specific param mappings. This module
 * holds the common scaffolding so each op's file stays small.
 *
 * Decision tree (per op):
 *   1. serverOpts.jwtToken set?       → no → return null (caller falls back)
 *   2. shouldUseServer(geometry)?     → no → return null
 *   3. POST /occt/op/{op} (serverFn)  → 5xx/network → warn + null
 *   4. fetchR2Bytes(stl)              → parseSTL → BufferGeometry
 *   5. Stash stepR2Key on geometry.userData.serverStepR2Key
 *   6. Return geometry — caller uses it instead of running local.
 *
 * The helper returns null (not throw) on graceful failures so callers
 * can fall back cleanly to local paths. A 400 from the server IS a
 * throw because local would also fail on the same params.
 */

import type * as THREE from 'three';
import {
  fetchR2Bytes,
  ServerOcctUnavailableError,
  type ServerOpResponse,
  type ServerDispatchOptions,
} from '@/lib/occt-server-client';
import { reportInfo, reportWarning } from '../lib/telemetry';
import { parseSTL } from '../io/importers';

/** Volume threshold above which server is preferred over local. Same
 *  number used by shouldUseServerBoolean — keep the heuristic uniform
 *  so a workflow doesn't flip between server and local per op. */
const SERVER_HOST_VOLUME_THRESHOLD_MM3 = 1_000_000;

export interface ServerOpts {
  jwtToken: string;
  baseUrl?: string;
  appBaseUrl?: string;
  forceServer?: boolean;
  signal?: AbortSignal;
}

/** True when the host's bbox volume crosses the threshold (or caller
 *  forces). Reads geometry.boundingBox; computes it if missing. */
export function shouldUseServerForHost(
  geometry: THREE.BufferGeometry,
  opts: { forceServer?: boolean } = {},
): boolean {
  if (opts.forceServer) return true;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return false;
  const sx = bbox.max.x - bbox.min.x;
  const sy = bbox.max.y - bbox.min.y;
  const sz = bbox.max.z - bbox.min.z;
  return sx * sy * sz >= SERVER_HOST_VOLUME_THRESHOLD_MM3;
}

/** Generic server-fallback runner. Returns the parsed geometry on
 *  success, null on graceful failure (so the caller falls through to
 *  the local path). Throws on 400 (bad params, local would also fail).
 *
 *  @param opName  Telemetry / log label ('fillet' | 'chamfer' | 'shell' | …).
 *  @param geometry  Input geometry (used to stash stepR2Key on success).
 *  @param serverFn  The op-specific wrapper (serverFillet / serverChamfer / …).
 *  @param opts  ServerOpts threaded from the UI layer.
 */
export async function tryServerOp(
  opName: string,
  geometry: THREE.BufferGeometry,
  serverFn: (options: ServerDispatchOptions) => Promise<ServerOpResponse>,
  opts: ServerOpts,
): Promise<THREE.BufferGeometry | null> {
  if (!opts.jwtToken) return null;
  if (!shouldUseServerForHost(geometry, { forceServer: opts.forceServer })) {
    return null;
  }

  const t0 = Date.now();
  try {
    const resp = await serverFn({
      jwtToken: opts.jwtToken,
      baseUrl: opts.baseUrl,
      signal: opts.signal,
    });
    const stlBuf = await fetchR2Bytes(resp.stlR2Key, {
      jwtToken: opts.jwtToken,
      baseUrl: opts.appBaseUrl,
      signal: opts.signal,
    });
    const geo = parseSTL(stlBuf);
    geo.userData.serverStepR2Key = resp.stepR2Key;
    reportInfo('csg', `server_${opName}_path_ok`, {
      elapsedMs: Date.now() - t0,
      serverElapsedMs: resp.elapsedMs,
      triangles: resp.meta.triangles,
    });
    return geo;
  } catch (err) {
    if (err instanceof ServerOcctUnavailableError && err.status === 400) {
      // Bad params: throw — local would also reject these.
      throw err;
    }
    reportWarning('csg', err, {
      phase: `server_${opName}_fallback`,
      elapsedMs: Date.now() - t0,
    });
    return null;
  }
}

/** Read back the upstream STEP key stashed by a previous server op.
 *  Lets chained ops pass `sourceR2Key` instead of host dims. */
export function getSourceR2Key(geometry: THREE.BufferGeometry): string | undefined {
  const k = geometry.userData?.serverStepR2Key;
  return typeof k === 'string' ? k : undefined;
}
