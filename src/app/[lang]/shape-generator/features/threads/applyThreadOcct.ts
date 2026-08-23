import type { OcctBridge } from '@/lib/occt/bridge';
import type { OcctOperationResult, OcctShape } from '@/lib/occt/types';
import { BufferGeometry } from 'three';
import {
  occtBooleanSolids,
  occtSweepHelix,
  type OcctExtrudeResult,
} from '../occtEngine';
import { findThreadRow } from './threadCatalog';
import type { ThreadFeature } from './threadFeature';

export const MAX_EXACT_THREAD_TURNS = 8;

export interface ThreadOcctPlacement {
  center: { x: number; y: number };
  z0: number;
}

/** Apply a catalog-backed cylindrical thread as an exact OCCT BREP cut. */
export async function applyThreadOcct(
  bridge: OcctBridge,
  parent: OcctShape,
  feature: ThreadFeature,
  placement: ThreadOcctPlacement,
): Promise<OcctOperationResult> {
  if (feature.mode !== 'geometric') {
    return { ok: false, error: 'applyThreadOcct: geometric mode required', warnings: [] };
  }
  const row = findThreadRow(feature.threadRef.series, feature.threadRef.designation);
  if (!row) return { ok: false, error: 'applyThreadOcct: unknown thread designation', warnings: [] };
  if (row.isTapered) {
    return { ok: false, error: 'applyThreadOcct: tapered NPT/BSPT BREP threads are not yet supported', warnings: [] };
  }
  if (!(feature.length > 0)) return { ok: false, error: 'applyThreadOcct: positive thread length required', warnings: [] };
  const turns = feature.length / row.pitch;
  if (turns > MAX_EXACT_THREAD_TURNS) {
    return {
      ok: false,
      error: `applyThreadOcct: ${turns.toFixed(2)} turns exceeds browser exact-thread limit ${MAX_EXACT_THREAD_TURNS}`,
      warnings: [],
    };
  }
  if (!bridge.buildThreadHelixCutter) {
    return { ok: false, error: 'applyThreadOcct: bridge has no exact helix cutter', warnings: [] };
  }

  const overlap = 0.01;
  const innerRadius = feature.threadKind === 'internal'
    ? Math.max(1e-6, row.tapDrill / 2 - overlap)
    : row.minorDiameter / 2;
  const outerRadius = feature.threadKind === 'external'
    ? row.nominalDia / 2 + overlap
    : row.nominalDia / 2;
  const cutter = await bridge.buildThreadHelixCutter({
    center: placement.center,
    z0: placement.z0 + feature.startOffset,
    innerRadius,
    outerRadius,
    pitch: row.pitch,
    lengthMm: feature.length,
    direction: feature.threadDirection,
    threadKind: feature.threadKind,
  });
  if (!cutter.ok || !cutter.shape) return cutter;
  const cut = await bridge.boolean.subtract(parent, cutter.shape, {
    baseId: feature.parentFeatureId ?? parent.id,
    toolId: `${feature.id}:helix-cutter`,
    opId: feature.id,
  });
  bridge.release(cutter.shape);
  if (!cut.ok || !cut.shape) return cut;
  return {
    ...cut,
    warnings: [...cutter.warnings, ...cut.warnings, `${row.designation}: exact BREP ${turns.toFixed(2)} turns`],
  };
}

/**
 * Product-registry adapter for the in-process OCCT feature pipeline.
 *
 * The catalog bridge above carries `OcctShape`s. Ordinary feature execution
 * carries a live replicad registry handle instead, so this adapter builds an
 * exact triangular helical cutter in that registry and subtracts it directly.
 * No display-mesh reconstruction is accepted.
 */
export function applyThreadOcctRegistered(
  parentHandle: string | null | undefined,
  options: {
    radius: number;
    height: number;
    pitch: number;
    depth: number;
    includedAngleDeg: number;
    direction?: 'right_hand' | 'left_hand';
    tessellation?: { tolerance?: number; angularTolerance?: number };
  },
): OcctExtrudeResult {
  const { radius, height, pitch, depth, includedAngleDeg } = options;
  const unavailable = (): OcctExtrudeResult => ({ geometry: new BufferGeometry(), handle: null });
  if (!parentHandle || !(radius > depth) || !(height > pitch) || !(pitch > 0)
    || !(depth > 0) || !(includedAngleDeg > 0 && includedAngleDeg < 180)) {
    return unavailable();
  }
  const turns = Math.floor(height / pitch);
  if (turns < 1 || turns > MAX_EXACT_THREAD_TURNS) return unavailable();
  const axialSpan = height - pitch;
  if (!(axialSpan > 0)) return unavailable();
  const effectivePitch = axialSpan / turns;
  const margin = Math.max(0.05, depth * 0.08);
  const radialSpan = depth + margin;
  const halfOpening = Math.min(
    radialSpan * Math.tan((includedAngleDeg * Math.PI) / 360),
    effectivePitch * 0.45,
  );
  if (!(halfOpening > 0)) return unavailable();
  const halfRadial = radialSpan / 2;
  const cutter = occtSweepHelix(
    [
      { x: -halfRadial, y: 0 },
      { x: halfRadial, y: -halfOpening },
      { x: halfRadial, y: halfOpening },
    ],
    effectivePitch,
    axialSpan,
    radius - depth / 2 + margin / 2,
    options.tessellation,
    [0, 1, 0],
    options.direction === 'left_hand',
    [0, -height / 2 + pitch / 2, 0],
  );
  if (!cutter.handle) return cutter;
  return occtBooleanSolids(
    'subtract',
    parentHandle,
    cutter.handle,
    options.tessellation,
  );
}
