/**
 * leadInOut.ts — CAM lead-in / lead-out path generation.
 *
 * In milling, plunging the cutter straight down into solid material
 * works for some processes (rigid tap, ramp into pocket) but tears
 * up the finish edge of a profile pass. The standard fix is a
 * **lead-in**: an approach segment that brings the tool tangentially
 * onto the cut path, smoothing engagement. A **lead-out** mirror
 * image disengages cleanly.
 *
 * Common lead types:
 *
 *   - **Tangent line** — straight approach at the cut tangent angle.
 *   - **Tangent arc** — arc of given radius, ending tangent to cut.
 *   - **Perpendicular** — comes in 90° (used when adjacent material
 *     prevents tangent approach).
 *   - **Helical / ramped** — for 3D entry, descends spirally into the
 *     work envelope.
 *
 * Output: a `LeadPath` of sampled points the toolpath emitter can
 * inject before the first cut move (and after the last).
 */

export type Vec3 = [number, number, number];

export interface PathPoint {
  position: Vec3;
  /** Unit tangent at that point. */
  tangent: Vec3;
}

export type LeadKind =
  | { kind: 'tangent-line'; lengthMm: number }
  | { kind: 'tangent-arc'; radiusMm: number; angleDeg: number }
  | { kind: 'perpendicular'; lengthMm: number }
  | { kind: 'helical-ramp'; descentMm: number; ramps: number }
  | { kind: 'none' };

export interface LeadPath {
  /** Sampled points (start → end). */
  points: PathPoint[];
  /** Total path length (mm). */
  lengthMm: number;
}

export interface LeadOptions {
  /** Number of samples per arc segment. */
  arcSampleCount: number;
  /** Number of samples per helical turn. */
  helicalSampleCount: number;
}

export const DEFAULT_LEAD_OPTIONS: LeadOptions = {
  arcSampleCount: 16,
  helicalSampleCount: 32,
};

// ── Top-level entry ─────────────────────────────────────────────

/** Generate a lead-in path that ENDS at `cutStart` with the cut's
 *  tangent direction. */
export function generateLeadIn(
  lead: LeadKind,
  cutStart: PathPoint,
  options: Partial<LeadOptions> = {},
): LeadPath {
  const opts = { ...DEFAULT_LEAD_OPTIONS, ...options };
  switch (lead.kind) {
    case 'none':
      return { points: [], lengthMm: 0 };
    case 'tangent-line':
      return tangentLineLead(cutStart, lead.lengthMm, /*entering=*/ true);
    case 'tangent-arc':
      return tangentArcLead(cutStart, lead.radiusMm, lead.angleDeg, /*entering=*/ true, opts);
    case 'perpendicular':
      return perpendicularLead(cutStart, lead.lengthMm, /*entering=*/ true);
    case 'helical-ramp':
      return helicalRampLead(cutStart, lead.descentMm, lead.ramps, /*entering=*/ true, opts);
  }
}

/** Generate a lead-out path that STARTS at `cutEnd` with the cut's
 *  outgoing tangent direction. */
export function generateLeadOut(
  lead: LeadKind,
  cutEnd: PathPoint,
  options: Partial<LeadOptions> = {},
): LeadPath {
  const opts = { ...DEFAULT_LEAD_OPTIONS, ...options };
  switch (lead.kind) {
    case 'none':
      return { points: [], lengthMm: 0 };
    case 'tangent-line':
      return tangentLineLead(cutEnd, lead.lengthMm, /*entering=*/ false);
    case 'tangent-arc':
      return tangentArcLead(cutEnd, lead.radiusMm, lead.angleDeg, /*entering=*/ false, opts);
    case 'perpendicular':
      return perpendicularLead(cutEnd, lead.lengthMm, /*entering=*/ false);
    case 'helical-ramp':
      return helicalRampLead(cutEnd, lead.descentMm, lead.ramps, /*entering=*/ false, opts);
  }
}

// ── Tangent line ────────────────────────────────────────────────

