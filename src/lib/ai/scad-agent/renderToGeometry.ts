/**
 * Browser helper: SCAD source → BufferGeometry via the existing
 * /api/nexyfab/openscad-render endpoint.
 *
 * The agent SSE route returns metadata only (stlBytes, triangle count) —
 * we hit the canonical render endpoint for the actual STL so we keep one
 * source of truth for plan/quota gating.
 */
import * as THREE from 'three';

export class ScadRenderError extends Error {
  constructor(public readonly status: number | undefined, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ScadRenderError';
  }
}

export interface RenderToGeometryResult {
  geometry: THREE.BufferGeometry;
  triangleCount: number;
  bytes: number;
}

export async function renderScadToGeometry(
  scad: string,
  signal?: AbortSignal,
  /** Base64 STL the SCAD may `import("model.stl")` — used to AI-edit an
   *  imported mesh by wrapping it as the base of the generated program. */
  importStl?: string | null,
): Promise<RenderToGeometryResult> {
  if (!scad.trim()) {
    throw new ScadRenderError(400, 'SCAD source is empty');
  }

  const resp = await fetch('/api/nexyfab/openscad-render/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scad, format: 'stl', ...(importStl ? { importStl } : {}) }),
    signal,
  });

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    let code: string | undefined;
    try {
      const body = await resp.json();
      if (typeof body?.error === 'string') message = body.error;
      if (typeof body?.code === 'string') code = body.code;
    } catch { /* ignore */ }
    throw new ScadRenderError(resp.status, message, code);
  }

  const body = await resp.json() as { dataBase64?: string; mode?: string; format?: string };
  if (typeof body.dataBase64 !== 'string') {
    throw new ScadRenderError(undefined, 'render response missing dataBase64');
  }

  const bytes = base64ToUint8Array(body.dataBase64);
  const geometry = await parseStlBinary(bytes);
  const triangleCount = geometry.attributes.position.count / 3;
  return { geometry, triangleCount: Math.round(triangleCount), bytes: bytes.byteLength };
}

function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  // Server / SSR fallback (defensive — this helper is browser-only).
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Parse binary STL bytes into a BufferGeometry. Environment-agnostic
 *  (STLLoader.parse touches no DOM), so it is reused by the server-side agent
 *  geometry adapter to verify rendered STL — not just the browser path. */
export async function parseStlBufferToGeometry(bytes: Uint8Array): Promise<THREE.BufferGeometry> {
  return parseStlBinary(bytes);
}

async function parseStlBinary(bytes: Uint8Array): Promise<THREE.BufferGeometry> {
  // Lazy-load STLLoader so the agent helper doesn't bloat the initial bundle.
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
  const loader = new STLLoader();
  // STLLoader.parse accepts an ArrayBuffer.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const geo = loader.parse(buffer);
  geo.computeBoundingBox();
  geo.computeVertexNormals();
  return geo;
}

/**
 * The measured bounds of an STL, extracted with ZERO external dependencies
 * (no `three`, no `three/examples` STLLoader, no app-route analysis modules).
 * Populated straight from the raw bytes so the reconstruction gate always has
 * a real bbox to verify against — even when the richer verification chain's
 * deep dynamic imports fail to resolve inside the production server bundle.
 */
export interface StlBounds {
  triangleCount: number;
  /** null only when the mesh has no finite vertices (empty render). */
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  /** Absolute mesh volume via signed-tetrahedra sum (mm³). */
  volume_mm3: number;
}

/**
 * Detect binary vs ASCII STL. Mirrors THREE's STLLoader heuristic: a size
 * match (`84 + 50·faces === length`) is decisive; otherwise a leading
 * "solid" token (within the first 5 bytes, to tolerate a BOM) marks ASCII;
 * failing both, treat as binary.
 */
function looksBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nFaces = dv.getUint32(80, true);
  if (84 + nFaces * 50 === bytes.length) return true;
  const solid = [115, 111, 108, 105, 100]; // 's','o','l','i','d'
  for (let off = 0; off < 5; off++) {
    let match = true;
    for (let i = 0; i < 5; i++) {
      if (bytes[off + i] !== solid[i]) { match = false; break; }
    }
    if (match) return false;
  }
  return true;
}

/** Fold one triangle into the running bbox + signed-volume accumulators. */
function accumTriangle(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  acc: { min: number[]; max: number[]; vol: number },
): void {
  const xs = [ax, bx, cx], ys = [ay, by, cy], zs = [az, bz, cz];
  for (let k = 0; k < 3; k++) {
    if (xs[k] < acc.min[0]) acc.min[0] = xs[k]; if (xs[k] > acc.max[0]) acc.max[0] = xs[k];
    if (ys[k] < acc.min[1]) acc.min[1] = ys[k]; if (ys[k] > acc.max[1]) acc.max[1] = ys[k];
    if (zs[k] < acc.min[2]) acc.min[2] = zs[k]; if (zs[k] > acc.max[2]) acc.max[2] = zs[k];
  }
  // Signed volume of tetra (origin, a, b, c) = a · (b × c) / 6.
  const crossX = by * cz - bz * cy;
  const crossY = bz * cx - bx * cz;
  const crossZ = bx * cy - by * cx;
  acc.vol += (ax * crossX + ay * crossY + az * crossZ) / 6;
}

