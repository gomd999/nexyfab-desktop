/**
 * Optional server-side STEP → STL preview via `/api/nexyfab/brep/step-import`.
 * Falls back to local WASM/OCCT path when API is off, anonymous, or errors.
 */
import * as THREE from 'three';
import { parseSTL } from './importers';
import { BREP_STEP_SYNC_MAX_BYTES } from '@/lib/brep-bridge/constants';
import { StepImportApiError } from './stepImportApiError';

export { StepImportApiError } from './stepImportApiError';

function serverImportDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  return process.env.NEXT_PUBLIC_SERVER_STEP_IMPORT === '0';
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof atob !== 'undefined') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64')).buffer;
  }
  return new ArrayBuffer(0);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  if (typeof btoa !== 'undefined') return btoa(binary);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => {
    setTimeout(res, ms);
  });
}

async function geometryFromPreview(data: {
  previewMeshBase64?: string;
  artifactUrl?: string;
}): Promise<THREE.BufferGeometry | null> {
  if (data.previewMeshBase64) {
    try {
      const buf = base64ToArrayBuffer(data.previewMeshBase64);
      return parseSTL(buf);
    } catch {
      return null;
    }
  }
  if (data.artifactUrl) {
    try {
      const r = await fetch(data.artifactUrl);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return parseSTL(ab);
    } catch {
      return null;
    }
  }
  return null;
}

async function pollJob(jobId: string): Promise<THREE.BufferGeometry | null> {
  for (let i = 0; i < 180; i++) {
    const r = await fetch(`/api/nexyfab/brep/step-import/job/${jobId}`, { credentials: 'include' });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      const msg = typeof d.error === 'string' ? d.error : `HTTP ${r.status}`;
      const code = typeof d.code === 'string' ? d.code : undefined;
      throw new StepImportApiError(msg, code, r.status);
    }
    const status = d.status as string | undefined;
    if (status === 'complete') {
      const geo = await geometryFromPreview({
        previewMeshBase64: typeof d.previewMeshBase64 === 'string' ? d.previewMeshBase64 : undefined,
        artifactUrl: typeof d.artifactUrl === 'string' ? d.artifactUrl : undefined,
      });
      if (geo) return geo;
      return null;
    }
    if (status === 'failed') {
      const msg = typeof d.errorMessage === 'string' ? d.errorMessage : 'Job failed';
      throw new StepImportApiError(msg, 'BREP_JOB_FAILED', r.status);
    }
    await sleep(1000);
  }
  return null;
}

export interface ServerStepImportOk {
  geometry: THREE.BufferGeometry;
}

/** Returns geometry when the API produced a mesh; otherwise `null` → caller uses client STEP. */
export async function tryServerStepImport(filename: string, buffer: ArrayBuffer): Promise<ServerStepImportOk | null> {
  if (serverImportDisabled()) return null;

  let base64: string;
  try {
    base64 = arrayBufferToBase64(buffer);
    if (!base64) return null;
  } catch {
    return null;
  }

  const asyncMode = buffer.byteLength > BREP_STEP_SYNC_MAX_BYTES;

  const res = await fetch('/api/nexyfab/brep/step-import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { kind: 'inlineBase64', base64, filename },
      async: asyncMode,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 401) return null;

  if (res.status === 403) {
    const msg = typeof data.error === 'string' ? data.error : 'Forbidden';
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new StepImportApiError(msg, code, res.status);
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new StepImportApiError(msg, code, res.status);
  }

  if (data.mode === 'async' && typeof data.jobId === 'string') {
    const geo = await pollJob(data.jobId);
    if (!geo) return null;
    return { geometry: geo };
  }

  if (data.mode === 'sync') {
    const geo = await geometryFromPreview({
      previewMeshBase64: typeof data.previewMeshBase64 === 'string' ? data.previewMeshBase64 : undefined,
      artifactUrl: typeof data.artifactUrl === 'string' ? data.artifactUrl : undefined,
    });
    if (!geo) return null;
    return { geometry: geo };
  }

  return null;
}
