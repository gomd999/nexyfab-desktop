import * as THREE from 'three';

/**
 * Voxelize a mesh into a binary mask.
 * Returns Uint8Array of length nx*ny*nz where 1 = inside mesh, 0 = outside.
 * Uses ray-casting parity test: cast ray from each (ey, ez) pair in +X direction,
 * count intersections. Odd = inside, even = outside.
 */
export function voxelizeMesh(
  geometry: THREE.BufferGeometry,
  nx: number,
  ny: number,
  nz: number,
  dimX: number,
  dimY: number,
  dimZ: number
): Uint8Array {
  const nElem = nx * ny * nz;
  const mask = new Uint8Array(nElem);

  // Center the geometry at origin based on its bounding box
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  const centeredGeometry = geometry.clone();
  centeredGeometry.translate(-center.x, -center.y, -center.z);

  // Scale geometry to fit within the voxel grid dimensions
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const scaleX = size.x > 1e-10 ? dimX / size.x : 1;
  const scaleY = size.y > 1e-10 ? dimY / size.y : 1;
  const scaleZ = size.z > 1e-10 ? dimZ / size.z : 1;
  centeredGeometry.scale(scaleX, scaleY, scaleZ);

  // Create mesh for raycasting
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(centeredGeometry, material);

  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3(1, 0, 0);

  const voxelSizeX = dimX / nx;
  const halfDimX = dimX / 2;
  const halfDimY = dimY / 2;
  const halfDimZ = dimZ / 2;

  // For each (ey, ez) pair, cast a ray in +X and determine inside/outside
  for (let ez = 0; ez < nz; ez++) {
    const cz = -halfDimZ + (ez + 0.5) * (dimZ / nz);

    for (let ey = 0; ey < ny; ey++) {
      const cy = -halfDimY + (ey + 0.5) * (dimY / ny);

      // Cast ray from far left in +X direction
      rayOrigin.set(-halfDimX - dimX, cy, cz);
      raycaster.set(rayOrigin, rayDirection);
      raycaster.far = Infinity;

      const intersections = raycaster.intersectObject(mesh, false);

      if (intersections.length === 0) continue;

      // Get intersection distances (X coordinates relative to ray origin)
      const hitDistances = intersections
        .map((hit) => hit.point.x)
        .sort((a, b) => a - b);

      // Remove duplicate intersections (within tolerance)
      const uniqueHits: number[] = [];
      for (let i = 0; i < hitDistances.length; i++) {
        if (
          uniqueHits.length === 0 ||
          Math.abs(hitDistances[i] - uniqueHits[uniqueHits.length - 1]) > 1e-8
        ) {
          uniqueHits.push(hitDistances[i]);
        }
      }

      // Walk through voxels in X, toggling inside/outside at each intersection
      let hitIdx = 0;
      let inside = false;

      for (let ex = 0; ex < nx; ex++) {
        const cx = -halfDimX + (ex + 0.5) * voxelSizeX;

        // Advance past any intersections before this voxel center
        while (hitIdx < uniqueHits.length && uniqueHits[hitIdx] < cx) {
          inside = !inside;
          hitIdx++;
        }

        if (inside) {
          mask[ex + ey * nx + ez * nx * ny] = 1;
        }
      }
    }
  }

  // Cleanup
  centeredGeometry.dispose();
  material.dispose();

  return mask;
}
