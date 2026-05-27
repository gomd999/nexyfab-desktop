/**
 * bearingSeatSizer.ts — Size a housing bore + shaft journal for a
 * rolling-element bearing per ISO 286 fit recommendations.
 *
 * Inputs:
 *   - Bearing series (deep-groove / cylindrical / tapered).
 *   - Inner / outer diameter (mm).
 *   - Loading direction (rotating inner vs outer).
 *   - Load class (light / medium / heavy).
 *
 * Outputs:
 *   - Housing bore tolerance class.
 *   - Shaft journal tolerance class.
 *   - Required shoulder height + retaining method.
 */

export type BearingSeries = 'deep-groove' | 'cylindrical-roller' | 'tapered-roller' | 'angular-contact';
export type LoadDirection = 'rotating-inner' | 'rotating-outer' | 'oscillating';
export type LoadClass = 'light' | 'medium' | 'heavy';

export interface BearingSize {
  innerMm: number;
  outerMm: number;
  widthMm: number;
}

export interface BearingSeatOptions {
  series: BearingSeries;
  loadDirection: LoadDirection;
  loadClass: LoadClass;
  /** Whether bearing temperature exceeds 70 °C (looser shaft to allow thermal growth). */
  highTemp: boolean;
}

export const DEFAULT_OPTIONS: BearingSeatOptions = {
  series: 'deep-groove',
  loadDirection: 'rotating-inner',
  loadClass: 'medium',
  highTemp: false,
};

export interface SeatResult {
  housingTolerance: string;
  shaftTolerance: string;
  shoulderHeightMm: number;
  retentionMethod: 'press-fit' | 'snap-ring' | 'shoulder-and-nut' | 'shoulder-and-cap';
  recommendedShaftDimMm: number;
  recommendedHousingDimMm: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function sizeSeat(bearing: BearingSize, options: Partial<BearingSeatOptions> = {}): SeatResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // Pick shaft fit per ISO 286 / SKF.
  let shaft: string;
  if (opts.loadDirection === 'rotating-inner') {
    if (opts.loadClass === 'light') shaft = 'j6';
    else if (opts.loadClass === 'medium') shaft = 'k6';
    else shaft = 'n6';
  } else if (opts.loadDirection === 'rotating-outer') {
    shaft = 'h6';
  } else {
    shaft = 'j6';
  }

  // Pick housing fit.
  let housing: string;
  if (opts.loadDirection === 'rotating-outer') {
    housing = opts.loadClass === 'light' ? 'J7' : opts.loadClass === 'medium' ? 'K7' : 'N7';
  } else if (opts.loadDirection === 'rotating-inner') {
    housing = opts.loadClass === 'heavy' ? 'M7' : opts.loadClass === 'medium' ? 'J7' : 'H7';
  } else {
    housing = 'K7';
  }

  // Adjust for thermal.
  if (opts.highTemp) {
    warnings.push('High temp: ensure thermal expansion allowance.');
    if (shaft === 'k6') shaft = 'j6';
    if (housing === 'H7') housing = 'J7';
  }

  // Shoulder height: 70-90% of bearing inner ring height.
  const shoulderHeight = 0.7 * (bearing.outerMm - bearing.innerMm) / 2;

  // Retention method.
  let retention: SeatResult['retentionMethod'];
  if (opts.loadClass === 'heavy' || opts.series === 'tapered-roller') retention = 'shoulder-and-nut';
  else if (opts.loadDirection === 'rotating-outer') retention = 'shoulder-and-cap';
  else retention = opts.loadClass === 'light' ? 'snap-ring' : 'press-fit';

  return {
    housingTolerance: housing,
    shaftTolerance: shaft,
    shoulderHeightMm: shoulderHeight,
    retentionMethod: retention,
    recommendedShaftDimMm: bearing.innerMm,
    recommendedHousingDimMm: bearing.outerMm,
    warnings,
  };
}

// ── Roughness recommendation ─────────────────────────────────

export interface RoughnessRec {
  shaftRaMicron: number;
  housingRaMicron: number;
}

export function recommendRoughness(opts: Partial<BearingSeatOptions> = {}): RoughnessRec {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const shaftRa = o.loadClass === 'heavy' ? 0.4 : o.loadClass === 'medium' ? 0.8 : 1.6;
  const housingRa = shaftRa * 1.5;
  return { shaftRaMicron: shaftRa, housingRaMicron: housingRa };
}

// ── Preload check (angular contact) ──────────────────────────

export function preloadRecommendation(bearing: BearingSize, opts: Partial<BearingSeatOptions> = {}): { preloadN: number; rationale: string } | null {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  if (o.series !== 'angular-contact' && o.series !== 'tapered-roller') return null;
  const preload = bearing.outerMm * 10; // Rough rule of thumb.
  return {
    preloadN: preload,
    rationale: `Angular-contact / tapered-roller needs axial preload ~10 N per mm of outer dia.`,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface SeatSummary {
  housingTolerance: string;
  shaftTolerance: string;
  retentionMethod: SeatResult['retentionMethod'];
  shoulderHeightMm: number;
}

export function summarize(result: SeatResult): SeatSummary {
  return {
    housingTolerance: result.housingTolerance,
    shaftTolerance: result.shaftTolerance,
    retentionMethod: result.retentionMethod,
    shoulderHeightMm: result.shoulderHeightMm,
  };
}
