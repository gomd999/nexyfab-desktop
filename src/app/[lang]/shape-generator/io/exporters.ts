import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';
import { buildBinaryStl } from './stlEncode';

export { buildBinaryStl } from './stlEncode';

/**
 * Options that control how the STL is written. The default mirrors the
 * historical export (mm + as-is geometry) so existing call sites get the
 * same output without changes.
 */
export interface ExportSTLOptions {
  /** Output unit. Geometry is always stored in mm internally; we scale to
   *  the requested unit so a slicer that defaults to mm/cm/m gets sane
   *  numbers without manual override. */
  unit?: 'mm' | 'cm' | 'm';
  /** Origin handling. 'as-is' keeps the geometry's local frame; 'centered'
   *  recenters the bounding box origin to (0,0,0); 'feet-on-floor' centers
   *  X/Y and floors Z to 0 (typical for 3D-print orientation). */
  origin?: 'as-is' | 'centered' | 'feet-on-floor';
}

const UNIT_SCALE: Record<NonNullable<ExportSTLOptions['unit']>, number> = {
  mm: 1,
  cm: 0.1,
  m: 0.001,
};

/**
 * Apply unit scale + origin transform to a clone of the input geometry,
 * leaving the original untouched. Returning a clone matters: the source
 * geometry is also bound to the live three.js scene and mutating it
 * would visually shift the user's model.
 */
function prepareForExport(
  geometry: THREE.BufferGeometry,
  opts: ExportSTLOptions,
): THREE.BufferGeometry {
  const scale = UNIT_SCALE[opts.unit ?? 'mm'];
  const origin = opts.origin ?? 'as-is';
  if (scale === 1 && origin === 'as-is') return geometry;

  const out = geometry.clone();
  if (origin !== 'as-is') {
    out.computeBoundingBox();
    const bb = out.boundingBox;
    if (bb) {
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      if (origin === 'centered') {
        const cz = (bb.min.z + bb.max.z) / 2;
        out.translate(-cx, -cy, -cz);
      } else if (origin === 'feet-on-floor') {
        out.translate(-cx, -cy, -bb.min.z);
      }
    }
  }
  if (scale !== 1) out.scale(scale, scale, scale);
  return out;
}

// ─── STL Export (Binary) ────────────────────────────────────────────────────

export async function exportSTL(
  geometry: THREE.BufferGeometry,
  filename = 'model',
  options: ExportSTLOptions = {},
): Promise<void> {
  const prepared = prepareForExport(geometry, options);
  const buffer = buildBinaryStl(prepared);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  // Annotate the filename with non-default options so the user can tell
  // an mm-vs-m export apart in their Downloads folder. e.g.
  //   model.stl              (defaults)
  //   model_cm.stl           (cm units, as-is origin)
  //   model_m_centered.stl   (m units, centered origin)
  const suffixParts: string[] = [];
  if (options.unit && options.unit !== 'mm') suffixParts.push(options.unit);
  if (options.origin && options.origin !== 'as-is') suffixParts.push(options.origin);
  const suffix = suffixParts.length > 0 ? `_${suffixParts.join('_')}` : '';
  await downloadBlob(`${filename}${suffix}.stl`, blob);
  // Free the cloned geometry's GPU/CPU buffers if we created one.
  if (prepared !== geometry) prepared.dispose();
}

// ─── OBJ Export ─────────────────────────────────────────────────────────────

export async function exportOBJ(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const lines: string[] = ['# NexyFab Shape Generator - OBJ Export', `# Vertices: ${pos.count}`, ''];

  // Vertices
  for (let i = 0; i < pos.count; i++) {
    lines.push(`v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}`);
  }

  // Normals
  if (norm) {
    lines.push('');
    for (let i = 0; i < norm.count; i++) {
      lines.push(`vn ${norm.getX(i).toFixed(6)} ${norm.getY(i).toFixed(6)} ${norm.getZ(i).toFixed(6)}`);
    }
  }

  // Faces
  lines.push('');
  const triCount = pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const a = i * 3 + 1, b = i * 3 + 2, c = i * 3 + 3; // OBJ is 1-indexed
    if (norm) {
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    } else {
      lines.push(`f ${a} ${b} ${c}`);
    }
  }

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  await downloadBlob(`${filename}.obj`, blob);
}

