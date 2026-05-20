/**
 * dimXpert.ts — Auto-dimensioning from feature recognition.
 *
 * SolidWorks DimXpert reads a part's feature tree and emits the
 * dimensions a manufacturing print needs, placed in legible
 * locations on a drawing view. Two flavors:
 *
 *   - **Geometric DimXpert** (size + position tolerances on features,
 *     used for MBD).
 *   - **Drawing DimXpert** (places the same dimensions on a 2D view).
 *
 * Capabilities:
 *
 *   - **Feature collection** — given the recognized features of the
 *     part (hole / boss / pocket / slot / fillet), emit the right
 *     dimension callouts (Ø, depth, location, size).
 *   - **Chain-dimensioning** vs **baseline-dimensioning** — two
 *     legible layout strategies; baseline preferred for tight
 *     tolerance datums.
 *   - **Smart placement** — avoid overlap by routing leaders around
 *     view geometry. Iterative repulsion-based layout.
 *   - **Hole callouts** — multi-line "⌀ 6.5 ▽ 12" format for
 *     drilled-counterbored holes.
 *
 * Output is a list of `DimXpertDimension` entries ready for the
 * drawing renderer to draw.
 */

export type FeatureKind = 'hole' | 'boss' | 'pocket' | 'slot' | 'fillet' | 'chamfer' | 'face' | 'edge';

export interface RecognizedFeature {
  id: string;
  kind: FeatureKind;
  /** Center / anchor (mm). */
  positionMm: [number, number, number];
  /** Principal size (mm). */
  primarySizeMm: number;
  /** Secondary size (e.g. depth for hole, length for slot). */
  secondarySizeMm?: number;
  /** Tertiary size (e.g. counterbore depth). */
  tertiarySizeMm?: number;
  /** Optional tolerance grade. */
  toleranceGrade?: string;
}

export type DimKind = 'linear' | 'radial' | 'diameter' | 'angular' | 'callout';

export interface DimXpertDimension {
  id: string;
  kind: DimKind;
  /** Dimension label string. */
  label: string;
  /** Numeric value (mm or degrees). */
  value: number;
  /** Tolerance (e.g. "±0.1", "H7"). */
  tolerance?: string;
  /** Drawing position (mm on sheet). */
  position?: [number, number];
  /** Origin entity (feature ids). */
  featureIds: string[];
  /** Leader line: list of polyline points (sheet mm). */
  leader?: Array<[number, number]>;
}

// ── Hole callout formatter ──────────────────────────────────────

export function formatHoleCallout(feature: RecognizedFeature): string {
  const dia = `⌀${feature.primarySizeMm}`;
  const parts: string[] = [dia];
  if (feature.secondarySizeMm) {
    parts.push(`▽ ${feature.secondarySizeMm}`);
  }
  if (feature.tertiarySizeMm) {
    parts.push(`⌴⌀${feature.tertiarySizeMm} ▽ ${feature.tertiarySizeMm * 0.5}`);
  }
  return parts.join(' ');
}

// ── Per-feature dimension generators ─────────────────────────────

function holeToDims(feature: RecognizedFeature, idCounter: { n: number }): DimXpertDimension[] {
  const out: DimXpertDimension[] = [];
  out.push({
    id: `D${++idCounter.n}`,
    kind: 'callout',
    label: formatHoleCallout(feature),
    value: feature.primarySizeMm,
    tolerance: feature.toleranceGrade,
    featureIds: [feature.id],
  });
  // Location dimensions — x and y from origin.
  out.push({
    id: `D${++idCounter.n}`, kind: 'linear',
    label: `${feature.positionMm[0].toFixed(1)}`,
    value: feature.positionMm[0],
    featureIds: [feature.id],
  });
  out.push({
    id: `D${++idCounter.n}`, kind: 'linear',
    label: `${feature.positionMm[1].toFixed(1)}`,
    value: feature.positionMm[1],
    featureIds: [feature.id],
  });
  return out;
}

function bossToDims(feature: RecognizedFeature, idCounter: { n: number }): DimXpertDimension[] {
  return [
    {
      id: `D${++idCounter.n}`, kind: 'diameter',
      label: `⌀${feature.primarySizeMm}`,
      value: feature.primarySizeMm,
      tolerance: feature.toleranceGrade,
      featureIds: [feature.id],
    },
    {
      id: `D${++idCounter.n}`, kind: 'linear',
      label: `${feature.secondarySizeMm ?? 0}`,
      value: feature.secondarySizeMm ?? 0,
      featureIds: [feature.id],
    },
  ];
}

function slotToDims(feature: RecognizedFeature, idCounter: { n: number }): DimXpertDimension[] {
  return [
    {
      id: `D${++idCounter.n}`, kind: 'linear',
      label: `${feature.primarySizeMm} (slot length)`,
      value: feature.primarySizeMm,
      tolerance: feature.toleranceGrade,
      featureIds: [feature.id],
    },
    {
      id: `D${++idCounter.n}`, kind: 'linear',
      label: `${feature.secondarySizeMm ?? 0} (slot width)`,
      value: feature.secondarySizeMm ?? 0,
      featureIds: [feature.id],
    },
  ];
}

function filletToDims(feature: RecognizedFeature, idCounter: { n: number }): DimXpertDimension[] {
  return [{
    id: `D${++idCounter.n}`, kind: 'radial',
    label: `R${feature.primarySizeMm}`,
    value: feature.primarySizeMm,
    featureIds: [feature.id],
  }];
}

