import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RhinoMesh {
  vertices: number[][];
  faces: number[][];
  normals: number[][];
  name: string;
  layer: string;
}

export interface RhinoFile {
  version: 3;
  objects: RhinoMesh[];
  settings: { modelUnitSystem: string };
}

export interface GrasshopperPoints {
  points: number[][];
  count: number;
}

// ─── geometryToRhinoMesh ────────────────────────────────────────────────────

export function geometryToRhinoMesh(
  geometry: THREE.BufferGeometry,
  name: string,
  layer = 'Default',
): RhinoMesh {
  // Work with non-indexed geometry so every 3 vertices is a triangle
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;

  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;

  const vertices: number[][] = [];
  const faces: number[][] = [];
  const normals: number[][] = [];

  // Build vertex and normal arrays
  for (let i = 0; i < pos.count; i++) {
    vertices.push([
      parseFloat(pos.getX(i).toFixed(8)),
      parseFloat(pos.getY(i).toFixed(8)),
      parseFloat(pos.getZ(i).toFixed(8)),
    ]);

    if (norm) {
      normals.push([
        parseFloat(norm.getX(i).toFixed(8)),
        parseFloat(norm.getY(i).toFixed(8)),
        parseFloat(norm.getZ(i).toFixed(8)),
      ]);
    }
  }

  // Build triangle face indices (every 3 vertices = one face)
  const triCount = pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    faces.push([i * 3, i * 3 + 1, i * 3 + 2]);
  }

  return { vertices, faces, normals, name, layer };
}

// ─── exportRhinoJSON ────────────────────────────────────────────────────────

export async function exportRhinoJSON(
  geometry: THREE.BufferGeometry,
  filename = 'model',
  shapeName = 'Shape',
): Promise<void> {
  const mesh = geometryToRhinoMesh(geometry, shapeName);

  const rhinoFile: RhinoFile = {
    version: 3,
    objects: [mesh],
    settings: { modelUnitSystem: 'Millimeters' },
  };

  const json = JSON.stringify(rhinoFile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  await downloadBlob(`${filename}.json`, blob);
}

// ─── exportGrasshopperPoints ────────────────────────────────────────────────

export async function exportGrasshopperPoints(
  geometry: THREE.BufferGeometry,
  filename = 'points',
): Promise<void> {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;

  const points: number[][] = [];

  // Deduplicate vertices using a string key map
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const x = parseFloat(pos.getX(i).toFixed(6));
    const y = parseFloat(pos.getY(i).toFixed(6));
    const z = parseFloat(pos.getZ(i).toFixed(6));
    const key = `${x},${y},${z}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push([x, y, z]);
    }
  }

  const ghPoints: GrasshopperPoints = { points, count: points.length };

  const json = JSON.stringify(ghPoints, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  await downloadBlob(`${filename}.json`, blob);
}
