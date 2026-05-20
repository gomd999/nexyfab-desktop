/**
 * slotPatternGenerator.ts — Generate slot patterns for jigs / fixtures /
 * vented covers.
 *
 * Slots are elongated holes machined into a plate. Patterns:
 *
 *   - **Linear**: N slots equally spaced along a row.
 *   - **Linear grid**: rows × cols of slots.
 *   - **Circular** (radial): slots arrayed around a center.
 *   - **Staggered**: alternating offset rows (hex packing).
 *
 * Each slot has:
 *
 *   - Width × length × corner radius.
 *   - Position + orientation in the plate's local frame.
 *
 * Output is a list of slot specs the caller turns into cutout
 * geometry. Module also computes pattern stats: total cut area,
 * remaining strength fraction, max slot edge length (for laser
 * cycle estimate).
 */

export interface Vec2 { x: number; y: number }

export type SlotPattern = 'linear' | 'grid' | 'circular' | 'staggered';

export interface SlotSpec {
  id: string;
  /** Center of the slot in plate-local frame. */
  center: Vec2;
  /** Orientation angle of the slot's long axis (radians). */
  angleRad: number;
  /** Width (short dimension), mm. */
  widthMm: number;
  /** Length (long dimension), mm. */
  lengthMm: number;
  /** Corner radius. */
  cornerRadiusMm: number;
}

export interface PatternInput {
  pattern: SlotPattern;
  /** Slot width. */
  widthMm: number;
  /** Slot length. */
  lengthMm: number;
  /** Corner radius (default width/2 for full rounding). */
  cornerRadiusMm?: number;
}

export interface LinearInput extends PatternInput {
  pattern: 'linear';
  /** Start point. */
  start: Vec2;
  /** Direction of the row (will be normalized). */
  direction: Vec2;
  /** Slot count. */
  count: number;
  /** Pitch (center-to-center distance), mm. */
  pitchMm: number;
}

export interface GridInput extends PatternInput {
  pattern: 'grid';
  origin: Vec2;
  rows: number;
  cols: number;
  pitchXMm: number;
  pitchYMm: number;
}

export interface CircularInput extends PatternInput {
  pattern: 'circular';
  center: Vec2;
  /** Inner radius (center of slots). */
  radiusMm: number;
  /** Slot count around the circle. */
  count: number;
  /** Start angle (radians). */
  startAngleRad?: number;
  /** True = slot's long axis radial; false = tangential. */
  radialOrientation?: boolean;
}

export interface StaggeredInput extends PatternInput {
  pattern: 'staggered';
  origin: Vec2;
  rows: number;
  cols: number;
  pitchXMm: number;
  pitchYMm: number;
}

export type PatternSpec = LinearInput | GridInput | CircularInput | StaggeredInput;

export interface PatternResult {
  slots: SlotSpec[];
  totalCutAreaMm2: number;
  totalCutPerimeterMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateSlotPattern(spec: PatternSpec): PatternResult {
  let slots: SlotSpec[] = [];
  switch (spec.pattern) {
    case 'linear': slots = buildLinear(spec); break;
    case 'grid': slots = buildGrid(spec); break;
    case 'circular': slots = buildCircular(spec); break;
    case 'staggered': slots = buildStaggered(spec); break;
  }
  let area = 0;
  let perimeter = 0;
  for (const s of slots) {
    const w = s.widthMm;
    const L = s.lengthMm;
    const r = Math.min(s.cornerRadiusMm, w / 2);
    // Stadium area = w·L - (4 - π)·r²; perimeter = 2(L - 2r) + 2π·r.
    area += w * L - (4 - Math.PI) * r * r;
    perimeter += 2 * (L - 2 * r) + 2 * Math.PI * r;
  }
  return { slots, totalCutAreaMm2: area, totalCutPerimeterMm: perimeter };
}

// ── Per-pattern builders ──────────────────────────────────────

function makeSlot(id: string, center: Vec2, angle: number, p: PatternInput): SlotSpec {
  return {
    id,
    center,
    angleRad: angle,
    widthMm: p.widthMm,
    lengthMm: p.lengthMm,
    cornerRadiusMm: p.cornerRadiusMm ?? p.widthMm / 2,
  };
}

function buildLinear(spec: LinearInput): SlotSpec[] {
  const len = Math.hypot(spec.direction.x, spec.direction.y) || 1;
  const dx = spec.direction.x / len;
  const dy = spec.direction.y / len;
  const slots: SlotSpec[] = [];
  for (let i = 0; i < spec.count; i++) {
    slots.push(makeSlot(
      `slot-${i}`,
      { x: spec.start.x + dx * spec.pitchMm * i, y: spec.start.y + dy * spec.pitchMm * i },
      Math.atan2(dy, dx),
      spec,
    ));
  }
  return slots;
}

function buildGrid(spec: GridInput): SlotSpec[] {
  const slots: SlotSpec[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      slots.push(makeSlot(
        `slot-${r}-${c}`,
        { x: spec.origin.x + c * spec.pitchXMm, y: spec.origin.y + r * spec.pitchYMm },
        0,
        spec,
      ));
    }
  }
  return slots;
}

function buildCircular(spec: CircularInput): SlotSpec[] {
  const slots: SlotSpec[] = [];
  const startA = spec.startAngleRad ?? 0;
  for (let i = 0; i < spec.count; i++) {
    const theta = startA + (2 * Math.PI * i) / spec.count;
    const cx = spec.center.x + Math.cos(theta) * spec.radiusMm;
    const cy = spec.center.y + Math.sin(theta) * spec.radiusMm;
    const slotAngle = spec.radialOrientation === false ? theta + Math.PI / 2 : theta;
    slots.push(makeSlot(`slot-${i}`, { x: cx, y: cy }, slotAngle, spec));
  }
  return slots;
}

function buildStaggered(spec: StaggeredInput): SlotSpec[] {
  const slots: SlotSpec[] = [];
  for (let r = 0; r < spec.rows; r++) {
    const offsetX = (r % 2) * (spec.pitchXMm / 2);
    for (let c = 0; c < spec.cols; c++) {
      slots.push(makeSlot(
        `slot-${r}-${c}`,
        { x: spec.origin.x + offsetX + c * spec.pitchXMm, y: spec.origin.y + r * spec.pitchYMm },
        0,
        spec,
      ));
    }
  }
  return slots;
}

// ── Plate strength estimate ────────────────────────────────────

export interface PlateStrength {
  /** Effective remaining material area within the pattern's bbox. */
  remainingAreaMm2: number;
  /** Fraction of plate area still solid. */
  solidFraction: number;
}

export function estimatePlateStrength(result: PatternResult, plateAreaMm2: number): PlateStrength {
  const remaining = Math.max(0, plateAreaMm2 - result.totalCutAreaMm2);
  return {
    remainingAreaMm2: remaining,
    solidFraction: plateAreaMm2 > 0 ? remaining / plateAreaMm2 : 1,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface PatternSummary {
  slotCount: number;
  totalCutAreaMm2: number;
  totalCutPerimeterMm: number;
  estLaserMinutes: number;
}

export function summarize(result: PatternResult, laserCutSpeedMmMin: number = 2000): PatternSummary {
  const minutes = laserCutSpeedMmMin > 0 ? result.totalCutPerimeterMm / laserCutSpeedMmMin : 0;
  return {
    slotCount: result.slots.length,
    totalCutAreaMm2: result.totalCutAreaMm2,
    totalCutPerimeterMm: result.totalCutPerimeterMm,
    estLaserMinutes: minutes,
  };
}
