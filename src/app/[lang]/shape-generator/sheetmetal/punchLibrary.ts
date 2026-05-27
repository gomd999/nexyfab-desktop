/**
 * punchLibrary.ts — Catalog of press-brake punch and die geometries.
 *
 * Sheet metal bending presses use *matched* punch + die sets. The
 * punch (top tool) descends into the V-die (bottom tool) bending
 * the sheet between them.
 *
 * Common punch profiles:
 *
 *   - **Standard 90°**: tip angle 88° (slight over-bend to compensate
 *     for springback), tip radius 0.5-2 mm.
 *   - **Acute 60° / 45°**: for bends > 90° (used for hemming, very
 *     tight returns).
 *   - **Goose-neck**: offset shaft for clearance when forming
 *     complex shapes.
 *   - **Radius punch**: large tip radius for forming arcs/radii.
 *
 * Common die profiles:
 *
 *   - **V-die**: standard 90° opening, V-width 6-50 mm depending on
 *     sheet thickness.
 *   - **Hemming die**: closes the metal on itself.
 *   - **Radius die**: rounded bottom for radius forms.
 *
 * Die selection rules: V-width ≈ 6-12 × sheet thickness (depending
 * on bend radius desired).
 */

export type PunchProfile = 'standard-90' | 'acute-60' | 'acute-45' | 'goose-neck' | 'radius-punch';

export type DieProfile = 'v-die' | 'hemming-die' | 'radius-die' | 'channel-die';

export interface PunchSpec {
  id: string;
  profile: PunchProfile;
  /** Tip angle (degrees). */
  tipAngleDeg: number;
  /** Tip radius (mm). */
  tipRadiusMm: number;
  /** Max bend height (mm) before the punch shoulder hits the flange. */
  maxBendHeightMm: number;
  /** Designation (e.g., "RAM-90/0.6"). */
  designation: string;
}

export interface DieSpec {
  id: string;
  profile: DieProfile;
  /** V opening width (mm). */
  vWidthMm: number;
  /** V angle (degrees), typically 90 or 60. */
  vAngleDeg: number;
  /** Die inside corner radius. */
  innerRadiusMm: number;
  designation: string;
}

// ── Library ────────────────────────────────────────────────────

export const PUNCH_LIBRARY: PunchSpec[] = [
  { id: 'P-STD-90-0.6', profile: 'standard-90', tipAngleDeg: 88, tipRadiusMm: 0.6, maxBendHeightMm: 60, designation: 'STD 88°/R0.6' },
  { id: 'P-STD-90-1.0', profile: 'standard-90', tipAngleDeg: 88, tipRadiusMm: 1.0, maxBendHeightMm: 60, designation: 'STD 88°/R1.0' },
  { id: 'P-STD-90-2.0', profile: 'standard-90', tipAngleDeg: 88, tipRadiusMm: 2.0, maxBendHeightMm: 80, designation: 'STD 88°/R2.0' },
  { id: 'P-ACU-60-0.5', profile: 'acute-60', tipAngleDeg: 60, tipRadiusMm: 0.5, maxBendHeightMm: 35, designation: 'ACUTE 60°/R0.5' },
  { id: 'P-ACU-45-0.3', profile: 'acute-45', tipAngleDeg: 45, tipRadiusMm: 0.3, maxBendHeightMm: 25, designation: 'ACUTE 45°/R0.3' },
  { id: 'P-GN-90-1.0', profile: 'goose-neck', tipAngleDeg: 90, tipRadiusMm: 1.0, maxBendHeightMm: 120, designation: 'GOOSE-NECK 90°' },
  { id: 'P-RAD-5', profile: 'radius-punch', tipAngleDeg: 90, tipRadiusMm: 5.0, maxBendHeightMm: 80, designation: 'RAD R5' },
  { id: 'P-RAD-10', profile: 'radius-punch', tipAngleDeg: 90, tipRadiusMm: 10.0, maxBendHeightMm: 80, designation: 'RAD R10' },
];

