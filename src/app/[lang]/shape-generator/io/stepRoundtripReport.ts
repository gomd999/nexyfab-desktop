/**
 * stepRoundtripReport.ts — Phase D 후속 "STEP 라운드트립 가시화".
 *
 * Composes the existing exporter + importer + signature helpers into a
 * single diff report so:
 *   - users can see how clean a re-import would be after they export
 *     (UI surface: "export 후 다시 열었을 때 차이")
 *   - regression tests can assert "volumeDriftPct < 0.5%" for any
 *     known-good shape (the existing M1 stepRoundtrip test is binary
 *     pass/fail; this adds the numbers)
 *
 * Two layers:
 *
 *   computeRoundtripDrift(before, after) — pure math, no WASM.
 *     Compares two GeometrySignatures and returns a drift report.
 *
 *   runStepRoundtripReport(geometry) — WASM-required wrapper.
 *     Export → import → signature both → drift report.
 *
 * The drift report is informational, not a hard gate. Callers decide
 * the threshold (M1 burn-in uses 0.5% volume; UI hint may use 5% as a
 * "lossy" warning).
 */

import type * as THREE from 'three';
import type { GeometrySignature } from '../__tests__/geometrySignature';

export interface RoundtripDrift {
  /** |after.volume - before.volume| / before.volume, as percent (0 = perfect). */
  readonly volumeDriftPct: number;
  /** Same for surface area. */
  readonly surfaceDriftPct: number;
  /** Max single-axis absolute delta of bbox min/max points. */
  readonly bboxDeltaMax: number;
  /** after.vertexCount - before.vertexCount (positive = grew). */
  readonly vertexCountDelta: number;
  /** after.triangleCount - before.triangleCount. */
  readonly triangleCountDelta: number;
  /** True if position hash changed (any topology / vertex-order shift). */
  readonly hashChanged: boolean;
  /** Verdict band: 'clean' (<0.5%), 'minor' (<2%), 'lossy' (<10%), 'broken' (>=10% or import failed). */
  readonly verdict: 'clean' | 'minor' | 'lossy' | 'broken';
}

const CLEAN_THRESHOLD_PCT = 0.5;
const MINOR_THRESHOLD_PCT = 2;
const LOSSY_THRESHOLD_PCT = 10;

/** Pure-math drift report. No WASM, safe for default-CI tests. */
export function computeRoundtripDrift(
  before: GeometrySignature,
  after: GeometrySignature,
): RoundtripDrift {
  const volumeDriftPct = absPct(before.volume_mm3, after.volume_mm3);
  const surfaceDriftPct = absPct(before.surfaceArea_mm2, after.surfaceArea_mm2);

  const bboxDeltaMax = Math.max(
    Math.abs(before.bbox.min[0] - after.bbox.min[0]),
    Math.abs(before.bbox.min[1] - after.bbox.min[1]),
    Math.abs(before.bbox.min[2] - after.bbox.min[2]),
    Math.abs(before.bbox.max[0] - after.bbox.max[0]),
    Math.abs(before.bbox.max[1] - after.bbox.max[1]),
    Math.abs(before.bbox.max[2] - after.bbox.max[2]),
  );

  const verdict = pickVerdict(volumeDriftPct, surfaceDriftPct);

  return {
    volumeDriftPct,
    surfaceDriftPct,
    bboxDeltaMax,
    vertexCountDelta: after.vertexCount - before.vertexCount,
    triangleCountDelta: after.triangleCount - before.triangleCount,
    hashChanged: before.positionHash !== after.positionHash,
    verdict,
  };
}

function absPct(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return Infinity;
  if (Math.abs(before) < 1e-9) {
    // Avoid division by zero — fall back to absolute delta scaled by mm
    return Math.abs(after - before);
  }
  return (Math.abs(after - before) / Math.abs(before)) * 100;
}

function pickVerdict(volumePct: number, surfacePct: number): RoundtripDrift['verdict'] {
  const worst = Math.max(volumePct, surfacePct);
  if (!Number.isFinite(worst)) return 'broken';
  if (worst < CLEAN_THRESHOLD_PCT) return 'clean';
  if (worst < MINOR_THRESHOLD_PCT) return 'minor';
  if (worst < LOSSY_THRESHOLD_PCT) return 'lossy';
  return 'broken';
}

/** Render a one-line summary for UI hints + log lines.
 *  Example: "clean · vol 0.02% · surf 0.05% · bbox 0.001mm". */
export function formatRoundtripDrift(d: RoundtripDrift): string {
  return [
    d.verdict,
    `vol ${d.volumeDriftPct.toFixed(2)}%`,
    `surf ${d.surfaceDriftPct.toFixed(2)}%`,
    `bbox ${d.bboxDeltaMax.toFixed(3)}mm`,
    d.hashChanged ? 'hash≠' : 'hash=',
  ].join(' · ');
}

/**
 * Full export → import → diff chain. Requires OCCT WASM (via
 * exportToStepAsync + importStepFile). Returns { drift, importFailed }.
 *
 * `importFailed: true` is treated as a verdict='broken' regardless of
 * numeric drift (importer rejected our export — the worst case).
 */
export interface RoundtripChainResult {
  readonly drift: RoundtripDrift;
  readonly importFailed: boolean;
  readonly importErrorMessage?: string;
  readonly exportBytes: number;
}

export async function runStepRoundtripReport(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
): Promise<RoundtripChainResult> {
  const [{ exportToStepAsync }, { importStepFile }, { computeSignature }] =
    await Promise.all([
      import('./stepExporter'),
      import('./stepImporter'),
      import('../__tests__/geometrySignature'),
    ]);

  const before = computeSignature(geometry);
  const stepText = await exportToStepAsync(geometry, partName);
  const exportBytes = stepText.length;
  const buf = new TextEncoder().encode(stepText);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  try {
    const imported = await importStepFile(ab);
    const after = computeSignature(imported.geometry);
    return { drift: computeRoundtripDrift(before, after), importFailed: false, exportBytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      drift: {
        volumeDriftPct: Infinity,
        surfaceDriftPct: Infinity,
        bboxDeltaMax: Infinity,
        vertexCountDelta: 0,
        triangleCountDelta: 0,
        hashChanged: true,
        verdict: 'broken',
      },
      importFailed: true,
      importErrorMessage: message,
      exportBytes,
    };
  }
}
