/**
 * shippingLayoutOptimizer.ts — Optimize pallet / container packing
 * for shipping product crates.
 *
 * Given a list of finished-product crates (with bounding boxes +
 * weights) and a pallet / container spec, the module computes a
 * stacking arrangement that maximizes load utilization while
 * respecting:
 *
 *   - Max weight capacity.
 *   - Max stack height.
 *   - Fragile items can't be at the bottom.
 *   - Some items can't be rotated.
 *
 * Uses a layered (palletizing) heuristic: pack tallest/heaviest at
 * the bottom layer, then lighter / smaller above.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Crate {
  id: string;
  /** Bounding box dimensions. */
  widthMm: number;
  depthMm: number;
  heightMm: number;
  weightKg: number;
  /** Allow 90° rotation in horizontal plane. */
  rotatable: boolean;
  /** Cannot have anything stacked on top. */
  fragile: boolean;
  /** Cannot be rotated to its side (e.g., orientation arrow). */
  topUpOnly?: boolean;
}

export interface PalletSpec {
  widthMm: number;
  depthMm: number;
  maxHeightMm: number;
  maxWeightKg: number;
}

export interface PlacedCrate {
  id: string;
  /** Origin (corner with smallest x, y, z). */
  origin: Vec3;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /** Rotation 0 or 90 in horizontal plane. */
  rotationDeg: 0 | 90;
}

