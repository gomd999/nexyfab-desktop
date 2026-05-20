/**
 * gearMeshingAnalysis.ts — Analyze the engagement of two mated gears.
 *
 * Once you have two gears modeled, you have to verify they actually
 * mesh without:
 *
 *   - **Undercutting** — too-few teeth on a small gear puts the
 *     tooth base inside the base circle, creating thin / fragile
 *     fillets.
 *   - **Backlash too small or too large** — clearance between
 *     mating teeth. Too small → binding; too large → vibration.
 *   - **Contact ratio below 1.2** — at any instant fewer than 1.2
 *     pairs of teeth are in contact → noisy + jerky transmission.
 *
 * AGMA 2001 formulas (simplified):
 *
 *   - Standard tooth profile: 20° pressure angle, addendum = 1·m,
 *     dedendum = 1.25·m, where m is module (mm).
 *   - Center distance C = (z1 + z2) · m / 2.
 *   - Path of contact length: works from base circles + addendum
 *     circles intersections.
 *   - Contact ratio ε = path-of-contact / base-pitch.
 *
 * Module produces a pass/marginal/fail verdict + the specific
 * numeric scores for each criterion so engineers can fix issues
 * individually.
 */

export interface SpurGear {
  /** Number of teeth. */
  teeth: number;
  /** Module (mm). */
  module: number;
  /** Pressure angle, degrees. Default 20. */
  pressureAngleDeg?: number;
  /** Profile shift coefficient x (0 = standard, +/- for corrected). */
  profileShift?: number;
}

export interface MeshAnalysis {
  /** Pinion (smaller gear). */
  pinion: SpurGear;
  /** Wheel (larger gear). */
  wheel: SpurGear;
  /** Computed center distance, mm. */
  centerDistanceMm: number;
  /** Standard (unshifted) center distance, mm. */
  standardCenterDistanceMm: number;
  /** Pinion pitch radius. */
  pinionPitchRadiusMm: number;
  /** Wheel pitch radius. */
  wheelPitchRadiusMm: number;
  /** Pinion base radius. */
  pinionBaseRadiusMm: number;
  /** Wheel base radius. */
  wheelBaseRadiusMm: number;
  /** Path-of-contact length, mm. */
  pathOfContactMm: number;
  /** Contact ratio (dimensionless). */
  contactRatio: number;
  /** Backlash (theoretical, mm). */
  backlashMm: number;
  /** Will the pinion be undercut at the root? */
  pinionUndercut: boolean;
  /** Minimum teeth to avoid undercut for pinion's pressure angle. */
  minimumTeethForNoUndercut: number;
  /** Overall pass/marginal/fail verdict. */
  verdict: 'pass' | 'marginal' | 'fail';
  /** Itemized issues. */
  issues: string[];
}

