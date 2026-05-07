import * as THREE from 'three';
import { reportError } from '../lib/telemetry';
import { publicWasmUrl } from '../lib/publicWasmUrl';

interface OcctResult {
  success: boolean;
  progress_list?: { text: string }[];
  meshes?: OcctMesh[];
}

interface OcctMesh {
  name?: string;
  attributes?: {
    position?: { array: Float32Array | number[] };
    normal?: { array: Float32Array | number[] };
  };
  index?: { array: Uint32Array | number[] };
  color?: { r: number; g: number; b: number };
}

let occtModule: unknown = null;

async function wasmAbsolutePathForNode(): Promise<string> {
  /** `node:` is Node-only; webpack must not bundle these for the client graph. */
  const path = await import(/* webpackIgnore: true */ 'node:path');
  const fs = await import(/* webpackIgnore: true */ 'node:fs');
  const candidates = [
    path.join(process.cwd(), 'public', 'occt-import-js.wasm'),
    path.join(process.cwd(), 'node_modules', 'occt-import-js', 'dist', 'occt-import-js.wasm'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[1];
}

async function getOcct() {
  if (occtModule) return occtModule;
  try {
    // Dynamic import to avoid SSR issues
    const occt = await import('occt-import-js');
    /** 브라우저: `/…wasm` (basePath 반영). Node/Vitest: 절대 경로 — Windows에서 `/x` → `C:\\x` 오인 방지. */
    let locateFile: (p: string) => string;
    if (typeof window !== 'undefined') {
      locateFile = (p: string) => (p.endsWith('.wasm') ? publicWasmUrl('occt-import-js.wasm') : p);
    } else {
      const abs = await wasmAbsolutePathForNode();
      locateFile = (p: string) => (p.endsWith('.wasm') ? abs : p);
    }
    occtModule = await (occt.default as (opts?: { locateFile?: (p: string) => string }) => Promise<unknown>)({
      locateFile,
    });
    return occtModule;
  } catch (e) {
    throw new Error('Failed to load OCCT WASM module: ' + e);
  }
}

export interface StepImportResult {
  geometry: THREE.BufferGeometry;
  meshCount: number;
  faceCount: number;
  name: string;
  boundingBox: THREE.Box3;
  parts?: { geometry: THREE.BufferGeometry; name: string }[];
}

export async function importStepFile(buffer: ArrayBuffer): Promise<StepImportResult> {
  const occt = await getOcct() as {
    ReadStepFile: (buf: Uint8Array, params: null) => OcctResult;
  };

  const fileBuffer = new Uint8Array(buffer);
  const result: OcctResult = occt.ReadStepFile(fileBuffer, null);

  if (!result.success) {
    const errors = result.progress_list?.map(p => p.text).join('; ') ?? 'Unknown error';
    const err = new Error('STEP parsing failed: ' + errors);
    reportError('step_import', err, { byteLength: buffer.byteLength });
    throw err;
  }

  if (!result.meshes || result.meshes.length === 0) {
    const err = new Error('No geometry found in STEP file');
    reportError('step_import', err, { byteLength: buffer.byteLength });
    throw err;
  }

  // Merge all meshes into one BufferGeometry
  const geometries: THREE.BufferGeometry[] = [];

  for (const mesh of result.meshes) {
    const posArr = mesh.attributes?.position?.array;
    const idxArr = mesh.index?.array;
    if (!posArr || !idxArr) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(posArr), 3));

    const normArr = mesh.attributes?.normal?.array;
    if (normArr) {
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normArr), 3));
    }

    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));

    if (!normArr) geo.computeVertexNormals();
    geometries.push(geo);
  }

  if (geometries.length === 0) {
    const err = new Error('STEP produced no renderable meshes');
    reportError('step_import', err, { byteLength: buffer.byteLength });
    throw err;
  }

  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const merged = mergeGeometries(geometries, false) ?? geometries[0];

  merged.computeBoundingBox();
  const bb = merged.boundingBox ?? new THREE.Box3();

  // Center geometry at origin
  const center = new THREE.Vector3();
  bb.getCenter(center);
  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingBox();

  const totalFaces = merged.index ? Math.floor(merged.index.count / 3) : 0;

  const parts = result.meshes.map((m, i) => {
    const partGeo = geometries[i].clone();
    partGeo.translate(-center.x, -center.y, -center.z);
    partGeo.computeBoundingBox();
    return {
      name: m.name || `part_${i}`,
      geometry: partGeo,
    };
  });

  return {
    geometry: merged,
    meshCount: result.meshes.length,
    faceCount: totalFaces,
    name: result.meshes[0].name ?? 'imported',
    boundingBox: merged.boundingBox ?? new THREE.Box3(),
    parts,
  };
}