// ── Top-level generator ─────────────────────────────────────────

export interface DimXpertOptions {
  /** Style: chain (size dims linked end-to-end) vs baseline
   *  (all dims measured from a single datum). */
  layoutStyle: 'chain' | 'baseline';
  /** Sheet bbox to constrain placement (mm). */
  sheetBbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Sheet scale (model mm per sheet mm). */
  sheetScale: number;
  /** Default tolerance per ISO 2768 class. */
  defaultTolerance?: 'iso2768-m' | 'iso2768-f' | 'iso2768-c';
}

export function generateDimensions(
  features: RecognizedFeature[],
  options: DimXpertOptions,
): DimXpertDimension[] {
  const counter = { n: 0 };
  const all: DimXpertDimension[] = [];
  for (const f of features) {
    switch (f.kind) {
      case 'hole':    all.push(...holeToDims(f, counter)); break;
      case 'boss':    all.push(...bossToDims(f, counter)); break;
      case 'slot':    all.push(...slotToDims(f, counter)); break;
      case 'fillet':
      case 'chamfer': all.push(...filletToDims(f, counter)); break;
      case 'pocket':  all.push(...bossToDims(f, counter)); break;
      case 'face':    /* face dims via DRF / GD&T elsewhere */ break;
      case 'edge':    break;
    }
  }
  return placeDimensions(all, features, options);
}

// ── Placement (avoid overlap) ───────────────────────────────────

function placeDimensions(
  dims: DimXpertDimension[],
  features: RecognizedFeature[],
  options: DimXpertOptions,
): DimXpertDimension[] {
  const featureById = new Map(features.map(f => [f.id, f]));
  const sheetW = options.sheetBbox.maxX - options.sheetBbox.minX;
  const sheetH = options.sheetBbox.maxY - options.sheetBbox.minY;

  // Initial placement: chain-style places dims along bottom edge,
  // baseline-style aligns to left datum.
  const baseY = options.sheetBbox.minY + 20;
  const baseX = options.sheetBbox.minX + 20;
  let chainCursor = baseX;

  for (let i = 0; i < dims.length; i++) {
    const d = dims[i]!;
    const feature = d.featureIds[0] ? featureById.get(d.featureIds[0]) : null;
    if (options.layoutStyle === 'chain') {
      d.position = [chainCursor, baseY];
      chainCursor += 25;
    } else {
      // Baseline — y depends on dim index, x at left.
      const offset = (i + 1) * 12;
      d.position = [baseX, baseY + offset];
    }
    // Leader from dim text → feature position.
    if (feature) {
      const fxOnSheet = feature.positionMm[0] / options.sheetScale + (options.sheetBbox.minX + sheetW / 2);
      const fyOnSheet = feature.positionMm[1] / options.sheetScale + (options.sheetBbox.minY + sheetH / 2);
      d.leader = [d.position, [fxOnSheet, fyOnSheet]];
    }
  }

  // Crude repulsion: any two dims closer than minSpacing get nudged.
  const minSpacingMm = 8;
  const iterations = 5;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < dims.length; i++) {
      for (let j = i + 1; j < dims.length; j++) {
        const a = dims[i]!.position;
        const b = dims[j]!.position;
        if (!a || !b) continue;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dist = Math.hypot(dx, dy);
        if (dist < minSpacingMm && dist > 0) {
          const push = (minSpacingMm - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          dims[i]!.position = [a[0] - ux * push, a[1] - uy * push];
          dims[j]!.position = [b[0] + ux * push, b[1] + uy * push];
        }
      }
    }
  }

  return dims;
}

// ── Feature recognizer (heuristic) ──────────────────────────────

/** Recognize features from a coarse part summary. Production version
 *  would walk the OCCT B-rep; this preview signature works with the
 *  feature tree NexyFab already maintains. */
export interface PartFeatureSummary {
  /** Holes with center + diameter + depth. */
  holes: Array<{ center: [number, number, number]; diameterMm: number; depthMm: number; tapped?: boolean }>;
  /** Slots with center + length + width. */
  slots: Array<{ center: [number, number, number]; lengthMm: number; widthMm: number }>;
  /** Fillet edges. */
  fillets: Array<{ position: [number, number, number]; radiusMm: number }>;
  /** Chamfer edges. */
  chamfers: Array<{ position: [number, number, number]; sizeMm: number }>;
}

export function recognizeFeatures(summary: PartFeatureSummary): RecognizedFeature[] {
  const out: RecognizedFeature[] = [];
  let n = 0;
  for (const h of summary.holes) {
    out.push({
      id: `F${++n}`, kind: 'hole',
      positionMm: h.center,
      primarySizeMm: h.diameterMm,
      secondarySizeMm: h.depthMm,
      toleranceGrade: h.tapped ? '6H' : 'H8',
    });
  }
  for (const s of summary.slots) {
    out.push({
      id: `F${++n}`, kind: 'slot',
      positionMm: s.center,
      primarySizeMm: s.lengthMm,
      secondarySizeMm: s.widthMm,
    });
  }
  for (const f of summary.fillets) {
    out.push({
      id: `F${++n}`, kind: 'fillet',
      positionMm: f.position,
      primarySizeMm: f.radiusMm,
    });
  }
  for (const c of summary.chamfers) {
    out.push({
      id: `F${++n}`, kind: 'chamfer',
      positionMm: c.position,
      primarySizeMm: c.sizeMm,
    });
  }
  return out;
}