export interface AnalysisOptions {
  /** Allowable backlash range, mm. */
  backlashRangeMm: { min: number; max: number };
  /** Minimum contact ratio. */
  minContactRatio: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  backlashRangeMm: { min: 0.05, max: 0.3 },
  minContactRatio: 1.2,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeGearMesh(pinion: SpurGear, wheel: SpurGear, options: Partial<AnalysisOptions> = {}): MeshAnalysis {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // Validate same module + pressure angle.
  const issues: string[] = [];
  if (Math.abs(pinion.module - wheel.module) > 1e-6) {
    issues.push('Modules differ — gears cannot mesh.');
  }
  const alphaP = (pinion.pressureAngleDeg ?? 20) * Math.PI / 180;
  const alphaW = (wheel.pressureAngleDeg ?? 20) * Math.PI / 180;
  if (Math.abs(alphaP - alphaW) > 1e-6) {
    issues.push('Pressure angles differ — gears cannot mesh.');
  }
  const m = pinion.module;
  const alpha = alphaP;

  const pitchP = (m * pinion.teeth) / 2;
  const pitchW = (m * wheel.teeth) / 2;
  const baseP = pitchP * Math.cos(alpha);
  const baseW = pitchW * Math.cos(alpha);
  const stdCenter = pitchP + pitchW;

  // Profile shift effect on center distance.
  const totalShift = (pinion.profileShift ?? 0) + (wheel.profileShift ?? 0);
  const workingPitchP = pitchP + (pinion.profileShift ?? 0) * m;
  const workingPitchW = pitchW + (wheel.profileShift ?? 0) * m;
  const centerDist = totalShift === 0 ? stdCenter : workingPitchP + workingPitchW;

  // Addendum radii.
  const addP = pitchP + m + (pinion.profileShift ?? 0) * m;
  const addW = pitchW + m + (wheel.profileShift ?? 0) * m;

  // Path-of-contact: line from addendum-circle/line-of-action intersect of pinion to that of wheel.
  const t1 = Math.sqrt(Math.max(0, addP * addP - baseP * baseP)) - pitchP * Math.sin(alpha);
  const t2 = Math.sqrt(Math.max(0, addW * addW - baseW * baseW)) - pitchW * Math.sin(alpha);
  const pathOfContact = Math.max(0, t1) + Math.max(0, t2);

  // Base pitch.
  const basePitch = Math.PI * m * Math.cos(alpha);
  const contactRatio = basePitch > 0 ? pathOfContact / basePitch : 0;

  // Backlash from operating vs standard.
  const backlash = 2 * (centerDist - stdCenter) * Math.tan(alpha);

  // Undercut: minimum teeth for no undercut at 20° = ~17. General formula:
  //   z_min = 2 · (1 - x) / sin²(α)
  // where x is the profile shift coefficient.
  const minTeeth = 2 * (1 - (pinion.profileShift ?? 0)) / (Math.sin(alpha) ** 2);
  const undercut = pinion.teeth < minTeeth;

  if (undercut) issues.push(`Pinion has ${pinion.teeth} teeth; needs ≥ ${Math.ceil(minTeeth)} to avoid undercut.`);
  if (contactRatio < opts.minContactRatio) issues.push(`Contact ratio ${contactRatio.toFixed(2)} below ${opts.minContactRatio}.`);
  if (backlash < opts.backlashRangeMm.min) issues.push(`Backlash ${backlash.toFixed(3)} mm below minimum.`);
  if (backlash > opts.backlashRangeMm.max) issues.push(`Backlash ${backlash.toFixed(3)} mm above maximum.`);

  let verdict: MeshAnalysis['verdict'];
  if (issues.length === 0) verdict = 'pass';
  else if (issues.length <= 1) verdict = 'marginal';
  else verdict = 'fail';

  return {
    pinion,
    wheel,
    centerDistanceMm: centerDist,
    standardCenterDistanceMm: stdCenter,
    pinionPitchRadiusMm: pitchP,
    wheelPitchRadiusMm: pitchW,
    pinionBaseRadiusMm: baseP,
    wheelBaseRadiusMm: baseW,
    pathOfContactMm: pathOfContact,
    contactRatio,
    backlashMm: backlash,
    pinionUndercut: undercut,
    minimumTeethForNoUndercut: Math.ceil(minTeeth),
    verdict,
    issues,
  };
}

// ── Ratio + speed ──────────────────────────────────────────────

export interface RatioInfo {
  ratio: number;
  /** Pinion RPM for a given wheel RPM. */
  pinionRpmAtWheelRpm: (wheelRpm: number) => number;
  /** Wheel RPM for a given pinion RPM. */
  wheelRpmAtPinionRpm: (pinionRpm: number) => number;
}

export function ratioInfo(pinion: SpurGear, wheel: SpurGear): RatioInfo {
  const ratio = wheel.teeth / pinion.teeth;
  return {
    ratio,
    pinionRpmAtWheelRpm: (wheelRpm) => wheelRpm * ratio,
    wheelRpmAtPinionRpm: (pinionRpm) => pinionRpm / ratio,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface AnalysisSummary {
  verdict: MeshAnalysis['verdict'];
  contactRatio: number;
  hasUndercut: boolean;
  issueCount: number;
  ratio: number;
}

export function summarize(analysis: MeshAnalysis): AnalysisSummary {
  return {
    verdict: analysis.verdict,
    contactRatio: analysis.contactRatio,
    hasUndercut: analysis.pinionUndercut,
    issueCount: analysis.issues.length,
    ratio: analysis.wheel.teeth / analysis.pinion.teeth,
  };
}
