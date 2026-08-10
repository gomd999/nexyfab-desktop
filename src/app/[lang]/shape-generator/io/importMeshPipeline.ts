import * as THREE from 'three';
import { upsertRecentImportFile } from '@/lib/platform';
import { makeEdges, meshVolume, meshSurfaceArea } from '../shapes';
import { trackGeometry } from '../hooks/useGeometryGC';
import { importPayload } from './importers';
import { decideStepProcessingRoute, formatStepCapacityMb } from '@/lib/brep-bridge/stepCapacityPolicy';
import { BREP_STEP_BROWSER_MAX_BYTES } from '@/lib/brep-bridge/constants';
import { probeStepStructure } from '@/lib/brep-bridge/stepStructureProbe';

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
  // Provenance tag: imported meshes have unknown manufacturing process, so
  // downstream analysis (auto-DFM) must not assume injection molding — a
  // welded/fabricated import would otherwise get false undercut/draft-angle
  // badges (process-aware DFM, methodology §13 #1).
  geometry.userData.nfImported = true;
  const edgeGeometry = makeEdges(geometry);
  const volume_cm3 = meshVolume(geometry) / 1000;
  const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  // A corrupt/empty import yields an Infinity box → NaN size shown in the UI.
  const size = bb && !bb.isEmpty() ? bb.getSize(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
  const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
  return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox, filename, parts };
}

/** Browser File from drag-and-drop or legacy `<input type="file">`. */
export async function prepareImportedShapeFromFile(file: File): Promise<PreparedImportedShape> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'step' || ext === 'stp') assertBrowserStepCapacity(file.size);
  const buffer = await file.arrayBuffer();
  return prepareImportedShapeFromBuffer(file.name, buffer);
}

function assertBrowserStepCapacity(bytes: number): void {
  const capacity = decideStepProcessingRoute(bytes, { authenticated: false, serverEnabled: false });
  if (capacity.route === 'large-job-required') {
    throw new Error(
      `STEP ${formatStepCapacityMb(bytes)} requires the private large-file server job; browser processing is limited to ${formatStepCapacityMb(BREP_STEP_BROWSER_MAX_BYTES)}.`,
    );
  }
  if (capacity.route === 'unsupported-size') {
    throw new Error(`STEP file size is invalid or exceeds the ${formatStepCapacityMb(capacity.maxBytes)} product limit.`);
  }
}

/** Tauri native dialog + buffer, or unified picker on web. */
export async function prepareImportedShapeFromBuffer(
  filename: string,
  buffer: ArrayBuffer,
): Promise<PreparedImportedShape> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'step' || ext === 'stp') {
    assertBrowserStepCapacity(buffer.byteLength);
    // The server preview has no occurrence tree. Keep assemblies on the
    // hierarchy-aware importer until the server response carries structure.
    if (!probeStepStructure(buffer).isAssembly) try {
      const { tryServerStepImport } = await import('./serverStepImport');
      const server = await tryServerStepImport(filename, buffer);
      if (server) {
        trackGeometry(server.geometry);
        return finalizeImported(server.geometry, filename, undefined);
      }
    } catch {
      // Server worker unavailable/unconfigured (e.g. BREP_WORKER_URL unset) —
      // fall through to the client path (importPayload → parseSTEP → replicad).
    }
  }
  const { geometry, filename: resolvedName, parts } = await importPayload(filename, buffer);
  return finalizeImported(geometry, resolvedName, parts);
}

export function pushRecentImportFile(filename: string, ext: string, size: number): void {
  upsertRecentImportFile({ name: filename, ext, size, date: Date.now() });
}
