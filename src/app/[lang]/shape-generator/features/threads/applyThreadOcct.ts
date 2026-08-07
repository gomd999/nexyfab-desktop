import type { OcctBridge } from '@/lib/occt/bridge';
import type { OcctOperationResult, OcctShape } from '@/lib/occt/types';
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
