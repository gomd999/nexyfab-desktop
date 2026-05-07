import * as THREE from 'three';
import type { ShapeResult } from '../shapes';
import { computeExplodedPositions } from './ExplodedView';

/** Minimal part info for union AABB (matches `BomPartResult` from ShapePreview). */
export type AssemblyBoundsPart = {
  name?: string;
  result: ShapeResult;
  position?: [number, number, number];
  rotation?: [number, number, number];
};

/**
 * World-space axis-aligned bounds of all assembly parts, including exploded view offsets when `explodeFactor > 0`.
 */
export function computeAssemblyWorldBounds(
  bomParts: AssemblyBoundsPart[] | undefined | null,
  explodeFactor: number,
): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!bomParts?.length) return null;

  let explodedOffsets: Map<string, THREE.Vector3> | null = null;
  if (explodeFactor > 0) {
    const partsInput = bomParts.map((p, i) => {
      const mat = new THREE.Matrix4();
      if (p.rotation) {
        const rot = p.rotation.map(d => d * Math.PI / 180) as [number, number, number];
        mat.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
      }
      if (p.position) {
        const t = new THREE.Matrix4().makeTranslation(...p.position);
        mat.premultiply(t);
      }
      return { id: p.name || `part_${i}`, geometry: p.result.geometry, transform: mat };
    });
    explodedOffsets = computeExplodedPositions(partsInput, explodeFactor);
  }

  let box: THREE.Box3 | null = null;
  for (let i = 0; i < bomParts.length; i++) {
    const p = bomParts[i];
    const partKey = p.name || `part_${i}`;
    const explodeOffset = explodedOffsets?.get(partKey);
    const pos: [number, number, number] = p.position
      ? [
          p.position[0] + (explodeOffset?.x ?? 0),
          p.position[1] + (explodeOffset?.y ?? 0),
          p.position[2] + (explodeOffset?.z ?? 0),
        ]
      : explodeOffset
        ? [explodeOffset.x, explodeOffset.y, explodeOffset.z]
        : [0, 0, 0];
    const mat = new THREE.Matrix4();
    if (p.rotation) {
      const rot = p.rotation.map(d => d * Math.PI / 180) as [number, number, number];
      mat.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    }
    mat.setPosition(pos[0], pos[1], pos[2]);
    const g = p.result.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) continue;
    const corners = [
      new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
      new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
      new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
      new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
    ];
    for (const c of corners) {
      c.applyMatrix4(mat);
      if (!box) box = new THREE.Box3().setFromPoints([c]);
      else box.expandByPoint(c);
    }
  }
  if (!box) return null;
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}
