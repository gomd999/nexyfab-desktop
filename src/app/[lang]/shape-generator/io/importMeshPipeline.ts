import * as THREE from 'three';
import { upsertRecentImportFile } from '@/lib/platform';
import { makeEdges, meshVolume, meshSurfaceArea } from '../shapes';
import { trackGeometry } from '../hooks/useGeometryGC';
import { importPayload } from './importers';

export interface PreparedImportedShape {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  volume_cm3: number;
  surface_area_cm2: number;
  bbox: { w: number; h: number; d: number };
  filename: string;
  parts?: { geometry: THREE.BufferGeometry; name: string }[];
}

function finalizeImported(geometry: THREE.BufferGeometry, filename: string, parts?: { geometry: THREE.BufferGeometry; name: string }[]): PreparedImportedShape {
  const edgeGeometry = makeEdges(geometry);
  const volume_cm3 = meshVolume(geometry) / 1000;
  const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
  return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox, filename, parts };
}

/** Browser File from drag-and-drop or legacy `<input type="file">`. */
export async function prepareImportedShapeFromFile(file: File): Promise<PreparedImportedShape> {
  const buffer = await file.arrayBuffer();
  return prepareImportedShapeFromBuffer(file.name, buffer);
}

/** Tauri native dialog + buffer, or unified picker on web. */
export async function prepareImportedShapeFromBuffer(
  filename: string,
  buffer: ArrayBuffer,
): Promise<PreparedImportedShape> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'step' || ext === 'stp') {
    const { tryServerStepImport } = await import('./serverStepImport');
    const server = await tryServerStepImport(filename, buffer);
    if (server) {
      trackGeometry(server.geometry);
      return finalizeImported(server.geometry, filename, undefined);
    }
  }
  const { geometry, filename: resolvedName, parts } = await importPayload(filename, buffer);
  return finalizeImported(geometry, resolvedName, parts);
}

export function pushRecentImportFile(filename: string, ext: string, size: number): void {
  upsertRecentImportFile({ name: filename, ext, size, date: Date.now() });
}