// ─── PLY Export (ASCII) ─────────────────────────────────────────────────────

export async function exportPLY(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const vertexCount = pos.count;
  const faceCount = vertexCount / 3;

  const lines: string[] = [
    'ply',
    'format ascii 1.0',
    'comment NexyFab Shape Generator',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
  ];

  if (norm) {
    lines.push('property float nx', 'property float ny', 'property float nz');
  }

  lines.push(`element face ${faceCount}`, 'property list uchar int vertex_indices', 'end_header');

  for (let i = 0; i < vertexCount; i++) {
    let line = `${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}`;
    if (norm) {
      line += ` ${norm.getX(i).toFixed(6)} ${norm.getY(i).toFixed(6)} ${norm.getZ(i).toFixed(6)}`;
    }
    lines.push(line);
  }

  for (let i = 0; i < faceCount; i++) {
    lines.push(`3 ${i * 3} ${i * 3 + 1} ${i * 3 + 2}`);
  }

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  await downloadBlob(`${filename}.ply`, blob);
}

// ─── STEP Export (AP242 tessellated) ───────────────────────────────────────

/** Writes .step file; await in export handlers so manufacturing sidecars stay in the same user gesture. */
export async function exportSTEP(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const { exportToStepAsync } = await import('./stepExporter');
  const text = await exportToStepAsync(geometry, filename);
  const blob = new Blob([text], { type: 'application/step' });
  await downloadBlob(`${filename}.step`, blob);
}

export {
  exportManufacturingSidecars,
  exportManufacturingZipBundle,
  triangleCount,
} from './manufacturingPackage';
export type { ManufacturingSidecarMeta } from './manufacturingPackage';

// ─── 3MF Export (ZIP container for Bambu/Prusa/Cura) ───────────────────────

export { export3MF, build3MFBlob } from './threemfExporter';
export type { SliceMetadata } from './threemfExporter';
import { build3MFBlob as _build3MF } from './threemfExporter';
import type { SliceMetadata } from './threemfExporter';

// ─── Print-ready export (rotates to slicer Z-up + injects metadata) ──────

/**
 * Slicers (PrusaSlicer, Cura, OrcaSlicer) all expect Z to be the build axis
 * and the part to sit on the build plate (min Z = 0). Given the user's chosen
 * `buildDirection` from the print analysis panel, this helper:
 *   1. clones the geometry
 *   2. rotates it so `buildDirection` aligns with +Z
 *   3. translates so the bottom rests on Z=0
 *   4. exports STL + 3MF (3MF carries the slicer metadata)
 */
