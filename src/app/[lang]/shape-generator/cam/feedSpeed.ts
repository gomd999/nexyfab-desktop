/**
 * feedSpeed.ts — Surface-speed / chip-load → RPM / feed calculator.
 *
 * The two CAM inputs that change every time:
 *   - **Surface speed (SFM)**: how fast the cutting edge moves
 *     relative to the workpiece. Material-dependent — aluminium
 *     loves 500-1000 SFM, hardened steel wants 80-120.
 *   - **Chip load (IPT)**: how much each flute removes per
 *     revolution. Diameter + flute count dependent.
 *
 * From these two we derive:
 *     RPM         = (SFM × 12) / (π × diameter)        // English
 *     RPM         = (Vc × 1000) / (π × diameter)       // Metric
 *     Feed rate   = RPM × IPT × fluteCount
 *
 * This module ships a small reference table that's good for "first
 * cut" feed/speeds. Real shops dial them in by chip / chatter / heat.
 */

export type MaterialKey =
  | 'aluminum-6061'
  | 'aluminum-7075'
  | 'steel-1018'
  | 'steel-4140'
  | 'stainless-304'
  | 'titanium-grade5'
  | 'brass-360'
  | 'abs'
  | 'pom-delrin';

export type CutterType = 'flat-end' | 'ball-end' | 'bull-nose' | 'drill';

export interface FeedSpeedInput {
  material: MaterialKey;
  cutterType: CutterType;
  diameterMm: number;
  fluteCount: number;
  /** Roughing vs finishing — finishing reduces IPT by 50%. */
  pass: 'rough' | 'finish';
}

export interface FeedSpeedResult {
  rpm: number;
  feedMmMin: number;
  chipLoadMm: number;
  surfaceSpeedMmin: number;
  warnings: string[];
}

/** Surface speed (m/min) reference for HSS cutters in metric. */
const SFM_M_MIN: Record<MaterialKey, number> = {
  'aluminum-6061':   300,
  'aluminum-7075':   250,
  'steel-1018':      80,
  'steel-4140':      55,
  'stainless-304':   35,
  'titanium-grade5': 30,
  'brass-360':       150,
  'abs':             200,
  'pom-delrin':      250,
};

/** Chip load per tooth (mm/tooth) at 6 mm cutter diameter (roughing).
 *  Scales with diameter — bigger cutter handles more chip per tooth. */
const IPT_AT_6MM: Record<MaterialKey, number> = {
  'aluminum-6061':   0.08,
  'aluminum-7075':   0.06,
  'steel-1018':      0.04,
  'steel-4140':      0.03,
  'stainless-304':   0.025,
  'titanium-grade5': 0.02,
  'brass-360':       0.05,
  'abs':             0.1,
  'pom-delrin':      0.08,
};

export function calcFeedSpeed(input: FeedSpeedInput): FeedSpeedResult {
  const warnings: string[] = [];
  if (input.diameterMm <= 0) {
    warnings.push('diameter must be > 0');
    return { rpm: 0, feedMmMin: 0, chipLoadMm: 0, surfaceSpeedMmin: 0, warnings };
  }
  if (input.fluteCount <= 0) {
    warnings.push('flute count must be > 0');
    return { rpm: 0, feedMmMin: 0, chipLoadMm: 0, surfaceSpeedMmin: 0, warnings };
  }

  const vc = SFM_M_MIN[input.material];
  // RPM = Vc * 1000 / (π * D_mm)
  const rpm = (vc * 1000) / (Math.PI * input.diameterMm);

  // Scale IPT with diameter relative to 6mm reference (sqrt scaling — empirical).
  let ipt = IPT_AT_6MM[input.material] * Math.sqrt(input.diameterMm / 6);
  if (input.pass === 'finish') ipt *= 0.5;
  if (input.cutterType === 'ball-end') ipt *= 0.7; // ball end engages less
  if (input.cutterType === 'drill') ipt *= 1.5;    // drill point penetrates
  const feed = rpm * ipt * input.fluteCount;

  // Sanity warnings.
  if (rpm > 24000) warnings.push(`RPM ${rpm.toFixed(0)} exceeds typical 24k spindle limit`);
  if (rpm < 500) warnings.push(`RPM ${rpm.toFixed(0)} is below comfortable cutting range`);
  if (feed > 10000) warnings.push(`Feed ${feed.toFixed(0)} mm/min may exceed servo limits`);

  return {
    rpm: Math.round(rpm),
    feedMmMin: Math.round(feed),
    chipLoadMm: Math.round(ipt * 10000) / 10000,
    surfaceSpeedMmin: vc,
    warnings,
  };
}
