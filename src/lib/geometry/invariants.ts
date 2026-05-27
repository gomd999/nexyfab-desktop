/**
 * Geometry invariants — runtime assertions that catch silent corruption
 * before it reaches the user or the STEP export.
 *
 * Pattern: every B-rep / CSG / feature operation that returns a solid
 * should call `assertManifold(result)` before returning. In development
 * (NODE_ENV !== 'production') the assertion throws with a precise
 * message so the test or dev session sees it immediately. In production
 * the assertion is a silent metric — we don't want to crash the user's
 * session, but we *do* want to know that an invariant was violated so
 * Sentry alert rule #1 (engine fallback) and the per-operation telemetry
 * can fire.
 *
 * Cost: a single `validateGeometry` pass per assertion (~O(n) on tri
 * count). Fine for assertion sites that fire once per feature apply.
 * Do NOT call inside tight loops — call once at the boundary of the op.
 */

import * as THREE from 'three';
import { validateGeometry, type ValidationResult } from '@/app/[lang]/shape-generator/analysis/geometryValidation';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * In production we never throw — geometry corruption shouldn't crash the
 * user's session. Dev/test sessions throw so the regression is impossible
 * to ignore.
 */
const SHOULD_THROW = process.env.NODE_ENV !== 'production';

export interface InvariantContext {
  /** Operation that produced this geometry — e.g. "boolean.union", "fillet". */
  op: string;
  /** Additional fields for the telemetry payload. */
  [key: string]: unknown;
}

export class GeometryInvariantError extends Error {
  override readonly name = 'GeometryInvariantError';
  constructor(
    public readonly invariant: 'manifold' | 'watertight' | 'non-zero-volume' | 'valid',
    message: string,
    public readonly context: InvariantContext,
    public readonly result?: Partial<ValidationResult>,
  ) {
    super(message);
  }
}

// ─── Telemetry forwarding ───────────────────────────────────────────────────

function report(err: GeometryInvariantError): void {
  // Browser: route through shape-generator telemetry which already handles
  // PII scrub + Sentry forward (Wave 0 Day 5).
  if (typeof window !== 'undefined') {
    void import('@/app/[lang]/shape-generator/lib/telemetry').then(t => {
      t.reportError('feature_pipeline', err, {
        ...err.context,
        invariant: err.invariant,
        result: err.result,
      });
    }).catch(() => { /* telemetry SDK not loaded */ });
    return;
  }
  // Server: log to stderr. Sentry server SDK picks up via console capture.
  console.error('[geometry-invariant]', err.invariant, err.message, err.context);
}

function fail(err: GeometryInvariantError): void {
  report(err);
  if (SHOULD_THROW) throw err;
}

// ─── Assertions ─────────────────────────────────────────────────────────────

/**
 * Every edge belongs to exactly two faces. The most fundamental B-rep
 * invariant — a non-manifold edge means STEP export will produce an
 * invalid file, downstream FEA meshing will fail, and CAM toolpath
 * generation will degrade.
 */
export function assertManifold(geo: THREE.BufferGeometry, context: InvariantContext): void {
  // Skip cheap when production + no observer attached.
  if (!SHOULD_THROW && typeof window === 'undefined') return;
  const v = validateGeometry(geo);
  if (v.isManifold) return;
  fail(new GeometryInvariantError(
    'manifold',
    `Non-manifold mesh: ${v.nonManifoldEdges} bad edge(s) — ${v.issues.slice(0, 3).join('; ')}`,
    context,
    { isManifold: v.isManifold, nonManifoldEdges: v.nonManifoldEdges, issues: v.issues },
  ));
}

/**
 * Manifold AND closed (no boundary edges). Watertight is required for any
 * solid that will go to STEP export, 3D-printing slicing, or volume-based
 * cost estimation.
 */
export function assertWatertight(geo: THREE.BufferGeometry, context: InvariantContext): void {
  if (!SHOULD_THROW && typeof window === 'undefined') return;
  const v = validateGeometry(geo);
  if (v.isManifold && v.isClosed) return;
  fail(new GeometryInvariantError(
    'watertight',
    `Not watertight: manifold=${v.isManifold} closed=${v.isClosed} openEdges=${v.openEdges}`,
    context,
    { isManifold: v.isManifold, isClosed: v.isClosed, openEdges: v.openEdges },
  ));
}

/**
 * Signed volume must be positive and non-trivially-small. A zero or
 * negative volume means inside-out normals or a degenerate solid — both
 * are silent failures that look correct in the viewport but break every
 * downstream consumer.
 */
export function assertNonZeroVolume(
  geo: THREE.BufferGeometry,
  context: InvariantContext,
  options?: { minVolumeMm3?: number },
): void {
  if (!SHOULD_THROW && typeof window === 'undefined') return;
  const v = validateGeometry(geo);
  const min = options?.minVolumeMm3 ?? 1e-6;
  if (v.volume > min) return;
  fail(new GeometryInvariantError(
    'non-zero-volume',
    `Bad volume: ${v.volume.toExponential(3)} mm³ (min ${min.toExponential(3)}) — likely inverted normals`,
    context,
    { volume: v.volume },
  ));
}

/**
 * Combined: manifold AND watertight AND non-zero positive volume. Use at
 * the boundary of any feature pipeline that must produce a "real solid".
 */
export function assertValidSolid(
  geo: THREE.BufferGeometry,
  context: InvariantContext,
  options?: { minVolumeMm3?: number },
): void {
  if (!SHOULD_THROW && typeof window === 'undefined') return;
  const v = validateGeometry(geo);
  const min = options?.minVolumeMm3 ?? 1e-6;
  if (v.isManifold && v.isClosed && v.volume > min) return;
  fail(new GeometryInvariantError(
    'valid',
    `Invalid solid: manifold=${v.isManifold} closed=${v.isClosed} volume=${v.volume.toExponential(3)} (min ${min.toExponential(3)})`,
    context,
    {
      isManifold: v.isManifold,
      isClosed: v.isClosed,
      volume: v.volume,
      nonManifoldEdges: v.nonManifoldEdges,
      openEdges: v.openEdges,
    },
  ));
}

/**
 * For callers that prefer a boolean instead of throwing. Reports to
 * telemetry if invalid but never throws.
 */
export function isValidSolid(geo: THREE.BufferGeometry, context: InvariantContext): boolean {
  const v = validateGeometry(geo);
  const ok = v.isManifold && v.isClosed && v.volume > 1e-6;
  if (!ok) {
    report(new GeometryInvariantError(
      'valid',
      `isValidSolid: manifold=${v.isManifold} closed=${v.isClosed} volume=${v.volume.toExponential(3)}`,
      context,
      { isManifold: v.isManifold, isClosed: v.isClosed, volume: v.volume },
    ));
  }
  return ok;
}
