/**
 * parametricJoint.ts — Woodworking + sheet-metal joint generator.
 *
 * For furniture and engineered-wood products, joints (the place
 * where two pieces meet) need a precise mating geometry. This module
 * generates parametric joint profiles in 2D so they can be projected
 * onto the part faces and CSG-subtracted from each piece.
 *
 * Supported families:
 *
 *   - **Mortise & tenon** — rectangular peg into a matching socket.
 *   - **Dovetail** — angled trapezoidal teeth for tensile resistance.
 *   - **Finger / box** — alternating square teeth (laser-cut friendly).
 *   - **Lap** — simple rabbet for stacking joints.
 *   - **Half-blind dovetail** — pin board not visible from one face.
 *   - **Sheet-metal tab/slot** — for sheet-metal weldments.
 *
 * Outputs include the "male" and "female" profiles so callers can
 * subtract one from each board. Optional clearance is applied to
 * the female side for press-fit tuning.
 */

export interface Point2D {
  x: number;
  y: number;
}

export type JointKind = 'mortise-tenon' | 'dovetail' | 'finger' | 'lap' | 'half-blind-dovetail' | 'tab-slot';

export interface MortiseTenonParams {
  kind: 'mortise-tenon';
  /** Tenon width (mm). */
  widthMm: number;
  /** Tenon height (mm). */
  heightMm: number;
  /** Tenon length / mortise depth (mm). */
  lengthMm: number;
  /** Clearance applied to female (mm). */
  clearanceMm: number;
}

export interface DovetailParams {
  kind: 'dovetail';
  /** Number of tails. */
  count: number;
  /** Material width (mm). */
  widthMm: number;
  /** Pitch (mm) between tail centers. */
  pitchMm: number;
  /** Tail half-angle (deg). 10-15 typical. */
  angleDeg: number;
  /** Pin width at the narrow end (mm). */
  pinWidthMm: number;
  /** Material thickness (mm). */
  thicknessMm: number;
  /** Clearance (mm). */
  clearanceMm: number;
}

export interface FingerParams {
  kind: 'finger';
  count: number;
  widthMm: number;
  fingerWidthMm: number;
  thicknessMm: number;
  clearanceMm: number;
}

export interface LapParams {
  kind: 'lap';
  widthMm: number;
  thicknessMm: number;
  clearanceMm: number;
}

export interface HalfBlindDovetailParams {
  kind: 'half-blind-dovetail';
  count: number;
  widthMm: number;
  pitchMm: number;
  angleDeg: number;
  /** Depth not penetrating outer face (mm). */
  blindDepthMm: number;
  thicknessMm: number;
  clearanceMm: number;
}

export interface TabSlotParams {
  kind: 'tab-slot';
  /** Tab count along joint. */
  count: number;
  /** Tab width (mm). */
  tabWidthMm: number;
  /** Pitch between tab centers (mm). */
  pitchMm: number;
  /** Sheet thickness (mm). */
  thicknessMm: number;
  /** Slot fit clearance (mm). */
  clearanceMm: number;
}

export type JointParams = MortiseTenonParams | DovetailParams | FingerParams | LapParams | HalfBlindDovetailParams | TabSlotParams;

export interface JointProfile {
  male: Point2D[];
  female: Point2D[];
  /** Bounding box of the joint. */
  bbox: { min: Point2D; max: Point2D };
  /** Diagnostic warnings. */
  warnings: string[];
}

// ── Top-level entry ─────────────────────────────────────────────

export function generateJointProfile(params: JointParams): JointProfile {
  switch (params.kind) {
    case 'mortise-tenon': return mortiseTenon(params);
    case 'dovetail': return dovetail(params);
    case 'finger': return finger(params);
    case 'lap': return lap(params);
    case 'half-blind-dovetail': return halfBlindDovetail(params);
    case 'tab-slot': return tabSlot(params);
  }
}

// ── Mortise + tenon ────────────────────────────────────────────

