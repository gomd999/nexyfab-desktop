/**
 * massProperties — geometry-coupled verification of the production mass-properties code
 * (the volume / centroid / inertia the CAD UI shows the user). Unlike the fea/ closed-form
 * library, this exercises the REAL path: a THREE.BufferGeometry primitive → the
 * divergence-theorem / tetra-decomposition solver in massProperties.ts → checked against
 * the exact rigid-body closed forms.
 *
 *   box (w×h×d):  V=whd, CoM=0, Ixx=m(h²+d²)/12, Iyy=m(w²+d²)/12, Izz=m(w²+h²)/12
 *   sphere (R):   V=4/3πR³, I=2/5·mR² (all axes, isotropic)
 *   cylinder:     V=πR²h, axial I=½mR², transverse I=m(3R²+h²)/12  (THREE axis = Y)
 *
 * The box is exactly triangulated ⇒ machine-tight tolerance; the sphere/cylinder are
 * faceted approximations ⇒ a sub-percent discretization gap is expected and asserted to
 * stay below the inscribed-polyhedron bound (computed V must be slightly UNDER analytic).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeMassProperties, combineAssemblyMassProperties } from './massProperties';

const DENSITY = 7.85; // g/cm³ (steel)

describe('massProperties — geometry → analysis (verified vs closed form)', () => {
  it('an exactly-meshed box matches V, area, CoM and inertia to machine precision', () => {
    const w = 40, h = 30, d = 20; // mm
    const g = new THREE.BoxGeometry(w, h, d);
    const mp = computeMassProperties(g, DENSITY);

    expect(mp.volume_cm3).toBeCloseTo((w * h * d) / 1000, 6);                 // 24 cm³
    expect(mp.surfaceArea_cm2).toBeCloseTo((2 * (w * h + w * d + h * d)) / 100, 6); // 52 cm²
    const m = DENSITY * (w * h * d) / 1000;                                   // g
    expect(mp.mass_g).toBeCloseTo(m, 6);
    // centred box ⇒ CoM at origin
    expect(mp.centerOfMass[0]).toBeCloseTo(0, 6);
    expect(mp.centerOfMass[1]).toBeCloseTo(0, 6);
    expect(mp.centerOfMass[2]).toBeCloseTo(0, 6);
    // solid-box inertia (g·mm²)
    expect(mp.momentsOfInertia.Ixx).toBeCloseTo((m * (h * h + d * d)) / 12, 4);
    expect(mp.momentsOfInertia.Iyy).toBeCloseTo((m * (w * w + d * d)) / 12, 4);
    expect(mp.momentsOfInertia.Izz).toBeCloseTo((m * (w * w + h * h)) / 12, 4);
  });

  it('a translated box reports the offset centroid with inertia unchanged (parallel axis)', () => {
    const w = 40, h = 30, d = 20;
    const centred = computeMassProperties(new THREE.BoxGeometry(w, h, d), DENSITY);
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(100, -50, 25);
    const moved = computeMassProperties(g, DENSITY);
    expect(moved.centerOfMass[0]).toBeCloseTo(100, 4);
    expect(moved.centerOfMass[1]).toBeCloseTo(-50, 4);
    expect(moved.centerOfMass[2]).toBeCloseTo(25, 4);
    // inertia is about the CoM ⇒ invariant under translation
    expect(moved.momentsOfInertia.Ixx).toBeCloseTo(centred.momentsOfInertia.Ixx, 2);
    expect(moved.momentsOfInertia.Izz).toBeCloseTo(centred.momentsOfInertia.Izz, 2);
  });

  it('a finely-faceted sphere approaches V=4/3πR³ and the isotropic 2/5·mR² inertia', () => {
    const R = 25;
    const g = new THREE.SphereGeometry(R, 128, 96);
    const mp = computeMassProperties(g, DENSITY);
    const Vexact = (4 / 3) * Math.PI * R ** 3;
    expect(mp.volume_cm3 * 1000).toBeGreaterThan(Vexact * 0.99);  // within ~1%
    expect(mp.volume_cm3 * 1000).toBeLessThan(Vexact);            // inscribed polyhedron ⇒ under
    const m = mp.mass_g;
    const Iexact = 0.4 * m * R * R;                               // 2/5 mR²
    for (const I of [mp.momentsOfInertia.Ixx, mp.momentsOfInertia.Iyy, mp.momentsOfInertia.Izz]) {
      expect(I / Iexact).toBeGreaterThan(0.98);
      expect(I / Iexact).toBeLessThan(1.0);
    }
    // isotropy: the three principal moments are essentially equal (within 0.5%)
    expect(mp.momentsOfInertia.Ixx / mp.momentsOfInertia.Iyy).toBeCloseTo(1, 2);
    expect(mp.momentsOfInertia.Iyy / mp.momentsOfInertia.Izz).toBeCloseTo(1, 2);
  });

  it('a faceted cylinder matches V=πR²h with axial ½mR² and transverse m(3R²+h²)/12', () => {
    const R = 20, hh = 60;
    const g = new THREE.CylinderGeometry(R, R, hh, 128); // axis along Y
    const mp = computeMassProperties(g, DENSITY);
    const Vexact = Math.PI * R * R * hh;
    expect(mp.volume_cm3 * 1000).toBeGreaterThan(Vexact * 0.99);
    expect(mp.volume_cm3 * 1000).toBeLessThan(Vexact);
    const m = mp.mass_g;
    expect(mp.momentsOfInertia.Iyy / (0.5 * m * R * R)).toBeGreaterThan(0.985); // axial ½mR²
    expect(mp.momentsOfInertia.Iyy / (0.5 * m * R * R)).toBeLessThan(1.0);
    const Itrans = (m * (3 * R * R + hh * hh)) / 12;
    expect(mp.momentsOfInertia.Ixx / Itrans).toBeGreaterThan(0.985);            // transverse
    expect(mp.momentsOfInertia.Ixx / mp.momentsOfInertia.Izz).toBeCloseTo(1, 2); // symmetry
  });

  it('combines an assembly: total mass adds and the CoM is the mass-weighted mean', () => {
    const cube = () => new THREE.BoxGeometry(20, 20, 20);
    const asm = combineAssemblyMassProperties([
      { name: 'A', geometry: cube(), density_g_cm3: DENSITY, position: [0, 0, 0] },
      { name: 'B', geometry: cube(), density_g_cm3: DENSITY, position: [60, 0, 0] },
    ]);
    const one = DENSITY * (20 ** 3) / 1000;
    expect(asm.mass_g).toBeCloseTo(2 * one, 4);
    expect(asm.centerOfMass[0]).toBeCloseTo(30, 4);   // midway between the two cubes
    expect(asm.parts[0].fraction).toBeCloseTo(0.5, 6);
  });
});
