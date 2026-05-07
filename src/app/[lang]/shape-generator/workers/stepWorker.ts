import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { publicWasmUrl } from '../lib/publicWasmUrl';

// ─── Types & Interfaces ───────────────────────────────────────────────────────
export interface StepPartStats {
  id: string;
  name: string;
  faceCount: number;
  edgeCount: number;
  volume_cm3: number;
  surfaceArea_cm2: number;
  bbox: { w: number; h: number; d: number };
  isSolid: boolean;
  isManifold: boolean;
  shellCount: number;
  dfmSuggestions: string[];
}

export interface StepAnalysisStats {
  faceCount: number;
  edgeCount: number;
  shellCount: number;
  volume_cm3: number;
  surfaceArea_cm2: number;
  bbox: { w: number; h: number; d: number };
  isSolid: boolean;
  isManifold: boolean;
  parts?: StepPartStats[];
}

export interface StepWorkerInput {
  type: 'PARSE_STEP';
  payload: {
    buffer: ArrayBuffer;
    filename: string;
  };
}

export interface SerializedGeometry {
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
}

export interface StepWorkerOutput {
  type: 'STEP_RESULT';
  stats?: StepAnalysisStats;
  dfmSuggestions?: string[];
  globalGeometry?: SerializedGeometry;
  partsGeometry?: {
    name: string;
    geometry: SerializedGeometry;
  }[];
  error?: string;
}

interface OcctMesh {
  name?: string;
  index?: { array: Uint32Array | number[] };
  attributes?: {
    position?: { array: Float32Array | number[] };
    normal?: { array: Float32Array | number[] };
  };
}

interface OcctResult {
  success: boolean;
  meshes?: OcctMesh[];
  progress_list?: { text: string }[];
}

