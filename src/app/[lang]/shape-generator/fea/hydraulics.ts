/**
 * hydraulics.ts — incompressible hydraulics (Pascal's principle) for cylinders and
 * presses.
 *
 *   pressure:           P = F/A          (transmitted equally — Pascal)
 *   force multiplier:   F2/F1 = A2/A1
 *   work conservation:  F1·d1 = F2·d2    ⇒  d1/d2 = A2/A1   (no free lunch)
 *   cylinder force:     F = P·A,  bore A = πD²/4,  rod side = π(D²−d²)/4 (annulus)
 *   speed:              v = Q/A          (volume continuity)
 *
 * Verified against the pressure/force relations, the force multiplication with work
 * conservation, the annular rod-side reduction, and the flow-speed continuity.
 */

/** Pressure P = F/A. */
export function pressure(F: number, A: number): number { return F / A; }
/** Force from pressure on an area: F = P·A. */
export function pascalForce(P: number, A: number): number { return P * A; }
/** Bore (full-piston) area πD²/4. */
export function boreArea(D: number): number { return (Math.PI * D * D) / 4; }
/** Annular (rod-side) area π(D²−d²)/4. */
export function annularArea(D: number, dRod: number): number { return (Math.PI * (D * D - dRod * dRod)) / 4; }

/** Force multiplication ratio of a hydraulic press: F2/F1 = A2/A1. */
export function forceMultiplication(A1: number, A2: number): number { return A2 / A1; }
/** Cylinder/piston speed from flow: v = Q/A. */
export function cylinderSpeed(Q: number, A: number): number { return Q / A; }
/** Output stroke for an input stroke under work conservation: d_out = d_in·A_in/A_out. */
export function outputStroke(dIn: number, Ain: number, Aout: number): number { return (dIn * Ain) / Aout; }