function mortiseTenon(p: MortiseTenonParams): JointProfile {
  const w = p.widthMm;
  const h = p.heightMm;
  const c = p.clearanceMm;
  const male: Point2D[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const female: Point2D[] = [
    { x: -c, y: -c },
    { x: w + c, y: -c },
    { x: w + c, y: h + c },
    { x: -c, y: h + c },
  ];
  return {
    male, female,
    bbox: { min: { x: -c, y: -c }, max: { x: w + c, y: h + c } },
    warnings: [],
  };
}

// ── Dovetail ───────────────────────────────────────────────────

function dovetail(p: DovetailParams): JointProfile {
  const warnings: string[] = [];
  if (p.count < 1) warnings.push('Dovetail count must be ≥ 1');
  const angleRad = (p.angleDeg * Math.PI) / 180;
  const slope = Math.tan(angleRad);
  const tailWide = p.pitchMm - p.pinWidthMm;
  if (tailWide <= 0) warnings.push('Pin width too large for given pitch');
  const halfTail = tailWide / 2;
  const male: Point2D[] = [];
  // Build the tail outline along x: pin/tail/pin/tail/…
  let x = 0;
  male.push({ x, y: 0 });
  for (let i = 0; i < p.count; i++) {
    const centerX = (i + 0.5) * p.pitchMm;
    const baseLeft = centerX - halfTail;
    const baseRight = centerX + halfTail;
    const tipLeft = baseLeft + slope * p.thicknessMm;
    const tipRight = baseRight - slope * p.thicknessMm;
    male.push({ x: baseLeft, y: 0 });
    male.push({ x: tipLeft, y: p.thicknessMm });
    male.push({ x: tipRight, y: p.thicknessMm });
    male.push({ x: baseRight, y: 0 });
    x = baseRight;
  }
  male.push({ x: p.count * p.pitchMm, y: 0 });
  // Female = mirror with clearance applied.
  const female = male.map(pt => ({ x: pt.x, y: pt.y + p.clearanceMm }));
  return {
    male, female,
    bbox: { min: { x: 0, y: 0 }, max: { x: p.count * p.pitchMm, y: p.thicknessMm + p.clearanceMm } },
    warnings,
  };
}

// ── Finger / box joint ─────────────────────────────────────────

function finger(p: FingerParams): JointProfile {
  const warnings: string[] = [];
  if (p.count < 1) warnings.push('Finger count must be ≥ 1');
  const male: Point2D[] = [];
  const segmentWidth = p.fingerWidthMm;
  for (let i = 0; i < p.count; i++) {
    const x0 = i * segmentWidth * 2;
    const x1 = x0 + segmentWidth;
    male.push({ x: x0, y: 0 });
    male.push({ x: x0, y: p.thicknessMm });
    male.push({ x: x1, y: p.thicknessMm });
    male.push({ x: x1, y: 0 });
  }
  const female = male.map(pt => ({ x: pt.x + p.clearanceMm, y: pt.y }));
  return {
    male, female,
    bbox: { min: { x: 0, y: 0 }, max: { x: p.count * segmentWidth * 2, y: p.thicknessMm } },
    warnings,
  };
}

// ── Lap (rabbet) ──────────────────────────────────────────────

function lap(p: LapParams): JointProfile {
  const w = p.widthMm;
  const t = p.thicknessMm;
  const male: Point2D[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: t },
    { x: 0, y: t },
  ];
  const c = p.clearanceMm;
  const female: Point2D[] = [
    { x: -c, y: -c },
    { x: w + c, y: -c },
    { x: w + c, y: t + c },
    { x: -c, y: t + c },
  ];
  return {
    male, female,
    bbox: { min: { x: -c, y: -c }, max: { x: w + c, y: t + c } },
    warnings: [],
  };
}

// ── Half-blind dovetail ────────────────────────────────────────

function halfBlindDovetail(p: HalfBlindDovetailParams): JointProfile {
  // Treat like a regular dovetail but truncate depth.
  const tail = dovetail({
    kind: 'dovetail',
    count: p.count, widthMm: p.widthMm, pitchMm: p.pitchMm,
    angleDeg: p.angleDeg, pinWidthMm: p.pitchMm * 0.4,
    thicknessMm: Math.min(p.blindDepthMm, p.thicknessMm),
    clearanceMm: p.clearanceMm,
  });
  return tail;
}

// ── Sheet-metal tab + slot ─────────────────────────────────────

function tabSlot(p: TabSlotParams): JointProfile {
  const male: Point2D[] = [];
  const female: Point2D[] = [];
  for (let i = 0; i < p.count; i++) {
    const centerX = (i + 0.5) * p.pitchMm;
    const left = centerX - p.tabWidthMm / 2;
    const right = centerX + p.tabWidthMm / 2;
    male.push({ x: left, y: 0 });
    male.push({ x: left, y: p.thicknessMm });
    male.push({ x: right, y: p.thicknessMm });
    male.push({ x: right, y: 0 });
    female.push({ x: left - p.clearanceMm, y: -p.clearanceMm });
    female.push({ x: left - p.clearanceMm, y: p.thicknessMm + p.clearanceMm });
    female.push({ x: right + p.clearanceMm, y: p.thicknessMm + p.clearanceMm });
    female.push({ x: right + p.clearanceMm, y: -p.clearanceMm });
  }
  return {
    male, female,
    bbox: { min: { x: 0, y: -p.clearanceMm }, max: { x: p.count * p.pitchMm, y: p.thicknessMm + p.clearanceMm } },
    warnings: [],
  };
}

// ── Joint strength estimation ──────────────────────────────────

export interface JointStrength {
  /** Estimated tensile strength (N) before pulling apart. */
  tensileN: number;
  /** Estimated shear strength (N). */
  shearN: number;
  /** Contact area (mm²). */
  contactAreaMm2: number;
}

export function estimateJointStrength(profile: JointProfile, materialShearMPa: number = 5): JointStrength {
  // Contact area = perimeter of male × depth (rough proxy).
  let perim = 0;
  for (let i = 0; i < profile.male.length; i++) {
    const a = profile.male[i]!;
    const b = profile.male[(i + 1) % profile.male.length]!;
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const depthMm = profile.bbox.max.y - profile.bbox.min.y;
  const contactArea = perim * depthMm;
  return {
    contactAreaMm2: contactArea,
    tensileN: contactArea * materialShearMPa,
    shearN: contactArea * materialShearMPa * 0.7,
  };
}

// ── Joint preset library ───────────────────────────────────────

export const JOINT_PRESETS: Record<string, JointParams> = {
  drawer_front_dovetail: {
    kind: 'dovetail',
    count: 4, widthMm: 100, pitchMm: 25, angleDeg: 12, pinWidthMm: 5, thicknessMm: 12, clearanceMm: 0.1,
  },
  shelf_finger: {
    kind: 'finger',
    count: 5, widthMm: 100, fingerWidthMm: 10, thicknessMm: 12, clearanceMm: 0.05,
  },
  chair_mortise: {
    kind: 'mortise-tenon',
    widthMm: 20, heightMm: 30, lengthMm: 25, clearanceMm: 0.1,
  },
  metal_tab: {
    kind: 'tab-slot',
    count: 3, tabWidthMm: 10, pitchMm: 30, thicknessMm: 2, clearanceMm: 0.1,
  },
};
