import * as THREE from 'three';

// ─── Helper: trigger browser download ──────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── STL Export (Binary) ────────────────────────────────────────────────────

export function exportSTL(geometry: THREE.BufferGeometry, filename = 'model'): void {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const triCount = pos.count / 3;

  const bufferSize = 84 + triCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes)
  const header = 'NexyFab Shape Generator - STL Export';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  view.setUint32(80, triCount, true);

  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const cb = new THREE.Vector3(), ab = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const offset = 84 + i * 50;
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);

    cb.subVectors(v2, v1);
    ab.subVectors(v0, v1);
    cb.cross(ab).normalize();

    view.setFloat32(offset, cb.x, true);
    view.setFloat32(offset + 4, cb.y, true);
    view.setFloat32(offset + 8, cb.z, true);

    for (let v = 0; v < 3; v++) {
      const vert = [v0, v1, v2][v];
      view.setFloat32(offset + 12 + v * 12, vert.x, true);
      view.setFloat32(offset + 12 + v * 12 + 4, vert.y, true);
      view.setFloat32(offset + 12 + v * 12 + 8, vert.z, true);
    }
    view.setUint16(offset + 48, 0, true); // attribute byte count
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  triggerDownload(blob, `${filename}.stl`);
}

// ─── OBJ Export ─────────────────────────────────────────────────────────────

export function exportOBJ(geometry: THREE.BufferGeometry, filename = 'model'): void {
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
  triggerDownload(blob, `${filename}.obj`);
}

// ─── PLY Export (ASCII) ─────────────────────────────────────────────────────

export function exportPLY(geometry: THREE.BufferGeometry, filename = 'model'): void {
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
  triggerDownload(blob, `${filename}.ply`);
}

// ─── STEP Export (AP214 ASCII) ─────────────────────────────────────────────

export function exportSTEP(geometry: THREE.BufferGeometry, filename = 'model'): void {
  // Delegate content generation to stepExporter module, then trigger download
  import('./stepExporter').then(({ exportToStep }) => {
    const text = exportToStep(geometry, filename);
    const blob = new Blob([text], { type: 'application/step' });
    triggerDownload(blob, `${filename}.step`);
  });
}

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
export function exportPrintReady(
  geometry: THREE.BufferGeometry,
  filename: string,
  meta: SliceMetadata,
): { stlSize: number; threeMfSize: number } {
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

  triggerDownload(stlBlob, `${filename}.stl`);
  triggerDownload(threeMfBlob, `${filename}.3mf`);

  geo.dispose();
  return { stlSize: stlBlob.size, threeMfSize: threeMfBlob.size };
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
        triggerDownload(blob, `${filename}.glb`);
        material.dispose();
        geo.dispose();
        resolve();
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
