/**
 * gearGeometry.ts — involute spur-gear geometry. A gear tooth flank is an INVOLUTE of
 * the base circle: the curve traced by the end of a string unwound from the base
 * circle. At roll angle θ the involute point is
 *
 *   (x,y) = rb·(cosθ + θ·sinθ,  sinθ − θ·cosθ),   |r| = rb·√(1+θ²)
 *
 * The pressure angle α at a radius r satisfies cosα = rb/r, and the involute function
 * inv(α) = tanα − α gives the angular position. Standard gears: module m, N teeth,
 * pitch d = m·N, base db = m·N·cosφ, base pitch pb = π·m·cosφ.
 *
 * Verified: the involute point radius rb√(1+θ²) and its radius of curvature rb·θ; the
 * pressure angle at the pitch circle equalling φ; inv(α)=tanα−α; the pitch/base
 * diameters, gear ratio and centre distance; and the shared base pitch of a mesh.
 */

/** Point on the involute of a base circle (radius rb) at roll angle θ. */
export function involutePoint(rb: number, theta: number): [number, number] {
  return [rb * (Math.cos(theta) + theta * Math.sin(theta)), rb * (Math.sin(theta) - theta * Math.cos(theta))];
}

/** Involute function inv(α) = tan(α) − α. */
export function involuteFunction(alpha: number): number {
  return Math.tan(alpha) - alpha;
}

/** Pressure angle at radius r on an involute from base radius rb: α = acos(rb/r). */
export function pressureAngleAtRadius(rb: number, r: number): number {
  return Math.acos(Math.max(-1, Math.min(1, rb / r)));
}

export function pitchDiameter(module: number, teeth: number): number { return module * teeth; }
export function baseDiameter(module: number, teeth: number, pressureAngle: number): number {
  return module * teeth * Math.cos(pressureAngle);
}
/** Base pitch pb = π·m·cosφ (the distance between adjacent involutes along the line of action). */
export function basePitch(module: number, pressureAngle: number): number { return Math.PI * module * Math.cos(pressureAngle); }

/** Gear ratio N2/N1 = ω1/ω2 (driven teeth ÷ driver teeth). */
export function gearRatio(teethDriver: number, teethDriven: number): number { return teethDriven / teethDriver; }

/** Standard centre distance of a mesh: (d1+d2)/2 = m(N1+N2)/2. */
export function centerDistance(module: number, teeth1: number, teeth2: number): number {
  return (module * (teeth1 + teeth2)) / 2;
}

/** Radius of curvature of the involute at roll angle θ (unwound string length): ρ = rb·θ. */
export function radiusOfCurvature(rb: number, theta: number): number { return rb * theta; }