export async function exportPrintReady(
  geometry: THREE.BufferGeometry,
  filename: string,
  meta: SliceMetadata,
): Promise<{ stlSize: number; threeMfSize: number }> {
  // Clone so we don't mutate the working geometry
  const geo = geometry.clone();
  if (geo.index) {
    const ng = geo.toNonIndexed();
    geo.dispose();
    Object.assign(geo, ng);
  }

  // Build rotation: buildDirection → [0, 0, 1]
  const dir = meta.buildDirection ?? [0, 1, 0];
  const from = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const to = new THREE.Vector3(0, 0, 1);
  const dot = from.dot(to);
  if (Math.abs(dot - 1) > 1e-6) {
    if (Math.abs(dot + 1) < 1e-6) {
      // Antiparallel — rotate 180° around any perpendicular axis (X works)
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
    } else {
      const axis = new THREE.Vector3().crossVectors(from, to).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      geo.applyMatrix4(new THREE.Matrix4().makeRotationAxis(axis, angle));
    }
  }

  // Translate so min Z = 0 and X/Y centered on origin
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const dx = -(bb.min.x + bb.max.x) / 2;
  const dy = -(bb.min.y + bb.max.y) / 2;
  const dz = -bb.min.z;
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(dx, dy, dz));

  // STL — plain binary, no metadata channel
  const pos = geo.attributes.position;
  const triCount = pos.count / 3;
  const stlBuffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(stlBuffer);
  const header = `NexyFab print-ready ${meta.process ?? 'fdm'} ${meta.layerHeight ?? 0.2}mm`;
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, triCount, true);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const off = 84 + i * 50;
    va.fromBufferAttribute(pos, i * 3);
    vb.fromBufferAttribute(pos, i * 3 + 1);
    vc.fromBufferAttribute(pos, i * 3 + 2);
    cb.subVectors(vc, vb); ab.subVectors(va, vb);
    cb.cross(ab).normalize();
    view.setFloat32(off, cb.x, true);
    view.setFloat32(off + 4, cb.y, true);
    view.setFloat32(off + 8, cb.z, true);
    for (let v = 0; v < 3; v++) {
      const vert = [va, vb, vc][v];
      view.setFloat32(off + 12 + v * 12, vert.x, true);
      view.setFloat32(off + 16 + v * 12, vert.y, true);
      view.setFloat32(off + 20 + v * 12, vert.z, true);
    }
    view.setUint16(off + 48, 0, true);
  }
  const stlBlob = new Blob([stlBuffer], { type: 'application/octet-stream' });

  // 3MF with metadata. Note: rotation is already baked, so clear buildDirection
  // in the metadata copy to avoid downstream tools double-rotating.
  const slicerMeta: SliceMetadata = { ...meta, buildDirection: [0, 0, 1] };
  const threeMfBlob = _build3MF(geo, filename, slicerMeta);

  await downloadBlob(`${filename}.stl`, stlBlob);
  await downloadBlob(`${filename}.3mf`, threeMfBlob);

  geo.dispose();
  return { stlSize: stlBlob.size, threeMfSize: threeMfBlob.size };
}

// ─── SAT / IGES / IFC Export (W5-H, 260721 — brep-bridge 라이터 등록부) ─────
//
// 3종 모두 "생성≠검증" 원칙으로 라이터가 자체 검증 실패 시 사유와 함께 거부한다
// (writeSatText/writeIfcText = 폐다면체 요건, writeIgesText = 좌표 유한성).
// 거부는 Error 로 throw — 호출부(핸들러)는 catch 후 사유를 토스트로 노출할 것.
//
// ⚠️ 정직 제외 선언(W5-H 범위 밖 — 겉핥기 생성 금지):
//  - DWG: 바이너리 포맷(버전별 오브젝트 맵·CRC·핸들 스트림) — LibreDWG급 라이터 없이
//    유효 파일을 생성할 수 없고, 유사-DWG 바이트 방출은 날조다. DXF 익스포트
//    (dxfExporter.ts)가 AutoCAD 호환 대체 경로.
//  - X_T: Parasolid 전용 스키마(커널 덤프) — 공개 스펙 기반의 검증 가능한 라이터가
//    없는 상태에서 텍스트 골격만 흉내내면 어떤 커널도 열지 못한다. STEP 익스포트가
//    표준 대체 경로.
export const UNSUPPORTED_EXPORT_FORMATS = {
  dwg: 'DWG 는 바이너리 사양(LibreDWG급 라이터 필요) — 유사 파일 생성은 날조라 제외. 대체=DXF 익스포트.',
  x_t: 'X_T 는 Parasolid 전용 스키마 — 검증 가능한 라이터 부재로 제외. 대체=STEP 익스포트.',
} as const;

/** three.js 지오메트리 → 융합 폴리메시(brep-bridge 공용 입력). 퇴화 삼각형 드랍 수 포함. */
async function geometryToWeldedMesh(geometry: THREE.BufferGeometry) {
  const { weldTriangleSoup } = await import('@/lib/brep-bridge/satExport');
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  if (!pos || pos.count === 0) throw new Error('Empty geometry — nothing to export');
  const welded = weldTriangleSoup(pos.array as unknown as ArrayLike<number>);
  if (geo !== geometry) geo.dispose();
  return welded;
}

