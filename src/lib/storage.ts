import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StorageResult {
  key: string;       // unique file key (e.g., "uploads/quick-quote/abc123/file.step")
  url: string;       // public or signed URL
  size: number;
}

export interface StorageAdapter {
  upload(buffer: Buffer, filename: string, directory: string): Promise<StorageResult>;
  /** Upload directly at an exact key (no UUID prefix) */
  uploadRaw?(buffer: Buffer, key: string, contentType?: string): Promise<void>;
  /** Download raw buffer by key */
  download?(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// ─── Local Filesystem Storage ──────────────────────────────────────────────

function getLocalStorage(): StorageAdapter {
  return {
    async upload(buffer, filename, directory) {
      const id = randomUUID();
      const dir = path.join(process.cwd(), 'public', directory, id);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, buffer);
      const key = `${directory}/${id}/${filename}`;
      return { key, url: `/${key}`, size: buffer.length };
    },
    async uploadRaw(buffer, key) {
      const filePath = path.join(process.cwd(), 'public', key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
    },
    async download(key) {
      const filePath = path.join(process.cwd(), 'public', key);
      return fs.readFileSync(filePath);
    },
    async getSignedUrl(key) {
      return `/${key}`; // local files are publicly accessible
    },
    async delete(key) {
      const filePath = path.join(process.cwd(), 'public', key);
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    },
  };
}

// ─── S3 Storage ────────────────────────────────────────────────────────────

function getS3Storage(): StorageAdapter {
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION || 'ap-northeast-2';
  const endpoint = process.env.S3_ENDPOINT; // R2: https://<accountid>.r2.cloudflarestorage.com
  const publicUrl = process.env.S3_PUBLIC_URL; // R2 public bucket URL (optional)

  function makeClient(S3Client: typeof import('@aws-sdk/client-s3').S3Client) {
    return new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  function getFileUrl(key: string) {
    if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/${key}`;
    if (endpoint) return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  // Wrap each S3 op so it lands in nf_api_usage. Helps spot R2 outages,
  // sustained 5xx, or unusually slow object PUTs (large STEP/STL files).
  async function withMeter<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    let statusCode = 200;
    let errorMessage: string | undefined;
    try {
      return await fn();
    } catch (err) {
      statusCode = 0;
      errorMessage = (err as Error).message;
      throw err;
    } finally {
      void (async () => {
        try {
          const { recordApiUsage } = await import('./api-meter');
          recordApiUsage({
            provider: 'r2',
            endpoint,
            statusCode,
            latencyMs: Date.now() - t0,
            errorMessage,
          });
        } catch { /* ignore */ }
      })();
    }
  }

  return {
    async upload(buffer, filename, directory) {
      return withMeter('putObject', async () => {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const id = randomUUID();
        const key = `${directory}/${id}/${filename}`;
        await makeClient(S3Client).send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: buffer, ContentType: getMimeType(filename),
        }));
        return { key, url: getFileUrl(key), size: buffer.length };
      });
    },
    async uploadRaw(buffer, key, contentType = 'application/octet-stream') {
      await withMeter('putObject', async () => {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        await makeClient(S3Client).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
      });
    },
    async download(key) {
      return withMeter('getObject', async () => {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const res = await makeClient(S3Client).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const chunks: Buffer[] = [];
        for await (const chunk of (res.Body as AsyncIterable<Uint8Array>)) {
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      });
    },
    async getSignedUrl(key, expiresInSeconds = 900) {
      return withMeter('getSignedUrl', async () => {
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        return getSignedUrl(makeClient(S3Client), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
      });
    },
    async delete(key) {
      await withMeter('deleteObject', async () => {
        const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        await makeClient(S3Client).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      });
    },
  };
}

// ─── MIME Type Helper ──────────────────────────────────────────────────────

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    step: 'application/step', stp: 'application/step',
    stl: 'application/sla', obj: 'text/plain',
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    zip: 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _storage: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (_storage) return _storage;
  _storage = process.env.S3_BUCKET ? getS3Storage() : getLocalStorage();
  return _storage;
}