/**
 * Extract triangle count, bounding box, and volume directly from STL bytes,
 * handling BOTH binary (`--export-format=binstl`) and ASCII STL. Pure Buffer /
 * string arithmetic — safe to call in any environment and independent of the
 * fragile deep imports `verifyStlBuffer` relies on. Never throws on a
 * well-formed STL; returns `bbox: null` for an empty (zero-triangle) mesh.
 */
export function parseStlBufferToBounds(bytes: Uint8Array): StlBounds {
  const acc = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], vol: 0 };
  let triangleCount = 0;

  if (looksBinaryStl(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const faces = dv.getUint32(80, true);
    // Guard against a corrupt header claiming more faces than the buffer holds.
    const maxFaces = Math.floor((bytes.length - 84) / 50);
    triangleCount = Math.min(faces, Math.max(0, maxFaces));
    let o = 84;
    for (let t = 0; t < triangleCount; t++) {
      o += 12; // skip the (unreliable) face normal
      const ax = dv.getFloat32(o, true), ay = dv.getFloat32(o + 4, true), az = dv.getFloat32(o + 8, true);
      const bx = dv.getFloat32(o + 12, true), by = dv.getFloat32(o + 16, true), bz = dv.getFloat32(o + 20, true);
      const cx = dv.getFloat32(o + 24, true), cy = dv.getFloat32(o + 28, true), cz = dv.getFloat32(o + 32, true);
      accumTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, acc);
      o += 36 + 2; // 3 verts + attribute byte count
    }
  } else {
    // ASCII STL — pull every "vertex x y z", group into triangles of 3.
    const text = new TextDecoder().decode(bytes);
    const re = /vertex\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)/g;
    const verts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    }
    triangleCount = Math.floor(verts.length / 9);
    for (let t = 0; t < triangleCount; t++) {
      const i = t * 9;
      accumTriangle(
        verts[i], verts[i + 1], verts[i + 2],
        verts[i + 3], verts[i + 4], verts[i + 5],
        verts[i + 6], verts[i + 7], verts[i + 8],
        acc,
      );
    }
  }

  const bbox = Number.isFinite(acc.min[0])
    ? {
        min: [acc.min[0], acc.min[1], acc.min[2]] as [number, number, number],
        max: [acc.max[0], acc.max[1], acc.max[2]] as [number, number, number],
      }
    : null;
  return { triangleCount, bbox, volume_mm3: Math.abs(acc.vol) };
}

/**
 * Extract the raw NON-INDEXED triangle vertex stream (9 floats/triangle) from
 * BOTH binary and ASCII STL — pure DataView / regex arithmetic, no THREE, no
 * fragile deep imports. The result can be wrapped as a `{ attributes:{ position:
 * { array, count } }, index:null }` duck-type and fed to faceInspection's
 * topology/hole detectors, so genus + hole counts survive even when the rich
 * `verifyStlBuffer` enrichment (which pulls the `[lang]` analysis bundle) fails
 * to resolve in a production server bundle. Returns an empty array on a
 * zero-triangle mesh; never throws on a well-formed STL.
 */
export function parseStlBufferToPositions(bytes: Uint8Array): Float32Array {
  if (looksBinaryStl(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const faces = dv.getUint32(80, true);
    const maxFaces = Math.floor((bytes.length - 84) / 50);
    const triangleCount = Math.min(faces, Math.max(0, maxFaces));
    const out = new Float32Array(triangleCount * 9);
    let o = 84;
    for (let t = 0; t < triangleCount; t++) {
      o += 12; // skip the face normal
      for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(o + k * 4, true);
      o += 36 + 2; // 3 verts + attribute byte count
    }
    return out;
  }
  const text = new TextDecoder().decode(bytes);
  const re = /vertex\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)\s+([-+eE0-9.]+)/g;
  const verts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  const triangleCount = Math.floor(verts.length / 9);
  return Float32Array.from(verts.slice(0, triangleCount * 9));
}

/**
 * Cheap triangle count for BOTH binary and ASCII STL. The binary-STL header
 * (uint32 at offset 80) is only valid for binstl; `runOpenScadCli` doesn't
 * force `--export-format`, so the installed OpenSCAD may emit ASCII — in which
 * case reading offset 80 as a count yields garbage. This handles both.
 */
export function countStlTriangles(bytes: Uint8Array): number {
  if (looksBinaryStl(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const faces = dv.getUint32(80, true);
    const maxFaces = Math.floor((bytes.length - 84) / 50);
    return Math.min(faces, Math.max(0, maxFaces));
  }
  const text = new TextDecoder().decode(bytes);
  const m = text.match(/\bfacet\b/g);
  return m ? m.length : 0;
}