function tangentLineLead(anchor: PathPoint, length: number, entering: boolean): LeadPath {
  const t = normalize(anchor.tangent);
  if (entering) {
    const start: Vec3 = [
      anchor.position[0] - t[0] * length,
      anchor.position[1] - t[1] * length,
      anchor.position[2] - t[2] * length,
    ];
    return {
      points: [
        { position: start, tangent: t },
        { position: anchor.position, tangent: t },
      ],
      lengthMm: length,
    };
  }
  const end: Vec3 = [
    anchor.position[0] + t[0] * length,
    anchor.position[1] + t[1] * length,
    anchor.position[2] + t[2] * length,
  ];
  return {
    points: [
      { position: anchor.position, tangent: t },
      { position: end, tangent: t },
    ],
    lengthMm: length,
  };
}

// ── Tangent arc ─────────────────────────────────────────────────

function tangentArcLead(anchor: PathPoint, radius: number, angleDeg: number, entering: boolean, opts: LeadOptions): LeadPath {
  const t = normalize(anchor.tangent);
  // Arc center is perpendicular to tangent, in the plane normal to a "up"
  // direction. For a 2D toolpath we assume Z=up.
  const upGuess: Vec3 = Math.abs(t[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const normal = normalize(cross(t, upGuess));
  // Center = anchor + radius × normal (on the offset side).
  const center: Vec3 = [
    anchor.position[0] + normal[0] * radius,
    anchor.position[1] + normal[1] * radius,
    anchor.position[2] + normal[2] * radius,
  ];
  // Vector from center to anchor.
  const rAnchor: Vec3 = [
    anchor.position[0] - center[0],
    anchor.position[1] - center[1],
    anchor.position[2] - center[2],
  ];
  const angleRad = (angleDeg * Math.PI) / 180;
  const sign = entering ? -1 : 1;
  const points: PathPoint[] = [];
  for (let s = 0; s <= opts.arcSampleCount; s++) {
    const u = s / opts.arcSampleCount;
    const theta = sign * angleRad * (entering ? (1 - u) : u);
    // Rotate rAnchor around the axis perpendicular to the arc plane (≈ upGuess).
    const rotated = rotateAroundAxis(rAnchor, upGuess, theta);
    const pos: Vec3 = [center[0] + rotated[0], center[1] + rotated[1], center[2] + rotated[2]];
    // Tangent at this point = perpendicular to the radius vector.
    const tangentDir = normalize(rotateAroundAxis(rotated, upGuess, sign * Math.PI / 2));
    points.push({ position: pos, tangent: tangentDir });
  }
  const length = radius * Math.abs(angleRad);
  return { points, lengthMm: length };
}

// ── Perpendicular ──────────────────────────────────────────────

function perpendicularLead(anchor: PathPoint, length: number, entering: boolean): LeadPath {
  const t = normalize(anchor.tangent);
  const upGuess: Vec3 = Math.abs(t[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const perp = normalize(cross(t, upGuess));
  if (entering) {
    const start: Vec3 = [
      anchor.position[0] + perp[0] * length,
      anchor.position[1] + perp[1] * length,
      anchor.position[2] + perp[2] * length,
    ];
    return {
      points: [
        { position: start, tangent: [-perp[0], -perp[1], -perp[2]] },
        { position: anchor.position, tangent: t },
      ],
      lengthMm: length,
    };
  }
  const end: Vec3 = [
    anchor.position[0] + perp[0] * length,
    anchor.position[1] + perp[1] * length,
    anchor.position[2] + perp[2] * length,
  ];
  return {
    points: [
      { position: anchor.position, tangent: t },
      { position: end, tangent: perp },
    ],
    lengthMm: length,
  };
}

// ── Helical ramp ───────────────────────────────────────────────

function helicalRampLead(anchor: PathPoint, descent: number, ramps: number, entering: boolean, opts: LeadOptions): LeadPath {
  const totalSamples = opts.helicalSampleCount * Math.max(1, Math.floor(ramps));
  const t = normalize(anchor.tangent);
  const upGuess: Vec3 = Math.abs(t[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const normal = normalize(cross(t, upGuess));
  const radius = Math.max(0.5, descent / 4); // gentle ramp.
  const center: Vec3 = [
    anchor.position[0] + normal[0] * radius,
    anchor.position[1] + normal[1] * radius,
    anchor.position[2] + normal[2] * radius,
  ];
  const points: PathPoint[] = [];
  for (let s = 0; s <= totalSamples; s++) {
    const u = s / totalSamples;
    const theta = (entering ? -1 : 1) * 2 * Math.PI * ramps * (entering ? (1 - u) : u);
    const rotated = rotateAroundAxis([
      anchor.position[0] - center[0],
      anchor.position[1] - center[1],
      anchor.position[2] - center[2],
    ], upGuess, theta);
    const zOffset = entering ? descent * (1 - u) : descent * u;
    const pos: Vec3 = [
      center[0] + rotated[0],
      center[1] + rotated[1],
      center[2] + rotated[2] + (entering ? zOffset : -zOffset),
    ];
    const tangentDir = normalize(rotateAroundAxis(rotated, upGuess, Math.PI / 2));
    points.push({ position: pos, tangent: tangentDir });
  }
  return { points, lengthMm: 2 * Math.PI * radius * ramps + descent };
}

// ── Vector helpers ──────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  // Rodrigues' formula.
  const n = normalize(axis);
  const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  const x = v[0], y = v[1], z = v[2];
  return [
    x * (c + n[0] * n[0] * C) + y * (n[0] * n[1] * C - n[2] * s) + z * (n[0] * n[2] * C + n[1] * s),
    x * (n[1] * n[0] * C + n[2] * s) + y * (c + n[1] * n[1] * C) + z * (n[1] * n[2] * C - n[0] * s),
    x * (n[2] * n[0] * C - n[1] * s) + y * (n[2] * n[1] * C + n[0] * s) + z * (c + n[2] * n[2] * C),
  ];
}

// ── Selection heuristic ─────────────────────────────────────────

export interface LeadRecommendation {
  inLead: LeadKind;
  outLead: LeadKind;
  reason: string;
}

/** Heuristic recommendation given the cut context.
 *  - Closed loops (profile) → tangent arc both ends.
 *  - Open paths into solid → helical ramp in, tangent line out.
 *  - Slot / pocket entries → perpendicular both ends if material allows. */
export function recommendLead(
  context: 'closed-profile' | 'open-path' | 'pocket-entry' | 'slot',
  toolDiameterMm: number,
): LeadRecommendation {
  switch (context) {
    case 'closed-profile':
      return {
        inLead: { kind: 'tangent-arc', radiusMm: toolDiameterMm, angleDeg: 90 },
        outLead: { kind: 'tangent-arc', radiusMm: toolDiameterMm, angleDeg: 90 },
        reason: 'Closed profile — tangent arc ends prevent witness marks',
      };
    case 'open-path':
      return {
        inLead: { kind: 'tangent-line', lengthMm: toolDiameterMm * 2 },
        outLead: { kind: 'tangent-line', lengthMm: toolDiameterMm * 2 },
        reason: 'Open path — clear tangent approach and exit',
      };
    case 'pocket-entry':
      return {
        inLead: { kind: 'helical-ramp', descentMm: toolDiameterMm * 0.5, ramps: 2 },
        outLead: { kind: 'tangent-line', lengthMm: toolDiameterMm * 0.5 },
        reason: 'Pocket entry — helical ramp avoids plunge into solid',
      };
    case 'slot':
      return {
        inLead: { kind: 'perpendicular', lengthMm: toolDiameterMm * 0.5 },
        outLead: { kind: 'perpendicular', lengthMm: toolDiameterMm * 0.5 },
        reason: 'Narrow slot — perpendicular leads for short approach',
      };
  }
}