// ─── DFM & Stats logic ────────────────────────────────────────────────────────
function generateDfmSuggestions(stats: Omit<StepAnalysisStats | StepPartStats, 'parts' | 'id' | 'name' | 'dfmSuggestions'>): string[] {
  const suggestions: string[] = [];

  if (!stats.isSolid) {
    suggestions.push('형상이 솔리드가 아닙니다 — 열린 셸(open shell)을 닫아 주세요. (Shape is not solid — close open shells.)');
  }
  if (!stats.isManifold) {
    suggestions.push('매니폴드 오류 감지 — 가공 전 메시 검증 필요. (Non-manifold geometry detected — validate mesh before machining.)');
  }
  if (stats.faceCount > 500) {
    suggestions.push(`면 수(${stats.faceCount})가 많습니다 — 블렌드/필릿 단순화를 검토하세요. (High face count (${stats.faceCount}) — consider simplifying blends/fillets.)`);
  }
  if (stats.shellCount > 1) {
    suggestions.push(`셸이 ${stats.shellCount}개입니다 — 조립 분리 여부를 확인하세요. (${stats.shellCount} shells found — verify assembly separation.)`);
  }

  const { w, h, d } = stats.bbox;
  const minDim = Math.min(w, h, d);
  const maxDim = Math.max(w, h, d);
  if (minDim > 0 && maxDim / minDim > 20) {
    suggestions.push('종횡비가 매우 높습니다 — 가공 시 진동 및 처짐 위험. (Very high aspect ratio — risk of vibration/deflection during machining.)');
  }
  if (minDim < 0.5 && minDim > 0) {
    suggestions.push('매우 얇은 단면이 있습니다 — 최소 벽두께 1 mm 이상 권장. (Very thin section detected — minimum wall thickness ≥ 1 mm recommended.)');
  }

  if (stats.volume_cm3 > 0 && stats.surfaceArea_cm2 > 0) {
    const ratio = stats.surfaceArea_cm2 / stats.volume_cm3;
    if (ratio > 30) {
      suggestions.push('표면적/부피 비율이 높습니다 — 내부 포켓 가공 효율을 검토하세요. (High surface-to-volume ratio — review internal pocket machining efficiency.)');
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('DFM 검사 통과 — 주요 가공성 문제가 발견되지 않았습니다. (DFM check passed — no major manufacturability issues detected.)');
  }

  return suggestions;
}

function extractPartStats(mesh: OcctMesh, index: number): StepPartStats {
  const positions = mesh.attributes?.position?.array ?? [];
  const indices = mesh.index?.array ?? [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let signedVolume = 0;
  let surfaceArea = 0;

  const triCount = indices.length > 0 ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  const edgeCount = Math.round(triCount * 1.5);

  if (positions.length > 0) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const getVec = (idx: number) => {
      const base = idx * 3;
      return [positions[base], positions[base + 1], positions[base + 2]];
    };
    const resolveIdx = (triIdx: number, vertInTri: number): number =>
      indices.length > 0 ? indices[triIdx * 3 + vertInTri] : triIdx * 3 + vertInTri;

    for (let t = 0; t < triCount; t++) {
      const a = getVec(resolveIdx(t, 0));
      const b = getVec(resolveIdx(t, 1));
      const c = getVec(resolveIdx(t, 2));

      signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1])
                     + b[0] * (c[1] * a[2] - c[2] * a[1])
                     + c[0] * (a[1] * b[2] - a[2] * b[1])) / 6;

      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      surfaceArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
  }

  const vol_mm3 = Math.abs(signedVolume);
  const area_mm2 = surfaceArea;
  const volume_cm3 = vol_mm3 / 1000;
  const surfaceArea_cm2 = area_mm2 / 100;

  const bboxW = isFinite(maxX) ? (maxX - minX) / 10 : 0;
  const bboxH = isFinite(maxY) ? (maxY - minY) / 10 : 0;
  const bboxD = isFinite(maxZ) ? (maxZ - minZ) / 10 : 0;

  const isSolid = signedVolume > 0;
  const eulerLike = triCount - edgeCount;
  const isManifold = isSolid && eulerLike > -triCount * 0.1;

  const partStats = {
    id: `part-${index}`,
    name: mesh.name || `Part ${index + 1}`,
    faceCount: triCount,
    edgeCount: edgeCount,
    volume_cm3: Math.round(volume_cm3 * 1000) / 1000,
    surfaceArea_cm2: Math.round(surfaceArea_cm2 * 100) / 100,
    bbox: {
      w: Math.round(bboxW * 10) / 10,
      h: Math.round(bboxH * 10) / 10,
      d: Math.round(bboxD * 10) / 10,
    },
    isSolid,
    isManifold,
    shellCount: 1,
  };

  const dfmSuggestions = generateDfmSuggestions(partStats as any);

  return { ...partStats, dfmSuggestions };
}

function extractStatsFromResult(result: OcctResult): StepAnalysisStats {
  const meshes: OcctMesh[] = result.meshes ?? [];
  const parts = meshes.map((mesh, index) => extractPartStats(mesh, index));

  if (parts.length === 0) {
    return {
      faceCount: 0, edgeCount: 0, shellCount: 0, volume_cm3: 0, surfaceArea_cm2: 0,
      bbox: { w: 0, h: 0, d: 0 }, isSolid: false, isManifold: false, parts: []
    };
  }

  let totalTriangles = 0;
  let totalEdgesEstimate = 0;
  let totalVolume = 0;
  let totalSurfaceArea = 0;
  let allSolid = true;
  let allManifold = true;

  const globalMaxW = parts.reduce((acc, p) => Math.max(acc, p.bbox.w), 0);
  const globalMaxH = parts.reduce((acc, p) => Math.max(acc, p.bbox.h), 0);
  const globalMaxD = parts.reduce((acc, p) => Math.max(acc, p.bbox.d), 0);

  for (const p of parts) {
    totalTriangles += p.faceCount;
    totalEdgesEstimate += p.edgeCount;
    totalVolume += p.volume_cm3;
    totalSurfaceArea += p.surfaceArea_cm2;
    if (!p.isSolid) allSolid = false;
    if (!p.isManifold) allManifold = false;
  }

  return {
    faceCount: totalTriangles,
    edgeCount: totalEdgesEstimate,
    shellCount: parts.length,
    volume_cm3: Math.round(totalVolume * 1000) / 1000,
    surfaceArea_cm2: Math.round(totalSurfaceArea * 100) / 100,
    bbox: { w: globalMaxW, h: globalMaxH, d: globalMaxD },
    isSolid: allSolid,
    isManifold: allManifold,
    parts,
  };
}

