import { maybeUploadOpenScadArtifact } from '@/lib/openscad-render/artifactUpload';
import { nfApiDebug } from '@/lib/nfApiLog';
import { brepWorkerTimeoutMs } from './constants';
import type { OpenScadMeshFormat } from '@/lib/openscad-render/runOpenScadCli';

/**
 * Tessellates STEP via optional `BREP_WORKER_URL` (POST JSON `{ filename, base64, jobId }`).
 * Without a worker: validates ISO-10303 header and returns a clear “configure worker” message.
 */
export async function runBrepStepProcess(opts: {
  userId: string;
  jobId: string;
  filename: string;
  buffer: Buffer;
}): Promise<{
  previewMeshBase64?: string;
  artifactUrl?: string;
  artifactKey?: string;
  brepSessionToken?: string;
  errorMessage?: string;
}> {
  const workerBase = process.env.BREP_WORKER_URL?.trim();
  if (workerBase) {
    const url = `${workerBase.replace(/\/$/, '')}/tessellate`;
    const timeoutMs = brepWorkerTimeoutMs();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: opts.filename,
            base64: opts.buffer.toString('base64'),
            jobId: opts.jobId,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) {
          return { errorMessage: `BREP worker HTTP ${res.status}: ${text.slice(0, 240)}` };
        }
        let data: {
          previewMeshBase64?: string;
          previewStlBase64?: string;
          artifactUrl?: string;
          brepSessionToken?: string;
          error?: string;
        };
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          return { errorMessage: 'BREP worker returned non-JSON body.' };
        }
        if (data.error) return { errorMessage: data.error };
        const meshB64 = data.previewMeshBase64 ?? data.previewStlBase64;
        return {
          previewMeshBase64: meshB64,
          artifactUrl: data.artifactUrl,
          brepSessionToken: data.brepSessionToken,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt === 0) {
          nfApiDebug('brep.worker', 'fetch_retry', { jobId: opts.jobId, message: msg });
          continue;
        }
        return { errorMessage: `BREP worker request failed: ${msg}` };
      }
    }
  }

  const head = opts.buffer.subarray(0, Math.min(4096, opts.buffer.length)).toString('latin1');
  if (!/ISO-10303|HEADER|STEP/i.test(head)) {
    return { errorMessage: 'Not a valid STEP file (expected ISO-10303 / STEP header).' };
  }

  return {
    errorMessage:
      'STEP header validated. Tessellation is not configured — set BREP_WORKER_URL to an OCCT-backed worker endpoint, or use in-browser STEP import.',
  };
}

/** Optional: upload STL preview from base64 when worker returned mesh and env storage is set. */
export async function maybeUploadBrepPreviewStl(opts: {
  userId: string;
  jobId: string;
  previewMeshBase64: string;
}): Promise<{ artifactUrl?: string; artifactKey?: string }> {
  let buf: Buffer;
  try {
    buf = Buffer.from(opts.previewMeshBase64, 'base64');
  } catch {
    return {};
  }
  if (buf.length === 0) return {};
  return maybeUploadOpenScadArtifact({
    buffer: buf,
    userId: opts.userId,
    jobId: opts.jobId,
    format: 'stl' as OpenScadMeshFormat,
  });
}
