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

export interface StepRoundtripCycle {
  readonly cycle: number;
  readonly driftFromPrevious: RoundtripDrift;
  readonly driftFromOriginal: RoundtripDrift;
  readonly exportBytes: number;
}

export interface StepRoundtripCyclesResult {
  readonly cycles: StepRoundtripCycle[];
  readonly importFailed: boolean;
  readonly failedCycle?: number;
  readonly failedExportBytes?: number;
  readonly importErrorMessage?: string;
}

function brokenDrift(): RoundtripDrift {
  return {
    volumeDriftPct: Infinity,
    surfaceDriftPct: Infinity,
    bboxDeltaMax: Infinity,
    vertexCountDelta: 0,
    triangleCountDelta: 0,
    hashChanged: true,
    verdict: 'broken',
  };
}

/**
 * Repeats the real STEP export -> import chain. Each cycle compares against
 * both its direct input and the original geometry so cumulative drift cannot
 * hide behind individually small steps.
 */
export async function runStepRoundtripCycles(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
  cycleCount = 3,
): Promise<StepRoundtripCyclesResult> {
  if (!Number.isInteger(cycleCount) || cycleCount < 1 || cycleCount > 10) {
    throw new Error('STEP_ROUNDTRIP_CYCLE_COUNT_INVALID');
  }
  const [{ exportToStepAsync }, { importStepFile }, { computeSignature }] =
    await Promise.all([
      import('./stepExporter'),
      import('./stepImporter'),
      import('../__tests__/geometrySignature'),
    ]);
  const original = computeSignature(geometry);
  let current = geometry;
  const cycles: StepRoundtripCycle[] = [];
  for (let index = 0; index < cycleCount; index += 1) {
    const before = computeSignature(current);
    const stepText = await exportToStepAsync(current, `${partName}_r${index + 1}`);
    const bytes = new TextEncoder().encode(stepText);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    try {
      const imported = await importStepFile(buffer);
      const after = computeSignature(imported.geometry);
      cycles.push({
        cycle: index + 1,
        driftFromPrevious: computeRoundtripDrift(before, after),
        driftFromOriginal: computeRoundtripDrift(original, after),
        exportBytes: stepText.length,
      });
      current = imported.geometry;
    } catch (error) {
      return {
        cycles,
        importFailed: true,
        failedCycle: index + 1,
        failedExportBytes: stepText.length,
        importErrorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { cycles, importFailed: false };
}

export async function runStepRoundtripReport(
  geometry: THREE.BufferGeometry,
  partName = 'NexyFab_Part',
): Promise<RoundtripChainResult> {
  const result = await runStepRoundtripCycles(geometry, partName, 1);
  const cycle = result.cycles[0];
  return cycle
    ? { drift: cycle.driftFromPrevious, importFailed: false, exportBytes: cycle.exportBytes }
    : {
        drift: brokenDrift(),
        importFailed: true,
        importErrorMessage: result.importErrorMessage,
        exportBytes: result.failedExportBytes ?? 0,
      };
}
