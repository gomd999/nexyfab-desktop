/**
 * torsion.ts — Saint-Venant torsion of shafts and thin sections.
 *
 *   solid circular:   J = πd⁴/32,  τ_max = T·r/J = 16T/(πd³),  θ = T·L/(G·J)
 *   hollow circular:  J = π(do⁴−di⁴)/32
 *   thin strip:       J = a·b³/3,  τ_max = 3T/(a·b²)        (a = long side, b = thickness)
 *   thin-walled closed (Bredt):  τ = T/(2·A_m·t),  J = 4·A_m²/∮(ds/t)
 *
 * A key result: a closed thin-walled section is vastly stiffer in torsion than an open
 * one of the same material. Verified against the closed forms and that contrast.
 */

/** Polar second moment of a solid circular shaft: J = πd⁴/32. */
export function polarMomentSolid(d: number): number { return (Math.PI * d ** 4) / 32; }
/** Polar second moment of a hollow circular shaft. */
export function polarMomentHollow(dOuter: number, dInner: number): number {
  return (Math.PI * (dOuter ** 4 - dInner ** 4)) / 32;
}
/** Max surface shear of a solid circular shaft: τ_max = 16T/(πd³). */
export function maxShearCircular(T: number, d: number): number { return (16 * T) / (Math.PI * d ** 3); }
/** Angle of twist θ = T·L/(G·J). */
export function twistAngle(T: number, L: number, G: number, J: number): number { return (T * L) / (G * J); }

/** Torsion constant of a thin rectangular strip: J = a·b³/3 (a ≫ b). */
export function thinStripTorsionConstant(a: number, b: number): number { return (a * b ** 3) / 3; }
/** Max shear in a thin strip: τ_max = 3T/(a·b²). */
export function thinStripMaxShear(T: number, a: number, b: number): number { return (3 * T) / (a * b * b); }

/** Bredt shear stress in a single-cell thin-walled closed section: τ = T/(2·A_m·t). */
export function bredtShearStress(T: number, Am: number, t: number): number { return T / (2 * Am * t); }
/** Torsion constant of a thin-walled closed section of constant t: J = 4·A_m²·t/perimeter. */
export function closedSectionTorsionConstant(Am: number, perimeter: number, t: number): number {
  return (4 * Am * Am * t) / perimeter;
}
/** Torsion constant of an OPEN thin-walled section (sum of strips): J = (1/3)·Σ b·t³. */
export function openSectionTorsionConstant(perimeter: number, t: number): number {
  return (perimeter * t ** 3) / 3;
}

/** Transmitted power P = T·ω for a rotating shaft. */
export function shaftPower(T: number, omega: number): number { return T * omega; }
