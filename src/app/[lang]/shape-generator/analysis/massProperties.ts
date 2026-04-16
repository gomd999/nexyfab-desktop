// ─── Mass Properties Computation ─────────────────────────────────────────────
// Uses divergence theorem for volume/center-of-mass and tetrahedra decomposition
// for moments of inertia (each triangle face forms a tetrahedron with the origin).

import * as THREE from 'three';

export interface MassProperties {
  volume_cm3: number;
  surfaceArea_cm2: number;
  mass_g: number;
  centerOfMass: [number, number, number];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  momentsOfInertia: { Ixx: number; Iyy: number; Izz: number }; // g·mm²
  principalAxes?: [number, number, number][];
  gyrationRadius: { rx: number; ry: number; rz: number }; // mm
}

/**
 * Compute full mass properties from a closed triangle mesh.
 * Geometry units are assumed to be mm. density is in g/cm³.
 */
export function computeMassProperties(
  geometry: THREE.BufferGeometry,
  density_g_cm3: number,
): MassProperties {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  if (!pos) {
    return emptyResult();
  }

  const triCount = idx ? idx.count / 3 : pos.count / 3;

  // ── Pass 1: volume and center of mass (divergence theorem) ──
  let totalSignedVol = 0;
  let cx = 0, cy = 0, cz = 0;

  // ── Surface area ──
  let surfaceArea = 0;

  // ── Pass 1 ──
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx2 = pos.getX(i2), cy2 = pos.getY(i2), cz2 = pos.getZ(i2);

    // Signed volume of tetrahedron (origin, a, b, c)
    const v6 = ax * (by * cz2 - bz * cy2)
             - bx * (ay * cz2 - az * cy2)
             + cx2 * (ay * bz - az * by);
    const v = v6 / 6;
    totalSignedVol += v;

    // Centroid of tetrahedron = (a + b + c) / 4
    cx += v * (ax + bx + cx2) / 4;
    cy += v * (ay + by + cy2) / 4;
    cz += v * (az + bz + cz2) / 4;

    // Triangle area for surface area
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    surfaceArea += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
  }

  const vol_mm3 = Math.abs(totalSignedVol);
  const vol_cm3 = vol_mm3 / 1000; // mm³ -> cm³
  const sa_cm2 = surfaceArea / 100; // mm² -> cm²

  if (vol_mm3 > 1e-10) {
    cx /= totalSignedVol;
    cy /= totalSignedVol;
    cz /= totalSignedVol;
  }

  // density in g/cm³ => g/mm³ = density_g_cm3 / 1000
  const density_g_mm3 = density_g_cm3 / 1000;
  const mass_g = density_g_mm3 * vol_mm3;

  // ── Pass 2: moments of inertia about center of mass ──
  // We sum contributions from each tetrahedron (origin, a, b, c), then use
  // parallel axis theorem to shift from origin to center of mass.
  let Ixx_o = 0, Iyy_o = 0, Izz_o = 0;

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const ex = pos.getX(i2), ey = pos.getY(i2), ez = pos.getZ(i2);

    // Signed volume * 6
    const v6 = ax * (by * ez - bz * ey)
             - bx * (ay * ez - az * ey)
             + ex * (ay * bz - az * by);
    const det = v6; // = 6 * signed_volume

    // For a tetrahedron with one vertex at origin, the inertia integrals are:
    // integral(x²) over tet = det/60 * (a²+b²+c²+ab+ac+bc) for that coordinate
    // We compute the diagonal terms of the inertia tensor.

    // Sum of squares and cross-terms for each axis pair
    const xx = ax * ax + bx * bx + ex * ex + ax * bx + ax * ex + bx * ex;
    const yy = ay * ay + by * by + ey * ey + ay * by + ay * ey + by * ey;
    const zz = az * az + bz * bz + ez * ez + az * bz + az * ez + bz * ez;

    const f = det / 60;

    // Ixx = integral(y² + z²) dV, etc.
    Ixx_o += f * (yy + zz);
    Iyy_o += f * (xx + zz);
    Izz_o += f * (xx + yy);
  }

  // Scale to absolute (we used signed det, so take abs of total)
  Ixx_o = Math.abs(Ixx_o);
  Iyy_o = Math.abs(Iyy_o);
  Izz_o = Math.abs(Izz_o);

  // Convert from volume integrals to mass integrals: multiply by density
  Ixx_o *= density_g_mm3;
  Iyy_o *= density_g_mm3;
  Izz_o *= density_g_mm3;

  // Parallel axis theorem: shift from origin to center of mass
  // I_cm = I_o - m * d²  where d² is the perpendicular distance squared
  const Ixx = Math.abs(Ixx_o - mass_g * (cy * cy + cz * cz));
  const Iyy = Math.abs(Iyy_o - mass_g * (cx * cx + cz * cz));
  const Izz = Math.abs(Izz_o - mass_g * (cx * cx + cy * cy));

  // Radius of gyration: k = sqrt(I / m)
  const rx = mass_g > 0 ? Math.sqrt(Ixx / mass_g) : 0;
  const ry = mass_g > 0 ? Math.sqrt(Iyy / mass_g) : 0;
  const rz = mass_g > 0 ? Math.sqrt(Izz / mass_g) : 0;

  // Bounding box
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox ?? new THREE.Box3();
  const size = bb.getSize(new THREE.Vector3());

  return {
    volume_cm3: vol_cm3,
    surfaceArea_cm2: sa_cm2,
    mass_g,
    centerOfMass: [cx, cy, cz],
    boundingBox: {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
      size: [size.x, size.y, size.z],
    },
    momentsOfInertia: { Ixx, Iyy, Izz },
    gyrationRadius: { rx, ry, rz },
  };
}

function emptyResult(): MassProperties {
  return {
    volume_cm3: 0,
    surfaceArea_cm2: 0,
    mass_g: 0,
    centerOfMass: [0, 0, 0],
    boundingBox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
    momentsOfInertia: { Ixx: 0, Iyy: 0, Izz: 0 },
    gyrationRadius: { rx: 0, ry: 0, rz: 0 },
  };
}