/** SAT 텍스트 생성(다운로드 없음 — 테스트/파이프라인용). 검증 실패 = throw(사유 포함). */
export async function buildSATText(geometry: THREE.BufferGeometry): Promise<string> {
  const { writeSatText } = await import('@/lib/brep-bridge/satExport');
  const { mesh } = await geometryToWeldedMesh(geometry);
  const r = writeSatText(mesh);
  if (!r.ok) throw new Error(`SAT export refused: ${r.error}`);
  return r.text;
}

/** ACIS SAT ASCII 익스포트 — 평면 페이스 폐다면체만(라이터가 검증·거부). */
export async function exportSAT(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const text = await buildSATText(geometry);
  await downloadBlob(`${filename}.sat`, new Blob([text], { type: 'application/octet-stream' }));
}

/** IGES 텍스트 생성 — ⚠폴리라인 와이어프레임(106 form 12)·B-Rep 아님(파일 내 명시). */
export async function buildIGESText(geometry: THREE.BufferGeometry, filename = 'model'): Promise<string> {
  const { writeIgesText } = await import('@/lib/brep-bridge/igesExport');
  const { mesh } = await geometryToWeldedMesh(geometry);
  const r = writeIgesText(mesh, { filename: `${filename}.igs` });
  if (!r.ok) throw new Error(`IGES export refused: ${r.error}`);
  return r.text;
}

/** IGES 5.x 익스포트(폴리라인 와이어프레임 — 서피스/솔리드 아님, S섹션에 선언). */
export async function exportIGES(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const text = await buildIGESText(geometry, filename);
  await downloadBlob(`${filename}.igs`, new Blob([text], { type: 'text/plain' }));
}

/** IFC 텍스트 생성 — IfcFacetedBrep(폐셸 검증·거부) + SITE/BUILDING/STOREY/PROXY 최소 계층. */
export async function buildIFCText(geometry: THREE.BufferGeometry, filename = 'model'): Promise<string> {
  const { writeIfcText } = await import('@/lib/brep-bridge/ifcExport');
  const { mesh } = await geometryToWeldedMesh(geometry);
  const r = writeIfcText(mesh, { name: filename });
  if (!r.ok) throw new Error(`IFC export refused: ${r.error}`);
  return r.text;
}

/** IFC2X3 익스포트(IfcFacetedBrep — mm 단위). */
export async function exportIFC(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const text = await buildIFCText(geometry, filename);
  await downloadBlob(`${filename}.ifc`, new Blob([text], { type: 'application/x-step' }));
}

// ─── Rhino JSON / Grasshopper re-exports ───────────────────────────────────

export { exportRhinoJSON, exportGrasshopperPoints } from './rhinoExport';
export type { RhinoMesh, RhinoFile, GrasshopperPoints } from './rhinoExport';

// ─── GLTF/GLB Export ───────────────────────────────────────────────────────

export async function exportGLTF(geometry: THREE.BufferGeometry, filename = 'model'): Promise<void> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: 0x58a6ff });
  const mesh = new THREE.Mesh(geo, material);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new GLTFExporter();

  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        let blob: Blob;
        if (result instanceof ArrayBuffer) {
          blob = new Blob([result], { type: 'application/octet-stream' });
        } else {
          const json = JSON.stringify(result);
          blob = new Blob([json], { type: 'application/json' });
        }
        downloadBlob(`${filename}.glb`, blob)
          .then(() => {
            material.dispose();
            geo.dispose();
            resolve();
          })
          .catch((err) => {
            material.dispose();
            geo.dispose();
            reject(err);
          });
      },
      (error) => {
        material.dispose();
        geo.dispose();
        reject(error);
      },
      { binary: true },
    );
  });
}
