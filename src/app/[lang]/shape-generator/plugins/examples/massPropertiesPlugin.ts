// ─── Mass Properties Plugin — Toolbar button that computes mass properties ───

import * as THREE from 'three';
import type { PluginManifest, PluginInitFn } from '../PluginAPI';

export const massPropertiesManifest: PluginManifest = {
  id: 'example-mass-properties',
  name: 'Mass Properties',
  version: '1.0.0',
  author: 'NexyFab',
  description: 'Calculates center of mass, volume, and moments of inertia for the current geometry',
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

interface MassProperties {
  volume: number;
  centerOfMass: { x: number; y: number; z: number };
  inertia: { Ixx: number; Iyy: number; Izz: number };
}

function computeMassProperties(geo: THREE.BufferGeometry): MassProperties {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos) return { volume: 0, centerOfMass: { x: 0, y: 0, z: 0 }, inertia: { Ixx: 0, Iyy: 0, Izz: 0 } };

  let totalVolume = 0;
  let cx = 0, cy = 0, cz = 0;
  let ixx = 0, iyy = 0, izz = 0;

  const triCount = idx ? idx.count / 3 : pos.count / 3;

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx2 = pos.getX(i2), cy2 = pos.getY(i2), cz2 = pos.getZ(i2);

    // Signed volume of tetrahedron formed with origin
    const v = (ax * (by * cz2 - bz * cy2) - bx * (ay * cz2 - az * cy2) + cx2 * (ay * bz - az * by)) / 6;
    totalVolume += v;

    // Centroid of tetrahedron
    const tx = (ax + bx + cx2) / 4;
    const ty = (ay + by + cy2) / 4;
    const tz = (az + bz + cz2) / 4;
    cx += v * tx;
    cy += v * ty;
    cz += v * tz;
  }

  const vol = Math.abs(totalVolume);
  if (vol > 1e-10) {
    cx /= totalVolume;
    cy /= totalVolume;
    cz /= totalVolume;
  }

  // Approximate moments of inertia (assuming uniform density = 1)
  // Using parallel axis theorem from centroid with bounding box approximation
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const m = vol; // mass = density * volume, density = 1
  ixx = (m / 12) * (size.y * size.y + size.z * size.z);
  iyy = (m / 12) * (size.x * size.x + size.z * size.z);
  izz = (m / 12) * (size.x * size.x + size.y * size.y);

  return {
    volume: vol,
    centerOfMass: { x: cx, y: cy, z: cz },
    inertia: { Ixx: ixx, Iyy: iyy, Izz: izz },
  };
}

/* ─── Plugin Init ─────────────────────────────────────────────────────────── */

export const massPropertiesInit: PluginInitFn = (ctx) => {
  ctx.registerToolbarButton({
    id: 'calc-mass',
    label: 'Mass Props',
    icon: '⚖️',
    category: 'evaluate',
    tooltip: 'Calculate center of mass and moments of inertia',
    onClick: () => {
      const geo = ctx.getGeometry();
      if (!geo) {
        ctx.showToast('warning', 'No geometry available — select or generate a shape first');
        return;
      }

      const props = computeMassProperties(geo);

      const lines = [
        `Volume: ${(props.volume / 1000).toFixed(3)} cm3`,
        `CoM: (${props.centerOfMass.x.toFixed(2)}, ${props.centerOfMass.y.toFixed(2)}, ${props.centerOfMass.z.toFixed(2)}) mm`,
        `Ixx: ${props.inertia.Ixx.toFixed(1)} mm4`,
        `Iyy: ${props.inertia.Iyy.toFixed(1)} mm4`,
        `Izz: ${props.inertia.Izz.toFixed(1)} mm4`,
      ];

      ctx.showToast('success', lines.join(' | '));
    },
  });

  ctx.showToast('info', 'Mass Properties plugin loaded');
};
