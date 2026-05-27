'use client';

// Geometry bridge — modeler writes the current effective geometry to
// sessionStorage so the Drawing and Render routes can reconstruct it
// without sharing React state. Compact base64 encoding keeps payloads
// under the sessionStorage quota for realistic CAD meshes.

import * as THREE from 'three';

const KEY_PREFIX = 'nexyfab:geom:';
const META_PREFIX = 'nexyfab:geom-meta:';
const MAX_BYTES = 3_500_000; // ~3.5 MB safety budget under sessionStorage quota

export interface GeometryMeta {
  vertexCount: number;
  triangleCount: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  selectedLabel: string | null;
  updatedAt: number;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa !== 'undefined') return btoa(bin);
  // SSR fallback (won't actually run — bridge is client-only)
  return Buffer.from(bin, 'binary').toString('base64');
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function writeGeometry(projectId: string, geometry: THREE.BufferGeometry, selectedLabel: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = geometry.getIndex();
    const posBuf = (pos.array as Float32Array).buffer as ArrayBuffer;
    const idxBuf = idx ? ((idx.array as Uint16Array | Uint32Array).buffer as ArrayBuffer) : null;
    const idxKind: 'u16' | 'u32' | null = idx
      ? (idx.array instanceof Uint32Array ? 'u32' : 'u16')
      : null;

    // Size guard — skip oversized meshes; Drawing route will fall back.
    const totalBytes = posBuf.byteLength + (idxBuf?.byteLength ?? 0);
    if (totalBytes > MAX_BYTES) {
      sessionStorage.removeItem(KEY_PREFIX + projectId);
      sessionStorage.removeItem(META_PREFIX + projectId);
      return;
    }

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const meta: GeometryMeta = {
      vertexCount: pos.count,
      triangleCount: idx ? idx.count / 3 : pos.count / 3,
      bboxMin: bb ? [bb.min.x, bb.min.y, bb.min.z] : [0, 0, 0],
      bboxMax: bb ? [bb.max.x, bb.max.y, bb.max.z] : [0, 0, 0],
      selectedLabel,
      updatedAt: Date.now(),
    };

    const payload = {
      pos: arrayBufferToBase64(posBuf),
      idx: idxBuf ? arrayBufferToBase64(idxBuf) : null,
      idxKind,
    };

    sessionStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(payload));
    sessionStorage.setItem(META_PREFIX + projectId, JSON.stringify(meta));
  } catch {
    // Quota exceeded or serialization error — silent skip.
  }
}

export function readGeometry(projectId: string): { geometry: THREE.BufferGeometry; meta: GeometryMeta } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + projectId);
    const metaRaw = sessionStorage.getItem(META_PREFIX + projectId);
    if (!raw || !metaRaw) return null;
    const parsed = JSON.parse(raw) as { pos: string; idx: string | null; idxKind: 'u16' | 'u32' | null };
    const meta = JSON.parse(metaRaw) as GeometryMeta;

    const posBuf = base64ToArrayBuffer(parsed.pos);
    const posArr = new Float32Array(posBuf);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

    if (parsed.idx && parsed.idxKind) {
      const idxBuf = base64ToArrayBuffer(parsed.idx);
      const idxArr = parsed.idxKind === 'u32'
        ? new Uint32Array(idxBuf)
        : new Uint16Array(idxBuf);
      geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return { geometry: geo, meta };
  } catch {
    return null;
  }
}