export const DIE_LIBRARY: DieSpec[] = [
  { id: 'D-V8', profile: 'v-die', vWidthMm: 8, vAngleDeg: 90, innerRadiusMm: 0.5, designation: 'V8/90' },
  { id: 'D-V12', profile: 'v-die', vWidthMm: 12, vAngleDeg: 90, innerRadiusMm: 1.0, designation: 'V12/90' },
  { id: 'D-V20', profile: 'v-die', vWidthMm: 20, vAngleDeg: 90, innerRadiusMm: 2.0, designation: 'V20/90' },
  { id: 'D-V40', profile: 'v-die', vWidthMm: 40, vAngleDeg: 90, innerRadiusMm: 4.0, designation: 'V40/90' },
  { id: 'D-HEM', profile: 'hemming-die', vWidthMm: 0, vAngleDeg: 0, innerRadiusMm: 0.5, designation: 'HEM' },
  { id: 'D-RAD-10', profile: 'radius-die', vWidthMm: 20, vAngleDeg: 0, innerRadiusMm: 10, designation: 'RAD R10' },
];

// ── Selection ──────────────────────────────────────────────────

export interface BendRequirement {
  /** Sheet thickness, mm. */
  thicknessMm: number;
  /** Bend angle (degrees from flat). 90 = right angle. */
  bendAngleDeg: number;
  /** Desired inside bend radius. */
  insideBendRadiusMm: number;
  /** Flange height (the smaller side of the bend), mm. */
  flangeHeightMm: number;
}

export interface ToolPair {
  punch: PunchSpec;
  die: DieSpec;
  /** Predicted spring-back compensation angle. */
  springBackDeg: number;
  /** Predicted bending force (kN/m). */
  forceKnPerM: number;
}

export function recommendToolPair(req: BendRequirement): ToolPair | null {
  // V-width ≈ 8 × thickness (typical).
  const idealVWidth = 8 * req.thicknessMm;
  const die = DIE_LIBRARY
    .filter(d => d.profile === 'v-die')
    .reduce((best, d) =>
      Math.abs(d.vWidthMm - idealVWidth) < Math.abs(best.vWidthMm - idealVWidth) ? d : best,
    DIE_LIBRARY[0]!);

  // Punch tip radius ≤ desired inside bend radius.
  const candidates = PUNCH_LIBRARY.filter(p =>
    p.tipRadiusMm <= req.insideBendRadiusMm + 0.1 &&
    p.maxBendHeightMm >= req.flangeHeightMm,
  );
  if (candidates.length === 0) return null;
  const punch = candidates.reduce((best, p) =>
    Math.abs(p.tipRadiusMm - req.insideBendRadiusMm) < Math.abs(best.tipRadiusMm - req.insideBendRadiusMm) ? p : best,
  candidates[0]!);

  // Spring-back compensation: empirical.
  const springBack = 0.5 + req.thicknessMm * 0.1;
  // Bending force (kN/m): F = 0.85 · σ · t² / V × 1000, σ in MPa → kN/m.
  // Use 400 MPa for mild steel as default.
  const sigma = 400;
  const force = (0.85 * sigma * req.thicknessMm * req.thicknessMm) / die.vWidthMm;
  return { punch, die, springBackDeg: springBack, forceKnPerM: force };
}

// ── Inquiry ────────────────────────────────────────────────────

export function findPunchByDesignation(d: string): PunchSpec | null {
  return PUNCH_LIBRARY.find(p => p.designation === d) ?? null;
}

export function findDieByDesignation(d: string): DieSpec | null {
  return DIE_LIBRARY.find(p => p.designation === d) ?? null;
}

// ── Summary ────────────────────────────────────────────────────

export interface LibrarySummary {
  punchCount: number;
  dieCount: number;
  punchProfiles: PunchProfile[];
  dieProfiles: DieProfile[];
  minTipRadius: number;
  maxTipRadius: number;
}

export function summarize(): LibrarySummary {
  const punchProfiles = new Set<PunchProfile>();
  const dieProfiles = new Set<DieProfile>();
  let minR = Infinity, maxR = 0;
  for (const p of PUNCH_LIBRARY) {
    punchProfiles.add(p.profile);
    if (p.tipRadiusMm < minR) minR = p.tipRadiusMm;
    if (p.tipRadiusMm > maxR) maxR = p.tipRadiusMm;
  }
  for (const d of DIE_LIBRARY) dieProfiles.add(d.profile);
  return {
    punchCount: PUNCH_LIBRARY.length,
    dieCount: DIE_LIBRARY.length,
    punchProfiles: [...punchProfiles],
    dieProfiles: [...dieProfiles],
    minTipRadius: minR,
    maxTipRadius: maxR,
  };
}
