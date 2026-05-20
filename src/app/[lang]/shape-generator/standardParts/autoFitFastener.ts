/**
 * autoFitFastener.ts — Suggest the best fastener for a given hole.
 *
 * SolidWorks Toolbox "Smart Fasteners" auto-detects holes and
 * suggests matching screws. NexyFab does the same in three steps:
 *
 *   1. Take a hole diameter (mm).
 *   2. Look up the matching bolt size that uses that hole as
 *      clearance (close / medium / coarse fit per ISO 273) OR as
 *      tap drill.
 *   3. Return the top-N fastener suggestions ordered by fit type.
 *
 * Output covers both ISO metric and ANSI inch tables so US-spec
 * holes get matched to inch fasteners.
 */

import { ISO_METRIC, isoSize } from './isoCatalogFull';
import { ANSI_INCH, inchToMm } from './ansiCatalog';

export type FitType = 'clearance-close' | 'clearance-medium' | 'clearance-coarse' | 'tap';
export type CatalogOrigin = 'ISO' | 'ANSI';

export interface FitSuggestion {
  origin: CatalogOrigin;
  /** Bolt nominal label (e.g. "M6" or "1/4"). */
  sizeLabel: string;
  fitType: FitType;
  /** Confidence 0-1 based on diameter delta. */
  confidence: number;
  /** Suggested fastener kinds appropriate for this fit. */
  kinds: Array<'hex-bolt' | 'socket-head-cap' | 'button-head' | 'flat-head'>;
}

export interface AutoFitOptions {
  /** Hole diameter in mm. */
  diameterMm: number;
  /** Tolerance window (mm). Default 0.3 mm. */
  toleranceMm?: number;
  /** Limit on suggestions returned. Default 3. */
  topN?: number;
}

export function suggestFasteners(opts: AutoFitOptions): FitSuggestion[] {
  const tol = opts.toleranceMm ?? 0.3;
  const top = opts.topN ?? 3;
  const candidates: FitSuggestion[] = [];

  for (const e of ISO_METRIC) {
    addIf('ISO', `M${e.size}`, 'clearance-close',  e.clearanceClose, opts.diameterMm, tol, candidates);
    addIf('ISO', `M${e.size}`, 'clearance-medium', e.clearanceMedium, opts.diameterMm, tol, candidates);
    addIf('ISO', `M${e.size}`, 'clearance-coarse', e.clearanceCoarse, opts.diameterMm, tol, candidates);
    addIf('ISO', `M${e.size}`, 'tap',              e.tapDrill,        opts.diameterMm, tol, candidates);
  }
  for (const e of ANSI_INCH) {
    // ANSI catalog doesn't list clearance/tap directly — approximate.
    const dMm = inchToMm(e.diameterIn);
    addIf('ANSI', e.label, 'clearance-close',  dMm + 0.4,  opts.diameterMm, tol, candidates);
    addIf('ANSI', e.label, 'clearance-medium', dMm + 0.8,  opts.diameterMm, tol, candidates);
    addIf('ANSI', e.label, 'tap',              dMm - 0.8,  opts.diameterMm, tol, candidates);
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, top);
}

function addIf(
  origin: CatalogOrigin,
  sizeLabel: string,
  fitType: FitType,
  catalogDiameter: number,
  queryDiameter: number,
  tol: number,
  out: FitSuggestion[],
): void {
  const delta = Math.abs(catalogDiameter - queryDiameter);
  if (delta > tol) return;
  const confidence = Math.max(0, 1 - delta / tol);
  out.push({
    origin,
    sizeLabel,
    fitType,
    confidence,
    kinds: fitType === 'tap'
      ? ['socket-head-cap', 'set-screw' as never]
      : ['hex-bolt', 'socket-head-cap', 'button-head'],
  });
}

/** Quick check: is this hole diameter standard? */
export function isStandardClearanceHole(
  diameterMm: number,
  tol: number = 0.1,
): { isStandard: boolean; matches: Array<{ origin: CatalogOrigin; size: string; fit: FitType }> } {
  const matches: Array<{ origin: CatalogOrigin; size: string; fit: FitType }> = [];
  for (const e of ISO_METRIC) {
    if (Math.abs(e.clearanceClose - diameterMm)  <= tol) matches.push({ origin: 'ISO', size: `M${e.size}`, fit: 'clearance-close' });
    if (Math.abs(e.clearanceMedium - diameterMm) <= tol) matches.push({ origin: 'ISO', size: `M${e.size}`, fit: 'clearance-medium' });
  }
  return { isStandard: matches.length > 0, matches };
}

/** Tap or clearance? Given the hole and the intended bolt, classify. */
export function classifyHole(
  holeDiameterMm: number,
  boltDiameterMm: number,
): 'tap' | 'clearance-close' | 'clearance-medium' | 'clearance-coarse' | 'oversize' | 'undersize' {
  const e = isoSize(boltDiameterMm);
  if (!e) return 'oversize';
  // Pick the closest matching category. First-hit + 0.3 tolerance
  // mis-classified holes within 0.3 of more than one category.
  const candidates = [
    { kind: 'tap' as const,              d: e.tapDrill },
    { kind: 'clearance-close' as const,  d: e.clearanceClose },
    { kind: 'clearance-medium' as const, d: e.clearanceMedium },
    { kind: 'clearance-coarse' as const, d: e.clearanceCoarse },
  ];
  let best = candidates[0]!;
  let bestDist = Math.abs(holeDiameterMm - best.d);
  for (const c of candidates.slice(1)) {
    const dist = Math.abs(holeDiameterMm - c.d);
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  if (bestDist <= 0.3) return best.kind;
  return holeDiameterMm > e.clearanceCoarse ? 'oversize' : 'undersize';
}