export interface PackResult {
  placed: PlacedCrate[];
  unplaced: Array<{ id: string; reason: string }>;
  totalWeightKg: number;
  totalVolumeMm3: number;
  bottomFootprintFraction: number;
  stackedHeightMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function packCrates(crates: Crate[], pallet: PalletSpec): PackResult {
  const palletArea = pallet.widthMm * pallet.depthMm;
  // Sort: non-fragile-heavy first, fragile-light last.
  const sorted = [...crates].sort((a, b) => {
    if (a.fragile !== b.fragile) return a.fragile ? 1 : -1;
    return b.weightKg - a.weightKg || (b.widthMm * b.depthMm) - (a.widthMm * a.depthMm);
  });

  const placed: PlacedCrate[] = [];
  const unplaced: Array<{ id: string; reason: string }> = [];
  let totalWeight = 0;
  let layerOriginZ = 0;
  let layerMaxHeight = 0;
  let currentLayer: PlacedCrate[] = [];

  function openNewLayer(): void {
    layerOriginZ += layerMaxHeight;
    layerMaxHeight = 0;
    currentLayer = [];
  }

  for (const crate of sorted) {
    if (crate.widthMm > pallet.widthMm && crate.depthMm > pallet.widthMm) {
      unplaced.push({ id: crate.id, reason: 'too wide for pallet' });
      continue;
    }
    if (totalWeight + crate.weightKg > pallet.maxWeightKg) {
      unplaced.push({ id: crate.id, reason: 'exceeds pallet weight' });
      continue;
    }
    // Try to fit in current layer.
    const placement = tryFitInLayer(crate, pallet, currentLayer);
    if (placement) {
      const placedCrate = buildPlaced(crate, placement, layerOriginZ);
      // Check stack-height + fragility.
      const stackedAbove = currentLayer.find(p => sharesFootprint(p, placedCrate));
      if (stackedAbove) {
        const aboveCrate = crates.find(c => c.id === stackedAbove.id);
        if (aboveCrate?.fragile) {
          unplaced.push({ id: crate.id, reason: 'cannot stack on fragile item' });
          continue;
        }
      }
      if (layerOriginZ + placedCrate.heightMm > pallet.maxHeightMm) {
        unplaced.push({ id: crate.id, reason: 'exceeds pallet height' });
        continue;
      }
      currentLayer.push(placedCrate);
      placed.push(placedCrate);
      totalWeight += crate.weightKg;
      if (placedCrate.heightMm > layerMaxHeight) layerMaxHeight = placedCrate.heightMm;
    } else {
      // Open new layer.
      openNewLayer();
      const retry = tryFitInLayer(crate, pallet, currentLayer);
      if (retry) {
        const placedCrate = buildPlaced(crate, retry, layerOriginZ);
        if (layerOriginZ + placedCrate.heightMm > pallet.maxHeightMm) {
          unplaced.push({ id: crate.id, reason: 'exceeds pallet height' });
          continue;
        }
        currentLayer.push(placedCrate);
        placed.push(placedCrate);
        totalWeight += crate.weightKg;
        if (placedCrate.heightMm > layerMaxHeight) layerMaxHeight = placedCrate.heightMm;
      } else {
        unplaced.push({ id: crate.id, reason: 'no fit in fresh layer' });
      }
    }
  }

  const totalVolume = placed.reduce((s, p) => s + p.widthMm * p.depthMm * p.heightMm, 0);
  // Bottom footprint: sum bottom-layer footprints / pallet area.
  const bottomLayer = placed.filter(p => p.origin.z === 0);
  const bottomArea = bottomLayer.reduce((s, p) => s + p.widthMm * p.depthMm, 0);

  return {
    placed,
    unplaced,
    totalWeightKg: totalWeight,
    totalVolumeMm3: totalVolume,
    bottomFootprintFraction: palletArea > 0 ? bottomArea / palletArea : 0,
    stackedHeightMm: layerOriginZ + layerMaxHeight,
  };
}

// ── Try-fit helper ────────────────────────────────────────────

function tryFitInLayer(crate: Crate, pallet: PalletSpec, current: PlacedCrate[]): { origin: Vec3; w: number; d: number; h: number; rot: 0 | 90 } | null {
  const orientations: Array<{ w: number; d: number; rot: 0 | 90 }> = [
    { w: crate.widthMm, d: crate.depthMm, rot: 0 },
  ];
  if (crate.rotatable && crate.widthMm !== crate.depthMm) {
    orientations.push({ w: crate.depthMm, d: crate.widthMm, rot: 90 });
  }
  for (const o of orientations) {
    const candidates: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    for (const p of current) {
      candidates.push({ x: p.origin.x + p.widthMm, y: p.origin.y, z: 0 });
      candidates.push({ x: p.origin.x, y: p.origin.y + p.depthMm, z: 0 });
    }
    for (const c of candidates) {
      if (c.x + o.w > pallet.widthMm || c.y + o.d > pallet.depthMm) continue;
      const overlap = current.some(p =>
        c.x < p.origin.x + p.widthMm &&
        c.x + o.w > p.origin.x &&
        c.y < p.origin.y + p.depthMm &&
        c.y + o.d > p.origin.y,
      );
      if (overlap) continue;
      return { origin: c, w: o.w, d: o.d, h: crate.heightMm, rot: o.rot };
    }
  }
  return null;
}

function buildPlaced(crate: Crate, placement: { origin: Vec3; w: number; d: number; h: number; rot: 0 | 90 }, layerOriginZ: number): PlacedCrate {
  return {
    id: crate.id,
    origin: { x: placement.origin.x, y: placement.origin.y, z: layerOriginZ },
    widthMm: placement.w,
    depthMm: placement.d,
    heightMm: placement.h,
    rotationDeg: placement.rot,
  };
}

function sharesFootprint(a: PlacedCrate, b: PlacedCrate): boolean {
  if (a.origin.z !== b.origin.z - a.heightMm) return false;
  return a.origin.x < b.origin.x + b.widthMm && a.origin.x + a.widthMm > b.origin.x &&
         a.origin.y < b.origin.y + b.depthMm && a.origin.y + a.depthMm > b.origin.y;
}

// ── Summary ────────────────────────────────────────────────────

export interface PackSummary {
  placedCount: number;
  unplacedCount: number;
  weightUtilization: number;
  volumeUtilizationFraction: number;
  bottomFootprintFraction: number;
  isFull: boolean;
}

export function summarize(crates: Crate[], pallet: PalletSpec, result: PackResult): PackSummary {
  const palletVolume = pallet.widthMm * pallet.depthMm * pallet.maxHeightMm;
  return {
    placedCount: result.placed.length,
    unplacedCount: result.unplaced.length,
    weightUtilization: pallet.maxWeightKg > 0 ? result.totalWeightKg / pallet.maxWeightKg : 0,
    volumeUtilizationFraction: palletVolume > 0 ? result.totalVolumeMm3 / palletVolume : 0,
    bottomFootprintFraction: result.bottomFootprintFraction,
    isFull: result.unplaced.length === 0,
  };
}
