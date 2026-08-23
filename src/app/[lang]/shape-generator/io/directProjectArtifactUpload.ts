import { Sha256 } from '@aws-crypto/sha256-js';

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

type UploadProgress = {
  phase: 'hashing' | 'uploading' | 'verifying';
  loadedBytes: number;
  totalBytes: number;
};

type UploadIntent = {
  uploadId: string;
  method: 'PUT' | 'MULTIPART_PUT';
  contentType: string;
  resumable: boolean;
  uploadUrl?: string;
  partSizeBytes?: number;
  totalParts?: number;
};

type UploadResult = {
  ok: true;
  idempotent: boolean;
  artifact: {
    artifactId: string;
    projectId: string;
    objectKey: string;
    byteLength: number;
    contentSha256: string;
  };
};

export interface ProjectArtifactUploadOptions {
  signal?: AbortSignal;
  shapeIdentitySha256?: string;
  onProgress?: (progress: UploadProgress) => void;
  fetchImpl?: typeof fetch;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashProjectArtifactFile(
  file: Blob,
  options: Pick<ProjectArtifactUploadOptions, 'signal' | 'onProgress'> = {},
): Promise<string> {
  const hash = new Sha256();
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    options.signal?.throwIfAborted();
    const end = Math.min(file.size, offset + HASH_CHUNK_BYTES);
    hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    options.onProgress?.({ phase: 'hashing', loadedBytes: end, totalBytes: file.size });
  }
  return bytesToHex(await hash.digest());
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
    throw new Error(`artifact_upload_${code}`);
  }
  return body as T;
}

async function postUploadAction<T>(
  endpoint: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<T> {
  return readJson<T>(await fetchImpl(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }));
}

export async function uploadProjectCadArtifact(
  projectId: string,
  file: File,
  options: ProjectArtifactUploadOptions = {},
): Promise<UploadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/artifacts/uploads`;
  const contentSha256 = await hashProjectArtifactFile(file, options);
  const intent = await postUploadAction<UploadIntent>(endpoint, {
    action: 'intent',
    filename: file.name,
    byteLength: file.size,
    contentSha256,
    ...(options.shapeIdentitySha256 ? { shapeIdentitySha256: options.shapeIdentitySha256 } : {}),
  }, fetchImpl, options.signal);

  if (intent.method === 'PUT') {
    if (!intent.uploadUrl) throw new Error('artifact_upload_missing_put_url');
    const uploaded = await fetchImpl(intent.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': intent.contentType },
      body: file,
      signal: options.signal,
    });
    if (!uploaded.ok) throw new Error(`artifact_upload_storage_HTTP_${uploaded.status}`);
    options.onProgress?.({ phase: 'uploading', loadedBytes: file.size, totalBytes: file.size });
  } else {
    const partSize = Number(intent.partSizeBytes);
    const totalParts = Number(intent.totalParts);
    if (!Number.isSafeInteger(partSize) || partSize <= 0 || !Number.isSafeInteger(totalParts) || totalParts <= 0) {
      throw new Error('artifact_upload_invalid_multipart_intent');
    }
    const resume = await postUploadAction<{
      uploadedParts: Array<{ partNumber: number; size: number }>;
    }>(endpoint, { action: 'status', uploadId: intent.uploadId }, fetchImpl, options.signal);
    const uploadedParts = new Set(resume.uploadedParts.map(part => part.partNumber));
    let loadedBytes = resume.uploadedParts.reduce((total, part) => total + Number(part.size || 0), 0);
    options.onProgress?.({ phase: 'uploading', loadedBytes, totalBytes: file.size });
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      options.signal?.throwIfAborted();
      if (uploadedParts.has(partNumber)) continue;
      const part = await postUploadAction<{
        uploadUrl?: string;
        alreadyUploaded: boolean;
        size?: number;
      }>(endpoint, { action: 'part-url', uploadId: intent.uploadId, partNumber }, fetchImpl, options.signal);
      if (part.alreadyUploaded) {
        loadedBytes += Number(part.size || 0);
        options.onProgress?.({ phase: 'uploading', loadedBytes, totalBytes: file.size });
        continue;
      }
      if (!part.uploadUrl) throw new Error('artifact_upload_missing_part_url');
      const start = (partNumber - 1) * partSize;
      const end = Math.min(file.size, start + partSize);
      const uploaded = await fetchImpl(part.uploadUrl, {
        method: 'PUT',
        body: file.slice(start, end),
        signal: options.signal,
      });
      if (!uploaded.ok) throw new Error(`artifact_upload_part_${partNumber}_HTTP_${uploaded.status}`);
      loadedBytes += end - start;
      options.onProgress?.({ phase: 'uploading', loadedBytes, totalBytes: file.size });
    }
  }

  options.onProgress?.({ phase: 'verifying', loadedBytes: file.size, totalBytes: file.size });
  const result = await postUploadAction<UploadResult>(endpoint, {
    action: 'complete', uploadId: intent.uploadId,
  }, fetchImpl, options.signal);
  if (!result.ok || result.artifact.contentSha256 !== contentSha256 || result.artifact.byteLength !== file.size) {
    throw new Error('artifact_upload_verification_mismatch');
  }
  return result;
}
