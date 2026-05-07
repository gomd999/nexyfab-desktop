import { getStorage } from '@/lib/storage';
import { OPENSCAD_ARTIFACT_MIN_BYTES_FOR_S3 } from './constants';
import type { OpenScadMeshFormat } from './runOpenScadCli';

function minBytesForS3(): number {
  const n = Number(process.env.OPENSCAD_ARTIFACT_MIN_BYTES);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return OPENSCAD_ARTIFACT_MIN_BYTES_FOR_S3;
}

/**
 * Uploads mesh to configured storage (S3/R2 when S3_BUCKET is set, else local public/).
 * When `OPENSCAD_ALWAYS_S3=1`, uploads regardless of size (if storage is configured).
 */
export async function maybeUploadOpenScadArtifact(opts: {
  buffer: Buffer;
  userId: string;
  jobId: string;
  format: OpenScadMeshFormat;
}): Promise<{ artifactKey?: string; artifactUrl?: string }> {
  if (process.env.OPENSCAD_DISABLE_S3 === '1') return {};

  const always =
    process.env.OPENSCAD_ALWAYS_S3 === '1' || process.env.OPENSCAD_ALWAYS_S3 === 'true';
  const minB = minBytesForS3();
  if (!always && opts.buffer.length < minB) return {};

  try {
    const storage = getStorage();
    const ext = opts.format === 'off' ? 'off' : 'stl';
    const fname = `${opts.jobId}.${ext}`;
    const dir = `openscad-artifacts/${opts.userId}`;
    const { key, url } = await storage.upload(opts.buffer, fname, dir);
    let artifactUrl = url;
    if (storage.getSignedUrl) {
      try {
        artifactUrl = await storage.getSignedUrl(key, 3600);
      } catch {
        /* keep public url */
      }
    }
    return { artifactKey: key, artifactUrl };
  } catch (e) {
    console.warn('[openscad] artifact upload failed', e);
    return {};
  }
}