// ─── Worker Event Listener ────────────────────────────────────────────────────
self.addEventListener('message', async (e: MessageEvent<StepWorkerInput>) => {
  if (e.data.type === 'PARSE_STEP') {
    try {
      const { buffer, filename } = e.data.payload;
      
      // Load OCCT WASM
      const occt = await import('occt-import-js');
      const occtModule = await occt.default({
        locateFile: (p: string) => (p.endsWith('.wasm') ? publicWasmUrl('occt-import-js.wasm') : p),
      });

      const uint8 = new Uint8Array(buffer);
      const name = filename.toLowerCase();
      let result: OcctResult;
      
      if (name.endsWith('.iges') || name.endsWith('.igs')) {
        result = occtModule.ReadIgesFile(uint8, null) as unknown as OcctResult;
      } else {
        result = occtModule.ReadStepFile(uint8, null) as unknown as OcctResult;
      }

      if (!result || !result.success) {
        throw new Error('Failed to parse STEP file: ' + (result?.progress_list?.map(p => p.text).join('; ') ?? 'Unknown error'));
      }

      if (!result.meshes || result.meshes.length === 0) {
        throw new Error('No geometry found in STEP file');
      }

      // Calculate DFM & Stats
      const stats = extractStatsFromResult(result);
      const dfmSuggestions = generateDfmSuggestions(stats);

      // Extract raw geometries for Three.js
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
        throw new Error('STEP produced no renderable meshes');
      }

      // Merge and center
      const merged = mergeGeometries(geometries, false) ?? geometries[0];
      merged.computeBoundingBox();
      const bb = merged.boundingBox ?? new THREE.Box3();
      const center = new THREE.Vector3();
      bb.getCenter(center);
      merged.translate(-center.x, -center.y, -center.z);
      merged.computeBoundingBox();

      const serializeGeo = (geo: THREE.BufferGeometry): SerializedGeometry => {
        const positions = new Float32Array((geo.attributes.position as THREE.BufferAttribute).array);
        const normals = geo.attributes.normal ? new Float32Array((geo.attributes.normal as THREE.BufferAttribute).array) : undefined;
        const indices = geo.index ? new Uint32Array(geo.index.array) : undefined;
        return { positions, normals, indices };
      };

      const globalGeometry = serializeGeo(merged);
      const partsGeometry = result.meshes.map((m, i) => {
        const partGeo = geometries[i].clone();
        partGeo.translate(-center.x, -center.y, -center.z);
        return {
          name: m.name || `Part ${i + 1}`,
          geometry: serializeGeo(partGeo)
        };
      });

      // Prepare transferables to zero-copy memory back to main thread
      const transferables: ArrayBuffer[] = [
        globalGeometry.positions.buffer as ArrayBuffer
      ];
      if (globalGeometry.normals) transferables.push(globalGeometry.normals.buffer as ArrayBuffer);
      if (globalGeometry.indices) transferables.push(globalGeometry.indices.buffer as ArrayBuffer);

      for (const p of partsGeometry) {
        transferables.push(p.geometry.positions.buffer as ArrayBuffer);
        if (p.geometry.normals) transferables.push(p.geometry.normals.buffer as ArrayBuffer);
        if (p.geometry.indices) transferables.push(p.geometry.indices.buffer as ArrayBuffer);
      }

      const outMsg: StepWorkerOutput = {
        type: 'STEP_RESULT',
        stats,
        dfmSuggestions,
        globalGeometry,
        partsGeometry
      };

      (self as any).postMessage(outMsg, transferables);

    } catch (err: any) {
      self.postMessage({ type: 'STEP_RESULT', error: err.message || String(err) } as StepWorkerOutput);
    }
  }
});
