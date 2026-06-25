/**
 * importedParts — turn imported mesh shells (from a multi-body STL/STEP, after
 * splitGeometryByConnectedComponent) into assembly PlacedParts.
 *
 * Each shell is recentred to its bbox centre and registered in the imported-
 * geometry registry; the PlacedPart carries that synthetic shapeId plus the
 * centre as its world `position` — matching the catalog convention (geometry
 * centred at origin, placed by `position`). From here the parts flow into the
 * same assembly pipeline as catalog parts: mates, balance, simulation.
 */
import * as THREE from 'three';
import type { PlacedPart } from './PartPlacementPanel';
import { registerImportedGeometry } from '../shapes/importedRegistry';

/**
 * Convert split geometries into PlacedParts. Geometries are recentred in place
 * (their local origin becomes the bbox centre) and the original centre becomes
 * the part's `position`, so the assembly looks identical to the imported file
 * while each part is now independently movable/mateable.
 */
export function importedGeometriesToPlaced(
  geometries: THREE.BufferGeometry[],
  baseName = 'part',
): PlacedPart[] {
  return geometries.map((geo, i) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox ?? new THREE.Box3();
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z); // recentre to origin
    geo.computeBoundingBox();
    const shapeId = registerImportedGeometry(geo, `${baseName}${i}`);
    return {
      id: `imp_${i}_${shapeId.replace(/[^a-zA-Z0-9]/g, '')}`,
      name: `${baseName} ${i + 1}`,
      shapeId,
      params: {},
      qty: 1,
      position: [center.x, center.y, center.z] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
    };
  });
}
