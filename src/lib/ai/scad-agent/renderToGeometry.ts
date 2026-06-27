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

  const resp = await fetch('/api/nexyfab/openscad-render', {
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
