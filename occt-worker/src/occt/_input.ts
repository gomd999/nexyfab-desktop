/**
 * Shape input resolver — W16 D1-2 (ADR-007).
 *
 * 3D-host ops (boolean / fillet / chamfer / shell / mirror / pattern)
 * accept EITHER a primitive `host: { w, h, d }` OR a `sourceR2Key`
 * pointing to a STEP file in R2. The R2 path lets clients chain ops:
 *
 *     extrude(profile, h=10)   → R2 key A
 *     fillet(sourceR2Key=A)    → R2 key B
 *     boolean(sourceR2Key=B, …) → R2 key C
 *     pattern(sourceR2Key=C, …) → R2 key D
 *
 * Without this, every op had to start from a primitive box — fine
 * for one-shot operations but not for real CAD pipelines.
 *
 * Security:
 *   - sourceR2Key MUST start with `occt-ops/<userId>/`. Identical
 *     prefix gate to the main app's /api/nexyfab/r2-fetch — one user
 *     can't read another user's intermediate shapes by guessing keys.
 *   - Validator rejects bad prefixes as 400 BEFORE the pool dispatch,
 *     so a malicious payload doesn't even reach the kernel.
 *
 * Format support:
 *   - STEP via replicad's high-level importSTEP / readSTEP probe.
 *   - Binary STL would belong here too but the worker's outputs are
 *     STEP first-class — keep this single-format until that changes.
 */

import { r2Get } from '../r2.js';
import type { ReplicadLike, OcctShape } from './_types.js';

export interface HostBox {
  w: number;
  h: number;
  d: number;
}

export interface ShapeInput {
  /** Primitive host — exactly one of host or sourceR2Key must be set. */
  host?: HostBox;
  /** R2 key pointing to a STEP file produced by a previous op. */
  sourceR2Key?: string;
}

/** Threaded into 3D-host op handlers so they can enforce per-user
 *  R2 prefix and (future) per-user telemetry / quotas. */
export interface OpContext {
  userId: string;
}

interface ReplicadWithImport extends ReplicadLike {
  importSTEP?: (text: string) => Promise<OcctShape> | OcctShape;
  readSTEP?: (text: string) => Promise<OcctShape> | OcctShape;
}

/** Validate that exactly one of host / sourceR2Key is set, and that
 *  sourceR2Key matches the caller's user prefix. Throws "invalid
 *  params: ..." so the dispatchOp 400 mapping catches it. */
export function validateShapeInput(input: ShapeInput, userId: string): void {
  const hasHost = input.host !== undefined;
  const hasKey = input.sourceR2Key !== undefined;
  if (hasHost === hasKey) {
    throw new Error(
      'invalid params: exactly one of host or sourceR2Key must be set',
    );
  }
  if (hasKey) {
    const key = input.sourceR2Key!;
    if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
      throw new Error('invalid params: sourceR2Key must be a string ≤ 512 chars');
    }
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error('invalid params: sourceR2Key has illegal path components');
    }
    const expectedPrefix = `occt-ops/${userId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new Error(
        `invalid params: sourceR2Key must start with ${expectedPrefix} (per-user scope)`,
      );
    }
  }
}

/** Resolve a host parameter into an OcctShape. Builds a primitive box
 *  if `host` is set, else fetches + imports STEP from R2 by key. */
export async function resolveShape(
  replicad: ReplicadWithImport,
  input: ShapeInput,
  userId: string,
): Promise<OcctShape> {
  validateShapeInput(input, userId);

  if (input.host) {
    if (!replicad.makeBaseBox) {
      throw new Error('replicad.makeBaseBox unavailable — kernel build mismatch');
    }
    return replicad.makeBaseBox(input.host.w, input.host.h, input.host.d) as OcctShape;
  }

  // R2 STEP import path.
  const key = input.sourceR2Key!;
  let stepBytes: Buffer;
  try {
    stepBytes = await r2Get(key);
  } catch (err) {
    throw new Error(
      `failed to fetch sourceR2Key ${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const stepText = stepBytes.toString('utf8');

  // Probe importSTEP first (modern replicad), then readSTEP (older).
  const importer = replicad.importSTEP ?? replicad.readSTEP;
  if (!importer) {
    throw new Error(
      'replicad kernel exposes no STEP import API (tried importSTEP + readSTEP)',
    );
  }
  try {
    const result = await importer(stepText);
    if (!result || typeof result !== 'object') {
      throw new Error('replicad STEP import returned no shape');
    }
    return result as OcctShape;
  } catch (err) {
    throw new Error(
      `OCCT STEP import from ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
